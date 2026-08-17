import crypto from "node:crypto";
import express, { type RequestHandler } from "express";
import { ExpressAdapter } from "ask-sdk-express-adapter";
import type { Config } from "./config.js";
import { ConnectorHub, generateCredential, hashToken } from "./hub.js";
import { createSkill } from "./skill.js";
import { JsonStore, PostgresStore, type BridgeStore } from "./store.js";
import { TaskRunner } from "./tasks.js";

export async function createApp(config: Config, suppliedStore?: BridgeStore) {
  const store = suppliedStore ?? (config.databaseUrl ? new PostgresStore(config.databaseUrl) : new JsonStore(config.dataFile));
  await store.init();
  const hub = new ConnectorHub(store);
  const runner = new TaskRunner(store, hub, config);
  await runner.resume();
  const app = express();
  const enrollmentLimits = new Map<string, { count: number; resetAt: number }>();

  app.disable("x-powered-by");
  app.get("/healthz", (_request, response) => response.json({ ok: true }));
  app.get("/api/v1/admin/installations", async (request,response)=>{
    if(!authorized(request.headers.authorization,config.adminApiToken)){response.status(401).json({ok:false,error:"unauthorized"});return;}
    response.json({ok:true,installations:await store.listInstallations()});
  });
  app.post("/api/v1/admin/installations/:id/revoke",async(request,response)=>{
    if(!authorized(request.headers.authorization,config.adminApiToken)){response.status(401).json({ok:false,error:"unauthorized"});return;}
    await store.revokeInstallation(request.params.id);hub.disconnect(request.params.id);response.json({ok:true});
  });
  app.post("/api/v1/pairings/claim", express.json({ limit: "4kb" }), async (request, response) => {
    const address = request.ip ?? "unknown";
    if (!allowAttempt(enrollmentLimits, address, 10, 60_000)) { response.status(429).json({ ok:false,error:"rate_limited" }); return; }
    const code = typeof request.body?.code === "string" ? request.body.code.replace(/\D/g, "") : "";
    const name = typeof request.body?.name === "string" ? request.body.name.trim().slice(0, 80) : "";
    if (!/^\d{6}$/.test(code) || !name) { response.status(400).json({ok:false,error:"invalid_request"}); return; }
    const token = generateCredential();
    const installation = await store.enrollWithCode(code, name, hashToken(token));
    if (!installation) { response.status(404).json({ok:false,error:"invalid_or_expired_code"}); return; }
    const wsUrl = config.publicBaseUrl.replace(/^http/, "ws") + "/connect";
    response.status(201).json({ok:true,installationId:installation.id,token,bridgeWebSocketUrl:wsUrl});
  });

  const adapter = new ExpressAdapter(createSkill(config, store, runner), config.verifyAlexaRequests, config.verifyAlexaRequests);
  app.post("/alexa", alexaRequestLogger, ...adapter.getRequestHandlers());
  return { app, store, runner, hub };
}

function allowAttempt(map:Map<string,{count:number;resetAt:number}>,key:string,limit:number,windowMs:number){const now=Date.now();const current=map.get(key);if(!current||current.resetAt<=now){map.set(key,{count:1,resetAt:now+windowMs});return true;}if(current.count>=limit)return false;current.count++;return true;}
function authorized(header:string|undefined,expected:string|undefined){if(!expected||!header?.startsWith("Bearer "))return false;const a=Buffer.from(header.slice(7)),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}

const alexaRequestLogger: RequestHandler = (request, response, next) => {
  const startedAt = Date.now();
  let errorResponse: string | undefined;
  const originalSend = response.send.bind(response);
  response.send = ((body?: unknown) => {
    if (response.statusCode >= 400) errorResponse = sanitizeErrorBody(body);
    return originalSend(body);
  }) as typeof response.send;

  console.info(JSON.stringify({
    event: "alexa.request.connected",
    method: request.method,
    path: request.originalUrl,
    remoteIp: request.socket.remoteAddress,
    forwardedFor: firstHeaderValue(request.headers["x-forwarded-for"]),
    cloudflareIp: firstHeaderValue(request.headers["cf-connecting-ip"]),
    userAgent: request.get("user-agent")?.slice(0, 160),
    contentType: request.get("content-type"),
    contentLength: request.get("content-length"),
    hasSignature: Boolean(request.get("signature")),
    hasSignatureCertificate: Boolean(request.get("signaturecertchainurl")),
  }));

  response.once("finish", () => {
    const envelope = typeof request.body === "string" ? safelyParseEnvelope(request.body) : undefined;
    console.info(JSON.stringify({
      event: "alexa.request.completed",
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: envelope?.request?.requestId,
      requestType: envelope?.request?.type,
      locale: envelope?.request?.locale,
      applicationId: envelope?.context?.System?.application?.applicationId ?? envelope?.session?.application?.applicationId,
      error: errorResponse,
    }));
  });
  next();
};

function firstHeaderValue(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value?.split(",", 1)[0]?.trim(); }
function sanitizeErrorBody(body: unknown) {
  const value = typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : "non-text error response";
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}
function safelyParseEnvelope(body: string): any { try { return JSON.parse(body); } catch { return undefined; } }
