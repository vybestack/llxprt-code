# Cherry-Pick Decisions: v0.25.2 → v0.26.0

**Range:** `v0.25.2..v0.26.0` (154 upstream commits)
**Branch:** `gmerge/0.26.0`
**Date:** 2026-03-24
**Revised:** 2026-03-25 (post human review)

## Decision Counts (Revised)

| Decision | Count |
|----------|------:|
| PICK     |    22 |
| REIMPLEMENT | 42 |
| SKIP     |    85 |
| NO_OP    |     5 |
| **Total**| **154** |

## Revision Log (2026-03-25)

Changes after human review and subagent re-analysis:

### PICK → SKIP (7 commits)
| SHA | Subject | Reason |
|-----|---------|--------|
| `764016b` | fix(a2a): Don't throw for Retry/InvalidStream | Deferred — added to #1675 |
| `5ba6e24` | Restricting to localhost (a2a) | Deferred — added to #1675 |
| `79076d1` | [A2A] Disable checkpointing if git not installed | Deferred — added to #1675 |
| `4f324b5` | fix: replace 3 periods with ellipsis | LLxprt has different tips, wittyPhrases.ts missing |
| `1998a71` | fix(hooks): enable /hooks disable | LLxprt already has correct behavior (no early-return bug) |
| `ee8d425` | refactor(core): truncation refactoring | Completely different architecture (toolOutputLimiter.ts) |
| `e030426` | Don't commit unless user asks | Different prompt architecture (.md files); user declined |

### PICK → REIMPLEMENT (5 commits)
| SHA | Subject | Reason |
|-----|---------|--------|
| `ae19802` | Add timeout for shell-utils | LLxprt uses shell-parser.ts, not inline parseCommandTree |
| `9722ec9` | fix(core): warnings for invalid hook event names | LLxprt hooks diverged; different warning patterns |
| `0bebc66` | fix(ui): ensure rationale renders before tool calls | Different stream processing with deduplication |
| `6900253` | feat(cli): replace keyboard shortcuts link with URL | Needs vybestack.dev URL, not geminicli.com |
| `4cfbe4c` | fix(cli): correct Homebrew installation detection | Same bug; adapt for llxprt-code/vybestack tap |

### PICK → NO_OP (1 commit)
| SHA | Subject | Reason |
|-----|---------|--------|
| `013a4e0` | fix(core): fix PTY descriptor shell leak | LLxprt already has safePtyDestroy() |

### REIMPLEMENT → PICK (1 commit)
| SHA | Subject | Reason |
|-----|---------|--------|
| `c8c7b57` | refactor(skills): replace project with workspace | LLxprt still says "project" — straight cherry-pick |

### REIMPLEMENT → SKIP (2 commits)
| SHA | Subject | Reason |
|-----|---------|--------|
| `86dbf20` | fix: experiment values in settings UI | LLxprt has no ExperimentFlags infrastructure |
| `203f520` | Stabilize the git evals | Different prompt/eval architecture |

### REIMPLEMENT → NO_OP (1 commit)
| SHA | Subject | Reason |
|-----|---------|--------|
| `52fadba` | fix(core): deduplicate ModelInfo emission | LLxprt never emits ModelInfo events; filed #1770 |

### Issues Filed
- **#1770** — feat: event-driven profile-aware model info display (milestone 0.10.0)
- **#1675 comment** — 3 deferred A2A server picks added
- **#1648 comment** — upstream PDF token estimation reference added

## Audit Methodology

All 154 commits were audited at the code level (not just subject lines).

- **Batches 1, 2, 4, 5:** Audited via `codeanalyzer` subagent with full `git show <sha>` diffs compared against LLxprt source files.
- **Batch 3 (commits 63-93):** Audited manually (coordinator) after subagent auth failures. Used `git show --stat` + targeted diff review + LLxprt file existence checks.
- **Detailed audit results:** `audit-batch1.md` through `audit-batch5.md` in this directory.
- **LLxprt state assessment:** Comprehensive check of LLxprt's current files/features performed before decisioning (skills, hooks, scheduler, a2a, policy, compression, settings, UI components).

