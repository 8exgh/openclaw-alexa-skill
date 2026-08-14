import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { OpenClawClient } from "./openclaw.js";
import { StateStore } from "./store.js";
import type { BridgeTask } from "./types.js";

export class TaskRunner {
  private readonly active = new Map<string, AbortController>();
  private readonly client: OpenClawClient;

  constructor(private readonly store: StateStore, private readonly config: Config) {
    this.client = new OpenClawClient(config.openClawTimeoutMs);
  }

  resume(): void {
    for (const task of this.store.listResumableTasks()) void this.execute(task.id);
  }

  async enqueue(userId: string, clawId: string, prompt: string, requestId?: string): Promise<BridgeTask> {
    const now = new Date().toISOString();
    const task = await this.store.createTask({
      id: requestId ?? randomUUID(),
      alexaUserId: userId,
      clawId,
      prompt,
      title: titleFor(prompt),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    if (task.status === "queued") void this.execute(task.id);
    return task;
  }

  async waitForTerminal(id: string, budgetMs: number): Promise<BridgeTask> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const task = this.store.getTask(id);
      if (!task) throw new Error("Task disappeared");
      if (["completed", "failed", "cancelled"].includes(task.status)) return task;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return this.store.getTask(id)!;
  }

  async cancelLatest(userId: string): Promise<boolean> {
    const task = this.store.latestTask(userId);
    if (!task || !["queued", "running"].includes(task.status)) return false;
    this.active.get(task.id)?.abort();
    await this.store.updateTask(task.id, "cancelled");
    return true;
  }

  private async execute(id: string): Promise<void> {
    if (this.active.has(id)) return;
    const task = this.store.getTask(id);
    if (!task || !["queued", "running"].includes(task.status)) return;
    const claw = this.config.installations.find((candidate) => candidate.id === task.clawId);
    if (!claw) {
      await this.store.updateTask(id, "failed", { error: "The paired Claw is no longer configured." });
      return;
    }
    const controller = new AbortController();
    this.active.set(id, controller);
    await this.store.updateTask(id, "running");
    try {
      const result = await this.client.run(claw, task.prompt, task.alexaUserId, controller.signal);
      if (this.store.getTask(id)?.status !== "cancelled") {
        await this.store.updateTask(id, "completed", { result: cleanForSpeech(result, this.config.maxSpokenCharacters) });
      }
    } catch (error) {
      if (this.store.getTask(id)?.status !== "cancelled") {
        await this.store.updateTask(id, "failed", { error: friendlyError(error) });
      }
    } finally {
      this.active.delete(id);
    }
  }
}

export function cleanForSpeech(text: string, maxCharacters: number): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " omitted code ")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[*_#`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxCharacters) return cleaned;
  const slice = cleaned.slice(0, maxCharacters - 1);
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  return `${(boundary > maxCharacters / 2 ? slice.slice(0, boundary + 1) : slice).trim()}…`;
}

function titleFor(prompt: string): string {
  const words = prompt.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim().split(/\s+/).slice(0, 8);
  return words.join(" ") || "Alexa request";
}

function friendlyError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "OpenClaw took too long to finish.";
  if (error instanceof Error && error.name === "AbortError") return "The task was cancelled.";
  return error instanceof Error ? error.message.slice(0, 300) : "OpenClaw could not complete the task.";
}
