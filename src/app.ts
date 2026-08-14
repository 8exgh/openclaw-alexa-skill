import crypto from "node:crypto";
import express from "express";
import { ExpressAdapter } from "ask-sdk-express-adapter";
import type { Config } from "./config.js";
import { createSkill } from "./skill.js";
import { StateStore } from "./store.js";
import { TaskRunner } from "./tasks.js";

export async function createApp(config: Config) {
  const store = new StateStore(config.dataFile);
  await store.init();
  const runner = new TaskRunner(store, config);
  runner.resume();
  const app = express();

  app.get("/healthz", (_request, response) => response.json({ ok: true }));
  app.post("/admin/pair/claim", express.json({ limit: "4kb" }), async (request, response) => {
    if (!config.pairingAdminToken || !safeBearerMatch(request.headers.authorization, config.pairingAdminToken)) {
      response.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const code = typeof request.body?.code === "string" ? request.body.code.replace(/\s/g, "") : "";
    const clawId = typeof request.body?.clawId === "string" ? request.body.clawId : "";
    if (!config.installations.some((claw) => claw.id === clawId)) {
      response.status(400).json({ ok: false, error: "unknown_claw" });
      return;
    }
    const claimed = await store.claimPairingCode(code, clawId);
    response.status(claimed ? 200 : 404).json({ ok: claimed, error: claimed ? undefined : "invalid_or_expired_code" });
  });

  const skill = createSkill(config, store, runner);
  const adapter = new ExpressAdapter(skill, config.verifyAlexaRequests, config.verifyAlexaRequests);
  app.post("/alexa", ...adapter.getRequestHandlers());
  return { app, store, runner };
}

function safeBearerMatch(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
