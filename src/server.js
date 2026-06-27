import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "./config/env.js";
import { closeRedis, getRedis } from "./config/redis.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import inviteRoutes from "./routes/invite.js";
import replayRoutes from "./routes/replay.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { idempotency } from "./middleware/idempotency.js";
import { getGameSignerAddress } from "./services/signatureService.js";
import { checkStoreHealth, closeStore } from "./services/store.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.trustProxy);
app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.appOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use((req, res, next) => {
  res.setTimeout(env.requestTimeoutMs, () => {
    if (!res.headersSent) {
      res.status(503).json({ error: "Request timed out" });
    }
  });
  next();
});

// Connect Redis up front so the rate limiters can share one store across every
// instance. Falls back to per-instance memory stores when REDIS_URL is unset.
const redis = await getRedis();
if (redis) {
  console.log("Redis connected: shared idempotency + rate limiting enabled");
}

const globalLimiter = createLimiter(env.rateLimitMax, "Too many requests", "rl:global:");
const gameLimiter = createLimiter(
  env.gameRateLimitMax,
  "Too many game requests from this address",
  "rl:game:"
);
const adminLimiter = createLimiter(
  env.adminRateLimitMax,
  "Too many admin requests from this address",
  "rl:admin:"
);

app.use(globalLimiter);

app.get("/health", (req, res) => {
  let gameSigner = null;
  try {
    gameSigner = getGameSignerAddress();
  } catch {
    gameSigner = "not configured";
  }

  res.json({
    ok: true,
    service: "snakiox-backend",
    gameSigner
  });
});

app.get("/ready", async (req, res) => {
  try {
    await checkStoreHealth();
    res.json({
      ok: true,
      service: "snakiox-backend",
      storage: env.storageDriver
    });
  } catch (error) {
    console.error("Readiness check failed", error);
    res.status(503).json({
      ok: false,
      service: "snakiox-backend",
      storage: env.storageDriver
    });
  }
});

const idempotent = idempotency();

app.use("/auth", gameLimiter, authRoutes);
app.use("/game", gameLimiter, idempotent, gameRoutes);
app.use("/invite/admin", adminLimiter);
app.use("/invite", gameLimiter, idempotent, inviteRoutes);
app.use("/replay", gameLimiter, replayRoutes);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(
    `Snakiox backend listening on port ${env.port} with ${env.storageDriver} storage`
  );
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, env.shutdownTimeoutMs);
  forceExit.unref();

  server.closeIdleConnections?.();

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeStore();
    await closeRedis();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Under traffic a single unhandled rejection (e.g. a transient DB blip) must
// not take the whole process down. Log it and keep serving. An uncaught
// synchronous exception leaves the process in an unknown state, so we drain
// connections and let the supervisor restart us cleanly.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
  shutdown("uncaughtException");
});

function createLimiter(max, message, prefix) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.path === "/health" || req.path === "/ready",
    message: { error: message },
    // Shared store when Redis is up; otherwise express-rate-limit's memory store.
    ...(redis ? { store: buildFailOpenRedisStore(prefix) } : {})
  });
}

// Wraps the Redis store so a Redis outage fails OPEN (allows the request)
// instead of bubbling up a 500 — availability over strict rate limiting.
function buildFailOpenRedisStore(prefix) {
  const store = new RedisStore({ sendCommand: (...args) => redis.sendCommand(args), prefix });

  return {
    // Forward the inner store's identity so express-rate-limit's double-count
    // guard can tell each limiter apart. Without these, every wrapper looks like
    // the same prefix-less "Object" store and stacking global + a route limiter
    // trips ERR_ERL_DOUBLE_COUNT for the shared client IP.
    prefix: store.prefix,
    localKeys: store.localKeys,
    init: (options) => store.init?.(options),
    async increment(key) {
      try {
        return await store.increment(key);
      } catch (error) {
        console.error("Rate limiter Redis error (failing open)", error);
        return { totalHits: 0, resetTime: new Date(Date.now() + env.rateLimitWindowMs) };
      }
    },
    async decrement(key) {
      try {
        await store.decrement(key);
      } catch {
        // ignore — best effort
      }
    },
    async resetKey(key) {
      try {
        await store.resetKey(key);
      } catch {
        // ignore — best effort
      }
    },
    async get(key) {
      try {
        return await store.get?.(key);
      } catch {
        return undefined;
      }
    }
  };
}
