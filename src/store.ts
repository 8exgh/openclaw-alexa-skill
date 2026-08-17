import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { BridgeTask, ClawInstallation, PairingCode, PersistedState, TaskStatus } from "./types.js";

export interface BridgeStore {
  init(): Promise<void>;
  close(): Promise<void>;
  getPairing(userId: string): Promise<string | undefined>;
  pair(userId: string, installationId: string): Promise<void>;
  unpair(userId: string): Promise<void>;
  createPairingCode(userId: string, ttlMs?: number): Promise<PairingCode>;
  enrollWithCode(code: string, name: string, credentialHash: string): Promise<ClawInstallation | undefined>;
  verifyInstallation(id: string, credentialHash: string): Promise<boolean>;
  touchInstallation(id: string): Promise<void>;
  revokeInstallation(id: string): Promise<void>;
  listInstallations(): Promise<Array<Omit<ClawInstallation,"credentialHash">>>;
  createTask(task: BridgeTask): Promise<BridgeTask>;
  getTask(id: string): Promise<BridgeTask | undefined>;
  listResumableTasks(): Promise<BridgeTask[]>;
  latestTask(userId: string): Promise<BridgeTask | undefined>;
  updateTask(id: string, status: TaskStatus, fields?: Partial<Pick<BridgeTask, "result" | "error">>): Promise<void>;
}

const emptyState = (): PersistedState => ({ version: 1, pairings: {}, pairingCodes: {}, tasks: {} });

interface JsonState extends PersistedState { installations: Record<string, ClawInstallation> }

export class JsonStore implements BridgeStore {
  private state: JsonState = { ...emptyState(), installations: {} };
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async init() { await mkdir(path.dirname(this.file), { recursive: true }); try { this.state = { installations: {}, ...JSON.parse(await readFile(this.file, "utf8")) }; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; await this.persist(); } }
  async close() { await this.writes; }
  async getPairing(userId: string) { return this.state.pairings[userId]; }
  async pair(userId: string, id: string) { this.state.pairings[userId] = id; await this.persist(); }
  async unpair(userId: string) { delete this.state.pairings[userId]; await this.persist(); }
  async createPairingCode(userId: string, ttlMs = 600_000) { this.expire(); let code; do code = crypto.randomInt(100000, 1000000).toString(); while (this.state.pairingCodes[code]); const value = { code, alexaUserId: userId, expiresAt: new Date(Date.now() + ttlMs).toISOString() }; this.state.pairingCodes[code] = value; await this.persist(); return value; }
  async enrollWithCode(code: string, name: string, credentialHash: string) { this.expire(); const pending = this.state.pairingCodes[code]; if (!pending) return; const now = new Date().toISOString(); const installation = { id: crypto.randomUUID(), name, credentialHash, createdAt: now }; this.state.installations[installation.id] = installation; this.state.pairings[pending.alexaUserId] = installation.id; delete this.state.pairingCodes[code]; await this.persist(); return installation; }
  async verifyInstallation(id: string, hash: string) { const item = this.state.installations[id]; return Boolean(item && !item.revokedAt && safeEqual(item.credentialHash, hash)); }
  async touchInstallation(id: string) { if (this.state.installations[id]) { this.state.installations[id]!.lastSeenAt = new Date().toISOString(); await this.persist(); } }
  async revokeInstallation(id: string) { if (this.state.installations[id]) { this.state.installations[id]!.revokedAt = new Date().toISOString(); await this.persist(); } }
  async listInstallations() { return Object.values(this.state.installations).map(({credentialHash:_,...item})=>item); }
  async createTask(task: BridgeTask) { const found = this.state.tasks[task.id]; if (found) return found; this.state.tasks[task.id] = task; await this.persist(); return task; }
  async getTask(id: string) { return this.state.tasks[id]; }
  async listResumableTasks() { return Object.values(this.state.tasks).filter(t => t.status === "queued" || t.status === "running"); }
  async latestTask(userId: string) { return Object.values(this.state.tasks).filter(t => t.alexaUserId === userId).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0]; }
  async updateTask(id: string, status: TaskStatus, fields = {}) { const task = this.state.tasks[id]; if (!task) return; Object.assign(task, fields, { status, updatedAt: new Date().toISOString() }); await this.persist(); }
  private expire() { const now = Date.now(); for (const [code, p] of Object.entries(this.state.pairingCodes)) if (Date.parse(p.expiresAt) <= now) delete this.state.pairingCodes[code]; }
  private persist() { const body = JSON.stringify(this.state, null, 2); this.writes = this.writes.then(async () => { const temp = `${this.file}.tmp`; await writeFile(temp, body, { mode: 0o600 }); await rename(temp, this.file); }); return this.writes; }
}

