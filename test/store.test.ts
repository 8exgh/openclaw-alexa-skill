import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../src/store.js";

test("pairing codes bind an Alexa user to a configured claw", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alexa-claw-store-"));
  const store = new JsonStore(path.join(directory, "state.json"));
  await store.init();
  const pending = await store.createPairingCode("alexa-user");
  const enrolled = await store.enrollWithCode(pending.code, "Home", "hash");
  assert.ok(enrolled);
  assert.equal(await store.getPairing("alexa-user"), enrolled.id);
  assert.equal(await store.enrollWithCode(pending.code, "Other", "hash"), undefined);
});

test("task creation is idempotent by Alexa request id", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alexa-claw-store-"));
  const store = new JsonStore(path.join(directory, "state.json"));
  await store.init();
  const now = new Date().toISOString();
  const original = await store.createTask({
    id: "request-1", alexaUserId: "user", clawId: "home", prompt: "first", title: "first",
    status: "queued", createdAt: now, updatedAt: now,
  });
  const duplicate = await store.createTask({
    ...original, prompt: "second", title: "second",
  });
  assert.equal(duplicate.prompt, "first");
});
