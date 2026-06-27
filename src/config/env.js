import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL || "";
const storageDriver =
  process.env.STORAGE_DRIVER ||
  (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")
    ? "postgres"
    : "json");

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  appOrigins: (process.env.APP_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  storageDriver,
  databaseUrl,
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || 30),
  databaseIdleTimeoutMs: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000),
  databaseConnectionTimeoutMs: Number(
    process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5000
  ),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY || "1"),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
  // Optional Redis. When set, idempotency + rate limiting share state across
  // every backend instance; when unset, both fall back to per-instance memory.
  redisUrl: process.env.REDIS_URL || "",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  gameRateLimitMax: Number(process.env.GAME_RATE_LIMIT_MAX || 120),
  adminRateLimitMax: Number(process.env.ADMIN_RATE_LIMIT_MAX || 60),
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000),
  gameSignerPrivateKey: process.env.GAME_SIGNER_PRIVATE_KEY || "",
  mintContractAddress:
    process.env.MINT_CONTRACT_ADDRESS ||
    "0x0000000000000000000000000000000000000000",
  // Signed into the mint payload — MUST match the chain the contract is deployed
  // on (1 = Ethereum mainnet), or signatures won't verify.
  chainId: BigInt(process.env.CHAIN_ID || "1"),
  // RPC used only to read the current block number when committing the
  // reveal block for a mint signature. Required for on-chain minting.
  rpcUrl: process.env.RPC_URL || "",
  // Smallest grind-proof buffer: the reveal block just needs to be unmined when
  // signed. 1 block (~12s on Ethereum) keeps random->mint snappy. Bump to 2+ if
  // reorg safety on the reveal block matters more than latency.
  revealBufferBlocks: Number(process.env.REVEAL_BUFFER_BLOCKS || 1),
  adminWalletAddress: process.env.ADMIN_WALLET_ADDRESS || "",
  // Games auto-end at 40 min on the client; allow a little margin server-side.
  maxGameDurationSeconds: Number(process.env.MAX_GAME_DURATION_SECONDS || 2700),
  minSecondsPerMove: Number(process.env.MIN_SECONDS_PER_MOVE || 0.03)
};

if (!["json", "postgres"].includes(env.storageDriver)) {
  throw new Error("STORAGE_DRIVER must be either json or postgres");
}

if (env.storageDriver === "postgres" && !env.databaseUrl) {
  throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
}

function parseTrustProxy(value) {
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
