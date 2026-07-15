import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://fastmark:fastmark@localhost:5432/fastmark";

const globalForDb = globalThis as unknown as {
  pg?: ReturnType<typeof postgres>;
};

export const client =
  globalForDb.pg ??
  postgres(connectionString, {
    max: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pg = client;
}

export const db = drizzle(client, { schema });
