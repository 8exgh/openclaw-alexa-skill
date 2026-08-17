export type BridgeToPlugin =
  | { type: "task.start"; taskId: string; prompt: string; userKey: string }
  | { type: "task.cancel"; taskId: string }
  | { type: "ping"; timestamp: number };

export type PluginToBridge =
  | { type: "authenticate"; installationId: string; token: string }
  | { type: "task.running"; taskId: string }
  | { type: "task.completed"; taskId: string; result: string }
  | { type: "task.failed"; taskId: string; error: string }
  | { type: "pong"; timestamp: number };
