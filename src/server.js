import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import inviteRoutes from "./routes/invite.js";
import replayRoutes from "./routes/replay.js";
import { errorHandler } from "./middleware/errorHandler.js";
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

const globalLimiter = createLimiter(env.rateLimitMax, "Too many requests");
const gameLimiter = createLimiter(
  env.gameRateLimitMax,
  "Too many game requests from this address"
);
const adminLimiter = createLimiter(
  env.adminRateLimitMax,
  "Too many admin requests from this address"
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

app.use("/auth", gameLimiter, authRoutes);
app.use("/game", gameLimiter, gameRoutes);
app.use("/invite/admin", adminLimiter);
app.use("/invite", gameLimiter, inviteRoutes);
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
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function createLimiter(max, message) {
  return rateLimit({
    windowMs: env.rateLimitWindowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.path === "/health" || req.path === "/ready",
    message: { error: message }
  });
}
