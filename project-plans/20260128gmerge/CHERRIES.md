# Cherry-Pick Analysis: v0.14.0 → v0.15.4

**Branch:** `20260128gmerge`
**Created:** 2026-01-28
**Upstream range:** `v0.14.0..v0.15.4` (54 substantive commits, 79 total including release/nightly)

---

## Summary

| Decision | Count | Notes |
|----------|-------|-------|
| **PICK** | 22 | Clean cherry-picks |
| **SKIP** | 25 | Telemetry, smart-edit, alternate buffer UI, scrolling, experiments, etc. |
| **REIMPLEMENT** | 7 | Need adaptation for LLxprt architecture |
| **Total substantive** | 54 | |

---

## SKIP: Release/Nightly/Patch Automation (25 commits)

These are release version bumps, nightly releases, and automated cherry-pick-to-release-branch commits. No code changes.

| SHA | Subject | Reason |
|-----|---------|--------|
| `40fa8136e` | chore(release): v0.15.4 | Release automation |
| `60407daf5` | fix(patch): cherry-pick 78a28bf to release/v0.15.3... | Release automation |
| `aa5ca13ef` | chore(release): v0.15.3 | Release automation |
| `a9789ae61` | fix(patch): cherry-pick d03496b to release/v0.15.2... | Release automation |
| `cb5c7fbdc` | chore(release): v0.15.2 | Release automation |
| `4067f85da` | fix(patch): cherry-pick ab6b229 to release/v0.15.1... | Release automation |
| `2c6d3eb51` | chore(release): v0.15.1 | Release automation |
| `79d867379` | fix(patch): cherry-pick ba15eeb to release/v0.15.0... | Release automation |
| `90adfb9a5` | chore(release): v0.15.0 | Release automation |
| `37af6f4f8` | chore(release): v0.15.0-preview.7 | Release automation |
| `d13152b05` | chore(release): v0.15.0-preview.6 | Release automation |
| `24b5eec88` | fix(patch): cherry-pick fb99b95 to release/v0.15.0-preview.5... | Release automation |
| `16f40a284` | chore(release): v0.15.0-preview.5 | Release automation |
| `77751a073` | fix(patch): cherry-pick 13d8d94 to release/v0.15.0-preview.4... | Release automation |
| `4ae2d4b18` | chore(release): v0.15.0-preview.4 | Release automation |
| `2639d7481` | fix(patch): cherry-pick 102905b to release/v0.15.0-preview.3... | Release automation |
| `fcd9b2a5f` | chore(release): v0.15.0-preview.3 | Release automation |
| `605d9167d` | fix(patch): cherry-pick fe1bfc6 to release/v0.15.0-preview.2... | Release automation |
| `128c22ece` | chore(release): v0.15.0-preview.2 | Release automation |
| `e27197096` | fix(patch): cherry-pick 7ec7845 to release/v0.15.0-preview.1... | Release automation |
| `48fa48ca3` | chore(release): v0.15.0-preview.1 | Release automation |
| `dfe7fc9a5` | fix(patch): cherry-pick 540f606 to release/v0.15.0-preview.0... | Release automation |
| `af5a1ebec` | chore(release): v0.15.0-preview.0 | Release automation |
| `e79f62694` | chore/release: bump version to 0.15.0-nightly... | Nightly automation |
| `cd27cae84` | chore(release): bump version to 0.15.0-nightly... | Nightly automation |

---

## SKIP: Feature/Architecture Not Applicable (25 commits)

