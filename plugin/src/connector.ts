import crypto from "node:crypto";
import WebSocket from "ws";
import { readCredentials } from "./credentials.js";

const INSTRUCTIONS=`You are responding through Alexa. Lead with the answer, use natural speech, normally stay below 45 words, and never output Markdown, URLs, tables, code, or secrets. You may complete work with your normal tools. End longer work with a concise spoken summary.`;

export class AlexaConnector {
  private ws?:WebSocket; private stopped=false; private retry?:NodeJS.Timeout; private readonly running=new Set<string>(); private readonly cancelled=new Set<string>();
  constructor(private readonly runtime:any,private readonly options:{agentId:string;credentialFile:string;taskTimeoutMs:number}){}
  async start(){this.stopped=false;await this.connect();}
  stop(){this.stopped=true;if(this.retry)clearTimeout(this.retry);this.ws?.close();}
  private async connect(){const credentials=await readCredentials(this.options.credentialFile);if(!credentials){console.warn("Alexa Bridge is not paired; run: openclaw alexa pair <code> --bridge <url>");return;}const ws=new WebSocket(credentials.bridgeWebSocketUrl,{handshakeTimeout:10000});this.ws=ws;ws.on("open",()=>ws.send(JSON.stringify({type:"authenticate",installationId:credentials.installationId,token:credentials.token})));ws.on("message",raw=>void this.handle(JSON.parse(raw.toString())));ws.on("close",()=>this.reconnect());ws.on("error",error=>console.error("Alexa Bridge connection error",error.message));}
  private reconnect(){if(this.stopped)return;this.retry=setTimeout(()=>void this.connect(),5000+crypto.randomInt(5000));}
  private async handle(message:any){if(message.type==="ping"){this.send({type:"pong",timestamp:message.timestamp});return;}if(message.type==="task.cancel"){this.cancelled.add(message.taskId);return;}if(message.type==="task.start")await this.runTask(message);}
  private async runTask(message:{taskId:string;prompt:string;userKey:string}){if(this.running.has(message.taskId))return;this.running.add(message.taskId);this.cancelled.delete(message.taskId);this.send({type:"task.running",taskId:message.taskId});const sessionKey=`agent:${this.options.agentId}:subagent:alexa-${message.userKey}`;try{const started=await this.runtime.subagent.run({sessionKey,message:`${INSTRUCTIONS}\n\nUser request: ${message.prompt}`,deliver:false});await this.runtime.subagent.waitForRun({runId:started.runId,timeoutMs:this.options.taskTimeoutMs});const transcript=await this.runtime.subagent.getSessionMessages({sessionKey,limit:10});const result=lastAssistantText(transcript.messages);if(!result)throw new Error("OpenClaw returned no spoken response");if(!this.cancelled.has(message.taskId))this.send({type:"task.completed",taskId:message.taskId,result});}catch(error){if(!this.cancelled.has(message.taskId))this.send({type:"task.failed",taskId:message.taskId,error:error instanceof Error?error.message:"OpenClaw task failed"});}finally{this.running.delete(message.taskId);this.cancelled.delete(message.taskId);}}
  private send(value:any){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(value));}
}

export function lastAssistantText(messages:any[]):string|undefined{for(let i=messages.length-1;i>=0;i--){const m=messages[i];if(m?.role!=="assistant")continue;if(typeof m.content==="string"&&m.content.trim())return m.content.trim();if(Array.isArray(m.content)){const text=m.content.filter((x:any)=>x?.type==="text"&&typeof x.text==="string").map((x:any)=>x.text).join(" ").trim();if(text)return text;}}}
