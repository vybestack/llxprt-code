Use this checklist to track batch execution progress.

## Current Status

| Field | Value |
|---|---|
| **Last Completed** | Batch 49 (FINAL BATCH) |
| **In Progress** | — |
| **Next Up** | — |
| **Progress** | 49/49 (100%) |
| **Last Updated** | 2026-01-04 |

## Preflight
- [x] On main: `git pull --ff-only`
- [x] Branch exists: `git checkout -b 20260104gmerge`
- [x] Upstream remote + tags fetched: `git fetch upstream --tags`
- [x] Clean worktree before Batch 01: `git status --porcelain` is empty
- [x] File existence pre-check run (see PLAN.md)

## Batch Checklist

- [x] Batch 01 — QUICK — REIMPLEMENT — `b8df8b2a` — feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630)
- [x] Batch 02 — FULL — PICK — `4f17eae5, d38ab079, 2e6d69c9, 47f69317, 8c1656bf` — feat(cli): Prevent queuing of slash and shell commands (#11094) / Update shell tool call colors for confirmed actions (#11126) / Fix --allowed-tools in non-interactive mode to do substring matching for parity with interactive mode. (#10944) / Add support for output-format stream-jsonflag for headless mode (#10883) / Don't always fall back on a git clone when installing extensions (#11229)
- [x] Batch 03 — QUICK — PICK — `cfaa95a2` — feat(cli): Add nargs to yargs options (#11132)
- [x] Batch 04 — FULL — SKIP — `130f0a02` — chore(subagents): Remove legacy subagent code (#11175) — LLxprt has advanced SubAgentScope system, not applicable — **RE-VALIDATED (2026-01-05): All commands PASS**
- [x] Batch 05 — QUICK — REIMPLEMENT — `c9c633be` — refactor: move `web_fetch` tool name to `tool-names.ts` (#11174)
- [x] Batch 06 — FULL — PICK — `60420e52, a9083b9d, b734723d` — feat: Do not add trailing space on directory autocomplete (#11227) / include extension name in `gemini mcp list` command (#11263) / Update extensions install warning (#11149)
- [x] Batch 07 — QUICK — REIMPLEMENT — `05930d5e` — fix(web-fetch): respect Content-Type header in fallback mechanism (#11284)
- [x] Batch 08 — FULL — PICK — `6ded45e5, d2c9c5b3` — feat: Add markdown toggle (alt+m) to switch between rendered and raw… (#10383) / Use Node.js built-ins in scripts/clean.js instead of glob. (#11286)
- [x] Batch 09 — QUICK — REIMPLEMENT — `937c15c6` — refactor: Remove deprecated --all-files flag (#11228)
- [x] Batch 10 — FULL — PICK — `c71b7491, 991bd373, a4403339` — fix: Add folder names in permissions dialog similar to the launch dialog (#11278) / fix(scripts): Improve deflake script isolation and unskip test (#11325) / feat(ui): add "Esc to close" hint to SettingsDialog (#11289)
- [x] Batch 11 — QUICK — REIMPLEMENT — `9049f8f8` — feat: remove deprecated telemetry flags (#11318)
- [x] Batch 12 — FULL — PICK — `22f725eb` — feat: allow editing queued messages with up arrow key (#10392)
- [x] Batch 13 — QUICK — SKIP — `dcf362bc` — Inline tree-sitter wasm and add runtime fallback (#11157) — Deferred: complex build system change, needs separate evaluation
- [x] Batch 14 — FULL — SKIP — `406f0baa, d42da871` — fix(ux) keyboard input hangs while waiting for keyboard input. (#10121) / fix(accessibility) allow line wrapper in screen reader mode  (#11317) — LLxprt already has KITTY_SEQUENCE_TIMEOUT_MS; different line wrapper approach
- [x] Batch 15 — QUICK — PICK — `3a1d3769` — Refactor `EditTool.Name` to use centralized `EDIT_TOOL_NAME` (#11343) — COMMITTED as 8d4830129
- [x] Batch 16 — FULL — PICK — `f3ffaf09, 0ded546a, 659b0557, 4a0fcd05, 2b61ac53` — f3ffaf09 PICKED a5ebeada6 / 0ded546a SKIP (PromptService architecture) / 659b0557 PICKED f6d41e648 / 4a0fcd05 SKIP (different release system) / 2b61ac53 PICKED 8b6f7643f
- [x] Batch 17 — QUICK — PICK — `8da47db1, 7c086fe5, e4226b8a, 4d2a1111, 426d3614` — 8da47db1 PICKED a4dc52cc8 / 7c086fe5 SKIP (McpStatus.tsx deleted) / e4226b8a PICKED 32c4504b6 / 4d2a1111 PICKED 5938d570f / 426d3614 PICKED afe58d996
- [x] Batch 18 — FULL — PICK — `b4a405c6, d3bdbc69` — b4a405c6 SKIP (cosmetic, LLxprt has custom descriptions) / d3bdbc69 SKIP-REIMPLEMENT (extension IDs valuable but conflicts with LLxprt flow)
- [x] Batch 19 — QUICK — SKIP — `08e87a59` — SKIP (Clearcut telemetry not in LLxprt; uses logCliConfiguration() instead)
- [x] Batch 20 — FULL — SKIP — `21163a16` — SKIP (LLxprt command tests diverged; can enable typechecking independently)
- [x] Batch 21 — QUICK — SKIP — `9b9ab609` — SKIP (LLxprt has sophisticated DebugLogger with 269+ usages)
- [x] Batch 22 — FULL — SKIP — `f4330c9f` — SKIP (LLxprt retains workspace extensions for multi-provider config)
- [x] Batch 23 — QUICK — SKIP — `cedf0235` — SKIP (ui/components tests diverged for multi-provider)
- [x] Batch 24 — FULL — SKIP — `2ef38065` — SKIP (SHELL_TOOL_NAME already exists in tool-names.ts)
- [x] Batch 25 — QUICK — SKIP — `dd42893d` — SKIP (config tests diverged for multi-provider architecture)
- [x] Batch 26 — FULL — REIMPLEMENT — `f22aa72c` — REIMPLEMENTED as 81be4bd89 (shell:true default + -I grep flag)
- [x] Batch 27 — QUICK — SKIP — `d065c3ca` — SKIP (test structure differs significantly)
- [x] Batch 28 — FULL — PICK — `98eef9ba` — PICKED as 4af93653d (web_fetch tool definition update)
- [x] Batch 29 — QUICK — REIMPLEMENT — `23e52f0f` — REIMPLEMENTED as fb8155a2b (tool name aliases for compatibility)
- [x] Batch 30 — FULL — SKIP — `0fd9ff0f` — SKIP (UI hooks tests structure differs)
- [x] Batch 31 — QUICK — SKIP — `c8518d6a` — SKIP (LLxprt has different tool architecture)
- [x] Batch 32 — FULL — SKIP — `8731309d` — SKIP-REIMPLEMENT (AbortSignal retry support - needs manual integration)
- [x] Batch 33 — QUICK — PICK — `518a9ca3, d0ab6e99, 397e52da` — 518a9ca3 SKIP (superseded), d0ab6e99 MANUAL_REVIEW, 397e52da MANUAL_REVIEW
- [x] Batch 34 — FULL — SKIP — `36de6862` — SKIP-REIMPLEMENT (traceId propagation - needs manual integration)
- [x] Batch 35 — QUICK — PICK — `49bde9fc, 61a71c4f, d5a06d3c` — 49bde9fc PICKED fffbb87ee, 61a71c4f SKIP (custom waitFor needed for ink), d5a06d3c PICKED 019f9daba
- [x] Batch 36 — FULL — SKIP — `995ae717` — SKIP (LLxprt has DebugLogger architecture, not shared singleton)
- [x] Batch 37 — QUICK — SKIP — `cc7e1472` — SKIP-REIMPLEMENT (major extension system refactor - 35 files)
- [x] Batch 38 — FULL — SKIP — `31f58a1f, 70a99af1, 72b16b3a` — all CONFLICTS: 31f58a1 SKIP (different ripgrep), 70a99af1 REIMPLEMENT, 72b16b3a REIMPLEMENT
- [x] Batch 39 — QUICK — REIMPLEMENT — `7dd2d8f7` — REIMPLEMENT (ShellTool needs static Name, others have it)
- [x] Batch 40 — FULL — SKIP — `654c5550, 0658b4aa` — both CONFLICTS: 654c5550 SKIP-TEST, 0658b4aa MANUAL_REVIEW
- [x] Batch 41 — QUICK — REIMPLEMENT — `bf80263b` — SKIP (LLxprt already has complete message bus/policy engine)
- [x] Batch 42 — FULL — PICK — `62dc9683, e72c00cf, cf16d167` — 62dc9683 SKIP, e72c00cf PICKED f3d6f58e2, cf16d167 PICKED ba3c2f7a4
- [x] Batch 43 — QUICK — REIMPLEMENT — `dd3b1cb6` — SKIP (useGeminiStream.ts conflicts, different architecture)
- [x] Batch 44 — FULL — REIMPLEMENT — `b364f376` — SKIP (LLxprt has DebugLogger architecture)
- [x] Batch 45 — QUICK — PICK — `16f5f767, ccf8d0ca, 5b750f51, ed9f714f, 306e12c2` — 16f5f767 SKIP, ccf8d0ca SKIP, 5b750f51 SKIP (already implemented), ed9f714f SKIP, 306e12c2 PICKED b1fc76d88
- [x] Batch 46 — FULL — PICK — `c7243997, 2940b508, 0d7da7ec` — c7243997 PICKED a9ecf32c1, 2940b508 SKIP (already implemented), 0d7da7ec PICKED 5b6901cd7
- [x] Batch 47 — QUICK — PICK — `847c6e7f` — SKIP-REIMPLEMENT (different compression architecture)
- [x] Batch 48 — FULL — PICK — `ce40a653` — SKIP (depends on batch 47, missing files)
- [x] Batch 49 — QUICK — PICK — `b1bbef43` — SKIP (different loop detection implementation order)

---

## Re-validation Records

### Batch 01 (2026-01-05)
- Previously implemented as commit 577de9661
- Re-ran all verification commands (lint, typecheck, build, start)
- All commands PASSED
- See NOTES.md for detailed output
- AUDIT.md: No changes needed (implementation status unchanged)

### Batch 02 (2026-01-05)
- Previously implemented as commit f88b73ffe
- Upstream SHAs: 4f17eae5, d38ab079, 2e6d69c9, 47f69317, 8c1656bf
- Re-ran all verification commands (lint, typecheck, build, start)
- All commands PASSED
- See NOTES.md for detailed output
- AUDIT.md: No changes needed (implementation status unchanged)

### Batch 03 (2026-01-05)
- Already implemented via commit dcf347e21 (predates upstream cfaa95a2)
- Functionality: nargs: 1 on yargs single-argument options, positional prompt parsing
- Re-ran all verification commands (lint, typecheck, build, start)
- All commands PASSED
- See NOTES.md for detailed output
- AUDIT.md: No changes needed (already verified as SKIP/NO_OP)

### Batch 05 (2026-01-05)
- Previously implemented as commit 19c602897
- Upstream SHA: c9c633be
- Functionality: Move web_fetch tool name to tool-names.ts (GOOGLE_WEB_FETCH_TOOL, DIRECT_WEB_FETCH_TOOL)
- Re-ran all verification commands (lint, typecheck, build, start)
- All commands PASSED
- See NOTES.md for detailed output
- AUDIT.md: No changes needed (implementation status unchanged)

### Batch 08 (2026-01-05)
- Contains 2 commits: 6ded45e5, d2c9c5b3
- 6ded45e5: SKIP/NO_OP - Markdown toggle already implemented (RawMarkdownIndicator, renderMarkdown state, Alt+M/Opt+M shortcuts)
- d2c9c5b3: COMMITTED as c3d9e02e1 - Node.js built-ins in clean.js (readdirSync/statSync instead of glob)
- Re-ran all verification commands (lint, typecheck, build, start)
- All commands PASSED
- See NOTES.md and batch08-revalidation.txt for detailed output
- AUDIT.md: No changes needed (implementation status unchanged)

### Batch 11 (2026-01-06)
- Upstream commit 9049f8f8 removes deprecated telemetry CLI flags from Google's gemini-cli
- Decision: SKIP - LLxprt has multi-provider architecture with different telemetry system
- Re-ran all verification commands (lint, typecheck, build, start)
- All commands PASSED
- See NOTES.md for detailed output (lines 2375+)
- AUDIT.md: No changes needed (implementation status unchanged)
- LLxprt retains all 5 telemetry CLI flags (--telemetry, --telemetry-target, --telemetry-otlp-endpoint, --telemetry-log-prompts, --telemetry-outfile)
- Upstream uses Clearcut for telemetry; LLxprt uses uiTelemetryService and logCliConfiguration()