## Decision Notes (Recurring Themes)

- **GitHub automation** (`.github/`): Always SKIP. 15+ commits.
- **Version bumps** (`chore(release)`): Always SKIP. 8 commits.
- **Upstream agent system** (`generalist-agent`, `delegate-to-agent`, `a2a-client-manager`, `AgentRegistry`): Always SKIP. LLxprt has its own subagent system. 7+ commits.
- **Plan mode** (`plan.toml`, `ApprovalMode.PLAN`): Always SKIP. LLxprt does not have plan mode. 4 commits.
- **Admin controls** (`code_assist/admin/`): Always SKIP. Google enterprise feature. 3 commits.
- **Flash fallback / model routing** (`availability/`, `routing/`, `fallback/`): Always SKIP. Not in LLxprt. 3 commits.
- **Rewind feature**: Always SKIP. LLxprt does not have rewind. 4 commits.
- **ClearcutLogger / Google telemetry**: Always SKIP.
- **Evals-only changes**: SKIP unless they also touch prompts.ts or core code.
- **Mnemoist migration**: SKIP. LLxprt still uses LruCache.
- **Skill-creator builtin**: SKIP. Not in LLxprt.
- **Settings changes**: Usually REIMPLEMENT due to LLxprt's divergent settings architecture (multi-provider, different merge logic).
- **Hooks changes**: Usually PICK or REIMPLEMENT — LLxprt has full hooks system.
- **Key binding changes**: Usually REIMPLEMENT — LLxprt has additional commands (`TOGGLE_TODO_DIALOG`, `TOGGLE_MOUSE_EVENTS`, `REFRESH_KEYPRESS`).
- **Branding**: All cherry-picks need `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`, `USE_GEMINI` → `USE_PROVIDER`, `gemini-cli` → `llxprt-code`.

---