| # | SHA | Subject | Reason |
|---|-----|---------|--------|
| 1 | `3f90001f8` | Added active experiment ids to Clearcut log events | **Clearcut telemetry removed from LLxprt** |
| 2 | `7bb13d1c4` | telemetry: track interactive session state | **Clearcut telemetry removed from LLxprt** |
| 3 | `4fbeac8b3` | Add experiment logging and add caching experiment | **Clearcut telemetry + experiments infra not in LLxprt** (no `code_assist/experiments/` dir) |
| 4 | `1cab68185` | Support incremental update experiment flag | **Experiment flags infra not in LLxprt** |
| 5 | `ac733d40b` | Add expected_replacements to smart-edit tool | **LLxprt doesn't have smart-edit** (uses deterministic replace + fuzzy edit) |
| 6 | `cbbf56512` | Support ink scrolling final pr (#12567) | **Major UI overhaul** — LLxprt uses different ink version (`@jrichman/ink@6.4.7`), no Scrollable.tsx. Very large diff (45+ files). Would need complete reimplementation. |
| 7 | `8f4b1b582` | Switch to alternate buffer mode before rendering Ink | **Depends on ink scrolling (#12567)** — LLxprt already has `useAlternateBuffer` via different path |
| 8 | `b37c674f2` | feat(ui) Make useAlternateBuffer the default | **Depends on ink scrolling stack** — LLxprt already has this as configurable setting |
| 9 | `2abc288c5` | Make useFullWidth the default | **Already have `useFullWidth` in LLxprt settingsSchema** — may just be a default change |
| 10 | `046b3011c` | Sticky headers where the top rounded border is sticky | **Depends on ink scrolling stack** |
| 11 | `0c4d3b266` | Turns out the node console.clear() clears the buffer | **Depends on alternate buffer mode stack** |
| 12 | `f64994871` | Branch batch scroll (#12680) | **Depends on ink scrolling/Scrollable stack** — LLxprt doesn't have Scrollable.tsx |
| 13 | `e192efa1f` | feat(ui) support animated page up/down, fn-up/down and end+home | **Depends on ink scrolling stack** + keyBindings.ts |
| 14 | `395587105` | Switch back to truncating headers | **Depends on sticky headers/scrolling stack** |
| 15 | `f581ae81d` | jacob314/drag scrollbar | **Depends on Scrollable/ScrollProvider stack** — files don't exist in LLxprt |
| 16 | `9ac47ebf8` | Fix merge conflicts. | **Fixup for scrolling/keyBindings stack** — no standalone value |
| 17 | `3032a8242` | Polish sticky headers | **Depends on sticky headers stack** |
| 18 | `9893da300` | Fix snapshot. | **Fixup for sticky headers** — no standalone value |
| 19 | `43b873124` | Fix extensions logging race condition and slash command logging | **Requires extension-manager.ts** — LLxprt doesn't have this file |
| 20 | `a4415f15d` | feat(core): Migrate generateContent to model configs | **Requires defaultModelConfigs.ts** — LLxprt doesn't have this file. Multi-provider architecture uses different approach. |
| 21 | `fdb608860` | feat(core): Migrate generateJson to resolved model configs | **Same as above** — depends on defaultModelConfigs.ts |
| 22 | `4af4f8644` | Plumb headers through google_credentials transport | **Google-specific auth transport** — LLxprt uses multi-provider auth, not google_credentials |
| 23 | `6893d2744` | feat(sessions): add resuming to geminiChat and CLI flags for session management | **LARGE** (30+ files, session resuming). LLxprt doesn't have `--resume`/`--session` flags. Would need separate feature work. |
| 24 | `6d90b7ddb` | feat(issue-templates): Refine issue template labels and types | **GitHub issue template for upstream repo** — LLxprt has own templates |
| 25 | `f3a8b7371` | fix(ci): ensure correct version calculation and git ls-remote filtering | **CI workflow for upstream release process** — LLxprt has own CI |

---

## PICK: Clean Cherry-Picks (22 commits)

| # | SHA | Subject | Risk | Notes |
|---|-----|---------|------|-------|
| 1 | `054497c7a` | fix(core): Handle null command in VSCode IDE detection | LOW | 1 file, 5 lines |
| 2 | `475e92da5` | Fix test in windows | LOW | Test-only, 2 files |
| 3 | `ef4030331` | docs: fix typos in some files | LOW | Doc typos, 2 files |
| 4 | `5ff7cdc9e` | test(policy): add extreme priority value tests | LOW | Test-only, 1 file |
| 5 | `2077521f8` | Trivial yaml fixes for linter | LOW | 2 YAML files |
| 6 | `331dbd563` | Preserve tabs on paste | LOW | 2 files, text utils |
| 7 | `4ab94dec5` | test: fix flaky file system integration test | LOW | 1 file, test fix |
| 8 | `3c9052a75` | Stop printing garbage characters for F1,F2.. keys | LOW | Text buffer + tests |
| 9 | `2136598e8` | Harden modifiable tool temp workspace | LOW | 2 files, security hardening |
| 10 | `37ca643a6` | Fix external editor diff drift | MEDIUM | Touches coreToolScheduler.ts |
| 11 | `5ba6bc713` | fix(prompt): Add Angular support to base prompt | LOW | Prompt snapshot + 2 lines |
| 12 | `22b055052` | Fix gemini crash on startup in tmux environments | LOW | Header.tsx fix |
| 13 | `51f952e70` | fix(core): use ripgrep --json output for robust cross-platform parsing | MEDIUM | ripGrep.ts + tests |
| 14 | `cc2c48d59` | fix(extension-uninstallation): Fix uninstalling extensions named differently | LOW-MED | extension.test.ts exists but references extension-manager.ts — **NEEDS REVIEW** |
| 15 | `2e2b06671` | Move temp dir from system prompt to first user msg | MEDIUM | Prompt changes, client.test.ts |
| 16 | `3154c06dc` | fix(ci): pre-download ripgrep in global setup to prevent race conditions | LOW | 1 file, test infra |
| 17 | `a0a682826` | fix: Downloading release assets from private GitHub repository | LOW | Extension github.ts |
| 18 | `69339f08a` | Adds listCommands endpoint to a2a server | LOW | A2A server only |
| 19 | `fd59d9dd9` | Fix shift+return in vscode | LOW | KeypressContext, 2 files |
| 20 | `9116cf2ba` | [cleanup] rename info message property 'icon' to 'prefix' | LOW | 2 files, types.ts |
| 21 | `c1076512d` | Deprecate read_many_files tool | LOW-MED | Docs + toolsCommand.ts |
| 22 | `b248ec6df` | Add setting to disable Github extensions | LOW-MED | extension-manager.ts (doesn't exist in LLxprt) — **NEEDS REVIEW** |

---

## REIMPLEMENT: Need LLxprt-Specific Adaptation (7 commits)

| # | SHA | Subject | Reason | Effort |
|---|-----|---------|--------|--------|
| 1 | `9e4ae214a` | Revamp KeypressContext | **LARGE** — 396 lines deleted, LLxprt has own KeypressContext with kitty support. Needs careful merge. | HIGH |
| 2 | `c0b766ad7` | Simplify switch case | **Depends on KeypressContext revamp** — simplifies switch to table-driven dispatch | HIGH (paired with above) |
| 3 | `47603ef8e` | Reload gemini memory on extension load/unload + memory refresh refactor | LLxprt has different extension architecture (no extension-manager.ts). Memory refresh may be partially applicable. | MEDIUM |
| 4 | `c88340314` | Extension Reloading - respect updates to exclude tools | Touches config.test.ts + extension-specific files LLxprt restructured | MEDIUM |
| 5 | `bafbcbbe8` | Add `/extensions restart` command | References extensionsCommand.ts which exists in LLxprt but extension-manager.ts doesn't | MEDIUM |
| 6 | `4ef4bd6f0` | feat(hooks): Hook Execution Engine | LLxprt has hooks/ dir but no hookRunner.ts. 1087 new lines. | HIGH |
| 7 | `6cf1c9852` | Update ink version | LLxprt uses `@jrichman/ink@6.4.7` not upstream ink. Package-lock changes. | LOW but needs care |

---

## Items Needing Your Decision

### 1. `cc2c48d59` — Fix uninstalling extensions named differently
- Touches `extension-manager.ts` (doesn't exist in LLxprt) and `extension.test.ts` (exists)
- **Question:** PICK (may conflict on manager file) or SKIP?

### 2. `b248ec6df` — Setting to disable Github extensions
- Also touches `extension-manager.ts` (doesn't exist) + `extension.test.ts` + docs
- **Question:** PICK (will fail on missing file) / REIMPLEMENT / SKIP?

### 3. `9e4ae214a` + `c0b766ad7` — KeypressContext revamp + simplify
- 396 lines deleted in revamp, LLxprt has kitty protocol support additions
- Very high conflict risk
- **Question:** REIMPLEMENT both together, or SKIP both?

### 4. `47603ef8e` + `c88340314` + `bafbcbbe8` — Extension reload stack
- Memory reload + exclude tools + restart command
- All depend on extension-manager.ts which LLxprt doesn't have
- **Question:** SKIP all 3 (they need extension-manager.ts), or REIMPLEMENT for LLxprt's architecture?

### 5. `4ef4bd6f0` — Hook Execution Engine
- 1087 new lines, LLxprt has hooks/ with hookPlanner, hookRegistry, hookTranslator but no hookRunner
- **Question:** PICK (new file, low conflict) or REIMPLEMENT to integrate with existing hooks/?

### 6. `6cf1c9852` — Update ink version
- LLxprt uses forked ink (`@jrichman/ink@6.4.7`), upstream updates to different version
- **Question:** SKIP (different ink fork) or manually update our fork?

### 7. `2abc288c5` — Make useFullWidth the default
- LLxprt already has `useFullWidth` in settingsSchema. This just changes the default.
- **Question:** PICK (simple default change) or SKIP (we already have our own default)?

### 8. `6893d2744` — Session resuming
- Very large (30+ files), adds `--resume`/`--session` CLI flags, modifies geminiChat
- **Question:** SKIP for now (separate feature), or REIMPLEMENT?

---

## Proposed Batching (pending your approval)

### Batch 1: Low-risk picks (10 commits)
`054497c7a` `475e92da5` `ef4030331` `5ff7cdc9e` `2077521f8` `331dbd563` `4ab94dec5` `3c9052a75` `2136598e8` `3154c06dc`

### Batch 2: Medium-risk picks (6 commits) + FULL VERIFY
`37ca643a6` `5ba6bc713` `22b055052` `51f952e70` `fd59d9dd9` `9116cf2ba`

### Batch 3: Extension/doc picks (4 commits)
`a0a682826` `69339f08a` `2e2b06671` `c1076512d`

### Batch 4+: Reimplementations (TBD based on your decisions)

---

## Awaiting Your Approval

Please review the SKIP/PICK/REIMPLEMENT decisions above, especially the 8 items marked "Needs Your Decision". I'll build the execution PLAN.md once you confirm.
