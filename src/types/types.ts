export interface WatchAccount {
  address: string;
  privateKey: string | number[];
}

export interface TokenWatchPayload {
  "EVM tokens"?: string[];
  "Solanatokens"?: string[];
  EVM?: WatchAccount[];
  Solana?: WatchAccount[];
}

export interface WatcherStatus {
  active: boolean;
  chain: "EVM" | "Solana";
  address: string;
  expiresAt: number;
  tokens: string[];
}
