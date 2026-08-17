import assert from "node:assert/strict";
import test from "node:test";
import { lastAssistantText } from "../src/connector.js";

test("extracts the newest assistant text",()=>{
  assert.equal(lastAssistantText([{role:"assistant",content:"first"},{role:"user",content:"next"},{role:"assistant",content:[{type:"text",text:"finished"}]}]),"finished");
});
