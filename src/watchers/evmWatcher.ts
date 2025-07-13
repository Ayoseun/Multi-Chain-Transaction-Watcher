// --- src/evmWatcher.ts ---
import { ethers, WebSocketProvider } from "ethers";
import { ERC20_ABI } from "../resources/abi";
import { publishTransactionFound } from "../services/rabbit";
import { getContract, getAllWallets, WalletInfo, getAllWatchedContracts, getAllContracts, ContractInfo } from "../services/redis";
import { ContactInfo } from "@solana/web3.js";

interface ChainConfig {
  name: string;
  ws: string;
  chainId: number;
  nativeSymbol: string;
  confirmations: number;
}

interface ActiveWatcher {
  provider: WebSocketProvider;
  cleanup: () => void;
}

const activeWatchers = new Map<string, ActiveWatcher>();
const pendingTransactions = new Map<string, { tx: any; confirmations: number; requiredConfirmations: number; chain: string }>();

// Chain WebSocket RPC URLs
const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  ethereum: {
    name: "Ethereum",
    ws: process.env.ETHEREUM || "wss://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
    nativeSymbol: "ETH",
    confirmations: 12,
  },
  polygon: {
    name: "Polygon",
    ws: process.env.POLYGON || "wss://polygon-amoy-bor-rpc.publicnode.com",
    chainId: 80002,
    nativeSymbol: "POL",
    confirmations: 30,
  },
  arbitrum: {
    name: "Arbitrum",
    ws: process.env.ARBITRUM || "wss://arbitrum-sepolia.drpc.org",
    chainId: 421614,
    nativeSymbol: "ETH",
    confirmations: 1,
  },
};

export async function startEvmWatcher(chainKey?: string): Promise<void> {
  const chainsToWatch = chainKey ? [chainKey] : Object.keys(CHAIN_CONFIGS);
  for (const chain of chainsToWatch) {
    await startChainWatcher(chain, CHAIN_CONFIGS[chain]);
  }
}

async function startChainWatcher(chainKey: string, config: ChainConfig): Promise<void> {
  const provider = new WebSocketProvider(config.ws);
  console.log(`Connected to ${config.name} WebSocket-rpc ${config.ws}`);

  provider.on("block", async (blockNumber) => {
    console.log("watching on", chainKey)
    const block = await provider.getBlock(blockNumber, true);
    if (!block?.transactions) return;

    const addresses = await getAllWallets("evm");

    const addressSet = new Set(addresses.map((a: WalletInfo) => a.address.toLowerCase()));
    console.log(addressSet)
    const contracts: ContractInfo[] = await getAllContracts(chainKey);

    const contractSet = new Set(contracts.map((a: ContractInfo) => a.address.toLowerCase()));
    console.log(contractSet)
    for (const tx of block.transactions) {
      let receipt: any;
      try {
        receipt = await provider.getTransactionReceipt(tx);
      } catch (err) {
        console.error(`Failed to get receipt for ${tx}:`, err);
        continue; // skip this tx
      }
      if (!receipt?.to) continue;

      const to = receipt.to.toLowerCase();
      const from = receipt.from.toLowerCase();

      if (addressSet.has(to) || addressSet.has(from) || contractSet.has(to)) {
        await processTransaction(provider, tx, receipt, config, chainKey);
      }
    }

    await updatePendingTransactions(chainKey, provider);
  });

  activeWatchers.set(chainKey, {
    provider,
    cleanup: () => provider.destroy(),
  });
}

async function processTransaction(provider: WebSocketProvider, tx: any, receipt: any, config: ChainConfig, chainKey: string) {
  const isNative = tx.value && tx.value > 0;
  const isToken = tx.to && tx.data && tx.data !== "0x";

  if (isNative) {
    pendingTransactions.set(`${chainKey}_${tx.hash}`, {
      tx: {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        blockNumber: tx.blockNumber,
        type: "native",
        symbol: config.nativeSymbol,
        decimals: 18,
        chain: config.name,
      },
      confirmations: 1,
      requiredConfirmations: config.confirmations,
      chain: chainKey,
    });
  }

  if (isToken) {
    const contractInfo = await getContract("EVM", tx.to);
    if (!contractInfo) return;

    const contract = new ethers.Contract(tx.to, ERC20_ABI, provider);
    const events = receipt.logs.map((log: any) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    }).filter((e: any) => e?.name === "Transfer");

    for (const event of events) {
      pendingTransactions.set(`${chainKey}_${tx.hash}_${event.args.from}_${event.args.to}`, {
        tx: {
          hash: tx.hash,
          from: event.args.from,
          to: event.args.to,
          value: event.args.value.toString(),
          blockNumber: receipt.blockNumber,
          type: "token",
          chain: config.name,
          contractAddress: contractInfo.address,
          contractName: contractInfo.name,
          symbol: contractInfo.symbol,
          decimals: contractInfo.decimals,
        },
        confirmations: 1,
        requiredConfirmations: config.confirmations,
        chain: chainKey,
      });
    }
  }
}

async function updatePendingTransactions(chainKey: string, provider: WebSocketProvider): Promise<void> {
  const blockNumber = await provider.getBlockNumber();
  const toRemove: string[] = [];

  for (const [key, txInfo] of pendingTransactions.entries()) {
    if (!key.startsWith(`${chainKey}_`)) continue;

    const conf = blockNumber - txInfo.tx.blockNumber + 1;
    txInfo.confirmations = conf;

    if (conf >= txInfo.requiredConfirmations) {
      await publishTransactionFound({
        transactionHash: txInfo.tx.hash,
        fromAddress: txInfo.tx.from,
        toAddress: txInfo.tx.to,
        amount: txInfo.tx.value,
        tokenAddress: txInfo.tx.contractAddress,
        chain: "evm",
        blockNumber: txInfo.tx.blockNumber,
        timestamp: Date.now(),
        type: txInfo.tx.type,
        gasUsed: null!,
        gasPrice: null!,
        direction: "incoming",
        walletAddress: txInfo.tx.from,
      });
      toRemove.push(key);
    }
  }

  toRemove.forEach(k => pendingTransactions.delete(k));
}

export async function stopEvmWatcher(chainKey?: string): Promise<void> {
  const targets = chainKey ? [chainKey] : Array.from(activeWatchers.keys());
  for (const key of targets) {
    const watcher = activeWatchers.get(key);
    if (watcher) {
      watcher.cleanup();
      activeWatchers.delete(key);
      console.log(`${key} WebSocket watcher stopped.`);
    }
  }
}
