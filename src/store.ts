import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BridgeTask, PairingCode, PersistedState, TaskStatus } from "./types.js";

const emptyState = (): PersistedState => ({ version: 1, pairings: {}, pairingCodes: {}, tasks: {} });

export class StateStore {
  private state: PersistedState = emptyState();
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8")) as PersistedState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  getPairing(userId: string): string | undefined {
    return this.state.pairings[userId];
  }

  async pair(userId: string, clawId: string): Promise<void> {
    this.state.pairings[userId] = clawId;
    await this.persist();
  }

  async createPairingCode(userId: string, ttlMs = 10 * 60_000): Promise<PairingCode> {
    this.removeExpiredCodes();
    let code: string;
    do code = Math.floor(100_000 + Math.random() * 900_000).toString();
    while (this.state.pairingCodes[code]);
    const pairingCode = { code, alexaUserId: userId, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
    this.state.pairingCodes[code] = pairingCode;
    await this.persist();
    return pairingCode;
  }

  async claimPairingCode(code: string, clawId: string): Promise<boolean> {
    this.removeExpiredCodes();
    const pending = this.state.pairingCodes[code];
    if (!pending) return false;
    this.state.pairings[pending.alexaUserId] = clawId;
    delete this.state.pairingCodes[code];
    await this.persist();
    return true;
  }

  async createTask(task: BridgeTask): Promise<BridgeTask> {
    const existing = this.state.tasks[task.id];
    if (existing) return existing;
    this.state.tasks[task.id] = task;
    await this.persist();
    return task;
  }

  getTask(id: string): BridgeTask | undefined {
    return this.state.tasks[id];
  }

  listResumableTasks(): BridgeTask[] {
    return Object.values(this.state.tasks).filter((task) => task.status === "queued" || task.status === "running");
  }

  latestTask(userId: string): BridgeTask | undefined {
    return Object.values(this.state.tasks)
      .filter((task) => task.alexaUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  async updateTask(id: string, status: TaskStatus, fields: Partial<Pick<BridgeTask, "result" | "error">> = {}): Promise<void> {
    const task = this.state.tasks[id];
    if (!task) return;
    Object.assign(task, fields, { status, updatedAt: new Date().toISOString() });
    await this.persist();
  }

  private removeExpiredCodes(): void {
    const now = Date.now();
    for (const [code, pending] of Object.entries(this.state.pairingCodes)) {
      if (Date.parse(pending.expiresAt) <= now) delete this.state.pairingCodes[code];
    }
  }

  private persist(): Promise<void> {
    const serialized = JSON.stringify(this.state, null, 2);
    this.writes = this.writes.then(async () => {
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, serialized, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    return this.writes;
  }
}
