# 🧿 Multi-Chain Transaction Watcher

> Real-time, cross-chain transaction tracker with confirmation logic, Redis state tracking, and RabbitMQ queue publishing.  

Built for builders, wallets, bots, bridges, analytics platforms, and devs needing **blockchain-native event pipelines**.

---

## ✅ Features

- Watch **EVM chains** (Ethereum, Polygon, Arbitrum) using WebSocket
- Watch **Solana** via slot polling (native + token transfers)
- Confirm transactions based on network rules
- Publish **transaction events** to RabbitMQ
- Use Redis for:
  - Tracking watched wallets
  - Managing known token contracts
- Durable, pluggable, and ready for production

---

## 🌐 Supported Chains

| Chain     | Native      | Token Support | Confirmations |
|-----------|-------------|---------------|----------------|
| Ethereum  | ✅           | ✅ ERC-20      | 12             |
| Polygon   | ✅           | ✅ ERC-20      | 30             |
| Arbitrum  | ✅           | ✅ ERC-20      | 1              |
| Solana    | ✅           | ✅ SPL Token   | 32 slots       |

---

## 📦 Key Modules

| File               | Description                                |
|--------------------|--------------------------------------------|
| `evmWatcher.ts`    | Watches EVM-compatible chains via WS       |
| `solanaWatcher.ts` | Polls Solana slots for transactions        |
| `rabbit.ts`        | Publishes events to RabbitMQ queues        |
| `redis.ts`         | Manages wallets and contracts in Redis     |
| `config.ts`        | Env-driven configuration                   |

---

## 🔐 .env Configuration

```env
# RPC URLs
ETHEREUM=wss://your-ethereum-ws
POLYGON=wss://your-polygon-ws
ARBITRUM=wss://your-arbitrum-ws
SOLANA_RPC=https://api.devnet.solana.com

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# Redis
REDIS_PASSWORD=yourPassword
REDIS_ADDRESS=localhost:6379
```

---

## 🚀 Usage

```ts
import { startEvmWatcher } from './src/evmWatcher';
import { startSolanaWatcher } from './src/solanaWatcher';

await startEvmWatcher();      // Watch all EVM chains
await startSolanaWatcher();   // Start Solana watcher
```

### Graceful Stop

```ts
import { stopEvmWatcher } from './src/evmWatcher';
import { stopSolanaWatcher } from './src/solanaWatcher';

await stopEvmWatcher();
await stopSolanaWatcher();
```

---

## 💾 Redis Integration

### 🔑 Tracked Redis Keys

| Key Format | Description |
|------------|-------------|
| `contract:{chain}:{address}` | Hash with name, symbol, decimals |
| `watched_contracts:{chain}` | Set of token contract addresses |
| `all_wallets:{chain}` | Set of wallet hash keys |
| `wallet:{chain}:{address}` | Hash with address, privateKey, chain |

### 🧰 Functions

#### Wallets
```ts
await getAllWallets('evm');     // WalletInfo[]
```

#### Contracts
```ts
await getContract('evm', '0x...');
await getAllContracts('solana');
await getWatchedContracts('evm');
await isContractWatched('solana', '...');
```

#### Health
```ts
await isRedisConnected();       // boolean
await testRedisConnection();    // Logs results
await closeRedisConnection();   // Graceful shutdown
```

---

## 📤 RabbitMQ Queues

| Queue Name | Purpose |
|------------|---------|
| `transaction.found.queue` | Confirmed transfers (native + token) |
| `transfer.complete.queue` | Internal result reporting |

### ✨ Publishers

```ts
await publishTransactionFound(payload);
await publishTransferComplete(payload);
await publishMultipleTransactions([...]);
await publishMultipleTransferCompletions([...]);
```

---

## 📁 Folder Structure

```
src/
├── evmWatcher.ts             # Watches Ethereum-based chains
├── solanaWatcher.ts          # Watches Solana transactions
├── rabbit.ts                 # RabbitMQ publishers
├── redis.ts                  # Wallet/Contract tracking via Redis
├── config.ts                 # Centralized config
resources/
└── abi.ts                    # ERC20 ABI
```

---

## 🔍 Example Transaction Payload

```ts
{
  transactionHash: '0xabc...',
  fromAddress: '0xfrom...',
  toAddress: '0xto...',
  amount: '1000000000000000000',
  tokenAddress: '0xtoken...',
  tokenName: 'MyToken',
  tokenSymbol: 'MTK',
  tokenDecimals: 18,
  chain: 'evm',
  blockNumber: 123456,
  timestamp: 1723891283,
  type: 'token',
  direction: 'incoming',
  walletAddress: '0xwatchedWallet'
}
```

---

## 📌 TODO

- [ ] Redis expiration/cleanup for stale keys
- [ ] Expose REST API for queue monitoring
- [ ] Add database or file-based persistence
- [ ] Retry publishing mechanism on RabbitMQ failure

---

## 🧪 Local Testing

```ts
await testRedisConnection();
await isRabbitMQConnected();
const status = await getQueueStatus();
console.log(status);
```

---

## 🛡 License

MIT — feel free to fork, improve, and deploy your own chain watcher infrastructure.
