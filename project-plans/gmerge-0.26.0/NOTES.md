# Notes: gmerge/0.26.0

Running notes during batch execution. Append after each batch.

---

## Pre-Execution Notes (2026-03-25)

- Human review changed 17 decisions from initial audit
- 3 A2A server picks deferred to #1675
- ModelInfo dedup (52fadba) → NO_OP; filed #1770 for profile-aware model info
- PTY leak fix (013a4e0) → NO_OP; LLxprt already has safePtyDestroy()
- Hooks disable fix (1998a71) → SKIP; LLxprt already has correct behavior
- 4 HIGH RISK REIMPLEMENTs identified: f7f38e2 (59 files), 608da23 (22+ files), 211d2c5 (hooks schema), cebe386 (MCP status hook)
- Keybinding chain dependency: 09a7301 → fb76408 → 42c26d1 → ce35d84 (all REIMPLEMENT, solo batches in order)
- Skills chain dependency: 4848f42 (PICK) → 222b739 (REIMPLEMENT)
- Package.ts chain: 43846f4 → d8e9db3 (consecutive REIMPLEMENTs)

---

## Batch P1 (2026-03-25)

- c04af6c: Applied with conflict resolution in 3 files; docs/get-started/configuration.md excluded (not in LLxprt). F12 info added to troubleshooting.md.
- f6c2d61: Empty cherry-pick — only touched docs/architecture.md which doesn't exist in LLxprt. Acceptable skip.
- c8c7b57: "project" → "workspace" terminology applied across skill scope strings in disable.ts, skillUtils.ts, skillManager.ts and tests.
- 4848f42: Clean apply. YAML colon handling with parseFrontmatter/parseSimpleFrontmatter.
- d0bbc7f: Conflict resolved — preserved LLxprt's `source` property while taking upstream's `match[2]?.trim() ?? ''` safety.
- Lint: 0 errors (warnings only), typecheck: clean.

---
