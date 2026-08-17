import crypto from "node:crypto";
import type http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { BridgeStore } from "./store.js";
import type { BridgeToPlugin, PluginToBridge } from "./protocol.js";

type TaskEventHandler = (message: PluginToBridge) => void;

export class ConnectorHub {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private readonly sockets = new Map<string, WebSocket>();
  private readonly listeners = new Map<string, Set<TaskEventHandler>>();
  private heartbeat?: NodeJS.Timeout;

  constructor(private readonly store: BridgeStore) {}

  attach(server: http.Server): void {
    server.on("upgrade", (request, socket, head) => {
      if (new URL(request.url ?? "/", "http://localhost").pathname !== "/connect") { socket.destroy(); return; }
      this.server.handleUpgrade(request, socket, head, (ws) => this.server.emit("connection", ws, request));
    });
    this.server.on("connection", (ws) => this.handleConnection(ws));
    this.heartbeat = setInterval(() => {
      for (const ws of this.sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() } satisfies BridgeToPlugin));
    }, 30_000);
  }

  close(): void { if (this.heartbeat) clearInterval(this.heartbeat); this.server.close(); }

  isOnline(installationId: string): boolean { return this.sockets.get(installationId)?.readyState === WebSocket.OPEN; }
  disconnect(installationId:string):void { this.sockets.get(installationId)?.close(4403,"credential revoked"); }

  send(installationId: string, message: BridgeToPlugin): boolean {
    const socket = this.sockets.get(installationId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  onTask(taskId: string, handler: TaskEventHandler): () => void {
    const set = this.listeners.get(taskId) ?? new Set(); set.add(handler); this.listeners.set(taskId, set);
    return () => { set.delete(handler); if (!set.size) this.listeners.delete(taskId); };
  }

  private handleConnection(ws: WebSocket): void {
    let installationId: string | undefined;
    const authTimer = setTimeout(() => ws.close(4401, "authentication required"), 5_000);
    ws.on("message", async (raw) => {
      let message: PluginToBridge;
      try { message = JSON.parse(raw.toString()) as PluginToBridge; } catch { ws.close(4400, "invalid json"); return; }
      if (!installationId) {
        if (message.type !== "authenticate" || !await this.store.verifyInstallation(message.installationId, hashToken(message.token))) { ws.close(4403, "invalid credential"); return; }
        installationId = message.installationId; clearTimeout(authTimer);
        this.sockets.get(installationId)?.close(4409, "replaced by newer connection");
        this.sockets.set(installationId, ws); await this.store.touchInstallation(installationId);
        ws.send(JSON.stringify({ type: "authenticated", installationId }));
        return;
      }
      if (message.type === "task.running" || message.type === "task.completed" || message.type === "task.failed") {
        const task = await this.store.getTask(message.taskId);
        if (!task || task.clawId !== installationId) { ws.close(4403, "task ownership mismatch"); return; }
        for (const handler of this.listeners.get(message.taskId) ?? []) handler(message);
      }
    });
    ws.on("close", () => { clearTimeout(authTimer); if (installationId && this.sockets.get(installationId) === ws) this.sockets.delete(installationId); });
    ws.on("error", () => undefined);
  }
}

export function generateCredential(): string { return crypto.randomBytes(32).toString("base64url"); }
export function hashToken(token: string): string { return crypto.createHash("sha256").update(token).digest("hex"); }
