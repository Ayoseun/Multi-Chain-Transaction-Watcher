// --- src/solanaWatcher.ts ---
import {
  Connection,
  PublicKey,
  VersionedMessage,
  VersionedTransactionResponse,
  ConfirmedTransactionMeta,
  TransactionVersion,
  BlockResponse
} from "@solana/web3.js";
import { SOLANA_RPC } from "./config";
import { publishTransactionFound } from "./rabbit";
import { getWallet, getContract, getWatchedContracts } from "./redis";

// --- Types ---
interface SolanaActiveWatcher {
  intervalId: NodeJS.Timeout;
  connection: Connection;
  cleanup: () => void;
}

interface TransactionWithSlot {
  slot: number;
  transaction: {
    message: VersionedMessage;
    signatures: string[];
  };
  meta: ConfirmedTransactionMeta | null;
  version?: TransactionVersion;
}

// --- Globals ---
const solanaPendingTransactions = new Map<string, { tx: any; slot: number; requiredConfirmations: number }>();
let solanaWatcher: SolanaActiveWatcher | null = null;
const SOLANA_CONFIRMATIONS = 32;

export async function startSolanaWatcher(): Promise<void> {
  console.log("Starting Solana watcher...");
  const connection = new Connection(SOLANA_RPC, "confirmed");
  let lastProcessedSlot = await connection.getSlot();

  const intervalId = setInterval(async () => {
    try {
      const currentSlot = await connection.getSlot();

      if (currentSlot > lastProcessedSlot) {
        await processNewSlots(connection, lastProcessedSlot + 1, currentSlot);
        lastProcessedSlot = currentSlot;
      }

      await updateSolanaPendingTransactions(connection, currentSlot);
    } catch (error) {
      console.error("Error in Solana transaction check:", error);
    }
  }, 2000);

  solanaWatcher = {
    intervalId,
    connection,
    cleanup: () => clearInterval(intervalId),
  };

  console.log("Solana watcher started successfully");
}

async function processNewSlots(connection: Connection, fromSlot: number, toSlot: number): Promise<void> {
  const wallets = await connection.getProgramAccounts(new PublicKey("11111111111111111111111111111111")); // dummy to avoid unused
  const allWallets = await getAllWalletKeys(); // custom function shown below
  const addressSet = new Set(allWallets.map(a => a.toLowerCase()));

  const watchedContracts = await getWatchedContracts('solana');
  const contractSet = new Set(watchedContracts.map(a => a.toLowerCase()));

  for (let slot = fromSlot; slot <= toSlot; slot++) {
    try {
      const block = await connection.getBlock(slot, {
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full"
      });

      if (!block?.transactions) continue;

      for (const tx of block.transactions) {
        if (!tx.transaction || tx.meta?.err) continue;

        const accounts = tx.transaction.message.staticAccountKeys;
        const hasWatched = accounts.some(key =>
          addressSet.has(key.toBase58().toLowerCase()) ||
          contractSet.has(key.toBase58().toLowerCase())
        );

        if (hasWatched && tx.transaction.signatures[0]) {
          const txWithSlot: TransactionWithSlot = {
            ...tx,
            slot
          };
          await processSolanaTransaction(connection, txWithSlot, slot);
        }
      }
    } catch (error) {
      console.error(`Error processing Solana slot ${slot}:`, error);
    }
  }
}

async function processSolanaTransaction(
  connection: Connection,
  tx: TransactionWithSlot,
  slot: number
): Promise<void> {
  try {
    const signature = tx.transaction.signatures[0];
    if (!signature) return;

    const accounts = tx.transaction.message.staticAccountKeys;
    if (accounts.length < 2) return;

    const isNativeTransfer = tx.meta?.preBalances && tx.meta?.postBalances &&
      tx.meta.preBalances.some((pre, i) => pre !== tx.meta!.postBalances![i]);

    const isTokenTransfer = tx.meta?.preTokenBalances?.length && tx.meta?.postTokenBalances?.length;

    if (isNativeTransfer) {
      await handleSolanaTransaction(tx, slot, 'native');
    }

    if (isTokenTransfer) {
      await handleSolanaTokenTransaction(tx, slot);
    }

  } catch (error) {
    console.error("Error processing Solana transaction:", error);
  }
}

