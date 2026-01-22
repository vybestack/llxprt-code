# Cherry-Pick Decisions: v0.12.0 → v0.13.0

Tracking issue: TBD (create after plan approval)

## Summary

| Decision | Count |
|----------|-------|
| PICK | 59 |
| SKIP | 55 |
| REIMPLEMENT | 12 |
| **Total** | 126 |

## Decision Notes

### Recurring SKIP Themes
- **Release/version bump commits** (chore(release): bump version, v0.13.0-preview.N, v0.13.0, nightly) - 11 commits
- **ClearcutLogger/telemetry commits** - LLxprt has removed all Google telemetry
- **Smart Edit fixes** - Smart Edit removed from LLxprt
- **debugLogger migrations** - LLxprt has different DebugLogger, already migrated
- **GitHub workflows** (gemini-automated-issue-triage.yml, release workflows)
- **Codebase investigator enable** - Google-specific preview feature
- **Remote experiments integration** - Google-specific experiments system
- **Todo-related commits** - LLxprt has completely different todo implementation
- **Model routing commits** - LLxprt does NOT support/want Google's model routing
- **API key auth flow** - LLxprt handles API keys differently with multi-provider
- **Compression threshold UI** - LLxprt has own ephemeral-based system
- **Subagent timeout/recovery** - LLxprt has different subagent architecture
- **Context percentage in footer** - LLxprt doesn't have this feature

### Recurring REIMPLEMENT Themes
- **Hook system** - New framework needs review for multi-provider compatibility
- **PolicyEngine to Core** - LLxprt has existing policy engine, needs reconciliation
- **Extensions MCP refactor** - Major restructuring needing careful adaptation
- **Settings schema autogeneration** - May conflict with LLxprt's schema system

### High-Risk Items
- `ffc5e4d0` - Refactor PolicyEngine to Core Package
- `da4fa5ad` - Extensions MCP refactor
- `4fc9b1cd` - Alternate buffer support (terminal-level)
- `c0495ce2`, `80673a0c`, `b2591534`, `cb2880cb` - Hook system series

### Follow-up Issues to Create
- **Subagent Recovery Turn** (`60973aac`) - LLxprt should implement similar "recovery turn" concept for our subagent system. When subagent hits TIMEOUT/MAX_TURNS/NO_TOOL_CALL, give it one grace turn to finalize. Like `--continue` for subagents.

---

