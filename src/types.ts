export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ClawInstallation {
  id: string;
  name: string;
  credentialHash: string;
  createdAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

export interface BridgeTask {
  id: string;
  alexaUserId: string;
  clawId: string;
  prompt: string;
  title: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PairingCode {
  code: string;
  alexaUserId: string;
  expiresAt: string;
}

export interface PersistedState {
  version: 1;
  pairings: Record<string, string>;
  pairingCodes: Record<string, PairingCode>;
  tasks: Record<string, BridgeTask>;
}

export interface InstallationCredential {
  installationId: string;
  token: string;
  bridgeWebSocketUrl: string;
}
