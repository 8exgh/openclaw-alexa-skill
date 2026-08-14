import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../src/store.js";

test("pairing codes bind an Alexa user to a configured claw", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alexa-claw-store-"));
  const store = new StateStore(path.join(directory, "state.json"));
  await store.init();
  const pending = await store.createPairingCode("alexa-user");
  assert.equal(await store.claimPairingCode(pending.code, "home"), true);
  assert.equal(store.getPairing("alexa-user"), "home");
  assert.equal(await store.claimPairingCode(pending.code, "other"), false);
});

test("task creation is idempotent by Alexa request id", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alexa-claw-store-"));
  const store = new StateStore(path.join(directory, "state.json"));
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
