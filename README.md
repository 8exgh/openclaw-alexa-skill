# OpenClaw Alexa bridge

A self-hosted Alexa Custom Skill endpoint that turns an Echo into a concise voice interface for a private OpenClaw Gateway. There is no AWS Lambda component.

## How it behaves

Every Alexa request is persisted as a task before OpenClaw starts it. The bridge waits up to 5.5 seconds for that same task:

- If OpenClaw finishes, Alexa speaks the concise result.
- If it is still running, Alexa says it started and invites you to ask for a status update.
- A later status request reads the persisted task; the original work is not started twice.
- Tasks survive bridge-container restarts and incomplete tasks resume.

The bridge calls OpenClaw's private, OpenResponses-compatible endpoint. OpenClaw runs the request through its normal agent path, including the selected agent's tools and policies.

## Architecture

```text
Alexa cloud --HTTPS--> Cloudflare Tunnel/reverse proxy
                              |
                              v
                   Alexa bridge container :3000
                     |                 |
                     |                 +-- /app/data/state.json
                     v
             private OpenClaw Gateway :18789
                     |
                     v
               dedicated alexa agent
```

Expose only the bridge's `/alexa` route publicly. Keep the OpenClaw Gateway private; its bearer credential is operator-level access.

## OpenClaw preparation

1. Create a dedicated agent with ID `alexa`.
2. Put [openclaw/alexa-agent-instructions.md](openclaw/alexa-agent-instructions.md) in that agent's instructions/workspace.
3. Give that agent a fast default model and a deliberately restricted tool policy. Alexa is a shared-room interface.
4. Enable the Responses endpoint as shown in [openclaw/openclaw-config.example.json5](openclaw/openclaw-config.example.json5):

```json5
gateway: { http: { endpoints: { responses: { enabled: true } } } }
```

5. Verify from the future bridge host:

```bash
curl --fail http://OPENCLAW_PRIVATE_HOST:18789/v1/models \
  -H "Authorization: Bearer YOUR_GATEWAY_TOKEN"
```

Do not route `/v1/responses`, `/v1/models`, or the Gateway port through the public tunnel.

## Local Docker setup

Copy `.env.example` to `.env`, fill in the values, then run:

```bash
docker compose up --build -d
curl --fail http://127.0.0.1:3042/healthz
```

The Compose port binds to loopback intentionally. Point Caddy, Traefik, nginx, or the Cloudflare Tunnel at `http://127.0.0.1:3042` from the same host. If your existing Cloudflare Tunnel on Server3 routes to another internal server, change the published binding in the deployment workflow from `3042:3000` only if necessary and restrict the port at the network firewall.

## Alexa skill setup

1. Create a Custom Skill in the Alexa Developer Console using your preferred locale.
2. Set its invocation name to `my claw`.
3. Paste [alexa/interaction-model.json](alexa/interaction-model.json) into the JSON editor and build the model. Change the locale if required.
4. Choose an HTTPS web-service endpoint and enter `https://YOUR_HOST/alexa`.
5. Select the trusted certificate option.
6. Copy the skill ID (`amzn1.ask.skill...`) into the `OPENCLAW_ALEXA_APPLICATION_ID` GitHub secret.
7. Enable development testing. An Echo registered to the same Amazon account can invoke the development skill; public publication is not required for personal testing.

Examples:

```text
Alexa, open my claw.
Alexa, ask my claw to check whether the backups completed.
Alexa, ask my claw for a status update.
Alexa, ask my claw to cancel the task.
```

Alexa's `AMAZON.SearchQuery` slot is not completely free-form dictation. Carrier wording such as “ask,” “do,” or “find out” gives Alexa's interaction model a better chance of capturing the complete request.

## Pairing

### One configured Claw (recommended for this deployment)

With `AUTO_PAIR_SINGLE_CLAW=true`, the first launch automatically maps that Alexa user ID to the only configured Claw. Saying “pair my Claw” performs the same binding explicitly. No Gateway token is spoken or entered into Alexa.

### Multiple configured Claws

Set `CLAW_INSTALLATIONS_JSON` instead of the single `OPENCLAW_*` connection variables and set `AUTO_PAIR_SINGLE_CLAW=false`. Saying “pair my Claw” produces a six-digit, ten-minute code. Claim it with:

```bash
BRIDGE_URL=https://assistant.example.com \
PAIRING_ADMIN_TOKEN='from-your-secret-store' \
./scripts/claim-pairing.sh 123456 home
```

Example secret value:

```json
[{"id":"home","name":"home claw","baseUrl":"http://192.168.4.56:18789","token":"...","agentId":"alexa"}]
```

The state file stores only the selected Claw ID. Gateway tokens remain in container environment configuration supplied by GitHub Actions.

## CI/CD in your infrastructure

The implementation follows the existing `inventory-shopify`/`devops` split:

1. [.github/workflows/build-and-request-deploy.yml](.github/workflows/build-and-request-deploy.yml) builds the image and pushes `ghcr.io/8exgh/openclaw-alexa-bridge:latest`.
2. It sends the `openclaw-alexa-bridge-deploy` repository dispatch event.
3. [deploy/devops-workflow.yml](deploy/devops-workflow.yml) is copied into `devops/.github/workflows/deploy-openclaw-alexa-bridge.yml` and runs on a self-hosted runner.
4. The runner pulls and replaces the container, mounts persistent state, and checks `/healthz`.

The source repository needs:

- `DEPLOY_TOKEN`: token allowed to send `repository_dispatch` to `8exgh/devops`.

The `devops` repository needs:

- `READ_PACKAGES_PAT`
- `OPENCLAW_ALEXA_APPLICATION_ID`
- `OPENCLAW_ALEXA_BASE_URL`: private URL reachable from the selected runner/server
- `OPENCLAW_ALEXA_GATEWAY_TOKEN`
- `OPENCLAW_ALEXA_PAIRING_ADMIN_TOKEN`: generate with `openssl rand -base64 32`

Review these two deployment values before copying the workflow:

- Runner label: currently `server7`
- Host port: currently `3042`, selected as the next port after the documented Server7 application range

No secrets are built into the image, checked into this repository, or sent in the repository-dispatch payload.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build
```

For local Alexa-envelope testing only, set `VERIFY_ALEXA_REQUESTS=false`. Production defaults to signature and timestamp verification and should never disable it.

## Operational notes

- `FAST_RESPONSE_BUDGET_MS` defaults to 5500, leaving time for Alexa/network overhead inside the eight-second limit.
- `OPENCLAW_TIMEOUT_MS` defaults to ten minutes for background work.
- Alexa request IDs are task IDs, making retries idempotent.
- Spoken output is stripped of Markdown/URLs and capped at 600 characters as a final safety net.
- The latest task is currently the status target. Named lookup and a task-history UI are natural later additions.
- Cancellation aborts the bridge's OpenClaw HTTP request. Whether an already-issued external side effect can be reversed depends on the OpenClaw tool involved.
