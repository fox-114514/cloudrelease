import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const optionalNonEmptyString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const optionalPositiveInt = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number().int().positive().optional(),
);

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
  // Behind Caddy/Nginx/a container bridge, set to a comma-separated list of
  // trusted proxy IP/CIDR hops (e.g. "127.0.0.1,::1,10.0.0.0/8"). Fastify
  // passes this straight to the underlying `proxy-addr` resolver which uses
  // it to derive the real client IP for `request.ip`, rate limiting and
  // audit. Leaving it empty/false means we trust no hop, so direct
  // deployments keep their previous behaviour and reverse-proxy
  // deployments must opt in.
  TRUST_PROXY: z.preprocess(
    (value) => {
      if (value === undefined) return false;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed === "") return false;
      if (trimmed.toLowerCase() === "true") return true;
      if (trimmed.toLowerCase() === "false") return false;
      return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
    },
    z.union([z.boolean(), z.array(z.string().min(1))]),
  ).default(false),
  ANDROID_UPDATE_APK_PATH: optionalNonEmptyString,
  ANDROID_UPDATE_VERSION_CODE: optionalPositiveInt,
  ANDROID_UPDATE_VERSION_NAME: optionalNonEmptyString,
  ANDROID_UPDATE_RELEASE_NOTES: z.string().default(""),
  WINDOWS_UPDATE_PACKAGE_PATH: optionalNonEmptyString,
  WINDOWS_UPDATE_VERSION_NAME: optionalNonEmptyString,
  WINDOWS_UPDATE_RELEASE_NOTES: z.string().default(""),
  LINUX_DESKTOP_UPDATE_PACKAGE_PATH: optionalNonEmptyString,
  LINUX_DESKTOP_UPDATE_VERSION_NAME: optionalNonEmptyString,
  LINUX_DESKTOP_UPDATE_RELEASE_NOTES: z.string().default(""),
  LINUX_CLI_UPDATE_PACKAGE_PATH: optionalNonEmptyString,
  LINUX_CLI_UPDATE_VERSION_NAME: optionalNonEmptyString,
  LINUX_CLI_UPDATE_RELEASE_NOTES: z.string().default(""),
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
