import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../src/store.js";
import { TaskRunner, type TaskTransport } from "../src/tasks.js";
import type { BridgeToPlugin, PluginToBridge } from "../src/protocol.js";

test("a connector completion finishes the original durable task", async () => {
  const store=new JsonStore(path.join(await mkdtemp(path.join(os.tmpdir(),"alexa-runner-")),"state.json"));await store.init();
  const code=await store.createPairingCode("user");const installation=await store.enrollWithCode(code.code,"Home","hash");assert.ok(installation);
  const listeners=new Map<string,(message:PluginToBridge)=>void>();
  const transport:TaskTransport={isOnline:()=>true,onTask:(id,fn)=>{listeners.set(id,fn);return()=>listeners.delete(id);},send:(_id,message:BridgeToPlugin)=>{if(message.type==="task.start")setTimeout(()=>listeners.get(message.taskId)?.({type:"task.completed",taskId:message.taskId,result:"Backups are healthy."}),5);return true;}};
  const runner=new TaskRunner(store,transport,{port:3000,dataFile:"",verifyAlexaRequests:false,fastResponseBudgetMs:1000,taskTimeoutMs:1000,maxSpokenCharacters:600,publicBaseUrl:"https://example.test",allowInsecureJsonStore:true});
  const task=await runner.enqueue("user",installation.id,"check backups","request-1");
  const finished=await runner.waitForTerminal(task.id,500);
  assert.equal(finished.status,"completed");assert.equal(finished.result,"Backups are healthy.");
});