## PICK Table (34 commits — chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|--:|:-----------:|:----:|:-----:|:---------:|:--------|
| 1 | `c04af6c` | 01-14 | docs, cli/config | Doc + config string update, files exist | docs: clarify F12 to open debug console |
| 2 | `f6c2d61` | 01-14 | docs | Pure doc fix, removes .md from links | docs: Remove .md extension from internal links |
| 3 | `764016b` | 01-14 | a2a-server | LLxprt HAS a2a-server/task.ts; adds Retry/InvalidStream handling | fix(a2a): Don't throw for Retry/InvalidStream |
| 4 | `ae19802` | 01-14 | core/utils | LLxprt HAS shell-utils.ts; adds timeout to prevent hangs | Add timeout for shell-utils |
| 5 | `4f324b5` | 01-15 | cli/ui | Simple text fix in tips.ts and wittyPhrases.ts | fix: replace 3 periods with ellipsis |
| 6 | `4848f42` | 01-15 | core/skills | LLxprt HAS skillLoader.ts; adds YAML fallback parser for colons | fix: Handle colons in skill description frontmatter |
| 7 | `d0bbc7f` | 01-14 | core/skills | Builds on #6; hardens regex for name/description | refactor(core): harden skill frontmatter parsing |
| 8 | `448fd3c` | 01-15 | core/tsconfig | Fixes circular dependency via tsconfig paths | fix(core): resolve circular dependency tsconfig |
| 9 | `6740886` | 01-15 | core/client | Adds `!signal.aborted` check before ModelInfo yield | fix(core): prevent ModelInfo emission on aborted signal |
| 10 | `5ba6e24` | 01-15 | a2a-server | Security: binds listen to localhost, adds Number() port conversion | Restricting to localhost (a2a) |
| 11 | `be37c26` | 01-16 | cli/ui | LLxprt HAS text-buffer.ts, LruCache.ts, highlight.ts; perf improvements | perf(ui): optimize text buffer and highlighting |
| 12 | `013a4e0` | 01-16 | core | LLxprt HAS shellExecutionService.ts, shell-utils.ts; fd leak fix | fix(core): fix PTY descriptor shell leak |
| 13 | `9722ec9` | 01-16 | core/hooks | LLxprt HAS hookRegistry.ts; adds HOOK_EVENTS validation set | fix(core): warnings for invalid hook event names |
| 14 | `ee8d425` | 01-16 | core/scheduler, utils | LLxprt HAS tool-executor.ts, fileUtils.ts, tokenCalculation.ts | refactor(core): truncation refactoring and token estimation |
| 15 | `1998a71` | 01-16 | cli/hooks, config | LLxprt HAS hooksCommand.ts, config.ts; fixes individual hook disable | fix(hooks): enable /hooks disable to reliably stop hooks |
| 16 | `e030426` | 01-17 | core/prompts | Single line addition to prompts.ts: "NEVER stage or commit" | Don't commit unless user asks |
| 17 | `6900253` | 01-17 | cli/ui | LLxprt HAS Help.tsx; replaces relative path with URL constant | feat(cli): replace keyboard shortcuts link with URL |
| 18 | `41e01c2` | 01-17 | core/mcp | LLxprt HAS oauth-provider.ts; fixes PKCE length + OAuth port | fix(core): resolve PKCE length and OAuth redirect port |
| 19 | `4cfbe4c` | 01-19 | cli | LLxprt HAS installationInfo.ts; fixes Homebrew detection on macOS | fix(cli): correct Homebrew installation detection |
| 20 | `d8a8b43` | 01-19 | cli/ui | LLxprt HAS commandUtils.ts; fixes clipboard in Windows Terminal | fix(cli): use OSC-52 clipboard copy in Windows Terminal |
| 21 | `a90bcf7` | 01-19 | commands | New /introspect slash command (TOML file); needs path adaptation | feat: add /introspect slash command |
| 22 | `0bebc66` | 01-19 | cli/hooks | Flushes pending text before scheduling tool calls | fix(ui): ensure rationale renders before tool calls |
| 23 | `155d9aa` | 01-20 | core/hooks | LLxprt HAS hookSystem.ts; fixes return type to DefaultHookOutput | fix: return type of fireSessionStartEvent |
| 24 | `4920ad2` | 01-19 | docs | Simple doc fix: removes unsupported DiffModified color key | docs(themes): remove unsupported DiffModified |
| 25 | `166e04a` | 01-20 | core/mcp, config | LLxprt HAS mcp-client-manager.ts; fixes instruction refresh | Fix mcp instructions |
| 26 | `79076d1` | 01-20 | a2a-server | LLxprt HAS a2a-server; adds git availability check | [A2A] Disable checkpointing if git not installed |
| 27 | `88df621` | 01-20 | integration-tests | Hook exit code test coverage; provider-agnostic | Test coverage for hook exit code cases |
| 28 | `85b1716` | 01-20 | cli/commands | Extension examples update; needs package name adaptation | Revert "Revert "Update extension examples"" |
| 29 | `b99e841` | 01-21 | cli | Exception handler for Windows node-pty race condition | Fixes Windows crash: resize pty already exited |
| 30 | `995ae42` | 01-20 | cli/ui | DebugProfiler event listener registration; small fix | Avoid spurious render warnings (DebugProfiler) |
| 31 | `2455f93` | 01-20 | cli/config | HOME/END keybinding conflict resolution | fix(cli): resolve home/end keybinding conflict |
| 32 | `55c2783` | 01-21 | cli/commands | Displays 'http' instead of 'sse' for URL-based MCP servers | fix(cli): display http type on mcp list |
| 33 | `9866eb0` | 01-20 | cli/ui | Fixes operator precedence in editor fallback logic | fix: bad fallback logic external editor |
| 34 | `97aac69` | 01-21 | core/tools | Adds getFullyQualifiedName() and fallback lookup for MCP tools | Fix mcp tool lookup in tool registry |

---

