import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface Credentials { installationId:string; token:string; bridgeWebSocketUrl:string }
export function defaultCredentialFile(){return path.join(os.homedir(),".openclaw","alexa","credentials.json");}
export async function readCredentials(file=defaultCredentialFile()):Promise<Credentials|undefined>{try{return JSON.parse(await readFile(file,"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return;throw e;}}
export async function writeCredentials(value:Credentials,file=defaultCredentialFile()){await mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await rename(temp,file);}
