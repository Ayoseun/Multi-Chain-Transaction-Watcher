require('dotenv').config();

export const MASTER_EVM_ADDRESS = process.env.MASTER_EVM_ADDRESS!;
export const MASTER_SOLANA_ADDRESS = process.env.MASTER_SOLANA_ADDRESS!;
export const EVM_RPC = process.env.EVM_RPC!;
export const SOLANA_RPC = process.env.SOLANA_RPC!;
export const EXPIRE_AFTER_MS = Number(process.env.EXPIRE_AFTER_MS || 5 * 60 * 1000);
export const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
export const REDIS_ADDRESS = process.env.REDIS_ADDRESS || "localhost:6379";
export const  REDIS_PASSWORD= process.env.REDIS_PASSWORD || "";