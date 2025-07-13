// --- src/index.ts ---
import { startEvmWatcher } from './watchers/evmWatcher';
import { publishTransactionFound, publishTransferComplete, closeConnections as closeRabbit } from './services/rabbit';
import { isRedisConnected, closeRedisConnection } from './services/redis';
import { startSolanaWatcher } from './watchers/solanaWatcher';



// You might define these watchers yourself
// Assuming they look like: startEvmWatcher(address: string)
async function bootstrap() {
  console.log('🚀 Starting transaction watcher service...');

  // Ensure Redis is connected
  const redisOk = await isRedisConnected();
  if (!redisOk) {
    console.error('❌ Redis is not connected. Exiting.');
    process.exit(1);
  }


    startEvmWatcher();
  

  // Start watching each Solana wallet
    startSolanaWatcher();
  

  // Optional: Periodically check health of Rabbit/Redis
  setInterval(async () => {
    const healthy = await isRedisConnected();
    if (!healthy) console.warn('⚠️ Redis is disconnected');
  }, 60_000);
}

// Run bootstrap
bootstrap().catch((err) => {
  console.error('💥 Bootstrap error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔌 SIGINT received. Shutting down...');
  await Promise.all([
    closeRedisConnection(),
    closeRabbit(),
  ]);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔌 SIGTERM received. Shutting down...');
  await Promise.all([
    closeRedisConnection(),
    closeRabbit(),
  ]);
  process.exit(0);
});
