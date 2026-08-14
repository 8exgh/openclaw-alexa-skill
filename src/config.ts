import path from "node:path";
import type { ClawInstallation } from "./types.js";

export interface Config {
  port: number;
  dataFile: string;
  alexaApplicationId?: string;
  verifyAlexaRequests: boolean;
  fastResponseBudgetMs: number;
  openClawTimeoutMs: number;
  maxSpokenCharacters: number;
  pairingAdminToken?: string;
  autoPairSingleClaw: boolean;
  installations: ClawInstallation[];
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

function installations(): ClawInstallation[] {
  if (process.env.CLAW_INSTALLATIONS_JSON) {
    const parsed = JSON.parse(process.env.CLAW_INSTALLATIONS_JSON) as ClawInstallation[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("CLAW_INSTALLATIONS_JSON must be a non-empty JSON array");
    }
    return parsed.map(validateInstallation);
  }

  const baseUrl = process.env.OPENCLAW_BASE_URL;
  const token = process.env.OPENCLAW_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("Set OPENCLAW_BASE_URL and OPENCLAW_TOKEN, or CLAW_INSTALLATIONS_JSON");
  }
  return [validateInstallation({
    id: process.env.OPENCLAW_CLAW_ID ?? "default",
    name: process.env.OPENCLAW_CLAW_NAME ?? "my claw",
    baseUrl,
    token,
    agentId: process.env.OPENCLAW_AGENT_ID ?? "alexa",
  })];
}

function validateInstallation(value: ClawInstallation): ClawInstallation {
  for (const field of ["id", "name", "baseUrl", "token", "agentId"] as const) {
    if (!value[field] || typeof value[field] !== "string") throw new Error(`Claw installation ${field} is required`);
  }
  const url = new URL(value.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Claw baseUrl must use HTTP or HTTPS");
  return { ...value, baseUrl: value.baseUrl.replace(/\/$/, "") };
}

export function loadConfig(): Config {
  return {
    port: integer("PORT", 3000),
    dataFile: process.env.DATA_FILE ?? path.resolve("data/state.json"),
    alexaApplicationId: process.env.ALEXA_APPLICATION_ID,
    verifyAlexaRequests: bool("VERIFY_ALEXA_REQUESTS", process.env.NODE_ENV === "production"),
    fastResponseBudgetMs: integer("FAST_RESPONSE_BUDGET_MS", 5_500),
    openClawTimeoutMs: integer("OPENCLAW_TIMEOUT_MS", 600_000),
    maxSpokenCharacters: integer("MAX_SPOKEN_CHARACTERS", 600),
    pairingAdminToken: process.env.PAIRING_ADMIN_TOKEN,
    autoPairSingleClaw: bool("AUTO_PAIR_SINGLE_CLAW", true),
    installations: installations(),
  };
}
