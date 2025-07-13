// --- src/rabbit.ts ---
import amqp from "amqplib";
import { RABBITMQ_URL } from "./config";

// Connection and channel refs
let connection: amqp.Connection | null = null;
let publishChannel: amqp.Channel | null = null;
let channelClosed = true;

async function getConnection(): Promise<amqp.Connection> {
    let newConnection:amqp.ChannelModel|null = null
  if (!connection) {
    newConnection = await amqp.connect(RABBITMQ_URL || "amqp://localhost");

   newConnection. connection.on('error', (err:any) => {
      console.error('❌ RabbitMQ connection error:', err);
      connection = null;
      publishChannel = null;
      channelClosed = true;
    });

    newConnection.connection.on('close', () => {
      console.log('🔌 RabbitMQ connection closed');
      connection = null;
      publishChannel = null;
      channelClosed = true;
    });
  }

  return newConnection!.connection;
}

async function getPublishChannel(): Promise<amqp.Channel> {
  if (!publishChannel || channelClosed) {
    const conn = await amqp.connect(RABBITMQ_URL || "amqp://localhost");
    publishChannel = await conn.createChannel();
    channelClosed = false;

    publishChannel.on('error', (err) => {
      console.error('❌ RabbitMQ channel error:', err);
      publishChannel = null;
      channelClosed = true;
    });

    publishChannel.on('close', () => {
      console.warn('⚠️ RabbitMQ channel closed');
      publishChannel = null;
      channelClosed = true;
    });
  }

  return publishChannel;
}

export const QUEUES = {
  TRANSACTION_FOUND: 'transaction.found.queue',
  TRANSFER_COMPLETE: 'transfer.complete.queue',
} as const;

export interface TransactionFoundPayload {
  transactionHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  tokenAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  chain: string;
  blockNumber: number;
  timestamp: number;
  gasUsed?: string;
  gasPrice?: string;
  type: 'native' | 'token';
  direction: 'incoming' | 'outgoing';
    walletAddress?: string; // Address of the wallet that initiated the transaction
 
}

export interface TransferCompletePayload extends TransactionFoundPayload {
  status: 'success' | 'failed';
  confirmations: number;
  failureReason?: string;
}

// --- Publishers ---
export async function publishTransactionFound(payload: TransactionFoundPayload): Promise<void> {
  try {
    const ch = await getPublishChannel();
    await ch.assertQueue(QUEUES.TRANSACTION_FOUND, { durable: true });

    const published = ch.sendToQueue(
      QUEUES.TRANSACTION_FOUND,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        timestamp: Date.now(),
        messageId: `tx_${payload.transactionHash}_${Date.now()}`
      }
    );

    if (published) {
      console.log(`✅ Published transaction: ${payload.transactionHash}`);
    } else {
      console.warn(`⚠️ Queue full for transaction: ${payload.transactionHash}`);
    }
  } catch (err) {
    console.error('❌ Failed to publish transaction found:', err);
    throw err;
  }
}

export async function publishTransferComplete(payload: TransferCompletePayload): Promise<void> {
  try {
    const ch = await getPublishChannel();
    await ch.assertQueue(QUEUES.TRANSFER_COMPLETE, { durable: true });

    const published = ch.sendToQueue(
      QUEUES.TRANSFER_COMPLETE,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        timestamp: Date.now(),
        messageId: `complete_${payload.transactionHash}_${Date.now()}`
      }
    );

    if (published) {
      console.log(`✅ Published transfer: ${payload.transactionHash} (${payload.status})`);
    } else {
      console.warn(`⚠️ Queue full for transfer: ${payload.transactionHash}`);
    }
  } catch (err) {
    console.error('❌ Failed to publish transfer complete:', err);
    throw err;
  }
}

// --- Batch Publishers ---
export async function publishMultipleTransactions(transactions: TransactionFoundPayload[]): Promise<void> {
  if (transactions.length === 0) return;

  try {
    const ch = await getPublishChannel();
    await ch.assertQueue(QUEUES.TRANSACTION_FOUND, { durable: true });

    const now = Date.now();

    for (const tx of transactions) {
      ch.sendToQueue(
        QUEUES.TRANSACTION_FOUND,
        Buffer.from(JSON.stringify(tx)),
        {
          persistent: true,
          timestamp: now,
          messageId: `tx_${tx.transactionHash}_${now}`
        }
      );
    }

    console.log(`✅ Published ${transactions.length} transactions`);
  } catch (err) {
    console.error('❌ Failed batch publish (transactions):', err);
    throw err;
  }
}

export async function publishMultipleTransferCompletions(completions: TransferCompletePayload[]): Promise<void> {
  if (completions.length === 0) return;

  try {
    const ch = await getPublishChannel();
    await ch.assertQueue(QUEUES.TRANSFER_COMPLETE, { durable: true });

    const now = Date.now();

    for (const tx of completions) {
      ch.sendToQueue(
        QUEUES.TRANSFER_COMPLETE,
        Buffer.from(JSON.stringify(tx)),
        {
          persistent: true,
          timestamp: now,
          messageId: `complete_${tx.transactionHash}_${now}`
        }
      );
    }

    console.log(`✅ Published ${completions.length} transfers`);
  } catch (err) {
    console.error('❌ Failed batch publish (completions):', err);
    throw err;
  }
}

// --- Payload Factories ---
export function createTransactionFoundPayload(params: Omit<TransactionFoundPayload, 'type' | 'direction'>): TransactionFoundPayload {
  return {
    ...params,
    type: params.tokenAddress ? 'token' : 'native',
    direction: params.toAddress.toLowerCase() === params.walletAddress!.toLowerCase() ? 'incoming' : 'outgoing'
  };
}

export function createTransferCompletePayload(params: Omit<TransferCompletePayload, 'type' | 'direction'>): TransferCompletePayload {
  return {
    ...params,
    type: params.tokenAddress ? 'token' : 'native',
    direction: params.toAddress.toLowerCase() === params.walletAddress!.toLowerCase() ? 'incoming' : 'outgoing'
  };
}

// --- Monitoring ---
export async function getQueueStatus() {
  try {
    const ch = await getPublishChannel();
    const [txStatus, txComplete] = await Promise.all([
      ch.checkQueue(QUEUES.TRANSACTION_FOUND),
      ch.checkQueue(QUEUES.TRANSFER_COMPLETE)
    ]);

    return {
      transactionFound: {
        messageCount: txStatus.messageCount,
        consumerCount: txStatus.consumerCount,
      },
      transferComplete: {
        messageCount: txComplete.messageCount,
        consumerCount: txComplete.consumerCount,
      },
    };
  } catch (err) {
    console.error('❌ Failed to get queue status:', err);
    throw err;
  }
}

export async function isRabbitMQConnected(): Promise<boolean> {
  try {
    const conn = await getConnection();
    return !conn.getMaxListeners()
  } catch {
    return false;
  }
}

// --- Graceful Shutdown ---
export async function closeConnections(): Promise<void> {
  try {
    if (publishChannel) {
      await publishChannel.close();
      publishChannel = null;
      channelClosed = true;
    }

    if (connection) {
       connection.removeAllListeners();
      connection = null;
    }

    console.log('✅ Closed RabbitMQ connections');
  } catch (err) {
    console.error('❌ Error during RabbitMQ shutdown:', err);
  }
}


