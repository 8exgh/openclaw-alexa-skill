# Setup guide

## Bridge operator setup

### 1. Create the Alexa skill

In the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask), create a Custom Skill named **My Claw** with a self-hosted HTTPS endpoint. Copy the Skill ID, paste [`alexa/interaction-model.json`](alexa/interaction-model.json) into the interaction-model JSON editor, then build the model.

For the publishing example phrases use only:

```text
Alexa, open my claw
Alexa, start my claw
Alexa, launch my claw
```

Account linking is not required. Pairing uses Amazon's skill-scoped Alexa user ID plus a one-time code.

### 2. Configure deployment secrets

The `openclaw-alexa-skill` repository needs:

```text
DEPLOY_TOKEN
```

The `devops` repository needs:

```text
READ_PACKAGES_PAT
OPENCLAW_ALEXA_APPLICATION_ID=amzn1.ask.skill....
OPENCLAW_ALEXA_POSTGRES_PASSWORD=<long random password>
OPENCLAW_ALEXA_PUBLIC_BASE_URL=https://claw-alexa.example.com
OPENCLAW_ALEXA_ADMIN_API_TOKEN=<long random token>
```

Generate the database password with `openssl rand -base64 32`. No OpenClaw Gateway URL or token is stored in GitHub.

### 3. Install the deployment workflow

Copy [`deploy/devops-workflow.yml`](deploy/devops-workflow.yml) to:

```text
devops/.github/workflows/deploy-openclaw-alexa-bridge.yml
```

The deployment targets runner `server7`, host `192.168.4.56`, and port `3070`. A push to this repository builds `ghcr.io/8exgh/openclaw-alexa-bridge:latest` and dispatches deployment to `devops`.

### 4. Configure public ingress

Route a Cloudflare Tunnel hostname such as:

```text
https://claw-alexa.example.com
```

to `http://192.168.4.56:3070`. The proxy must support WebSocket upgrades for `/connect`. Do not put an interactive Cloudflare Access login in front of the hostname.

Configure the Alexa skill endpoint as:

```text
https://claw-alexa.example.com/alexa
```

Production routes used are:

```text
POST /alexa
POST /api/v1/pairings/claim
GET  /connect                 WebSocket upgrade
GET  /healthz
```

Keep `/api/v1/admin/*` reachable only by operators where possible. It also requires `OPENCLAW_ALEXA_ADMIN_API_TOKEN` as a bearer token. List and revoke installations with:

```bash
curl --fail https://claw-alexa.example.com/api/v1/admin/installations \
  -H "Authorization: Bearer $OPENCLAW_ALEXA_ADMIN_API_TOKEN"

curl --fail -X POST \
  https://claw-alexa.example.com/api/v1/admin/installations/INSTALLATION_ID/revoke \
  -H "Authorization: Bearer $OPENCLAW_ALEXA_ADMIN_API_TOKEN"
```

### 5. Publish the OpenClaw plugin

Add `NPM_TOKEN` to this repository. Update the version in `plugin/package.json`, commit, then tag it:

```bash
git tag plugin-v0.1.0
git push origin plugin-v0.1.0
```

The publish workflow validates and publishes `@8examples/openclaw-alexa` to npm. After the first npm release, publish the same package to ClawHub for discovery:

```bash
clawhub package publish 8examples/openclaw-alexa --dry-run
clawhub package publish 8examples/openclaw-alexa
```

## OpenClaw owner setup

### 1. Install the plugin

```bash
openclaw plugins install npm:@8examples/openclaw-alexa
openclaw plugins inspect alexa-bridge --runtime --json
```

### 2. Ask Alexa for a code

Say:

> Alexa, ask my claw to pair my claw.

Alexa reads a six-digit code valid for ten minutes.

### 3. Claim the code on the OpenClaw host

```bash
openclaw alexa pair 123456 \
  --bridge https://claw-alexa.example.com \
  --name "Home Claw"
```

Restart the actual OpenClaw Gateway process after pairing. The plugin stores its unique credential at `~/.openclaw/alexa/credentials.json` with mode `0600` and connects outward to the bridge.

No public OpenClaw URL, firewall rule, or Gateway bearer token is needed.

### 4. Test it

Say:

> Alexa, ask my claw to check whether the backups completed.

For longer work Alexa responds that it started the task. Later say:

> Alexa, ask my claw for a status update.

To disconnect the Alexa account mapping, say:

> Alexa, ask my claw to unpair my claw.

The locally issued plugin credential can be revoked by the bridge operator through the authenticated administration API.

## Capacity notes for the first 100 installations

A single bridge container and PostgreSQL instance are sufficient for this initial scale. Monitor open WebSocket count, task duration, PostgreSQL storage, reconnect rates, and bridge memory. Back up the PostgreSQL volume. Run multiple bridge replicas only after adding cross-replica socket routing (for example Redis pub/sub); WebSocket connections are process-local in this release.