export class PostgresStore implements BridgeStore {
  private readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 10 }); }
  async init() { await this.pool.query(SCHEMA); }
  async close() { await this.pool.end(); }
  async getPairing(userId: string) { const r = await this.pool.query("SELECT installation_id FROM alexa_pairings WHERE alexa_user_id=$1", [userId]); return r.rows[0]?.installation_id; }
  async pair(userId: string, id: string) { await this.pool.query("INSERT INTO alexa_pairings(alexa_user_id,installation_id) VALUES($1,$2) ON CONFLICT(alexa_user_id) DO UPDATE SET installation_id=EXCLUDED.installation_id, updated_at=now()", [userId,id]); }
  async unpair(userId: string) { await this.pool.query("DELETE FROM alexa_pairings WHERE alexa_user_id=$1", [userId]); }
  async createPairingCode(userId: string, ttlMs = 600_000) { await this.pool.query("DELETE FROM pairing_codes WHERE expires_at <= now() OR alexa_user_id=$1", [userId]); for (let i=0;i<10;i++) { const code=crypto.randomInt(100000,1000000).toString(); const expiresAt=new Date(Date.now()+ttlMs); try { await this.pool.query("INSERT INTO pairing_codes(code,alexa_user_id,expires_at) VALUES($1,$2,$3)",[code,userId,expiresAt]); return {code,alexaUserId:userId,expiresAt:expiresAt.toISOString()}; } catch (e) { if ((e as {code?:string}).code !== "23505") throw e; } } throw new Error("Could not allocate pairing code"); }
  async enrollWithCode(code: string, name: string, credentialHash: string) { const client=await this.pool.connect(); try { await client.query("BEGIN"); const pending=await client.query("SELECT alexa_user_id FROM pairing_codes WHERE code=$1 AND expires_at>now() AND attempts<5 FOR UPDATE",[code]); if (!pending.rowCount) { await client.query("UPDATE pairing_codes SET attempts=attempts+1 WHERE code=$1",[code]); await client.query("COMMIT"); return; } const id=crypto.randomUUID(); const createdAt=new Date(); await client.query("INSERT INTO claw_installations(id,name,credential_hash) VALUES($1,$2,$3)",[id,name,credentialHash]); await client.query("INSERT INTO alexa_pairings(alexa_user_id,installation_id) VALUES($1,$2) ON CONFLICT(alexa_user_id) DO UPDATE SET installation_id=EXCLUDED.installation_id, updated_at=now()",[pending.rows[0].alexa_user_id,id]); await client.query("DELETE FROM pairing_codes WHERE code=$1",[code]); await client.query("COMMIT"); return {id,name,credentialHash,createdAt:createdAt.toISOString()}; } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); } }
  async verifyInstallation(id: string, hash: string) { const r=await this.pool.query("SELECT credential_hash FROM claw_installations WHERE id=$1 AND revoked_at IS NULL",[id]); return Boolean(r.rows[0] && safeEqual(r.rows[0].credential_hash,hash)); }
  async touchInstallation(id: string) { await this.pool.query("UPDATE claw_installations SET last_seen_at=now() WHERE id=$1",[id]); }
  async revokeInstallation(id: string) { await this.pool.query("UPDATE claw_installations SET revoked_at=now() WHERE id=$1",[id]); }
  async listInstallations() { const r=await this.pool.query("SELECT id,name,created_at,revoked_at,last_seen_at FROM claw_installations ORDER BY created_at DESC"); return r.rows.map(x=>({id:x.id,name:x.name,createdAt:new Date(x.created_at).toISOString(),revokedAt:x.revoked_at?new Date(x.revoked_at).toISOString():undefined,lastSeenAt:x.last_seen_at?new Date(x.last_seen_at).toISOString():undefined})); }
  async createTask(t: BridgeTask) { const r=await this.pool.query("INSERT INTO alexa_tasks(id,alexa_user_id,installation_id,prompt,title,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING *",[t.id,t.alexaUserId,t.clawId,t.prompt,t.title,t.status,t.createdAt,t.updatedAt]); return r.rowCount ? rowTask(r.rows[0]) : (await this.getTask(t.id))!; }
  async getTask(id: string) { const r=await this.pool.query("SELECT * FROM alexa_tasks WHERE id=$1",[id]); return r.rows[0] ? rowTask(r.rows[0]) : undefined; }
  async listResumableTasks() { const r=await this.pool.query("SELECT * FROM alexa_tasks WHERE status IN ('queued','running') ORDER BY created_at"); return r.rows.map(rowTask); }
  async latestTask(userId: string) { const r=await this.pool.query("SELECT * FROM alexa_tasks WHERE alexa_user_id=$1 ORDER BY created_at DESC LIMIT 1",[userId]); return r.rows[0] ? rowTask(r.rows[0]) : undefined; }
  async updateTask(id: string,status:TaskStatus,fields={}) { await this.pool.query("UPDATE alexa_tasks SET status=$2,result=COALESCE($3,result),error=COALESCE($4,error),updated_at=now() WHERE id=$1",[id,status,(fields as any).result??null,(fields as any).error??null]); }
}

function rowTask(r: Record<string,any>): BridgeTask { return { id:r.id, alexaUserId:r.alexa_user_id, clawId:r.installation_id, prompt:r.prompt, title:r.title, status:r.status, result:r.result??undefined, error:r.error??undefined, createdAt:new Date(r.created_at).toISOString(), updatedAt:new Date(r.updated_at).toISOString() }; }
function safeEqual(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS claw_installations (id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80), credential_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, last_seen_at timestamptz);
CREATE TABLE IF NOT EXISTS alexa_pairings (alexa_user_id text PRIMARY KEY, installation_id uuid NOT NULL REFERENCES claw_installations(id), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pairing_codes (code char(6) PRIMARY KEY, alexa_user_id text NOT NULL, expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS pairing_codes_user_idx ON pairing_codes(alexa_user_id);
CREATE TABLE IF NOT EXISTS alexa_tasks (id text PRIMARY KEY, alexa_user_id text NOT NULL, installation_id uuid NOT NULL REFERENCES claw_installations(id), prompt text NOT NULL, title text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')), result text, error text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS alexa_tasks_user_created_idx ON alexa_tasks(alexa_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS alexa_tasks_installation_status_idx ON alexa_tasks(installation_id,status);
`;
