import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  INITIAL_OWNER_LOGIN: z.string().min(1).default("owner"),
  INITIAL_OWNER_PASSWORD: z.string().min(8, "INITIAL_OWNER_PASSWORD must be at least 8 characters"),
  STORAGE_DIR: z.string().min(1).default("./storage"),
  MAX_IMAGE_SIZE_MB: z.coerce.number().int().positive().default(30),
  DEFAULT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Configuration validation failed:\n${issues}`);
}

export const config = parsed.data;

export type Config = typeof config;
