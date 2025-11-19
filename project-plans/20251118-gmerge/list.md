# 20251118 gmerge Cherry-pick Plan

## Commits to cherry-pick (chronological)

1. `34cd554a3` – Remove `node-fetch` from externals to keep bundling/packaging working across shells.
2. `107537c34` – Fix drag-and-drop file support for macOS Terminal 2.
3. `aea6230bc` – Harden process path detection so startup does not fail when process listing commands error.
4. `af52b04e6` – Introduce the shared OAuth credential class used by the new token storage flow.
5. `918ab3c2e` – Make the OAuth token storage implement the shared interface (prereq for encrypted storage).
6. `036f3a7f9` – Remove special-case folderTrust flag handling so trust logic stays consistent.
7. `e28a043f3` – Add hybrid token storage (encrypted on disk when the flag is enabled).
8. `12f584fff` – Validate IDE auth tokens inside the IDE companion server.
9. `079526fd3` – Fix mixed-input crashes by tightening error handling in the CLI prompt.
10. `2cc0c1a80` – Teach `IdeClient` to send auth tokens to the IDE extension.
11. `80fa4a310` – Make the trusted-folders file path configurable so multi-workspace setups work.
12. `d2f87d15e` – Include `workspacePath` in extension variables to fix template expansion.
13. `726d2c427` – Add `sso://` protocol support to the extensions command surface.
14. `0559040c0` – Fix the automatic compression bug that could hang during large tool output summarization.
15. `35067f12e` – Resolve Windows extension install failures due to path/permission issues.
16. `ee0628cb3` – Wire AbortSignal support through retry logic and tool execution so cancellations propagate.
17. `4cab85a8e` – Allow edit-tool executions to be cancelled cleanly.
18. `f30781364` – Respect preconfigured dynamic client-registration endpoints during OAuth setup.

## Commits intentionally skipped

- All `chore(release)` / tag bump commits (`v0.4.x` through `v0.6.x` previews and finals) – package/version metadata only.
- `ffe7f5f6d` (re-enables next-speaker check) – feature removed in llxprt.
- `7d77f0287`, `88272cba8`, `a0079785a`, `095351bf3`, `8f4321b1c`, `f7ff26ba6` – Clearcut/telemetry additions we do not ship.
- `bee5b638d`, `e76dda37a`, `0e284457b` – pipeline/loop detection/scheduler changes that conflict with llxprt’s multi-provider scheduler.
- `a980c0cec`, `1819ffe5b`, `f9f4b2a26`, `d5d150449` – CI/GitHub workflow adjustments we keep separate.
- `6391c4c0f` (default-on citations), `ebf5437e5` (remove session summaries) – diverge from llxprt UX decisions.
- Documentation-only updates (`a3a0e981e`, `6b576dc57`, `a015ea203`, etc.) unless we specifically need them later.
