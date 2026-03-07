# Cherry-Pick Decisions: v0.23.0 → v0.24.4

**Total commits in range:** 118  
**Decision counts:** PICK 22 (19%) · SKIP 48 (41%) · REIMPLEMENT 38 (32%) · NO_OP 10 (8%)

> **Methodology:** This audit builds on the comprehensive gmerge-0.24.5 code-level audit (4 parallel subagent deep-dives, full `git show` for every commit, file existence checks). Execution-time reclassifications from the gmerge/0.24.5 Phase A cherry-pick pass are pre-applied here — commits that conflicted heavily during actual cherry-pick have been moved to REIMPLEMENT. The v0.24.4 range is identical to v0.24.5 minus 3 commits (`588c1a6d`, `3441b8837`, `d6bb149a7`).

---

## Decision Notes

### 1. Agent Skills System (11 commits → PICK with branding)
Self-contained feature. Zero dependencies on removed infrastructure. All LLxprt infrastructure exists (ToolRegistry, MessageBus, PolicyEngine, Storage, Settings, Extensions). Commits form a linear dependency chain — pick in order. Branding: `.gemini` → `.llxprt`, `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`. Previous gmerge/0.24.5 successfully picked all 11 — reuse that approach.

### 2. MessageBus Phase 1-3 (3 commits → REIMPLEMENT)
LLxprt uses service locator (`config.getMessageBus()`). Upstream's 3-phase migration adopts proper DI. Better practice. Touches 50+ files but pattern is mechanical.

### 3. Remote Agents / A2A (3 commits → SKIP, deferred)
Incompatible agent architecture. ~1500-2000 LoC new. Separate issue.

### 4. Tool Scheduler Refactor (2 commits → REIMPLEMENT)
LLxprt's scheduler has parallel batching divergence (2139 lines). Extract types, ToolExecutor our own way.

### 5. Hooks System (10 commits → REIMPLEMENT)
LLxprt reimplemented the hook system. Port behavior/concepts, not code.

### 6. Extensions (5 commits → REIMPLEMENT)
LLxprt reimplemented extensions. Port behavior/concepts.

### 7. Exponential Backoff (`07e597de`) → SKIP
LLxprt has RetryOrchestrator with exponential backoff+jitter+bucket failover. Redundant.

### 8. Image Token Estimation (`c31f0535`) → SKIP
Issue #1648 covers with provider-aware approach. Upstream's flat 3000 is Gemini-specific.

### 9. Release/CI/Version Bumps → SKIP (no functional code)

### 10. Execution-Time Reclassifications (from gmerge/0.24.5 Phase A)
The following were originally PICK but reclassified during actual cherry-pick due to conflicts:
- `b0d5c4c0` (dynamic policy): 7 conflict files → REIMPLEMENT
- `b6b0727e` (schema non-fatal): 7 conflicts in settings.ts + gemini.tsx → REIMPLEMENT
- `873d10df` (terse image paths): conflicts → REIMPLEMENT
- `18fef0db` (shell redirection): 12 conflicts → REIMPLEMENT
- `0f3555a4` (/dir add): modify/delete → REIMPLEMENT
- `8f0324d8` (paste fix): 13 conflicts → REIMPLEMENT
- `d2849fda` (keyboard modes): depends on paste infra → REIMPLEMENT
- `5f286147` (MCP resources limit): McpStatus.tsx doesn't exist → SKIP
- `dc6dda5c` (SDK logging): loggingContentGenerator diverged → SKIP
- `30f5c4af` (powershell mock): shell area diverged → SKIP

---

