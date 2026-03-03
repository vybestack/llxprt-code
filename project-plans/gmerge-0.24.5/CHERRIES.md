# Cherry-Pick Decisions: v0.23.0 → v0.24.5

**Total commits in range:** 121  
**Decision counts:** PICK 34 (28%) · SKIP 42 (35%) · REIMPLEMENT 34 (28%) · NO_OP 11 (9%)

---

## Audit Methodology

Code-level audit performed by:
1. Reading `git show <sha>` for every commit (full diffs, not just names)
2. Comparing each touched file against LLxprt's current source
3. **4 parallel subagent deep-dives** covering: Agent Skills system feasibility, deferred commit analysis, MessageBus/Remote Agents/Tool Scheduler analysis, and user-flagged commit investigation
4. File existence checks for all upstream-only infrastructure

All subagent audit results preserved in `project-plans/gmerge-0.24.5/AUDIT-DETAILS.md`.

---

## Decision Notes

### 1. Agent Skills System (11 commits → PICK with branding)
Upstream added a complete Agent Skills system. **Deep analysis confirms this can be cherry-picked** — skills are remarkably self-contained with zero dependencies on removed infrastructure (ClearcutLogger, SmartEdit, FlashFallback). All required LLxprt infrastructure exists (ToolRegistry, MessageBus via config, PolicyEngine, Storage, Settings, Extensions). Commits form a linear dependency chain and must be picked in order.

One verification needed: `config.getAgentRegistry().getDirectoryContext()` in prompts.ts — confirm LLxprt's AgentRegistry has this or create a shim.

### 2. MessageBus Phase 1-3 (3 commits → REIMPLEMENT)
LLxprt currently uses a service locator pattern (`config.getMessageBus()`) which hides the dependency. Upstream's 3-phase migration makes MessageBus an explicit constructor parameter — proper dependency injection. This is better practice: more testable, more honest about coupling, standard DI. LLxprt should adopt the DI pattern, adapted to our codebase. Touches 50+ files but the pattern is mechanical. Needs a design spec and requirements.

### 3. Remote Agents / A2A (4 commits → REIMPLEMENT)
Incompatible agent architecture. LLxprt has SubagentOrchestrator, not upstream's agent framework. The A2A protocol support is valuable. Needs a phased PLAN: Phase 1 types+client (~500 LoC), Phase 2 registry (~300 LoC), Phase 3 execution (~700 LoC). Total ~1500-2000 LoC new.

### 4. Tool Scheduler Refactor (2 commits → REIMPLEMENT our own way)
Refactoring concepts are valuable (extract types, utilities, ToolExecutor) but LLxprt's scheduler is 2139 lines and heavily diverged with parallel batching. Do our own extraction: types → `scheduler/types.ts`, utilities → `fileUtils.ts`/`generateContentResponseUtilities.ts`, ToolExecutor → `scheduler/tool-executor.ts`. Expected to reduce file from 2139 to ~1500 lines. Needs a PLAN.

### 5. Hooks System (reimplemented in LLxprt)
All hooks-related upstream commits need REIMPLEMENT since LLxprt reimplemented the hook system. Port the behavior/concepts, not the code.

### 6. Extensions (reimplemented in LLxprt)
All extension-related upstream commits need REIMPLEMENT since LLxprt reimplemented extensions.

### 7. Exponential Backoff (`07e597de`) → SKIP
LLxprt has its own RetryOrchestrator (`packages/core/src/providers/RetryOrchestrator.ts`) with exponential backoff, jitter, and bucket failover — far more sophisticated than upstream's change. Upstream only removes a hardcoded 5s default from `googleQuotaErrors.ts`. Redundant.

### 8. Image Token Estimation (`c31f0535`) → SKIP
Issue #1648 already covers this with a superior provider-aware approach. Upstream's flat 3000 estimate is Gemini-specific. Also imports `availability/policyHelpers.js` which doesn't exist in LLxprt.

### 9. Release / CI / Version Bumps → SKIP (as before)

---

