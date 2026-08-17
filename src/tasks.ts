import crypto, { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { BridgeToPlugin, PluginToBridge } from "./protocol.js";
import type { BridgeStore } from "./store.js";
import type { BridgeTask } from "./types.js";

export class TaskRunner {
  private readonly active = new Set<string>();
  constructor(private readonly store: BridgeStore, private readonly hub: TaskTransport, private readonly config: Config) {}
  async resume() { for (const task of await this.store.listResumableTasks()) void this.execute(task.id); }
  async enqueue(userId:string,clawId:string,prompt:string,requestId?:string) { const now=new Date().toISOString(); const task=await this.store.createTask({id:requestId??randomUUID(),alexaUserId:userId,clawId,prompt,title:titleFor(prompt),status:"queued",createdAt:now,updatedAt:now}); if(task.status==="queued"||task.status==="running") void this.execute(task.id); return task; }
  async waitForTerminal(id:string,budgetMs:number) { const end=Date.now()+budgetMs; while(Date.now()<end){const task=await this.store.getTask(id);if(!task)throw new Error("Task disappeared");if(["completed","failed","cancelled"].includes(task.status))return task;await delay(75);}return (await this.store.getTask(id))!; }
  async cancelLatest(userId:string) { const task=await this.store.latestTask(userId);if(!task||!["queued","running"].includes(task.status))return false;this.hub.send(task.clawId,{type:"task.cancel",taskId:task.id});await this.store.updateTask(task.id,"cancelled");return true; }
  private async execute(id:string) { if(this.active.has(id))return;this.active.add(id);let unsubscribe=()=>{};try{const task=await this.store.getTask(id);if(!task||!["queued","running"].includes(task.status))return; while(!this.hub.isOnline(task.clawId)){if((await this.store.getTask(id))?.status==="cancelled")return;await delay(1000);} await this.store.updateTask(id,"running"); const terminal=new Promise<void>((resolve)=>{unsubscribe=this.hub.onTask(id,(event)=>{void(async()=>{if(event.type==="task.running")await this.store.updateTask(id,"running");if(event.type==="task.completed"){await this.store.updateTask(id,"completed",{result:cleanForSpeech(event.result,this.config.maxSpokenCharacters)});resolve();}if(event.type==="task.failed"){await this.store.updateTask(id,"failed",{error:event.error.slice(0,300)});resolve();}})();});}); if(!this.hub.send(task.clawId,{type:"task.start",taskId:id,prompt:task.prompt,userKey:stableUserKey(task.alexaUserId)}))throw new Error("Claw disconnected"); await Promise.race([terminal,delay(this.config.taskTimeoutMs).then(()=>{throw new Error("Claw task timed out");})]);}catch(error){const task=await this.store.getTask(id);if(task?.status!=="cancelled")await this.store.updateTask(id,"failed",{error:error instanceof Error?error.message:"Claw task failed"});}finally{unsubscribe();this.active.delete(id);} }
}
export interface TaskTransport { isOnline(id:string):boolean; send(id:string,message:BridgeToPlugin):boolean; onTask(id:string,handler:(message:PluginToBridge)=>void):()=>void }
export function cleanForSpeech(text:string,max:number){const cleaned=text.replace(/```[\s\S]*?```/g," omitted code ").replace(/https?:\/\/\S+/g,"a link").replace(/[*_#`>|]/g,"").replace(/\s+/g," ").trim();if(cleaned.length<=max)return cleaned;return `${cleaned.slice(0,max-1).trim()}…`;}
function titleFor(prompt:string){return prompt.replace(/[^\p{L}\p{N}\s'-]/gu," ").trim().split(/\s+/).slice(0,8).join(" ")||"Alexa request";}
function stableUserKey(value:string){return crypto.createHash("sha256").update(value).digest("hex").slice(0,16);}
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