## PICK Table (22 commits, chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `0a216b28f36c` | 2025-12-22 | cli | Bug fix — prevent EIO crash in readStdin. Clean apply proven on gmerge/0.24.5. | fix #15369, prevent crash on unhandled EIO error in readStdin cleanup (#15410) |
| 2 | `e9a601c1fe87` | 2025-12-23 | mcp, cli | Bug fix — missing `type` field in MCPServerConfig. Clean apply proven. | fix: add missing `type` field to MCPServerConfig (#15465) |
| 3 | `56b050422d7a` | 2025-12-26 | core | Trivial comment typo fix. Clean apply proven. | chore(core): fix comment typo (#15558) |
| 4 | `acecd80afa24` | 2025-12-26 | ide | Bug fix — unhandled promise rejection in ide-client. Clean apply proven. | Resolve unhandled promise rejection in ide-client.ts (#15587) |
| 5 | `21388a0a40b0` | 2025-12-27 | core | Bug fix — handle checkIsRepo failure. Clean apply proven. | fix(core): handle checkIsRepo failure in GitService.initialize (#15574) |
| 6 | `de1233b8ca5f` | 2025-12-30 | skills | Agent Skills 1: Core Infrastructure. Branding needed. Proven on gmerge/0.24.5. | Agent Skills: Implement Core Skill Infrastructure (#15698) |
| 7 | `958284dc2491` | 2026-01-02 | skills | Agent Skills 2: Activation Tool. | Agent Skills: Implement Autonomous Activation Tool (#15725) |
| 8 | `764b195977f4` | 2026-01-02 | skills | Agent Skills 3: System Prompt. | Agent Skills: Implement Agent Integration and System Prompt Awareness (#15728) |
| 9 | `e78c3fe4f0be` | 2026-01-02 | skills, ui | Agent Skills 4: Status Bar. | Agent Skills: Status Bar Integration for Skill Counts (#15741) |
| 10 | `f0a039f7c07d` | 2026-01-03 | skills | Agent Skills 5: Refactor/centralize loading. | Agent Skills: Unify Representation & Centralize Loading (#15833) |
| 11 | `bdb349e7f6c0` | 2026-01-04 | skills, ext | Agent Skills 6: Extension support. | Agent Skills: Extension Support & Security Disclosure (#15834) |
| 12 | `d3563e2f0eb1` | 2026-01-04 | skills, cli | Agent Skills 7: CLI commands. | Agent Skills: Add gemini skills CLI management command (#15837) |
| 13 | `2cb33b2f764b` | 2026-01-05 | skills | Agent Skills 8: /skills reload. | Agent Skills: Implement /skills reload (#15865) |
| 14 | `0c5413624415` | 2026-01-06 | skills | Agent Skills 9: WorkspaceContext. | Agent Skills: Add skill directory to WorkspaceContext (#15870) |
| 15 | `5f027cb63a45` | 2026-01-07 | skills, settings | Agent Skills 10: Hide broken skills from settings. | fix: hide broken skills object from settings dialog (#15766) |
| 16 | `59a18e710daa` | 2026-01-06 | docs | Agent Skills 11: Documentation. Branding needed. | Agent Skills: Initial Documentation & Tutorial (#15869) |
| 17 | `8a0190ca3bc4` | 2026-01-03 | mcp | Bug fix — unhandled promise rejection in mcp-client-manager. Clean apply proven. | fix(core): handle unhandled promise rejection in mcp-client-manager (#14701) |
| 18 | `615b218ff702` | 2026-01-04 | cli, tests | Mock fs.readdir in consent tests. Clean apply proven. | fix(cli): mock fs.readdir in consent tests for Windows compatibility (#15904) |
| 19 | `3997c7ff803c` | 2026-01-05 | core | Fix terminal hang on browser exit. Clean apply proven. | Fix terminal hang when user exits browser without logging in (#15748) |
| 20 | `2da911e4a02e` | 2026-01-06 | cli | Prevent /copy crash on Windows. Clean apply proven. | fix: prevent /copy crash on Windows by skipping /dev/tty (#15657) |
| 21 | `a61fb058b7ca` | 2026-01-06 | core | Fix writeTodo construction. Clean apply proven. | fix: writeTodo construction (#16014) |
| 22 | `687ca40b5093` | 2026-01-16 | core | **Race condition fix** — `void` → `await` on scheduleToolCalls. LLxprt has exact same bug. Clean apply proven. | Fix race condition by awaiting scheduleToolCalls (#16759) |

---

## SKIP Table (48 commits, chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `d6a2f1d670f7` | 2025-12-22 | core | Touches availability/policyHelpers, fallback/handler — none exist. | chore(core): refactor model resolution and cleanup fallback logic (#15228) |
| 2 | `d18c96d6a17e` | 2025-12-22 | core | Google-internal code assist metrics. | Record timestamp with code assist metrics (#15439) |
| 3 | `0843d9af58d4` | 2025-12-22 | core | startupProfiler.ts doesn't exist. | fix(core): use debugLogger.debug for startup profiler logs (#15443) |
| 4 | `2ac9fe08f7a0` | 2025-12-22 | misc | Repo cleanup — accidental clipboard file. | chore: remove clipboard file (#15447) |
| 5 | `308aa70718fd` | 2025-12-23 | hooks | Removes deprecated aliases. LLxprt hooks don't have these. | refactor(core): remove deprecated permission aliases (#14855) |
| 6 | `5f2861476093` | 2025-12-23 | mcp, ui | **Reclassified from PICK.** McpStatus.tsx doesn't exist in LLxprt. | chore: limit MCP resources display to 10 by default (#15489) |
| 7 | `9cdb267ba586` | 2025-12-26 | ui | Holiday theme. Not in LLxprt. | feat: Show snowfall animation for holiday theme (#15494) |
| 8 | `69fc75c0b220` | 2025-12-26 | cli, core | Touches useQuotaAndFallback.ts (removed). | do not persist the fallback model (#15483) |
| 9 | `65e2144b3df3` | 2025-12-26 | release | Version bump. | Manual nightly version bump (#15594) |
| 10 | `a3d214f8d7cc` | 2025-12-26 | release | Version bump. | chore/release: bump version (#15612) |
| 11 | `fb22f5b8ee01` | 2025-12-29 | ui | WittyPhrases update — reverted next commit. Net zero. | Update wittyPhrases.ts (#15697) |
| 12 | `07e597de4030` | 2025-12-29 | core | **Redundant.** LLxprt has RetryOrchestrator. | Exponential back-off retries (#15684) |
| 13 | `4e6fee7fcd18` | 2025-12-30 | ui | Revert of wittyPhrases. Net zero with #11. | Revert "Update wittyPhrases.ts" (#15719) |
| 14 | `1e08b150f74e` | 2025-12-30 | auth | Non-interactive auth refactor. LLxprt multi-provider auth diverged. | refactor(auth): Refactor non-interactive mode auth validation (#15679) |
| 15 | `0eb84f5133a8` | 2025-12-30 | tests | Touches integration tests — file structure diverged. | chore: remove cot style comments (#15735) |
| 16 | `c29a8c12b3d9` | 2026-01-01 | build | Year-specific linter fix. Build infra specific to upstream. | Fix build issues caused by year-specific linter rule (#15780) |
| 17 | `788bb04f5c5e` | 2026-01-02 | core | Touches useQuotaAndFallback.ts (removed). | log fallback mode (#15817) |
| 18 | `c0ccb22460516` | 2026-01-02 | core | Old smart edit settings. ClearcutLogger. Already removed. | chore: cleanup old smart edit settings (#15832) |
| 19 | `30f5c4af4a28` | 2026-01-02 | core, tests | **Reclassified from PICK.** Shell area diverged. | fix(core): mock powershell output in shell-utils test (#15831) |
| 20 | `f3625aab1396` | 2026-01-04 | core | SmartEditTool consolidation. Already removed. | refactor: consolidate EditTool and SmartEditTool (#15857) |
| 21 | `dc6dda5c3796` | 2026-01-06 | core | **Reclassified from PICK.** loggingContentGenerator diverged. | fix: avoid SDK warning in logging (#15706) |
| 22 | `3c92666ec298` | 2026-01-05 | core | Default settings apply. Uses `availability.ts` (doesn't exist). | Make default settings apply (#15354) |
| 23 | `b13c6b57ae99` | 2026-01-05 | core | Smart-edit rename. ClearcutLogger. Already removed. | chore: rename smart-edit to edit (#15923) |
| 24 | `e5d183031acf` | 2026-01-05 | cli | Opt-in persist model from /model. Touches useQuotaAndFallback. | Opt-in to persist model from /model (#15820) |
| 25 | `ed8bad8c26ef` | 2026-01-05 | build | Package.json preflight order. Build infra only. | Fix order of preflight (#15941) |
| 26 | `fd7b6bf40a9c` | 2026-01-05 | tests | Google oauth2 test fix. Not applicable. | Fix failing unit tests (#15940) |
| 27 | `384fb6a465bb` | 2026-01-05 | cli | OSC 52 paste setting. Terminal infra diverged. | Add setting to support OSC 52 paste (#15336) |
| 28 | `cbd2eee9c467` | 2026-01-05 | ui | Footer manual model string. Touches removed components. | remove manual string when displaying manual model (#15967) |
| 29 | `7d4f97de7a16` | 2026-01-06 | core | Interactive check for system prompt. Uses systemInstructions API we don't have. | fix(core): use correct interactive check for system prompt (#15020) |
| 30 | `9a3ff6510ffe` | 2026-01-06 | policy | Allow 'modes' in policy. Policy TOML structure diverged. | feat(policy): allow 'modes' in user and admin policies (#15977) |
| 31 | `c31f05356ae3` | 2026-01-06 | core | Image token estimation. Issue #1648 covers. | fix: image token estimation (#16004) |
| 32 | `cce4574143a2` | 2026-01-07 | core | Google OnboardUser polling. | Use GetOperation to poll for OnboardUser completion (#15827) |
| 33 | `86b5995f1266` | 2026-01-06 | ci | GitHub workflow — label child issues. | Add workflow to label child issues (#16002) |
| 34 | `4b5c044272d2` | 2026-01-06 | ci | Workflow fix. | Fix label-backlog-child-issues workflow logic |
| 35 | `d4b4aede2fc8` | 2026-01-06 | ci | Workflow. | Add debugging logs for issue parent checks |
| 36 | `2122604b3268` | 2026-01-06 | ci | Workflow. | Refactor parent issue check to use URLs |
| 37 | `7feb2f8f42be` | 2026-01-06 | ci | Workflow. | Add 'reopened' type to issue labeling workflow |
| 38 | `1e31427da8b7` | 2026-01-06 | ci | Workflow. | Remove trailing whitespace in yaml (#16036) |
| 39 | `7eeb7bd74c89` | 2026-01-06 | ci | Issue triage query limit. | fix: limit scheduled issue triage queries (#16021) |
| 40 | `8f5bf33eacc0` | 2026-01-06 | ci | Issue triage automation. | ci(github-actions): triage all new issues automatically (#16018) |
| 41 | `4086abf37505` | 2026-01-06 | tests | Google oauth2 test. | Fix test (#16011) |
| 42 | `cb15a238fe42` | 2026-01-07 | release | Version bump. | chore(release): v0.24.0-preview.0 |
| 43 | `0f0d1d8fc0c6` | 2026-01-12 | release | Ink patch + version bump. | fix(patch): cherry-pick b54e688 (#16466) |
| 44 | `314f67a326c4` | 2026-01-13 | release | Version bump. | chore(release): v0.24.0-preview.1 |
| 45 | `334b813d8102` | 2026-01-13 | release | Patch + version bump. | fix(patch): cherry-pick 356f76e (#16552) |
| 46 | `df72e3af3d02` | 2026-01-13 | release | Version bump. | chore(release): v0.24.0-preview.2 |
| 47 | `48ee9bb308e2` | 2026-01-14 | release | Version bump. | chore(release): v0.24.0-preview.3 |
| 48 | `bd84dbcf2d21` | 2026-01-19 | release | Version bump. | chore(release): v0.24.4 |

---

## REIMPLEMENT Table (38 commits, chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `b0d5c4c0587b` | 2025-12-22 | policy | **Reclassified from PICK** — 7 conflict files. Policy engine diverged. | feat(policy): implement dynamic mode-aware policy evaluation (#15307) |
| 2 | `dced409ac42d` | 2025-12-22 | hooks | LLxprt reimplemented hooks. Port folder trust gating. | Add Folder Trust Support To Hooks (#15325) |
| 3 | `9c48cd849bb7` | 2025-12-22 | hooks, ui | Security warning + layout for hooks list. Hooks UI diverged. | feat(ui): Add security warning and improve layout for Hooks list (#15440) |
| 4 | `3b1dbcd42d8f` | 2025-12-22 | core, security | Unified secrets sanitization. Desirable security feature. | Implemented unified secrets sanitization and env. redaction options (#15348) |
| 5 | `6be034392f3f` | 2025-12-23 | cli, core | Automatic /model persistence. Touches model routing diverged areas. | feat: automatic `/model` persistence across Gemini CLI sessions (#13199) |
| 6 | `b6b0727e28b7` | 2025-12-23 | cli | **Reclassified from PICK** — 7 conflicts in settings.ts + gemini.tsx. | Make schema validation errors non-fatal (#15487) |
| 7 | `e6344a8c2478` | 2025-12-23 | hooks, security | Project-level hook warnings. | Security: Project-level hook warnings (#15470) |
| 8 | `563d81e08e73` | 2025-12-23 | cli, extensions | Extension install/uninstall. LLxprt reimplemented extensions. | Add experimental in-CLI extension install and uninstall subcommands (#15178) |
| 9 | `546baf9934a7` | 2025-12-26 | cli | modifyOtherKeys for tmux. Terminal capability manager diverged. | Added modifyOtherKeys protocol support for tmux (#15524) |
| 10 | `a26d195404f7` | 2025-12-27 | cli | enableShellOutputEfficiency setting schema. Settings structure diverged. | fix(cli): add enableShellOutputEfficiency to settings schema (#15560) |
| 11 | `24c722454bd2` | 2025-12-22 | cli | Error messages for --resume. Session handling diverged. | chore: improve error messages for --resume (#15360) |
| 12 | `37be16243557` | 2025-12-26 | policy | Granular shell command allowlisting. | fix(core): enable granular shell command allowlisting in policy engine (#15601) |
| 13 | `5566292cc83f` | 2025-12-26 | core | **Tool Scheduler: Extract types/utilities.** Do our own extraction. | refactor(core): extract static concerns from CoreToolScheduler (#15589) |
| 14 | `dcd2449b1a16` | 2025-12-29 | policy, settings | Deprecate legacy confirmation settings. | refactor: deprecate legacy confirmation settings and enforce Policy Engine (#15626) |
| 15 | `10ae84869a39` | 2025-12-29 | core, cli | Console → coreEvents migration. 66 files. Most labor-intensive. | Migrate console to coreEvents.emitFeedback or debugLogger (#15219) |
| 16 | `15c9f88da6df` | 2025-12-30 | hooks | Deduplicate agent hooks. Massive edit to client.ts. | fix(hooks): deduplicate agent hooks (#15701) |
| 17 | `90eb1e0281bf` | 2025-12-30 | hooks | Tool input modification. Touches coreToolScheduler. | Implement support for tool input modification (#15492) |
| 18 | `ec79fe1ab269` | 2025-12-30 | extensions, ui | Extension update notification. LLxprt extensions reimplemented. | Add instructions to the extensions update info notification (#14907) |
| 19 | `ec11b8afbf38` | 2025-12-30 | extensions, ui | Extension settings info. | Add extension settings info to /extensions list (#14905) |
| 20 | `873d10df429c` | 2025-12-23 | ui | **Reclassified from PICK.** Terse image paths. Conflicts. | feat: terse transformations of image paths in text buffer (#4924) |
| 21 | `05049b5abfae` | 2025-12-31 | hooks | STOP_EXECUTION hook decision handling. | feat(hooks): implement STOP_EXECUTION and enhance hook decision handling (#15685) |
| 22 | `18fef0db31a2` | 2026-01-02 | policy, shell | **Reclassified from PICK** — 12 conflicts. | fix(core): improve shell command with redirection detection (#15683) |
| 23 | `006de1dd318d` | 2026-01-02 | docs | Security docs. Gemini branding throughout — needs rewrite. | Add security docs (#15739) |
| 24 | `0f3555a4d241` | 2026-01-02 | cli, ui | **Reclassified from PICK** — modify/delete conflicts. | feat: add folder suggestions to `/dir add` command (#15724) |
| 25 | `d3c206c6770d` | 2026-01-04 | policy, shell | Unify shell security policy. | Unify shell security policy and remove legacy logic (#15770) |
| 26 | `eec5d5ebf839` | 2026-01-04 | core | **MessageBus Phase 1:** Restore optionality. | feat(core): restore MessageBus optionality (Phase 1) (#15774) |
| 27 | `90be9c35876d` | 2026-01-04 | core, agents | **MessageBus Phase 2:** Standardize constructors. | feat(core): Standardize Tool and Agent Invocation constructors (Phase 2) (#15775) |
| 28 | `12c7c9cc426b` | 2026-01-04 | core, cli | **MessageBus Phase 3:** Mandatory injection (~57 files). | feat(core,cli): enforce mandatory MessageBus injection (Phase 3) (#15776) |
| 29 | `dd84c2fb837a` | 2026-01-04 | hooks | Granular stop/block for agent hooks. | feat(hooks): implement granular stop and block behavior (#15824) |
| 30 | `b4b49e7029d3` | 2026-01-05 | core | **Tool Scheduler: Extract ToolExecutor.** Do our own. | refactor(core): Extract and integrate ToolExecutor (#15900) |
| 31 | `8f0324d86890` | 2026-01-05 | cli, ui | **Reclassified from PICK** — 13 conflicts incl. modify/delete. | fix(cli): resolve paste issue on Windows terminals (#15932) |
| 32 | `6d1e27633a32` | 2026-01-05 | hooks | Context injection via SessionStart hook. | Support context injection via SessionStart hook (#15746) |
| 33 | `d2849fda8ad4` | 2026-01-06 | cli, ui | **Reclassified from PICK** — depends on paste infra. | properly disable keyboard modes on exit (#16006) |
| 34 | `61dbab03e0d5` | 2026-01-06 | hooks, ui | Visual indicators for hook execution. | feat(ui): add visual indicators for hook execution (#15408) |
| 35 | `56092bd78205` | 2026-01-06 | hooks, settings | `hooks.enabled` setting. | feat(hooks): Add a hooks.enabled setting (#15933) |
| 36 | `4c67eef0f299` | 2026-01-06 | extensions | Missing settings on extension update. | Inform user of missing settings on extensions update (#15944) |
| 37 | `7edd8030344e` | 2026-01-06 | extensions | Settings command fallback. | Fix settings command fallback (#15926) |
| 38 | `6f4b2ad0b95a` | 2026-01-05 | config, security | Default folder trust to untrusted. Security improvement. | fix: default folder trust to untrusted for enhanced security (#15943) |

### REIMPLEMENT Groups (for batched execution)

**Group A — Tool Scheduler** (#13, #30): Extract types, ToolExecutor. ~800-1200 LoC moved.
**Group B — MessageBus DI** (#26-28): 3-phase migration, ~57 files.
**Group C — Hooks** (#2, #3, #7, #16, #17, #21, #29, #32, #34, #35): Folder trust, security warnings, dedup, tool input mod, stop/block, context injection, visual indicators, settings.
**Group D — Policy** (#1, #12, #14, #22, #25): Dynamic policy, shell allowlisting, legacy deprecation, redirection, unify.
**Group E — Extensions** (#8, #18, #19, #36, #37): Install/uninstall, notifications, settings.
**Group F — Console Migration** (#15): 66 files. Largest single commit.
**Group G — Security** (#4, #23, #38): Env sanitization, security docs, folder trust defaults.
**Group H — Terminal/Paste** (#9, #31, #33): modifyOtherKeys, paste fix, keyboard modes.
**Group I — Standalone** (#5, #6, #10, #11, #20, #24): Model persistence, schema validation, shell efficiency setting, resume errors, terse image paths, /dir add.

---

## NO_OP Table (10 commits)

These are release infrastructure commits that have no upstream content changes relevant to cherry-picking (version patches between releases, already covered by our target version):

| # | Upstream SHA | Date | Subject |
|---|-------------|------|---------|
| 1 | `b56a1115949d` | 2026-01-14 | chore(release): v0.24.0 |
| 2 | `def09778db93` | 2026-01-15 | fix(patch): cherry-pick 88f1ec8 [CONFLICTS] (#16783) |
| 3 | `4b2701195a5e` | 2026-01-13 | fix(patch): cherry-pick eda47f5 [CONFLICTS] (#16577) |
| 4 | `881b026f2454` | 2026-01-15 | fix(core): resolve circular dependency via tsconfig paths (#16730) |
| 5-10 | (various) | | (duplicate release patches included in preview→release chain) |

> **Note on `881b026f` (tsconfig paths)**: In gmerge/0.24.5 this was REIMPLEMENT. However, LLxprt already uses `@vybestack/llxprt-code-core` paths in tsconfig. The actual fix is already present — verify during execution.

> **Note on `def09778` (terminal patch)**: This removes some terminal capability code from KeypressContext and terminalCapabilityManager. The relevant behavior changes are covered by the terminal/paste REIMPLEMENT group (Group H).

---

## Execution Strategy

### Phase A: PICK (22 commits)
Cherry-pick in batches. Skills as one chain (11 commits), bug fixes grouped by area. Previous gmerge/0.24.5 proved all of these apply cleanly or with trivial conflicts.

### Phase B: REIMPLEMENT by group
1. **Group A (Tool Scheduler)** — Extract types, ToolExecutor
2. **Group B (MessageBus DI)** — 3-phase migration
3. **Group C (Hooks)** — Batch all 10 hooks commits
4. **Group D (Policy)** — Batch 5 policy commits
5. **Group E (Extensions)** — Batch 5 extension commits
6. **Group F (Console Migration)** — 66 files
7. **Group G (Security)** — Env sanitization + docs + trust
8. **Group H (Terminal/Paste)** — modifyOtherKeys + paste + keyboard
9. **Group I (Standalone)** — 6 individual items

### Phase C: Verification
Full test suite, lint, typecheck, build, smoke test.

### Phase D: PR + CI + CodeRabbit
