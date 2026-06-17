import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load local env for db:push / db:migrate / db:studio (db:generate needs no DB).
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  verbose: true,
  strict: true,
});
