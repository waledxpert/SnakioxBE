import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPool, closeDatabase } from "../config/database.js";

const schemaPath = path.join(process.cwd(), "db", "schema.sql");

try {
  const schema = await readFile(schemaPath, "utf8");
  await getPool().query(schema);
  console.log("Snakiox PostgreSQL schema is ready");
} finally {
  await closeDatabase();
}
