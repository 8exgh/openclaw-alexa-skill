import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AlexaConnector } from "./connector.js";
import { defaultCredentialFile, writeCredentials } from "./credentials.js";

const plugin: any = definePluginEntry({
  id:"alexa-bridge",name:"Alexa Bridge",description:"Connects OpenClaw to the My Claw Alexa skill",
  register(api:any){
    if(["cli-metadata","discovery","full"].includes(api.registrationMode))api.registerCli(({program}:any)=>{
      const root=program.command("alexa").description("Manage the Alexa Bridge connection");
      root.command("pair <code>").requiredOption("--bridge <url>","Public Alexa bridge URL").option("--name <name>","Claw name",process.env.HOSTNAME??"My Claw").action(async(code:string,options:{bridge:string;name:string})=>{const response=await fetch(`${options.bridge.replace(/\/$/,"")}/api/v1/pairings/claim`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code,name:options.name})});const body=await response.json() as any;if(!response.ok)throw new Error(body.error??`Pairing failed (${response.status})`);await writeCredentials({installationId:body.installationId,token:body.token,bridgeWebSocketUrl:body.bridgeWebSocketUrl});console.log(`Paired ${options.name}. Restart the OpenClaw Gateway to connect.`);});
    },{descriptors:[{name:"alexa",description:"Manage the Alexa Bridge connection",hasSubcommands:true}]});
    if(api.registrationMode!=="full")return;
    const config=api.pluginConfig??{};let connector:AlexaConnector|undefined;
    api.registerService({id:"connector",async start(){connector=new AlexaConnector(api.runtime,{agentId:config.agentId??"alexa",credentialFile:config.credentialFile??defaultCredentialFile(),taskTimeoutMs:config.taskTimeoutMs??600000});await connector.start();},stop(){connector?.stop();}});
  }
});

export default plugin;
