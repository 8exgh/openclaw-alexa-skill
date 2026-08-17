# OpenClaw Alexa

A self-hosted Alexa Custom Skill bridge plus an installable OpenClaw plugin. It supports independently owned OpenClaw installations without exposing their Gateway ports or credentials.

## Pairing flow

1. The owner enables the Alexa skill and says, “Alexa, ask my claw to pair my claw.”
2. Alexa reads a six-digit code that expires in ten minutes.
3. On their OpenClaw host, the owner installs the plugin and runs:

   ```bash
   openclaw alexa pair 123456 --bridge https://claw-alexa.example.com --name "Home Claw"
   ```

4. The plugin receives a unique revocable credential, stores it locally with mode `0600`, and maintains an outbound WebSocket to the bridge.
5. Alexa requests are routed only to that paired installation. Fast results are spoken immediately; longer work remains a durable task available through “status update.”

## Components

- `src/`: public Alexa bridge, PostgreSQL persistence, pairing API, task routing, and authenticated WebSocket hub.
- `plugin/`: external OpenClaw plugin using official plugin service, CLI, and subagent runtime APIs.
- `alexa/`: Alexa interaction model and example manifest.
- `deploy/`: workflow for the existing self-hosted `devops` runner pattern.
- `setup.md`: complete operator and end-user setup.

## Security boundary

- The bridge never receives an OpenClaw Gateway token.
- Each installation receives a 256-bit credential; only its SHA-256 hash is stored centrally.
- Pairing codes are single-use, expire after ten minutes, and have attempt/rate limits.
- Each OpenClaw initiates its own TLS WebSocket connection; no inbound OpenClaw port is needed.
- Alexa user-to-installation mappings are created only by claiming an Alexa-generated code.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build

npm ci --prefix plugin
npm run typecheck --prefix plugin
npm run build --prefix plugin
```

Run the bridge and PostgreSQL locally with `docker compose up --build` after copying `.env.example` to `.env`.
