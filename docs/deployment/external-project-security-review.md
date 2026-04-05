# External Project Security Review

This review documents why NemoClaw should **reference** certain GitHub projects for ideas while **rebuilding the runtime pieces locally** for security.

Date reviewed: `2026-04-05`

## Repos reviewed

- `affaan-m/everything-claude-code`
- `Hmbown/NemoHermes`
- `NousResearch/Hermes-Agent`

## Recommendation

- Use `everything-claude-code` for workflow ideas only.
- Use `NemoHermes` as a small design reference only.
- Do **not** embed `Hermes-Agent` directly into this NemoClaw/OpenClaw stack.
- Rebuild only the minimal pieces we actually need inside this repo.

## Findings

### `everything-claude-code`

What looks good:

- Has a published `SECURITY.md`.
- CI and release workflows pin major GitHub actions to full SHAs.
- Includes security-oriented validation and secret-detection scripts.
- Dependency surface is relatively small for the published npm package.

What makes it unsafe to import wholesale:

- It is still a large local-hooks/config/scripts repo that is meant to execute on the operator's machine.
- It contains MCP bootstrap logic that forwards `gh auth token` into process environment for GitHub server startup.
- It carries many hook, install, orchestration, and environment-merging scripts that are powerful by design.

Verdict:

- Copy patterns, not code.

### `NemoHermes`

What looks good:

- Narrow TypeScript codebase.
- Small dependency surface (`commander` only at runtime).
- No shell execution or package-install behavior in the runtime code reviewed.
- Main behavior is local endpoint probing, simple registry caching, and route selection.
- Includes a `SECURITY.md`.

What still argues against importing it directly:

- Early-stage project (`0.1.0`) with a compatibility-bridge scope, not a hardened production dependency.
- Bakes in catalog and discovery assumptions that we should own locally if they affect routing decisions.
- Plugin/runtime contract may change under us.

Verdict:

- Safest external reference of the three, but still better to re-implement the useful ideas in-tree.

### `Hermes-Agent`

High-risk characteristics:

- Large Python + Node dependency surface.
- `curl | bash` and `irm ... | iex` install paths.
- Browser, messaging, voice, MCP, cron, RL, and optional remote/runtime integrations.
- Optional dependencies include `git+https` sources.
- Installer pulls tools and browser dependencies dynamically and may use `sudo`.
- Broad runtime scope increases attack surface and review burden.

Positive signals:

- Supply-chain-audit workflow exists.
- Some dependency version ranges are constrained.

Verdict:

- Use as inspiration only.
- Do not import it into a security-sensitive local control plane.

## Practical outcome for NemoClaw

The secure path is:

- Keep OpenClaw/NemoClaw as the orchestration layer.
- Keep Continue/Ollama as the coding surface.
- Keep reviewer and researcher as read-only sidecars.
- Add browser operations only behind explicit dry-run and human-confirmation gates.
- Rebuild integration code in this repo instead of importing high-power external agent stacks.
