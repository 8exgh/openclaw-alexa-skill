import assert from "node:assert/strict";
import test from "node:test";
import { OpenClawClient } from "../src/openclaw.js";

test("OpenClaw client calls the Responses endpoint with the Alexa agent", async (context) => {
  const originalFetch = globalThis.fetch;
  let receivedUrl = "";
  let receivedAgent = "";
  let receivedBody = "";
  globalThis.fetch = async (input, init) => {
    receivedUrl = input.toString();
    receivedAgent = new Headers(init?.headers).get("x-openclaw-agent-id") ?? "";
    receivedBody = init?.body?.toString() ?? "";
    return new Response(JSON.stringify({ output_text: "Everything is healthy." }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await new OpenClawClient(2_000).run({
    id: "home", name: "Home", baseUrl: "http://openclaw:18789", token: "secret", agentId: "alexa",
  }, "check everything", "alexa-user");

  assert.equal(result, "Everything is healthy.");
  assert.equal(receivedUrl, "http://openclaw:18789/v1/responses");
  assert.equal(receivedAgent, "alexa");
  const body = JSON.parse(receivedBody) as { input: string; instructions: string; user: string };
  assert.equal(body.input, "check everything");
  assert.match(body.instructions, /45 words/);
  assert.match(body.user, /^alexa:/);
});