## PICK Table (44 commits, chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `0a216b28f36c` | 2025-12-22 | cli | Bug fix — prevent EIO crash in readStdin. Clean apply. | fix #15369, prevent crash on unhandled EIO error in readStdin cleanup (#15410) |
| 2 | `b0d5c4c0587b` | 2025-12-22 | policy | Dynamic mode-aware policy evaluation. Policy engine exists. | feat(policy): implement dynamic mode-aware policy evaluation (#15307) |
| 3 | `e9a601c1fe87` | 2025-12-23 | mcp, cli | Bug fix — missing `type` field in MCPServerConfig. | fix: add missing `type` field to MCPServerConfig (#15465) |
| 4 | `b6b0727e28b7` | 2025-12-23 | cli | Make schema validation errors non-fatal. | Make schema validation errors non-fatal (#15487) |
| 5 | `5f2861476093` | 2025-12-23 | mcp, ui | Limit MCP resources display to 10. | chore: limit MCP resources display to 10 by default (#15489) |
| 6 | `873d10df429c` | 2025-12-23 | ui | Terse image path transformations in text buffer. | feat: terse transformations of image paths in text buffer (#4924) |
| 7 | `56b050422d7a` | 2025-12-26 | core | Trivial comment typo fix in tools.ts. | chore(core): fix comment typo (#15558) |
| 8 | `acecd80afa24` | 2025-12-26 | ide | Bug fix — unhandled promise rejection in ide-client. | Resolve unhandled promise rejection in ide-client.ts (#15587) |
| 9 | `21388a0a40b0` | 2025-12-27 | core | Bug fix — handle checkIsRepo failure in GitService. | fix(core): handle checkIsRepo failure in GitService.initialize (#15574) |
| 10 | `de1233b8ca5f` | 2025-12-30 | skills | **Agent Skills: Core Infrastructure.** New SkillManager, CLI command, UI list. Branding changes needed (.gemini→.llxprt, @google→@vybestack). | Agent Skills: Implement Core Skill Infrastructure (#15698) |
| 11 | `958284dc2491` | 2026-01-02 | skills | **Agent Skills: Activation Tool.** New `activate_skill` tool + policy. | Agent Skills: Implement Autonomous Activation Tool (#15725) |
| 12 | `764b195977f4` | 2026-01-02 | skills | **Agent Skills: System Prompt.** Adds skills section to prompts. | Agent Skills: Implement Agent Integration and System Prompt Awareness (#15728) |
| 13 | `e78c3fe4f0be` | 2026-01-02 | skills, ui | **Agent Skills: Status Bar.** Skill count in UI. | Agent Skills: Status Bar Integration for Skill Counts (#15741) |
| 14 | `f0a039f7c07d` | 2026-01-03 | skills | **Agent Skills: Refactor.** Move to `skills/` dir, extract loader. | Agent Skills: Unify Representation & Centralize Loading (#15833) |
| 15 | `bdb349e7f6c0` | 2026-01-04 | skills, ext | **Agent Skills: Extension Support.** Skills from extensions. | Agent Skills: Extension Support & Security Disclosure (#15834) |
| 16 | `d3563e2f0eb1` | 2026-01-04 | skills, cli | **Agent Skills: CLI Commands.** `skills list/enable/disable`. | Agent Skills: Add gemini skills CLI management command (#15837) |
| 17 | `2cb33b2f764b` | 2026-01-05 | skills | **Agent Skills: Reload.** `/skills reload` command. Verify tool reload works with LLxprt's CoreToolScheduler. | Agent Skills: Implement /skills reload (#15865) |
| 18 | `0c5413624415` | 2026-01-06 | skills | **Agent Skills: WorkspaceContext.** Skill dir in context. | Agent Skills: Add skill directory to WorkspaceContext (#15870) |
| 19 | `5f027cb63a45` | 2026-01-07 | skills, settings | **Agent Skills: UI fix.** Hide broken skills from settings. | fix: hide broken skills object from settings dialog (#15766) |
| 20 | `0eb84f5133a8` | 2025-12-30 | integration-tests | Remove CoT style comments from integration test. | chore: remove cot style comments (#15735) |
| 21 | `8a0190ca3bc4` | 2026-01-03 | mcp | Bug fix — unhandled promise rejection in mcp-client-manager. | fix(core): handle unhandled promise rejection in mcp-client-manager (#14701) |
| 22 | `18fef0db31a2` | 2026-01-02 | policy, shell | Improve shell command redirection detection. | fix(core): improve shell command with redirection detection (#15683) |
| 23 | `0f3555a4d241` | 2026-01-02 | cli, ui | Folder suggestions for `/dir add`. | feat: add folder suggestions to `/dir add` command (#15724) |
| 24 | `30f5c4af4a28` | 2026-01-02 | core, tests | Fix powershell mock in shell-utils test. | fix(core): mock powershell output in shell-utils test (#15831) |
| 25 | `615b218ff702` | 2026-01-04 | cli, tests | Mock fs.readdir in consent tests for Windows compat. | fix(cli): mock fs.readdir in consent tests for Windows compatibility (#15904) |
| 26 | `3997c7ff803c` | 2026-01-05 | core | Fix terminal hang when user exits browser without logging in. | Fix terminal hang when user exits browser without logging in (#15748) |
| 27 | `dc6dda5c3796` | 2026-01-06 | core | Avoid SDK warning in logging. loggingContentGenerator.ts exists. | fix: avoid SDK warning by not accessing .text getter in logging (#15706) |
| 28 | `2da911e4a02e` | 2026-01-06 | cli | Prevent /copy crash on Windows. | fix: prevent /copy crash on Windows by skipping /dev/tty (#15657) |
| 29 | `8f0324d86890` | 2026-01-05 | cli, ui | Resolve paste issue on Windows terminals. | fix(cli): resolve paste issue on Windows terminals (#15932) |
| 30 | `a61fb058b7ca` | 2026-01-06 | core | Fix writeTodo construction — remove erroneous `this` arg. | fix: writeTodo construction (#16014) |
| 31 | `d2849fda8ad4` | 2026-01-06 | cli, ui | Properly disable keyboard modes on exit. | properly disable keyboard modes on exit (#16006) |
| 32 | `687ca40b5093` | 2026-01-19 | cli, ui | **Race condition fix** — `void` → `await` on scheduleToolCalls. LLxprt has the exact same bug. HIGH confidence PICK. | Fix race condition by awaiting scheduleToolCalls (#16759) |
| 33 | `588c1a6d1657` | 2026-01-19 | cli, ui | **Rationale rendering order** — flush pending text before tool calls. LLxprt has same bug. Depends on #32. | fix(ui): ensure rationale renders before tool calls (#17043) |
| 34 | `59a18e710daa` | 2026-01-06 | docs | **Agent Skills: Documentation.** Needs LLxprt rebranding. | Agent Skills: Initial Documentation & Tutorial (#15869) |

**PICK Notes:**
- Skills (#10-19, #34): Must be picked in order. Branding changes: `.gemini` → `.llxprt`, `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`. Verify `getAgentRegistry().getDirectoryContext()` exists.
- Race condition (#32-33): Pick 687ca40b first, then 588c1a6d (depends on it).
- WriteTodo (#30): Verify LLxprt's WriteTodosTool registration actually has the extra arg bug.

---

## SKIP Table (42 commits, chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `d6a2f1d670f7` | 2025-12-22 | core | Touches availability/policyHelpers, fallback/handler, overrideStrategy — none exist. | chore(core): refactor model resolution and cleanup fallback logic (#15228) |
| 2 | `d18c96d6a17e` | 2025-12-22 | core | Google-internal code assist metrics telemetry. | Record timestamp with code assist metrics (#15439) |
| 3 | `0843d9af58d4` | 2025-12-22 | core | startupProfiler.ts doesn't exist in LLxprt. | fix(core): use debugLogger.debug for startup profiler logs (#15443) |
| 4 | `2ac9fe08f7a0` | 2025-12-22 | misc | Repo cleanup — accidental clipboard file. | chore: remove clipboard file (#15447) |
| 5 | `308aa70718fd` | 2025-12-23 | hooks | Removes deprecated `permissionDecision`/`permissionDecisionReason` aliases. LLxprt's reimplemented hooks don't have these. | refactor(core): remove deprecated permission aliases (#14855) |
| 6 | `9cdb267ba586` | 2025-12-26 | ui | Snowfall holiday theme. Not in LLxprt. | feat: Show snowfall animation for holiday theme (#15494) |
| 7 | `69fc75c0b220` | 2025-12-26 | cli, core | Touches useQuotaAndFallback.ts (removed). | do not persist the fallback model (#15483) |
| 8 | `65e2144b3df3` | 2025-12-26 | release | Version bump. | Manual nightly version bump (#15594) |
| 9 | `a3d214f8d7cc` | 2025-12-26 | release | Version bump. | chore/release: bump version (#15612) |
| 10 | `fb22f5b8ee01` | 2025-12-29 | ui | WittyPhrases update — reverted next commit. Net zero. | Update wittyPhrases.ts (#15697) |
| 11 | `07e597de4030` | 2025-12-29 | core | **Redundant.** LLxprt has RetryOrchestrator with exponential backoff+jitter+bucket failover. Upstream only removes hardcoded 5s default from googleQuotaErrors.ts. | Exponential back-off retries for retryable error (#15684) |
| 12 | `4e6fee7fcd18` | 2025-12-30 | ui | Revert of wittyPhrases. Net zero with #10. | Revert "Update wittyPhrases.ts" (#15719) |
| 13 | `1e08b150f74e` | 2025-12-30 | auth | Non-interactive auth refactor. LLxprt multi-provider auth diverged. | refactor(auth): Refactor non-interactive mode auth validation (#15679) |
| 14 | `c29a8c12b3d9` | 2026-01-01 | build | Year-specific linter fix. Build infra specific to upstream. | Fix build issues caused by year-specific linter rule (#15780) |
| 15 | `788bb04f5c5e` | 2026-01-02 | core | Touches useQuotaAndFallback.ts (removed) and flashFallback.test.ts. | log fallback mode (#15817) |
| 16 | `c0ccb22460516` | 2026-01-02 | core | Cleanup old smart edit settings. Touches clearcut-logger. LLxprt already removed both. | chore: cleanup old smart edit settings (#15832) |
| 17 | `eec5d5ebf839` | 2026-01-04 | core | **MessageBus Phase 1.** Reclassified — see REIMPLEMENT table. | feat(core): restore MessageBus optionality (Phase 1) (#15774) |
| 18 | `90be9c35876d` | 2026-01-04 | core, agents | **MessageBus Phase 2.** Reclassified — see REIMPLEMENT table. | feat(core): Standardize Tool and Agent Invocation constructors (Phase 2) (#15775) |
| 19 | `12c7c9cc426b` | 2026-01-04 | core, cli | **MessageBus Phase 3.** Reclassified — see REIMPLEMENT table. | feat(core,cli): enforce mandatory MessageBus injection (Phase 3) (#15776) |
| 20 | `f3625aab1396` | 2026-01-04 | core | Consolidates EditTool and SmartEditTool. LLxprt already removed SmartEdit. | refactor: consolidate EditTool and SmartEditTool (#15857) |
| 21 | `b13c6b57ae99` | 2026-01-05 | core | Rename smart-edit to edit. Touches clearcut-logger. SmartEdit removed. | chore: rename smart-edit to edit (#15923) |
| 22 | `cce4574143a2` | 2026-01-07 | core | Google-specific OnboardUser polling. | Use GetOperation to poll for OnboardUser completion (#15827) |
| 23 | `86b5995f1266` | 2026-01-06 | ci | GitHub workflow — label child issues. Gemini-specific. | Add workflow to label child issues for rollup (#16002) |
| 24 | `4b5c044272d2` | 2026-01-06 | ci | Gemini-specific workflow fix. | Fix label-backlog-child-issues workflow logic |
| 25 | `d4b4aede2fc8` | 2026-01-06 | ci | Gemini-specific workflow. | Add debugging logs for issue parent checks |
| 26 | `2122604b3268` | 2026-01-06 | ci | Gemini-specific workflow. | Refactor parent issue check to use URLs |
| 27 | `7feb2f8f42be` | 2026-01-06 | ci | Gemini-specific workflow. | Add 'reopened' type to issue labeling workflow |
| 28 | `1e31427da8b7` | 2026-01-06 | ci | Gemini-specific workflow. | Remove trailing whitespace in yaml (#16036) |
| 29 | `7eeb7bd74c89` | 2026-01-06 | ci | Gemini-specific issue triage. | fix: limit scheduled issue triage queries (#16021) |
| 30 | `8f5bf33eacc0` | 2026-01-06 | ci | Gemini-specific issue triage. | ci(github-actions): triage all new issues automatically (#16018) |
| 31 | `4086abf37505` | 2026-01-06 | tests | Fixes oauth2.test.ts — Google code_assist auth, not applicable. | Fix test. (#16011) |
| 32 | `fd7b6bf40a9c` | 2026-01-05 | tests | Fixes oauth2.test.ts — same as above. | Fix failing unit tests (#15940) |
| 33 | `ed8bad8c26ef` | 2026-01-05 | build | Package.json preflight order. Build infra only. | Fix order of preflight (#15941) |
| 34 | `c31f05356ae3` | 2026-01-06 | core | **Image token estimation.** Issue #1648 covers this with provider-aware approach. Upstream uses flat 3000 (Gemini-specific). Also imports availability/policyHelpers (missing). | fix: image token estimation (#16004) |
| 35 | `3441b88375b6` | 2026-01-19 | core | LLxprt's client.ts doesn't emit ModelInfo events — completely different model routing. | fix(core): deduplicate ModelInfo emission in GeminiClient (#17075) |
| 36 | `cb15a238fe42` | 2026-01-07 | release | Version bump. | chore(release): v0.24.0-preview.0 |
| 37 | `0f0d1d8fc0c6` | 2026-01-12 | release | Ink version patch + version bump. | fix(patch): cherry-pick b54e688 (#16466) |
| 38 | `314f67a326c4` | 2026-01-13 | release | Version bump. | chore(release): v0.24.0-preview.1 |
| 39 | `df72e3af3d02` | 2026-01-13 | release | Version bump. | chore(release): v0.24.0-preview.2 |
| 40 | `48ee9bb308e2` | 2026-01-14 | release | Version bump. | chore(release): v0.24.0-preview.3 |
| 41 | `b56a1115949d` | 2026-01-14 | release | Version bump. | chore(release): v0.24.0 |
| 42 | `bd84dbcf2d21` | 2026-01-19 | release | Version bump. | chore(release): v0.24.4 |
|    | `d6bb149a7e81` | 2026-01-20 | release | Version bump. | chore(release): v0.24.5 |

---

## REIMPLEMENT Table (34 commits, chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `dced409ac42d` | 2025-12-22 | hooks | LLxprt reimplemented hooks. Port folder trust gating behavior into LLxprt hook architecture. | Add Folder Trust Support To Hooks (#15325) |
| 2 | `9c48cd849bb7` | 2025-12-22 | hooks, ui | Security warning + layout for hooks list. Hooks UI diverged. | feat(ui): Add security warning and improve layout for Hooks list (#15440) |
| 3 | `3b1dbcd42d8f` | 2025-12-22 | core, security | Unified secrets sanitization — new service + touches shell.ts, hookRunner, mcp-client, config. Desirable security feature. | Implemented unified secrets sanitization and env. redaction options (#15348) |
| 4 | `e6344a8c2478` | 2025-12-23 | hooks, security | Project-level hook warnings. Security feature, hooks diverged. | Security: Project-level hook warnings (#15470) |
| 5 | `563d81e08e73` | 2025-12-23 | cli, extensions | Extension install/uninstall subcommands. LLxprt reimplemented extensions. Port behavior. | Add experimental in-CLI extension install and uninstall subcommands (#15178) |
| 6 | `37be16243557` | 2025-12-26 | policy | Granular shell command allowlisting. Policy files diverged. | fix(core): enable granular shell command allowlisting in policy engine (#15601) |
| 7 | `dcd2449b1a16` | 2025-12-29 | policy, settings | Deprecate legacy confirmation settings. Config/scheduler diverged. | refactor: deprecate legacy confirmation settings and enforce Policy Engine (#15626) |
| 8 | `10ae84869a39` | 2025-12-29 | core, cli | Console → coreEvents migration. 66 files. Cherry-pick impossible but migration pattern valuable. | Migrate console to coreEvents.emitFeedback or debugLogger (#15219) |
| 9 | `15c9f88da6df` | 2025-12-30 | hooks | Deduplicate agent hooks. Massive edit to client.ts (+378 lines). LLxprt's client.ts heavily diverged. Port dedup intent. | fix(hooks): deduplicate agent hooks and add cross-platform integration tests (#15701) |
| 10 | `ec79fe1ab269` | 2025-12-30 | extensions, ui | Extension update notification text. LLxprt extensions reimplemented. | Add instructions to the extensions update info notification (#14907) |
| 11 | `ec11b8afbf38` | 2025-12-30 | extensions, ui | Extension settings info in /extensions list. LLxprt extensions reimplemented. | Add extension settings info to /extensions list (#14905) |
| 12 | `90eb1e0281bf` | 2025-12-30 | hooks | Tool input modification. Touches coreToolScheduler (diverged) and hookRunner. | Implement support for tool input modification (#15492) |
| 13 | `05049b5abfae` | 2025-12-31 | hooks | STOP_EXECUTION hook decision handling. Touches multiple diverged files. | feat(hooks): implement STOP_EXECUTION and enhance hook decision handling (#15685) |
| 14 | `d3c206c6770d` | 2026-01-04 | policy, shell | Unify shell security policy. Touches policy-engine, toml-loader, shell, config. Diverged. | Unify shell security policy and remove legacy logic (#15770) |
| 15 | `5566292cc83f` | 2025-12-26 | core | **Tool Scheduler: Extract types/utilities.** Concepts valuable for our 2139-line file. Do our own extraction. | refactor(core): extract static concerns from CoreToolScheduler (#15589) |
| 16 | `b4b49e7029d3` | 2026-01-05 | core | **Tool Scheduler: Extract ToolExecutor.** Same — do our own. | refactor(core): Extract and integrate ToolExecutor (#15900) |
| 17 | `848e8485cd0f` | 2025-12-29 | agents | **Remote Agents: Multi-agent TOML.** Incompatible agent architecture. Port via PLAN. | feat(agents): add support for remote agents and multi-agent TOML files (#15437) |
| 18 | `3ebe4e6a8ffc` | 2025-12-30 | agents | **Remote Agents: Registry.** Same. | feat(agents): Add remote agents to agent registry (#15711) |
| 19 | `02a36afc3892` | 2025-12-23 | agents, a2a | **Remote Agents: A2A Client Manager.** Same. | feat: Add A2A Client Manager and tests (#15485) |
| 20 | `96b9be3ec439` | 2026-01-06 | agents | **Remote Agents: Support.** Same. | feat(agents): add support for remote agents (#16013) |
| 21 | `4c67eef0f299` | 2026-01-06 | extensions | Missing settings on extension update. LLxprt extensions reimplemented. | Inform user of missing settings on extensions update (#15944) |
| 22 | `7edd8030344e` | 2026-01-06 | extensions | Settings command fallback. LLxprt extensions reimplemented. | Fix settings command fallback (#15926) |
| 23 | `6f4b2ad0b95a` | 2026-01-05 | config, security | Default folder trust to untrusted. Both cli and core config diverged. Security improvement. | fix: default folder trust to untrusted for enhanced security (#15943) |
| 24 | `881b026f2454` | 2026-01-15 | core | Circular dependency tsconfig paths. Trivial 1-line reimpl: add `@vybestack/llxprt-code-core` path. | fix(core): resolve circular dependency via tsconfig paths (#16730) |
| 25 | `006de1dd318d` | 2026-01-02 | docs | Security docs for hooks. Gemini branding/paths throughout — needs LLxprt rewrite. Content themes valuable. | Add security docs (#15739) |
| 26 | `eec5d5ebf839` | 2026-01-04 | core | **MessageBus Phase 1: Restore Optionality.** Adopt DI pattern instead of service locator (`config.getMessageBus()`). Make MessageBus optional constructor param on ToolRegistry, tools, MockTool. | feat(core): restore MessageBus optionality (Phase 1) (#15774) |
| 27 | `90be9c35876d` | 2026-01-04 | core, agents | **MessageBus Phase 2: Standardize Constructors.** Add MessageBus fallback to all tool `createInvocation()` methods, agent invocation constructors. | feat(core): Standardize Tool and Agent Invocation constructors (Phase 2) (#15775) |
| 28 | `12c7c9cc426b` | 2026-01-04 | core, cli | **MessageBus Phase 3: Mandatory Injection.** Make MessageBus required everywhere. Remove `setMessageBus()` shims. ~57 files. | feat(core,cli): enforce mandatory MessageBus injection (Phase 3) (#15776) |
| 29 | `dd84c2fb837a` | 2026-01-04 | hooks | Granular stop/block for agent hooks. New event types in streaming protocol. LLxprt hooks reimplemented. | feat(hooks): implement granular stop and block behavior for agent hooks (#15824) |
| 30 | `6d1e27633a32` | 2026-01-05 | hooks | Context injection via SessionStart hook. Needs sessionHookTriggers.ts adapted to LLxprt hook infra. | Support context injection via SessionStart hook. (#15746) |
| 31 | `61dbab03e0d5` | 2026-01-06 | hooks, ui | Visual indicators for hook execution. LLxprt hooks architecture exists. Adapt to our hook system. | feat(ui): add visual indicators for hook execution (#15408) |
| 32 | `56092bd78205` | 2026-01-06 | hooks, settings | Add `hooks.enabled` setting. Settings structure exists, reorganize from `tools.enableHooks`. | feat(hooks): Add a hooks.enabled setting. (#15933) |
| 33 | `9172e2831542` | 2026-01-06 | settings, ui | Add descriptions for each settings item. Adapt to LLxprt's SettingsDialog. | Add description for each settings item in /settings (#15936) |
| 34 | `2fe45834dde6` | 2026-01-06 | settings, security | Remote admin settings + secureModeEnabled/mcpEnabled. Enterprise feature, adapt to LLxprt config. | feat(admin): Introduce remote admin settings & implement secureModeEnabled/mcpEnabled (#15935) |

### REIMPLEMENT Notes — Needs Separate PLANs:
- **Remote Agents (#17-20)**: Need a multi-phase PLAN per `dev-docs/PLAN-TEMPLATE.md`. ~1500-2000 LoC.
- **Tool Scheduler (#15-16)**: Need a PLAN. ~800-1200 LoC moved (not new). Reduces main file from 2139→~1500 lines.
- **Console Migration (#8)**: 66-file migration. Needs its own PLAN. Most labor-intensive.
- **Hooks group (#1,2,4,9,12,13)**: Should be done as a cohesive batch since they all touch reimplemented hooks.
- **Policy group (#6,7,14)**: Should be batched together.

---

## NO_OP Table (11 commits, chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `24c722454bd2` | 2025-12-22 | cli | LLxprt uses /continue not /restore. Error messages already differ. | chore: improve error messages for --resume (#15360) |
| 2 | `6be034392f3f` | 2025-12-23 | cli, core | LLxprt has its own model persistence for multi-provider. | feat: automatic `/model` persistence across Gemini CLI sessions (#13199) |
| 3 | `a26d195404f7` | 2025-12-27 | cli | LLxprt already has enableShellOutputEfficiency in settings. | fix(cli): add enableShellOutputEfficiency to settings schema (#15560) |
| 4 | `546baf9934a7` | 2025-12-26 | cli, ui | **Already implemented.** LLxprt has modifyOtherKeys in terminalContract.ts and KeypressContext.tsx. | Added modifyOtherKeys protocol support for tmux (#15524) |
| 5 | `384fb6a465bb` | 2026-01-05 | cli | **Already implemented.** LLxprt has OSC 52 paste in clipboard.ts. | Add setting to support OSC 52 paste (#15336) |
| 6 | `3c92666ec298` | 2026-01-05 | cli | LLxprt has its own settings handling. | Make default settings apply (#15354) |
| 7 | `e5d183031acf` | 2026-01-05 | cli, ui | LLxprt already handles model persistence. | Opt-in to persist model from /model (#15820) |
| 8 | `cbd2eee9c467` | 2026-01-05 | ui | LLxprt footer already differs. | remove manual string when displaying manual model in the footer (#15967) |
| 9 | `9a3ff6510ffe` | 2026-01-06 | policy | **Already have this.** LLxprt's toml-loader has NO tier-based restriction on `modes`. | feat(policy): allow 'modes' in user and admin policies (#15977) |
| 10 | `7d4f97de7a16` | 2026-01-06 | core | LLxprt uses `interactionMode` parameter approach, not `config.isInteractiveShellEnabled()`. Bug doesn't apply. | fix(core): use correct interactive check for system prompt (#15020) |
| 11 | `def09778db93` | 2026-01-19 | cli | **Already removed.** LLxprt already removed bracketedPaste detection/bufferFastReturn logic. | fix(patch): terminal capability fix (#16783) |

### NO_OP Notes:
- `334b813d8102` (settings refactor) is also NO_OP for the bulk migration deletion (already done), BUT has a 1-line `yolo.toml` change (`allow_redirection = true`) that should be manually added.
- `4b2701195a5e` (scheduler finalization fix) is effectively SKIP — the specific race condition doesn't exist in LLxprt's different completion tracking pattern.

---

## Additional Items

### Resolved Deferred Items

Items previously marked "deferred" have been reclassified:

**Moved to REIMPLEMENT (included in this sync):**
- **Hooks Visual Indicators** (`61dbab03`) → REIMPLEMENT. LLxprt hooks architecture exists (hookRegistry, hookRunner, hookEventHandler, hookPlanner). Adapt upstream visual indicators to our hook system.
- **hooks.enabled setting** (`56092bd7`) → REIMPLEMENT. Settings structure exists, reorganize from `tools.enableHooks` to `hooks.enabled`.
- **Granular stop/block for agent hooks** (`dd84c2fb`) → REIMPLEMENT. Add new event types to existing hook streaming protocol.
- **Context injection via SessionStart hook** (`6d1e2763`) → REIMPLEMENT. Create sessionHookTriggers.ts adapted to LLxprt hook infrastructure.
- **Settings item descriptions** (`9172e283`) → REIMPLEMENT. Adapt to LLxprt's SettingsDialog.
- **Remote admin settings** (`2fe45834`) → REIMPLEMENT. Adapt enterprise settings to LLxprt config.
- **Console → coreEvents migration** (`10ae8486`) → REIMPLEMENT. Biggest single item (~66 files), adopt upstream event-driven architecture pattern.

**SKIP (out of scope for this sync, tracked for future):**
- **yolo.toml `allow_redirection = true`** (from `334b813d`) → Actually trivial, moved to Minor Manual Adds below
- **Remove dead `setMessageBus()` stubs** → Subsumed by MessageBus REIMPLEMENT (DI refactor removes these naturally)

### Minor Manual Adds:
- Add `allow_redirection = true` to `yolo.toml` (from `334b813d`) — 1-line change, do during cherry-pick execution