## PICK Table (Chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `706834ec` | 2025-10-29 | cli | Fix relative path handling in @command | fix: enhance path handling in handleAtCommand to support relative paths (#9065) |
| 2 | `6e026bd9` | 2025-10-29 | core | Security fix - use emitFeedback | fix(security) - Use emitFeedback instead of console error (#11954) |
| 3 | `c60d8ef5` | 2025-10-29 | integration-tests | Unskip read_many_files test | fix(infra) - Unskip read many file test (#12181) |
| 4 | `3e970186` | 2025-10-29 | core | Move getPackageJson utility to core | refactor(core): Move getPackageJson utility to core package (#12224) |
| 5 | `42a265d2` | 2025-10-29 | cli/tests | Fix atprocessor test on Windows | Fix atprocessor test on windows (#12252) |
| 6 | `82c10421` | 2025-10-29 | cli | Fix alt key mappings for Mac | Fix alt key mappings for mac (#12231) |
| 7 | `99f75f32` | 2025-10-29 | cli, integration-tests | Add deprecated flag message | Fix(noninteractive) - Add message when user uses deprecated flag (#11682) |
| 8 | `523274db` | 2025-10-29 | cli | Standardize error logging | Standardize error logging with coreEvents.emitFeedback (#12199) |
| 9 | `77df6d48` | 2025-10-29 | docs | Update keyboard shortcuts docs | docs: update keyboard shortcuts with missing shortcuts (#12024) |
| 10 | `1d9e6870` | 2025-10-30 | core | Granular memory loaders for JIT | feat(core): Implement granular memory loaders for JIT architecture (#12195) |
| 11 | `c583b510` | 2025-10-30 | cli/tests | Refactor unit tests in packages/cli/src/ui | Refactoring unit tests in packages/cli/src/ui (#12251) |
| 12 | `b8330b62` | 2025-10-30 | core | Fix misreported lines removed by model | Fix misreported number of lines being removed by model (#12076) |
| 13 | `7d03151c` | 2025-10-30 | cli | Fix output messages for install and link | fix output messages for install and link (#12168) |
| 14 | `a3370ac8` | 2025-10-30 | cli | Add validate command for extensions | Add validate command (#12186) |
| 15 | `b8969cce` | 2025-10-30 | docs | Fix incorrect extension install method doc | fix(docs): remove incorrect extension install method (#11194) |
| 16 | `d4cad0cd` | 2025-10-30 | integration-tests | Use canned response for JSON output error test | fix(test) - Make JSON output error test use canned response (#12250) |
| 17 | `cc081337` | 2025-10-30 | cli, integration-tests | Support reloading extensions - MCP servers | Initial support for reloading extensions in the CLI - mcp servers only (#12239) |
| 18 | `54fa26ef` | 2025-10-30 | cli/tests | Fix tests to use act for UI changes | Fix tests to wrap all calls changing the UI with act. (#12268) |
| 19 | `b382ae68` | 2025-10-30 | eslint, core | Prevent self-imports, fix build loop | feat: Prevent self-imports and fix build loop (#12309) |
| 20 | `68afb720` | 2025-10-30 | core | Change default compression threshold | Change default compression threshold (#12306) |
| 21 | `322feaaf` | 2025-10-30 | core | Decouple GeminiChat from uiTelemetryService | refactor(core): decouple GeminiChat from uiTelemetryService via Usage events (#12196) |
| 22 | `ab8c24f5` | 2025-10-31 | cli | Fixes for Ink 6.4.0 | Fixes for Ink 6.4.0 (#12352) |
| 23 | `f8ff921c` | 2025-10-31 | docs | Update mcp-server.md | Update mcp-server.md (#12310) |
| 24 | `f875911a` | 2025-10-31 | cli | Remove testing-library/react dep | Remove testing-library/react dep now that it is unused. (#12355) |
| 25 | `01ad74a8` | 2025-10-31 | docs | user.email only for Google auth | docs(cli): `user.email` attribute is only available for Google auth (#12372) |
| 26 | `f4ee245b` | 2025-10-31 | cli | Switch to ink@ version 6.4.0 | Switch to ink@. version 6.4.0 (#12381) |
| 27 | `c158923b` | 2025-10-31 | docs | Add policy engine documentation | docs: Add policy engine documentation and update sidebar (#12240) |
| 28 | `adddafe6` | 2025-10-31 | cli | Handle untrusted folders on extension install | Handle untrusted folders on extension install and link (#12322) |
| 29 | `6ee7165e` | 2025-10-31 | cli | Add logging for slow rendering | feat(infra) - Add logging for slow rendering (#11147) |
| 30 | `d72f8453` | 2025-10-31 | cli | Remove unused jsdom dep | Remove unused jsdom dep (#12394) |
| 31 | `4b53b3a6` | 2025-10-31 | docs | Update telemetry.md remove flag references | Update telemetry.md to remove references to flags. (#12397) |
| 32 | `9478bca6` | 2025-10-31 | docs | Add Policy Engine docs to indexes | Adding the Policy Engine docs to indexes. (#12404) |
| 33 | `8b93a5f2` | 2025-10-31 | .gitignore | Add package-lock | I think the package lock was added in error to .gitignore. (#12405) |
| 34 | `f9df4153` | 2025-10-31 | core | Introduce release channel detection | feat(core): Introduce release channel detection (#12257) |
| 35 | `61207fc2` | 2025-10-31 | cli | Update string width for Ink alignment | further incremental steps. Update the string width version to align with upstream ink (#12411) |
| 36 | `f8ce3585` | 2025-10-31 | cli | Ink updates | Jacob314/jrichman ink (#12414) |
| 37 | `caf2ca14` | 2025-10-31 | cli | Add kitty support for function keys | Add kitty support for function keys. (#12415) |
| 38 | `e3262f87` | 2025-11-01 | core | Combine .gitignore and .geminiignore logic | fix(core): combine .gitignore and .geminiignore logic for correct precedence (#11587) |
| 39 | `d7243fb8` | 2025-11-01 | cli | Add DarkGray to ColorTheme | Add DarkGray to the ColorTheme. (#12420) |
| 40 | `02518d29` | 2025-11-02 | docs | Update command-line flag documentation | docs: update command-line flag documentation (#12452) |
| 41 | `9187f6f6` | 2025-11-02 | core | Preserve path components in OAuth issuer URLs | fix: preserve path components in OAuth issuer URLs (#12448) |
| 42 | `462c7d35` | 2025-11-02 | cli | Add response semantic color | feat(ui): add response semantic color (#12450) |
| 43 | `1ef34261` | 2025-11-03 | cli, a2a | Bump tar to 7.5.2 | chore: bump tar to 7.5.2 (#12466) |
| 44 | `93f14ce6` | 2025-11-03 | core | Split core system prompt into multiple parts | refactor: split core system prompt into multiple parts (#12461) |
| 45 | `19ea68b8` | 2025-11-03 | cli/tests | Refactor packages/cli/src/ui tests | Refactoring packages/cli/src/ui tests (#12482) |
| 46 | `9d642f3b` | 2025-11-03 | core | Improve error handling for setGlobalProxy | refactor(core): improve error handling for setGlobalProxy (#12437) |
| 47 | `c4377c1b` | 2025-11-03 | cli | Persist restart-required changes on ESC exit | fix(settings): persist restart-required changes when exiting with ESC (#12443) |
| 48 | `1c044ba8` | 2025-11-03 | cli | Respect ctrl+c for abort in NonInteractive | (fix): Respect ctrl+c signal for aborting execution in NonInteractive mode (#11478) |
| 49 | `2144d258` | 2025-11-03 | cli, core | Return empty map if token file missing | fix(auth): Return empty map if token file does not exits, and refacto… (#12332) |
| 50 | `ad33c223` | 2025-11-03 | cli, docs | Navigation shortcuts without scroll | Modify navigation and completion keyboard shortcuts to not use scroll. (#12502) |
| 51 | `bd06e5b1` | 2025-11-03 | package-lock | Bump vite to 7.1.12 | chore: bump vite to 7.1.12 (#12512) |
| 52 | `fc42c461` | 2025-11-03 | cli | Only show screen reader notice once | Only show screen reader notice once (#12247) |
| 53 | `f0c3c81e` | 2025-11-03 | core | Improve loop detection for longer patterns | fix(core): Improve loop detection for longer repeating patterns (#12505) |
| 54 | `b5315bfc` | 2025-11-03 | cli | Fix alt+left on ghostty | Fix alt+left on ghostty (#12503) |
| 55 | `ab730512` | 2025-11-04 | core | Replace hardcoded MCP OAuth port with dynamic | fix(mcp): replace hardcoded port 7777 with dynamic port allocation for OAuth (#12520) |
| 56 | `6ab1b239` | 2025-11-04 | cli/tests, core/tests | Refactor telemetry tests | refactor(core): Refactored and removed redundant test lines in telemetry (#12356) |
| 57 | `96d7eb29` | 2025-11-04 | integration-tests | Use canned response for flicker test | fix(infra) - Use canned response for flicker test (#12377) |
| 58 | `b8b66203` | 2025-11-04 | core | Tighten bash shell option handling | Tighten bash shell option handling (#12532) |
| 59 | `460c3deb` | 2025-11-04 | cli | Fix flicker in screen reader nudge | Fix flicker in screen reader nudge (#12541) |
| 60 | `f7966501` | 2025-11-04 | cli | Fix shift+tab when not in kitty mode | Fix shift+tab keybinding when not in kitty mode (#12552) |
| 61 | `75c2769b` | 2025-11-04 | integration-tests | Fix extension install tests | Ss/fix ext (#12540) |
| 62 | `fd885a3e` | 2025-11-05 | core | Fix googleQuotaErrors | fix(patch): cherry-pick f51d745 to release/v0.13.0-preview.0-pr-12586 to patch version v0.13.0-preview.0 and create version 0.13.0-preview.1 (#12595) |
| 63 | `ece06155` | 2025-11-05 | cli, core | Shell execution service fixes | fix(patch): cherry-pick 1611364 to release/v0.13.0-preview.1-pr-12587 to patch version v0.13.0-preview.1 and create version 0.13.0-preview.2 (#12601) |

---

## SKIP Table (Chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `5d87a7f9` | 2025-10-28 | cli | LLxprt has different todo implementation | Remove Todo Icon (#12190) |
| 2 | `372b5887` | 2025-10-28 | package.json | Version bump - nightly release | chore(release): bump version to 0.13.0-nightly.20251029.cca41edc (#12191) |
| 3 | `b31b786d` | 2025-10-29 | cli, core | LLxprt has DebugLogger, already migrated | refactor: Replace console.error with structured logging and feedback (#12175) |
| 4 | `121732dd` | 2025-10-29 | cli | LLxprt has different todo implementation | Hide collapsed Todo tray when they're all done. (#12242) |
| 5 | `2e003ad8` | 2025-10-29 | cli | LLxprt has different todo implementation | refactor(todo): improve performance and readability of todo component (#12238) |
| 6 | `66e981ed` | 2025-10-29 | core | ClearcutLogger - Google telemetry | feat(telemetry): Add auth_type to StartSessionEvent OTel logging (#12034) |
| 7 | `36207abe` | 2025-10-29 | core, docs | ClearcutLogger - Google telemetry | feat(telemetry): Add extensions to StartSessionEvent telemetry (#12261) |
| 8 | `6c8a48db` | 2025-10-29 | cli | LLxprt has different todo implementation | feat(ui): Fix Todo item text color not propagating for custom themes (#12265) |
| 9 | `06035d5d` | 2025-10-29 | cli, integration-tests | Gemini-specific API key dialog - LLxprt has multi-provider profile system | feat(auth): improve API key authentication flow (#11760) |
| 10 | `167b6ff8` | 2025-10-30 | cli | LLxprt has DebugLogger, already migrated | chore: migrate console.error to debugLogger in useSlashCompletion (#12218) |
| 11 | `42c79c64` | 2025-10-29 | core | tsconfig rootDir - then reverted | fix(core): Add rootDir to tsconfig.json to resolve TS5055 error (#12274) |
| 12 | `4d2a2de5` | 2025-10-30 | docs | Gemini-cli changelog | Docs: add v.0.11.0 to changelog (#12256) |
| 13 | `2a3244b1` | 2025-10-30 | core | ClearcutLogger - extension ID logging | Log extension ID with tool call/slash command invocation (#12254) |
| 14 | `054b4307` | 2025-10-30 | core | Revert tsconfig rootDir change | Revert "fix(core): Add rootDir to tsconfig.json to resolve TS5055 error" (#12293) |
| 15 | `135d981e` | 2025-10-30 | core | ClearcutLogger - line change metrics | Create line change metrics (#12299) |
| 16 | `c6a7107f` | 2025-10-30 | docs | Gemini-specific quota pricing doc | fixing minor formatting issues in quota-and-pricing.md (#11340) |
| 17 | `643f2c09` | 2025-10-30 | core | NO - LLxprt does not support model routing | Enable model routing for all users (#12300) |
| 18 | `3332703f` | 2025-10-30 | cli, core, docs | LLxprt has own ephemeral-based compression | Make compression threshold editable in the UI. (#12317) |
| 19 | `59e00eed` | 2025-10-30 | cli | LLxprt doesn't have context percentage in footer | Remove context percentage in footer by default (#12326) |
| 20 | `c89bc30d` | 2025-10-30 | .gemini | gemini-specific review command (uses .gemini/) | Code review script to catch common package/cli regressions (#12316) |
| 21 | `db37c715` | 2025-10-30 | package.json | Version bump - nightly | chore/release: bump version to 0.13.0-nightly.20251031.c89bc30d (#12330) |
| 22 | `f566df91` | 2025-10-30 | .github | Release workflow - dynamic run names | feat: add dynamic run-names to patch release workflows (#12336) |
| 23 | `e762cda5` | 2025-10-30 | .github, scripts | Release workflow fix | fix: Address silent failure in release-patch-1-create-pr workflow (#12339) |
| 24 | `12472ce9` | 2025-10-31 | core/tests | ClearcutLogger tests | refactor(core): Refactored and removed redundant test lines in teleme… (#12284) |
| 25 | `236334d0` | 2025-10-31 | core, docs | ClearcutLogger - extension name to ToolCallEvent | feat(telemetry): Add extension name to ToolCallEvent telemetry (#12343) |
| 26 | `6f69cdcc` | 2025-10-31 | cli | Minor --model clarification | chore: make clear that `--model` is for choosing model on startup (#12367) |
| 27 | `9da3cb7e` | 2025-10-31 | core | GCP log exporter - Google telemetry | fix(core): remove duplicate session_id in GCP log exporter (#12370) |
| 28 | `b31f6804` | 2025-10-31 | cli | LLxprt has DebugLogger, already migrated | chore: migrate console.error to debugLogger in usePromptCompletion (#12208) |
| 29 | `11e1e980` | 2025-10-31 | core | LLxprt has different ephemeral-based loop config | fix(core): ensure loop detection respects session disable flag (#12347) |
| 30 | `d13482e8` | 2025-10-31 | cli | LLxprt ephemerals don't require restart | Mark `model.compressionThreshold` as requiring a restart (#12378) |
| 31 | `31c5761e` | 2025-10-31 | core | Gemini-specific quota messages | refactor: simplify daily quota error messages (#12386) |
| 32 | `ab013fb7` | 2025-10-31 | core | LLxprt has DebugLogger, already migrated | migrating console.error to debugger for installationManager, oauth-provider, modifiable-tool (#12279) |
| 33 | `e9c7a80b` | 2025-10-31 | core | LLxprt has DebugLogger, already migrated | migrate console.error to coreEvents for mcp-client-manager and google-auth-provider (#12342) |
| 34 | `35f091bb` | 2025-10-31 | core | ClearcutLogger - slow rendering metric | feat(telemetry) - Add metric for slow rendering (#12391) |
| 35 | `fd2cbaca` | 2025-10-31 | core, integration-tests | NO - LLxprt does not support model routing | fix(core): prevent model router from overriding explicit model choice (#12399) |
| 36 | `b3cc397a` | 2025-10-31 | .github | gemini-automated-issue-triage.yml | feat(triage): overhaul automated issue triage workflow (#12365) |
| 37 | `59e0b10e` | 2025-11-03 | core | LLxprt needs configurable thinking via /set reasoning.* | Cap Thinking Budget to prevent runaway thought loops (#12416) |
| 38 | `265f24e5` | 2025-11-03 | cli, core | LLxprt handles model changes differently | fix(ui): ensure model changes update the UI immediately (#12412) |
| 39 | `1c185524` | 2025-11-03 | core | LLxprt has different subagent architecture | Enforce timeout for subagents  (#12232) |
| 40 | `60973aac` | 2025-11-03 | core | LLxprt has different subagent arch - CREATE FOLLOW-UP ISSUE | Grants subagent a recovery turn for when it hits TIMEOUT, MAX_TURNS or NO_TOOL_CALL failures.  (#12344) |
| 41 | `be1dc13b` | 2025-11-03 | core | ClearcutLogger - listing experiments | feat(core): Add support for listing experiments (#12495) |
| 42 | `7a515339` | 2025-11-03 | core | ClearcutLogger - recovery event logging | Log recovery events (nudges) that happens inside the subagent (#12408) |
| 43 | `60d2c2cc` | 2025-11-03 | core, docs | LLxprt has different todo implementation | Enable WriteTodos tool by default (#12500) |
| 44 | `1671bf77` | 2025-11-03 | cli | Alt buffer default - handled with `4fc9b1cd` | Alt buffer default (#12507) |
| 45 | `f3759381` | 2025-11-03 | core | Smart Edit timeout - Smart Edit removed | feat(core): add timeout to llm edit fix (#12393) |
| 46 | `2b77c1de` | 2025-11-04 | core | LLxprt has different todo - SI prompt nudge not relevant | SI prompt nudge for the todo tool (#12159) |
| 47 | `b6524e41` | 2025-11-04 | cli, core | LLxprt has DebugLogger, already migrated | migrate console.error to coreEvents/debugger for sandbox, logger, chatRecordingService (#12253) |
| 48 | `53c7646e` | 2025-11-04 | cli, core, docs | Codebase investigator enable - Google preview feature | enable codebase investigator by default for preview (#12555) |
| 49 | `da3da198` | 2025-11-04 | core | Remote experiments integration - Google-specific | feat(core): Integrate remote experiments configuration (#12539) |
| 50 | `25d7a803` | 2025-11-04 | package.json | Version bump - preview.0 | chore(release): v0.13.0-preview.0 |
| 51 | `13b443af` | 2025-11-05 | package.json | Version bump - preview.1 | chore(release): v0.13.0-preview.1 |
| 52 | `37670fe6` | 2025-11-05 | package.json | Version bump - preview.2 | chore(release): v0.13.0-preview.2 |
| 53 | `be36bf61` | 2025-11-06 | cli, core, docs | LLxprt has different todo implementation | fix(patch): cherry-pick 36feb73 to release/v0.13.0-preview.2-pr-12658 to patch version v0.13.0-preview.2 and create version 0.13.0-preview.3 (#12663) |
| 54 | `230056cc` | 2025-11-07 | package.json | Version bump - preview.3 | chore(release): v0.13.0-preview.3 |
| 55 | `72e48451` | 2025-11-07 | package.json | Version bump - final release | chore(release): v0.13.0 |

---

## REIMPLEMENT Table (Chronological)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | `c0495ce2` | 2025-11-02 | cli, core | Hook Configuration Schema - new system needs multi-provider review | feat(hooks): Hook Configuration Schema and Types (#9074) |
| 2 | `5062fadf` | 2025-11-02 | cli, scripts, .github | Settings schema autogeneration - may conflict with LLxprt's schema | chore: autogenerate settings documentation (#12451) |
| 3 | `80673a0c` | 2025-11-03 | core | Hook Type Decoupling - series continued | feat(hooks): Hook Type Decoupling and Translation (#9078) |
| 4 | `4fc9b1cd` | 2025-11-03 | cli, docs | Alternate buffer support - terminal-level changes, test carefully | alternate buffer support (#12471) |
| 5 | `b2591534` | 2025-11-03 | core | Hook Input/Output Contracts - series continued | feat(hooks): Hook Input/Output Contracts (#9080) |
| 6 | `cb2880cb` | 2025-11-03 | core | Hook Execution Planning - series continued | feat(hooks): Hook Execution Planning and Matching (#9090) |
| 7 | `da4fa5ad` | 2025-11-04 | cli, a2a, core | Extensions MCP refactor - major restructuring | Extensions MCP refactor (#12413) |
| 8 | `ffc5e4d0` | 2025-11-03 | cli, core | PolicyEngine to Core - LLxprt has existing policy engine | Refactor PolicyEngine to Core Package (#12325) |

---

## Commit Details Reference

For quick lookup during execution, here are the full SHAs:

### PICK commits (chronological) - 63 commits
```
706834ecd3c6449266de412539294f16c68473ce - PICK #1  - @command path handling
6e026bd9500d0ce5045b2e952daedf8c4af60324 - PICK #2  - security emitFeedback
c60d8ef5a861685f6f20a4e776aaaefdc1879b63 - PICK #3  - unskip read_many_files
3e9701861e9dc10fc6a28470069a63ebf6823c39 - PICK #4  - getPackageJson to core
42a265d2900a250bf75535bdcaba2a35c3eb609b - PICK #5  - atprocessor test Windows
82c10421a06f0e4934f44ce44e37f0a95e693b02 - PICK #6  - alt key mappings Mac
99f75f32184ecfc85bdef65f9ecb8d423479801f - PICK #7  - deprecated flag message
523274dbf34c6ea31c1060eae759aa06673b2f07 - PICK #8  - standardize error logging
77df6d48e23812e35272c4a21d89077a8cfcd049 - PICK #9  - keyboard shortcuts docs
1d9e6870befa21b9d4ca6c7d884c0a21a8549c7a - PICK #10 - granular memory loaders
c583b510e09ddf9d58cca5b6132bf19a8f5a8091 - PICK #11 - refactor ui tests
b8330b626ef9a134bee5089669751289a3c025c4 - PICK #12 - fix misreported lines
7d03151cd5b6a8ac208f0b22ad6e1f5fa3471390 - PICK #13 - install/link messages
a3370ac86bce6df706d9c57db15533db657ae823 - PICK #14 - validate command
b8969cceffbbba58b228d9c9bf12bfdd236efb0b - PICK #15 - fix docs extension install
d4cad0cdcc9a777e729e97d80a6f129dc267ba60 - PICK #16 - canned response JSON test
cc081337b7207df6640318931301101a846539b6 - PICK #17 - reload extensions MCP
54fa26ef0e2d77a0fbc2c4d3d110243d886d9b28 - PICK #18 - tests use act
b382ae6803ce21ead2a91682fc58126f3786f15b - PICK #19 - prevent self-imports
68afb7200e06507056b3321f9f1d9056ba95da45 - PICK #20 - compression threshold default
322feaafa62a1630ae1750d32efbb24ea9194463 - PICK #21 - decouple GeminiChat telemetry
ab8c24f5eab534697f26cf7da7a4f182c7665f3e - PICK #22 - Ink 6.4.0 fixes
f8ff921c426712232864ecd3fa2675c2c68a4580 - PICK #23 - update mcp-server.md
f875911af7d49055d583d86239e6fa2a01bdc471 - PICK #24 - remove testing-library/react
01ad74a8700d50356dff60719d761d5550f643dd - PICK #25 - user.email Google auth
f4ee245bf9c2383add94a76a12fbae9fb9225e5d - PICK #26 - ink@ 6.4.0
c158923b278685d99d340623dc2412b492721e58 - PICK #27 - policy engine docs
adddafe6d07eea74561bd71e88aef0ce2a546b4a - PICK #28 - untrusted folders
6ee7165e39bd4ee2ce68781c5a735a262cd160a1 - PICK #29 - slow rendering logging
d72f8453cbe4ebd2b0facc5dca9d87894ac214f4 - PICK #30 - remove jsdom dep
4b53b3a6e6e4e994195d569dc5a342f808382de5 - PICK #31 - telemetry.md flags
9478bca67db3e7966d6ab21f8ad1694695f20037 - PICK #32 - policy docs indexes
8b93a5f27d7c703f420001988f4cbd9beba7508b - PICK #33 - package-lock gitignore
f9df4153921034f276d3059f08af9849b3918798 - PICK #34 - release channel detection
61207fc2cbaa9a2e13845272f7edf0f15970d5fb - PICK #35 - string width Ink
f8ce3585eb60be197874f7d0641ee80f1e900b24 - PICK #36 - Ink updates
caf2ca1438c1a413ee978c97a41ce4e9f818fa9f - PICK #37 - kitty function keys
e3262f8766d73a281fbc913c7a7f6d876c7cb136 - PICK #38 - gitignore/geminiignore
d7243fb81f749ff32b9d37bfe2eb61068b0b2af3 - PICK #39 - DarkGray ColorTheme
02518d2927d16513dfa05257e1a2025d9123f3d1 - PICK #40 - command-line flag docs
9187f6f6d1b96c36d4d2321af46f1deedab60aa3 - PICK #41 - OAuth issuer URLs
462c7d350257d45981e69c39a38a087c812fa019 - PICK #42 - response semantic color
1ef34261e09a6b28177c2a46384b19cfa0b5bea0 - PICK #43 - bump tar 7.5.2
93f14ce626f68a7bf962e7ac8423bfb70a62c6f2 - PICK #44 - split system prompt
19ea68b838e10fe16950ac0193f3de49f067e669 - PICK #45 - refactor ui tests
9d642f3bb1dcf8380822b025adabb06262364ef2 - PICK #46 - setGlobalProxy error
c4377c1b1af84086f888915a93b56b5910396049 - PICK #47 - persist settings ESC
1c044ba8afa9e51ba5485394541c8739ba6be110 - PICK #48 - ctrl+c NonInteractive
2144d25885b408bb88531fbc2ad44a98aeb1481d - PICK #49 - empty map token file
ad33c22374fd88656f0785d1f9ad728bdac9075d - PICK #50 - nav shortcuts no scroll
bd06e5b161f72add52958f5cdc336c78ba401134 - PICK #51 - bump vite 7.1.12
fc42c4613f05d9ffc17fa403d0b8e87737f2269d - PICK #52 - screen reader once
f0c3c81e94f04720daf0661b28369e8699a1266a - PICK #53 - loop detection patterns
b5315bfc208c754eea1204260bdbe0d10c14819b - PICK #54 - alt+left ghostty
ab73051298b53d7748e93b88d439e775b08a7bac - PICK #55 - dynamic MCP OAuth port
6ab1b239ca8d89d689e2b863181a9d041159728c - PICK #56 - refactor telemetry tests
96d7eb296601e3da583f8c2da6bcac3745fbef68 - PICK #57 - canned flicker test
b8b6620365ba494780c4172fcd21782e25796d77 - PICK #58 - bash shell options
460c3debf5ec73f0652a496254ad9b5b3622caf7 - PICK #59 - screen reader flicker
f79665012231a7979c3c6c5b652614d0f928ab33 - PICK #60 - shift+tab non-kitty
75c2769b322dfd2834a4b0379ae0c6002eebbc33 - PICK #61 - extension install tests
fd885a3e50e3c88bba6b5b2ee03a76b7c514ff29 - PICK #62 - googleQuotaErrors fix
ece06155cc49776839a137bef87f05c3909312be - PICK #63 - shell execution fixes
```

### REIMPLEMENT commits - 8 commits
```
c0495ce2f93a48dff801acdd58743f138e5b419c - REIMPLEMENT #1 (Hook Config Schema)
5062fadf8767de5531a0a1577946d0e8227117a6 - REIMPLEMENT #2 (Settings autogen)
80673a0c0c11a69d3b3b60a5e8d8050459f0574d - REIMPLEMENT #3 (Hook Translator)
4fc9b1cde298f7681beb93485c1c9993482ed717 - REIMPLEMENT #4 (Alt buffer)
b25915340325fbb72366fce3e9db82580136c3a4 - REIMPLEMENT #5 (Hook I/O)
cb2880cb93e9797f3b97319323ce437a7fee9671 - REIMPLEMENT #6 (Hook Planner)
da4fa5ad75ccea4d8e320b1c0d552614e654f806 - REIMPLEMENT #7 (Extensions MCP)
ffc5e4d048ffa5e93af56848aa315fd4338094bb - REIMPLEMENT #8 (PolicyEngine)
```
