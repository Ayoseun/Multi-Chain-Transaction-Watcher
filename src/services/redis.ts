// --- src/redis.ts ---
import Redis from 'ioredis';
import { REDIS_PASSWORD, REDIS_ADDRESS } from './config';

// Fixed Redis URL construction
const REDIS_URL = `redis://:${REDIS_PASSWORD}@${REDIS_ADDRESS}`;

// Alternative Redis configuration (more explicit)
const redisConfig = {
  host: REDIS_ADDRESS.split(':')[0], // Extract host from address
  port: parseInt(REDIS_ADDRESS.split(':')[1]) || 6379, // Extract port or default to 6379
  password: REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
};

// Use either URL or config object
const redis = new Redis(redisConfig);
// Or use: const redis = new Redis(redisConfig);

// Add connection event handlers for better debugging
redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('ready', () => {
  console.log('✅ Redis ready to accept commands');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

redis.on('close', () => {
  console.log('🔌 Redis connection closed');
});

redis.on('reconnecting', () => {
  console.log('🔄 Redis reconnecting...');
});

// Interfaces
export interface WalletInfo {
  address: string;
  privateKey: string | number[];
  chain: string;
}

export interface ContractInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  chain: string;
}

// Redis key patterns
const CONTRACT_KEY = (chain: string, address: string) => `contract:${chain.toLowerCase()}:${address.toLowerCase()}`;
const WATCHED_CONTRACTS_KEY = (chain: string) => `watched_contracts:${chain.toLowerCase()}`;



// Contract retrieval functions
export async function getContract(chain: string, address: string): Promise<ContractInfo | null> {
  try {
    const key = CONTRACT_KEY(chain, address);
    const data = await redis.hgetall(key);

    if (!data.address) return null;

    return {
      address: data.address,
      name: data.name,
      symbol: data.symbol,
      decimals: parseInt(data.decimals),
      chain: data.chain as 'EVM' | 'Solana',
   
    };
  } catch (error) {
    console.error(`Error getting contract ${chain}:${address}:`, error);
    return null;
  }
}

export async function getWatchedContracts(chain: string): Promise<string[]> {
  try {
    const watchedContractsKey = WATCHED_CONTRACTS_KEY(chain);
    return await redis.smembers(watchedContractsKey);
  } catch (error) {
    console.error(`Error getting watched contracts for ${chain}:`, error);
    return [];
  }
}

export async function getAllWatchedContracts(): Promise<{ evm: string[], solana: string[] }> {
  try {
    const [evmContracts, solanaContracts] = await Promise.all([
      getWatchedContracts('evm'),
      getWatchedContracts('solana')
    ]);

    return {
      evm: evmContracts,
      solana: solanaContracts
    };
  } catch (error) {
    console.error('Error getting all watched contracts:', error);
    return { evm: [], solana: [] };
  }
}

// Batch retrieval functions for efficiency// Fetch all wallets for a chain
export async function getAllWallets(chain: string): Promise<WalletInfo[]> {

  try {
    const setKey = `all_wallets:${chain.toLowerCase()}`;
    const keys: string[] = await redis.smembers(setKey);

    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.hgetall(key));
    const results = await pipeline.exec();

    return results!
      .map((result): WalletInfo | null => {
        if (!result || result[0]) return null;
        const data = result[1] as Record<string, string>;

        if (!data.address || !data.privateKey || !data.chain) {
          console.warn("Skipping wallet due to missing fields:", data);
          return null;
        }

        try {
          return {
            address: data.address,
            privateKey: data.privateKey,
            chain: data.chain,


          };
        } catch (e) {
          console.warn("Skipping wallet due to JSON parse error:", e, data);
          return null;
        }
      })
      .filter((wallet): wallet is WalletInfo => wallet !== null);

  } catch (error) {
    console.error(`Error getting all wallets for ${chain}:`, error);
    return [];
  }
}



export async function getAllContracts(chain: string): Promise<ContractInfo[]> {
  try {
    const setKey = `watched_contracts:${chain.toLowerCase()}`;
    console.log(setKey)
    const addresses = await redis.smembers(setKey); // Fetch contract addresses
    console.log("address",addresses)
    if (addresses.length === 0) return [];
    const pipeline = redis.pipeline();
    for (const address of addresses) {
      const hashKey = `contract:${chain.toLowerCase()}:${address.toLowerCase()}`;
      pipeline.hgetall(hashKey);
    }

    const results = await pipeline.exec();
    console.log("results-contracxt",results)
    return results!
      .map((result, index): ContractInfo | null => {
        if (!result || result[0]) {
          console.warn(`Skipping contract at index ${index} due to Redis error:`, result?.[0]);
          return null;
        }

        const data = result[1] as Record<string, string>;

        if (!data.address || !data.name || !data.symbol || !data.decimals) {
          console.warn("Skipping due to missing fields:", data);
          return null;
        }

        return {
          address: data.address,
          name: data.name,
          symbol: data.symbol,
          decimals: parseInt(data.decimals),
          chain: chain.toLowerCase(), // since it's already from the input
         
        };
      })
      .filter((c): c is ContractInfo => c !== null);

  } catch (err) {
    console.error(`Error fetching contracts for ${chain}:`, err);
    return [];
  }
}




export async function isContractWatched(chain: string, address: string): Promise<boolean> {
  try {
    const contract = await getContract(chain, address);
    return contract !== null
  } catch (error) {
    console.error(`Error checking contract watched status ${chain}:${address}:`, error);
    return false;
  }
}

// Health check with better error handling
export async function isRedisConnected(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    console.error('Redis ping failed:', error);
    return false;
  }
}

// Test Redis connection
export async function testRedisConnection(): Promise<void> {
  try {
    console.log('🔄 Testing Redis connection...');
    console.log('Redis URL:', REDIS_URL.replace(REDIS_PASSWORD, '***'));

    const result = await redis.ping();
    if (result === 'PONG') {
      console.log('✅ Redis connection successful');
    } else {
      console.log('❌ Redis ping returned unexpected result:', result);
    }
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw error;
  }
}

// Close connection
export async function closeRedisConnection(): Promise<void> {
  try {
    await redis.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis connection:', error);
  }
}

export default redis;