async function handleSolanaTransaction(
  tx: TransactionWithSlot,
  slot: number,
  type: 'native' | 'token'
): Promise<void> {
  const signature = tx.transaction.signatures[0];
  if (!signature) return;

  const accounts = tx.transaction.message.staticAccountKeys;
  if (accounts.length < 2) return;

  let transferredAmount = '0';
  if (tx.meta?.preBalances && tx.meta?.postBalances) {
    const balanceChange = tx.meta.postBalances[1] - tx.meta.preBalances[1];
    transferredAmount = Math.abs(balanceChange).toString();
  }

  const transactionKey = `solana_${signature}`;
  solanaPendingTransactions.set(transactionKey, {
    tx: {
      hash: signature,
      from: accounts[0].toBase58(),
      to: accounts[1].toBase58(),
      value: transferredAmount,
      slot,
      type,
      chain: 'Solana',
      symbol: 'SOL',
      decimals: 9
    },
    slot,
    requiredConfirmations: SOLANA_CONFIRMATIONS
  });

  console.log(`Solana ${type} transaction ${signature} added to confirmation tracking`);
}

async function handleSolanaTokenTransaction(tx: TransactionWithSlot, slot: number): Promise<void> {
  if (!tx.meta?.preTokenBalances || !tx.meta?.postTokenBalances) return;

  const signature = tx.transaction.signatures[0];
  if (!signature) return;

  for (const post of tx.meta.postTokenBalances) {
    const pre = tx.meta.preTokenBalances.find(p =>
      p.accountIndex === post.accountIndex && p.mint === post.mint
    );

    if (!pre) continue;

    const mintAddress = post.mint;
    const contract = await getContract('Solana', mintAddress);
    if (!contract) continue;

    const balanceChange = BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount);
    if (balanceChange === 0n) continue;

    const transactionKey = `solana_${signature}_${mintAddress}`;
    solanaPendingTransactions.set(transactionKey, {
      tx: {
        hash: signature,
        from: pre.owner || '',
        to: post.owner || '',
        value: Math.abs(Number(balanceChange)).toString(),
        slot,
        type: 'token',
        chain: 'Solana',
        contractAddress: contract.address,
        contractName: contract.name,
        symbol: contract.symbol,
        decimals: contract.decimals
      },
      slot,
      requiredConfirmations: SOLANA_CONFIRMATIONS
    });

    console.log(`Solana token transaction ${signature} added to confirmation tracking`);
  }
}

async function updateSolanaPendingTransactions(connection: Connection, currentSlot: number): Promise<void> {
  const toRemove: string[] = [];

  for (const [key, pending] of solanaPendingTransactions.entries()) {
    const confirmations = currentSlot - pending.slot;

    if (confirmations >= pending.requiredConfirmations) {
      await publishTransactionFound({
        transactionHash: pending.tx.hash,
        fromAddress: pending.tx.from,
        toAddress: pending.tx.to,
        amount: pending.tx.value,
        tokenAddress: pending.tx.contractAddress,
        chain: 'Solana',
        blockNumber: pending.slot,
        timestamp: Date.now(),
        type: pending.tx.type,
        direction: pending.tx.from === pending.tx.chain ? 'outgoing' : 'incoming',
      });

      console.log(`Published confirmed Solana transaction: ${pending.tx.hash}`);
      toRemove.push(key);
    }
  }

  for (const key of toRemove) {
    solanaPendingTransactions.delete(key);
  }
}

export async function stopSolanaWatcher(): Promise<void> {
  if (solanaWatcher) {
    solanaWatcher.cleanup();
    solanaWatcher = null;
    console.log("Solana watcher stopped");
  }
}

// Helper to gather all wallet keys
async function getAllWalletKeys(): Promise<string[]> {
  const redis = await import('./redis');
  const [evm, solana] = await Promise.all([
    redis.getWatchedContracts('evm'),
    redis.getWatchedContracts('solana')
  ]);
  return [...evm, ...solana];
}
