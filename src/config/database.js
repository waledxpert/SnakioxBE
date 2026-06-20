import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (env.storageDriver !== "postgres") {
    throw new Error("PostgreSQL is not enabled");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      max: env.databasePoolMax,
      idleTimeoutMillis: env.databaseIdleTimeoutMs,
      connectionTimeoutMillis: env.databaseConnectionTimeoutMs,
      allowExitOnIdle: false,
      ssl:
        env.nodeEnv === "production" && !isLocalDatabase(env.databaseUrl)
          ? { rejectUnauthorized: false }
          : undefined
    });

    pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error", error);
    });
  }

  return pool;
}

export async function closeDatabase() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}

function isLocalDatabase(url) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}
