# OpenClaw Alexa Bridge plugin

This external OpenClaw plugin makes an outbound authenticated connection to the My Claw Alexa bridge. No Gateway port or Gateway credential is exposed.

```bash
openclaw plugins install npm-pack:./8examples-openclaw-alexa-0.1.0.tgz
openclaw alexa pair 123456 --bridge https://claw-alexa.example.com --name "Home Claw"
```

Restart the Gateway after pairing. Credentials are stored with mode `0600` under `~/.openclaw/alexa/credentials.json` by default.
