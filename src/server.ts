import http from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, hub, store } = await createApp(config);
const server = http.createServer(app);
hub.attach(server);
server.listen(config.port, "0.0.0.0", () => console.log(`OpenClaw Alexa bridge listening on port ${config.port}`));

async function shutdown() { hub.close(); server.close(); await store.close(); }
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
