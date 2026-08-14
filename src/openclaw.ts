import type { ClawInstallation } from "./types.js";

const VOICE_INSTRUCTIONS = `You are responding through an Alexa voice device.
Answer in plain, natural speech with the conclusion first. Use at most 45 words unless the user explicitly asks for more. Do not use Markdown, URLs, tables, headings, citations, or numbered lists. Never speak credentials, tokens, private keys, or other secrets. You may use your normal OpenClaw tools and complete requested work. If work takes time, provide a short status-oriented final summary suitable for later playback.`;

interface ResponsesPayload {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
}

export class OpenClawClient {
  constructor(private readonly timeoutMs: number) {}

  async run(claw: ClawInstallation, prompt: string, userId: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${claw.baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${claw.token}`,
        "content-type": "application/json",
        "x-openclaw-agent-id": claw.agentId,
      },
      body: JSON.stringify({
        model: `openclaw/${claw.agentId}`,
        user: `alexa:${stableUserKey(userId)}`,
        instructions: VOICE_INSTRUCTIONS,
        input: prompt,
        max_output_tokens: 220,
      }),
      signal: combined,
    });
    const payload = await response.json() as ResponsesPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? `OpenClaw returned HTTP ${response.status}`);
    const text = extractText(payload);
    if (!text) throw new Error("OpenClaw returned no spoken response");
    return text;
  }
}

function extractText(payload: ResponsesPayload): string {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text!.trim())
    .filter(Boolean)
    .join(" ");
}

function stableUserKey(userId: string): string {
  let hash = 2166136261;
  for (const char of userId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