## SKIP Table (76 commits — chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|--:|:-----------:|:----:|:-----:|:---------:|:--------|
| 1 | `a1cbe85` | 01-14 | release | Version bump — LLxprt has own versioning | chore(release): bump to nightly |
| 2 | `dfb7dc7` | 01-14 | cli/ui | Rewind feature — LLxprt doesn't have rewind | feat: add Rewind Confirmation dialog |
| 3 | `4db00b8` | 01-14 | .gemini/skills | Builtin skill-creator — not in LLxprt | docs(skills): use body-file in pr-creator |
| 4 | `1212161` | 01-14 | .github | GitHub automation | chore(automation): recursive labeling |
| 5 | `16b3591` | 01-14 | core/skills | Builtin skill-creator — not in LLxprt | feat: introduce skill-creator built-in skill |
| 6 | `b3eecc3` | 01-14 | .github | GitHub automation | chore(automation): remove PR size labeler |
| 7 | `41369f6` | 01-14 | docs | Upstream release notes — LLxprt has own | Docs: Update release notes |
| 8 | `b14cf1d` | 01-14 | .github | GitHub automation | chore(automation): improve issue triage |
| 9 | `5ed275c` | 01-14 | cli/config | Removes rewind keybinding — rewind not in LLxprt | Remove unused rewind key binding |
| 10 | `b3527dc` | 01-15 | .github | GitHub automation | chore: update dependabot configuration |
| 11 | `e58fca6` | 01-14 | cli/config | Auto model routing — not in LLxprt | feat(config): add 'auto' alias for default model |
| 12 | `4b2e9f7` | 01-14 | agents | Upstream agent system — LLxprt has own subagents | Enable & disable agents |
| 13 | `5bdfe1a` | 01-14 | cli/config | Plan mode — not in LLxprt | feat(plan): add experimental plan flag |
| 14 | `467e869` | 01-14 | .github | GitHub automation | chore(automation): ensure need-triage label |
| 15 | `409f9c8` | 01-14 | core/scheduler | Adds SchedulerStateManager — LLxprt has minimal scheduler | feat(scheduler): add SchedulerStateManager |
| 16 | `53f5443` | 01-15 | .github | GitHub automation | chore(automation): enforce help wanted label |
| 17 | `b0c9db7` | 01-15 | release | Version bump | chore(release): bump to nightly |
| 18 | `a8631a1` | 01-15 | .github | GitHub automation | fix(automation): correct label matching |
| 19 | `d545a3b` | 01-15 | .github | GitHub automation | fix(automation): prevent label-enforcer loop |
| 20 | `fa39819` | 01-15 | docs | Google-specific locations and model-routing references | Add links to supported locations |
| 21 | `2b6bfe4` | 01-15 | .github | GitHub automation | feat(automation): enforce maintainer label |
| 22 | `9e13a43` | 01-15 | docs | Telemetry docs — Google-specific | Replace relative paths for website build |
| 23 | `c8670f8` | 01-15 | cli/package.json | Upstream-specific dependency resolution | fix(cli): add explicit dependency on color-convert |
| 24 | `48fdb98` | 01-15 | .github | GitHub automation | fix(automation): robust label enforcement |
| 25 | `b0d2ec5` | 01-15 | docs | GEMINI.md — LLxprt has LLXPRT.md | docs: clarify workspace test in GEMINI.md |
| 26 | `655ab21` | 01-15 | cli/config, policy | Plan mode — not in LLxprt | feat(plan): experimental plan approval mode |
| 27 | `f367b95` | 01-15 | core/scheduler | awaitConfirmation module — LLxprt has minimal scheduler | feat(scheduler): add functional awaitConfirmation |
| 28 | `8dde66c` | 01-15 | .github | GitHub automation | fix(infra): update maintainer rollup label |
| 29 | `420a419` | 01-15 | .github | GitHub automation | fix(infra): GraphQL direct parents |
| 30 | `c6cf3a4` | 01-15 | .github | GitHub automation | chore(workflows): rename label-workstream-rollup |
| 31 | `4bb817d` | 01-16 | integration-tests | Test skip — file may not exist in LLxprt | skip simple-mcp-server.test.ts |
| 32 | `a159785` | 01-16 | agents, evals | Upstream agent system — LLxprt has own subagents | Steer outer agent to use expert subagents |
| 33 | `fcd860e` | 01-16 | core/agents | Upstream agent system — adds generalist-agent.ts | feat(core): Add generalist agent |
| 34 | `5241174` | 01-16 | policy, scheduler | Plan mode — creates plan.toml, not in LLxprt | feat(plan): enforce strict read-only policy |
| 35 | `59da616` | 01-16 | .github | GitHub automation | remove need-triage label from bug_report |
| 36 | `42fd647` | 01-16 | core/telemetry | telemetry/semantic.ts doesn't exist in LLxprt | fix(core): truncate large telemetry log entries |
| 37 | `063f0d0` | 01-16 | docs | Upstream Agent Skills feature docs | docs(extensions): add Agent Skills support |
| 38 | `93224e1` | 01-16 | policy | plan.toml — not in LLxprt | feat(plan): remove read_many_files from plan policies |
| 39 | `d8d4d87` | 01-16 | admin | Admin controls — Google enterprise, not in LLxprt | feat(admin): admin controls polling |
| 40 | `f2d3b76` | 01-16 | core/utils | Migrates to mnemoist — LLxprt uses LruCache | Remove LRUCache class migrating to mnemoist |
| 41 | `a769461` | 01-16 | a2a | Removes a2a-client-manager.ts — file doesn't exist in LLxprt | chore: remove a2a-adapter |
| 42 | `20580d7` | 01-17 | docs | Rewind docs — LLxprt doesn't have rewind | Delete rewind documentation |
| 43 | `9d9e3d1` | 01-18 | skills | Skill-creator CI — not in LLxprt | Stabilize skill-creator CI |
| 44 | `08c32f7` | 01-18 | core/compression | chatCompressionService.ts doesn't exist — LLxprt has own compression | fix(core): compression before overflow check |
| 45 | `d87a3ac` | 01-19 | evals | Evals-only change | Fix inverted logic |
| 46 | `d079b7a` | 01-19 | scripts | Project-specific scripts | chore(scripts): duplicate issue closer |
| 47 | `a4eb04b` | 01-19 | docs | Gemini 3 branding — LLxprt has own README | docs: update README for Gemini 3 |
| 48 | `4976915` | 01-19 | evals | Evals-only change | Demote git evals to nightly |
| 49 | `4b4bdd1` | 01-20 | .github | GitHub automation | fix(automation): jq quoting error |
| 50 | `e2901f3` | 01-19 | core/scheduler | Scheduler refactoring — LLxprt has minimal scheduler | refactor(core): decouple scheduler |
| 51 | `05c0a8e` | 01-19 | .github | GitHub automation | fix(workflows): author_association check |
| 52 | `451e0b4` | 01-19 | cli/config | Event-driven scheduler gate — not in LLxprt | feat(cli): experiment gate for scheduler |
| 53 | `e34f0b4` | 01-20 | fallback | fallback/handler.ts doesn't exist in LLxprt | fix: update currentSequenceModel |
| 54 | `943481c` | 01-20 | admin, settings | Admin controls — not in LLxprt | feat(admin): admin.skills.enabled setting |
| 55 | `15f2617` | 01-20 | agents | Upstream agent system — delegate-to-agent-tool not in LLxprt | fix(core): agent delegation error messages |
| 56 | `b71fe94` | 01-20 | admin, commands | Admin controls — not in LLxprt | feat(admin): admin settings to commands |
| 57 | `5b8a239` | 01-20 | core/telemetry | Google-specific uiTelemetryService | fix(core): telemetry token count after resume |
| 58 | `12b0fe1` | 01-20 | evals | Upstream agent evals | Demote subagent test to nightly |
| 59 | `e5745f1` | 01-20 | telemetry | ClearcutLogger — removed from LLxprt | feat(plan): telemetry for plan mode |
| 60 | `a16d598` | 01-20 | availability | Flash lite fallback — not in LLxprt | feat: flash lite utility fallback chain |
| 61 | `f42b4c8` | 01-20 | evals | Upstream agent evals | feat(core): eval for generalist agent |
| 62 | `f0f705d` | 01-20 | agents | Upstream agent system | feat(core): unify agent enabled/disabled flags |
| 63 | `ed0b0fa` | 01-20 | routing | routing/defaultStrategy.ts doesn't exist in LLxprt | fix(core): resolve auto model in default strategy |
| 64 | `67d6908` | 01-20 | .gemini, docs | GEMINI.md and .gemini/skills — LLxprt uses different paths | docs: update project context |
| 65 | `c9061a1` | 01-20 | docs | Docs sidebar — upstream site only | Remove missing sidebar item |
| 66 | `3b626e7` | 01-20 | cli/ui | ValidationDialog — uses useQuotaAndFallback not in LLxprt | Add ValidationDialog for 403 errors |
| 67 | `2b58605` | 01-21 | release | Version bump | chore(release): v0.26.0-preview.0 |
| 68 | `dc8fc75` | 01-21 | release | Preview cherry-pick — superseded | fix(patch): cherry-pick for preview.0 |
| 69 | `603e66b` | 01-22 | release | Version bump | chore(release): v0.26.0-preview.1 |
| 70 | `75b5eee` | 01-22 | release | Version bump | chore(release): v0.26.0-preview.2 |
| 71 | `1c207e2` | 01-22 | release | Version bump | chore(release): v0.26.0-preview.3 |
| 72 | `c593a29` | 01-25 | release | Version bump | chore(release): v0.26.0-preview.4 |
| 73 | `9c667cf` | 01-22 | cli/ui, commands | Rewind command — not in LLxprt | feat: implement /rewind command |
| 74 | `958cc45` | 01-22 | cli/ui | Rewind fixes — not in LLxprt | Fix rewind starts at bottom |
| 75 | `a380b42` | 01-28 | release | Version bump | chore(release): v0.26.0-preview.5 |
| 76 | `c1b110a` | 01-28 | release | Version bump | chore(release): v0.26.0 |

