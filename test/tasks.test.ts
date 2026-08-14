import assert from "node:assert/strict";
import test from "node:test";
import { cleanForSpeech } from "../src/tasks.js";

test("speech cleanup removes markup and URLs", () => {
  assert.equal(cleanForSpeech("**Done.** See https://example.com/report", 100), "Done. See a link");
});

test("speech cleanup caps long results", () => {
  const result = cleanForSpeech(`${"A".repeat(30)}. ${"B".repeat(60)}`, 50);
  assert.ok(result.length <= 50);
  assert.match(result, /…$/);
});
