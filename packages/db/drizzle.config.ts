import { type Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  dialect: "postgresql",
  out: "../../supabase/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:54322/postgres",
  },
  // Supabase manages auth/storage/realtime schemas — never touch them.
  schemaFilter: ["public"],
} satisfies Config;