---

## REIMPLEMENT Table (41 commits — chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|--:|:-----------:|:----:|:-----:|:---------:|:--------|
| 1 | `3b55581` | 01-14 | cli/config, docs | LLxprt has extensions but different architecture (extension.ts not extension-manager.ts) | Add experimental extension config setting |
| 2 | `a3234fb` | 01-14 | core/tools | Adds rootCommands[] to ToolExecuteConfirmationDetails; LLxprt types may differ | prefactor: add rootCommands as array |
| 3 | `09a7301` | 01-14 | cli/config | LLxprt HAS keyBindings.ts with same \x7f bindings; verify before removing | remove unnecessary \x7f key bindings |
| 4 | `c8c7b57` | 01-14 | cli/skills, core | Rename 'project' → 'workspace' scope; LLxprt skills may use different terminology | refactor(skills): replace project with workspace |
| 5 | `94d5ae5` | 01-14 | cli/ui, config | Removes paste field from KeyBinding; affects many files; verify LLxprt's current paste handling | Simplify paste handling |
| 6 | `7e6817d` | 01-15 | cli/zed, core | Adds stdin close exit cleanup; LLxprt zed integration may differ | fix(acp): run exit cleanup when stdin closes |
| 7 | `6021e4c` | 01-14 | core/scheduler, confirmation-bus | Adds types (SerializableConfirmationDetails, correlationId); LLxprt types less evolved | feat(scheduler): add types for event driven scheduler |
| 8 | `fb76408` | 01-14 | cli/config | Removes sequence binding from keyBindings.ts, keyMatchers.ts; verify LLxprt usage | Remove sequence binding |
| 9 | `a2dab14` | 01-15 | cli/config | Removes --prompt deprecation; verify LLxprt had same deprecation | feat(cli): undeprecate --prompt flag |
| 10 | `42c26d1` | 01-14 | cli/config, ui | Adds MOVE_UP/MOVE_DOWN commands; simplifies text-buffer key handling | cleanup: Improve keybindings |
| 11 | `a81500a` | 01-14 | cli/skills, config | LLxprt HAS consent.ts and install.ts; security consent integration may differ | feat(cli): security consent for skill installation |
| 12 | `222b739` | 01-14 | core/skills | LLxprt skillManager has different addSkillsWithPrecedence(); needs manual merge | feat(skills): conflict detection for skill overrides |
| 13 | `f909c9e` | 01-15 | core/policy | Adds source field to PolicyRule; LLxprt policy types differ | feat(policy): add source tracking to policy rules |
| 14 | `f7f38e2` | 01-15 | 59 files | LARGE: Makes all merged settings non-nullable; LLxprt settings architecture diverged | Make merged settings non-nullable |
| 15 | `e77d7b2` | 01-15 | core/utils, cli/ui, config | Adds maxFiles/timeout to crawler; LLxprt crawler.ts is simpler | fix(cli): prevent OOM crash file search |
| 16 | `8a627d6` | 01-16 | cli/ui | Makes pickTty() async with timeout; LLxprt has sync implementation | fix(cli): safely handle /dev/tty on macOS |
| 17 | `1e8f87f` | 01-15 | cli/hooks, core/mcp | Adds MCPDiscoveryState tracking; LLxprt MCP infrastructure may differ | Add support for running commands before MCP loads |
| 18 | `cfdc4cf` | 01-16 | cli/hooks | Changes scheduleToolCalls to async; LLxprt hook implementation may differ | Fix race condition awaiting scheduleToolCalls |
| 19 | `ce35d84` | 01-16 | cli/config, docs | LLxprt has extra commands (TOGGLE_TODO_DIALOG, TOGGLE_MOUSE_EVENTS, etc.) | cleanup: Organize key bindings |
| 20 | `608da23` | 01-16 | 22+ files | LARGE: Renames disable* → enable* settings with migration layer | feat(settings): rename disable* to enable* |
| 21 | `1681ae1` | 01-16 | cli/ui | LLxprt HAS ShellConfirmationDialog; unify into ToolConfirmationMessage | refactor(cli): unify shell confirmation dialogs |
| 22 | `272570c` | 01-16 | cli/config, tests | Skills default enabled + backward compat migration; settings schema differs | feat(agent): enable agent skills by default |
| 23 | `86dbf20` | 01-17 | cli/ui, config | Shows experiment values in SettingsDialog; LLxprt dialog may differ | fix: experiment values in settings UI |
| 24 | `203f520` | 01-19 | core/prompts, evals | prompts.ts improvements (git --no-pager, clearer commit rules); evals don't apply | Stabilize the git evals |
| 25 | `1b6b6d4` | 01-19 | cli/hooks | Extracts tool mapping to toolMapping.ts; LLxprt useReactToolScheduler differs | refactor(cli): centralize tool mapping |
| 26 | `ec74134` | 01-19 | core/policy, tools, cli/ui | Security: shell redirection warnings; LLxprt policy-engine may differ | feat(core): shell redirection transparency |
| 27 | `52fadba` | 01-19 | core/client | Deduplicates ModelInfo in GeminiClient; LLxprt multi-provider client differs | fix(core): deduplicate ModelInfo emission |
| 28 | `1182168` | 01-20 | core/prompts, turn, compression | Enhanced compression with self-verification; chatCompressionService.ts missing, prompts.ts applicable | feat(core): enhanced context compression |
| 29 | `e92f60b` | 01-20 | core/hooks, geminiChat | Migrates BeforeModel/AfterModel hooks to HookSystem; both files exist but may differ | fix: migrate BeforeModel/AfterModel hooks |
| 30 | `645e2ec` | 01-20 | cli/ui | Fixes Ctrl+Enter and Ctrl+J; LLxprt KeypressContext similar but may have diverged | fix(cli): resolve Ctrl+Enter/Ctrl+J newline |
| 31 | `b288f12` | 01-20 | cli/config, core/mcp | Passes CLI version to MCP servers; needs package name adaptation | fix(cli): send CLI version as mcp client version |
| 32 | `211d2c5` | 01-20 | core/hooks, cli/config | LARGE: Splits hooks into hooksConfig + hooks event names; schema refactor | feat(core): hooks properties are event names |
| 33 | `aceb06a` | 01-20 | cli/ui | Follow-up to #30: adds keyMatchers[NEWLINE] check in text-buffer | fix(cli): fix newline support broken in previous PR |
| 34 | `e1fd5be` | 01-20 | cli/ui | Esc-Esc clears prompt if non-empty; rewind reference needs removal | Add Esc-Esc to clear prompt |
| 35 | `93ae777` | 01-20 | cli/config | Adds System/SystemDefaults scope to migrateDeprecatedSettings; LLxprt settings differ | Fix System scopes migration |
| 36 | `0fa9a54` | 01-22 | cli | Auth failure sandbox handling; LLxprt has different auth flow (multi-provider) | fix(patch): auth failure handling preview.1 |
| 37 | `ee87c98` | 01-22 | cli/ui | Adds shift:true to fast return buffer keypress; small targeted fix | fix(patch): fast return buffer flags preview.2 |
| 38 | `cebe386` | 01-25 | cli/hooks, core | LARGE: New useMcpStatus hook; switches appEvents→coreEvents; significant refactor | fix(patch): MCP status hook refactor preview.3 |
| 39 | `2a3c879` | 01-23 | core/hooks, client, turn | Adds clearContext to AfterAgent hooks; LLxprt hooks implementation differs | feat: add clearContext to AfterAgent hooks |
| 40 | `43846f4` | 01-26 | core/utils | Adds try/catch around readPackageUp(); normalize:false | address feedback (package.ts) |
| 41 | `d8e9db3` | 01-26 | core/utils | Adds debugLogger.error() in catch block; follow-up to #40 | address feedback (package.ts) |

