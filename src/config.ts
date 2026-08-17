import path from "node:path";

export interface Config {
  port: number;
  databaseUrl?: string;
  dataFile: string;
  alexaApplicationId?: string;
  verifyAlexaRequests: boolean;
  fastResponseBudgetMs: number;
  taskTimeoutMs: number;
  maxSpokenCharacters: number;
  publicBaseUrl: string;
  adminApiToken?: string;
  allowInsecureJsonStore: boolean;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadConfig(): Config {
  const production = process.env.NODE_ENV === "production";
  const databaseUrl = process.env.DATABASE_URL;
  const allowInsecureJsonStore = bool("ALLOW_INSECURE_JSON_STORE", !production);
  if (!databaseUrl && !allowInsecureJsonStore) {
    throw new Error("DATABASE_URL is required in production; JSON storage is development-only");
  }
  return {
    port: integer("PORT", 3000),
    databaseUrl,
    dataFile: process.env.DATA_FILE ?? path.resolve("data/state.json"),
    alexaApplicationId: process.env.ALEXA_APPLICATION_ID,
    verifyAlexaRequests: bool("VERIFY_ALEXA_REQUESTS", production),
    fastResponseBudgetMs: integer("FAST_RESPONSE_BUDGET_MS", 5_500),
    taskTimeoutMs: integer("TASK_TIMEOUT_MS", 600_000),
    maxSpokenCharacters: integer("MAX_SPOKEN_CHARACTERS", 600),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    adminApiToken: process.env.ADMIN_API_TOKEN,
    allowInsecureJsonStore,
  };
}
