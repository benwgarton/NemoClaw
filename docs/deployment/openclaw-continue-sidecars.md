# OpenClaw Continue Sidecars

This workflow keeps NemoClaw/OpenClaw as the sandboxed control plane while moving hands-on coding into Continue and keeping review/research sidecars read-only.

## Roles

- `main`: OpenClaw orchestrator inside NemoClaw. Routes work and owns the final response.
- `coder`: Continue + local Ollama for active repo work.
- `reviewer`: host-side CLI that reads review packets and prefers Codex CLI with ChatGPT/Codex auth, falling back to OpenAI `gpt-5.4` API only when explicitly configured.
- `researcher`: host-side CLI that reads research packets and returns cited notes without repo writes.
- `browser-operator`: dry-run-first sidecar for browser workflows; keep it separate from research and require human confirmation before submit/delete/send.

## Packet Bus

The host-owned mailbox root defaults to `~/.openclaw/bus`.

Layout:

```text
~/.openclaw/bus/<workflow-id>/
  manifest.json
  main/
    inbox/
    outbox/
    archive/
  coder/
    inbox/
    outbox/
    archive/
  reviewer/
    inbox/
    outbox/
    archive/
  researcher/
    inbox/
    outbox/
    archive/
  browser-operator/
    inbox/
    outbox/
    archive/
```

Each packet contains:

- `packet_id`
- `workflow_id`
- `from_role`
- `to_role`
- `task_type`
- `summary`
- `artifact_paths`
- `constraints`
- `requested_output`

Only the router should move packets from one role's `outbox` to another role's `inbox`.

## Continue

Write the Continue config with:

```bash
node scripts/write-continue-config.js --output /mnt/c/Users/Benjamin/.continue/config.yaml
```

The generated config uses:

- `qwen3.5:27b-q4_K_M` for `chat`, `edit`, and `apply`
- `qwen2.5-coder:1.5b-base` for `autocomplete`

## Reviewer

The reviewer sidecar supports two backends:

- `codex`: preferred. Uses Codex CLI with existing local auth, including ChatGPT-backed Codex login when available.
- `openai`: optional. Uses `OPENAI_API_KEY` with `gpt-5.4`.

Environment:

- `OPENAI_REVIEW_MODEL` optional, defaults to `gpt-5.4`
- `CODEX_HOME` optional if the Codex auth cache is not in the default location
- `OPENAI_API_KEY` only if you want the API fallback backend

Example:

```bash
node scripts/review-packet.js --workflow demo --packet pkt-1234
```

Force the API backend:

```bash
node scripts/review-packet.js --workflow demo --packet pkt-1234 --backend openai
```

## Researcher

The researcher sidecar supports two modes:

- `constraints.query` with `BRAVE_SEARCH_API_KEY`
- `constraints.urls` for direct URL fetch and excerpting

Example:

```bash
node scripts/research-packet.js --workflow demo --packet pkt-5678
```

## Browser Operator

The browser operator sidecar is intentionally guarded.

- Default behavior is dry-run planning only.
- It generates a confirmation token for irreversible actions.
- Live execution is not enabled unless a trusted browser executor is configured separately.

Example:

```bash
node scripts/browser-operator.js --workflow demo --packet pkt-9012
```

If the packet is flagged as irreversible, route it again only after confirmation:

```bash
node scripts/browser-operator.js --workflow demo --packet pkt-9012 --confirm <token>
```

## Telegram / iPhone Access

NemoClaw already ships an official Telegram bridge:

- docs: `docs/deployment/set-up-telegram-bridge.md`
- script: `scripts/telegram-bridge.js`

That is the preferred iPhone path because it avoids opening the Control UI broadly to the internet.