---

## NO_OP Table (3 commits)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|--:|:-----------:|:----:|:-----:|:---------:|:--------|
| 1 | `c8d7c09` | 01-14 | core/utils | tokenCalculation.ts doesn't exist in LLxprt; different token estimation | fix: PDF token estimation |
| 2 | `0a6f2e0` | 01-19 | core/turn | LLxprt already has this fix (iterates allParts for thought detection) | Fix: Process all parts when thought is first |
| 3 | `31c6fef` | 01-27 | cli/config, docs | LLxprt already has skills system at stable | feat(skills): promote skills settings to stable |

---

## High-Risk Items

### Large REIMPLEMENTs (significant effort)

1. **`f7f38e2` — Make merged settings non-nullable** (59 files). Major type-safety refactor. LLxprt settings architecture has diverged significantly. Consider deferring or breaking into phases.

2. **`608da23` — Rename disable* → enable*** (22+ files). Settings migration with backward compatibility. Touches many config consumers. LLxprt has additional settings these patterns don't cover.

3. **`211d2c5` — Hooks properties are event names** (large). Splits hooks settings into hooksConfig + hooks event definitions. Fundamental schema change for hooks system.

4. **`cebe386` — MCP status hook refactor** (large). Introduces useMcpStatus hook, switches event system. Architectural change to MCP initialization flow.

### Dependency Chains

```
4848f42 (skill colons) → d0bbc7f (harden parsing) → 222b739 (conflict detection)

e030426 (don't commit) → 203f520 (git --no-pager, clearer commit rules)

645e2ec (Ctrl+Enter) → aceb06a (newline support fix)

43846f4 (package.ts) → d8e9db3 (package.ts follow-up)

09a7301 (\x7f bindings) → fb76408 (sequence binding) → 42c26d1 (improve keybindings) → ce35d84 (organize keybindings)
```
