/**
 * Applies supabase/schema.sql to the Game Rabbit Supabase database.
 *
 * Usage (needs `pg`, which isn't a project dependency: install it in a scratch folder):
 *   vercel env pull --yes                 # writes POSTGRES_URL_NON_POOLING into .env.local
 *   (cd /some/scratch && npm i pg@8)
 *   PG_DIR=/some/scratch node scripts/apply_schema.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire((process.env.PG_DIR ?? process.cwd()) + "/");
const pg = require("pg");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => /^([A-Z0-9_]+)="?(.*?)"?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const url = new URL(env.POSTGRES_URL_NON_POOLING);
url.searchParams.delete("sslmode"); // (pg's sslmode parsing overrides the ssl option below)
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(readFileSync("supabase/schema.sql", "utf8"));
const { rows } = await client.query(
  "select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'mapringer_%' order by 1",
);
console.table(rows);
await client.end();
