# CHERRIES.md — gmerge-0.18.4 (upstream v0.17.1 → v0.18.4)

## Counts

| Decision    | Count |
| ----------- | ----: |
| PICK        |    26 |
| SKIP        |    28 |
| REIMPLEMENT |    10 |
| **Total**   |    64 |

## Decision Notes

### Recurring Themes

- **Release/version bump commits**: All `chore(release)` and nightly version bumps are SKIP. LLxprt has its own versioning.
- **ClearcutLogger / Google telemetry**: SKIP per standing policy — all ClearcutLogger has been removed from LLxprt.
- **FlashFallback / quota fallback**: SKIP — FlashFallback is disabled and slated for removal in LLxprt.
- **Gemini-specific docs** (gemini-3.md, model.md): SKIP unless they document features we expose through multi-provider.
- **Reverted commit pairs**: Both the original and its revert are SKIP (net-zero).
- **Banner / branding design**: SKIP when purely cosmetic/Gemini-branded. LLxprt has its own banner.
- **Model config infrastructure (257cd07a, 8e531dc0)**: SKIP — upstream's single-provider model config service is incompatible with LLxprt's multi-provider routing. LLxprt's profile system is already superior. See #1329.
- **Gemini 3 thinking (8c07ad2a, 9b6d47fd)**: SKIP — LLxprt handles thinking in the provider layer (GeminiProvider.ts), not geminiChat.ts. Gap tracked in issue #1330.
- **Model profile display (8e531dc0)**: SKIP — tracked in issue #1329 for LLxprt-native implementation.
- **Patch cherry-picks to release branch**: These bring real bug fixes and features; evaluated individually.
- **Tool naming**: `write_todos` in upstream maps to `todo_write` in LLxprt; commit 0f845407 will need tool name adaptation during cherry-pick.
- **stdout/stderr protection (d1e35f86)**: Large (82 files) but high-value — PICK as solo batch. Creates `stdio.ts` in cli; later patch `2e8d7831` moves it to core.
- **genai dependency bump (25f84521)**: LLxprt currently at 1.16.0, upstream bumps to 1.30.0. PICK — the MCP/prompt changes are coupled to the new API.
- **User email in about box (43d6dc36)**: SKIP — Google-specific auth telemetry, not appropriate for LLxprt.
- **Refactoring philosophy**: Where upstream has refactored monolithic components (e.g. ToolMessage → ToolShared + ToolResultDisplay, AppHeader → useBanner, kittyProtocolDetector → synchronous writes), LLxprt should follow suit even if our code diverged. REIMPLEMENT to adopt the cleaner structure.

---

## PICK Table (chronological)

| #  | Upstream SHA      | Date       | Areas                            | Decision | Rationale                                                    | Subject                                                                       |
| -- | ----------------: | ---------- | -------------------------------- | -------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1  | `fd9d3e19a9190dbb` | 2025-11-18 | docs                             | PICK     | Trivial docs fix, applies cleanly                            | Remove obsolete reference to "help wanted" label in CONTRIBUTING.md (#13291)   |
| 2  | `b916d79fe2c151b8` | 2025-11-18 | cli, ui                          | PICK     | Keyboard regex fix; LLxprt's code matches upstream's "before" state | Improve keyboard code parsing (#13307)                                         |
| 3  | `10003a6490ab1db1` | 2025-11-18 | cli, zed                         | PICK     | IDE integration fix — LLxprt has full IDE support             | fix(core): Ensure `read_many_files` tool is available to zed (#13338)          |
| 4  | `90c764ce13ef511a` | 2025-11-18 | cli, ui                          | PICK     | modifyOtherKeys support; builds on b916d79f                   | Support 3-parameter modifyOtherKeys sequences (#13342)                         |
| 5  | `c5498bbb07f7a168` | 2025-11-18 | core                             | PICK     | Trivial refactor of pty resize error handling                 | Improve pty resize error handling for Windows (#13353)                          |
| 6  | `e8d0e0d342b115d8` | 2025-11-18 | cli, config, docs                | PICK     | Bug fix — wrong default for showLineNumbers setting           | bug(ui) showLineNumbers had the wrong default value (#13356)                   |
| 7  | `1e8ae5b9d7c9d9bf` | 2025-11-18 | cli, ui                          | PICK     | Crash fix in NO_COLOR mode                                    | fix(cli): fix crash on startup in NO_COLOR mode (#13343) (#13352)              |
| 8  | `61f0f3c243e1038b` | 2025-11-19 | cli, mcp                         | PICK     | MCP prompt fix — spaces in names                              | fix: allow MCP prompts with spaces in name (#12910)                            |
| 9  | `5c47592159ba22e9` | 2025-11-19 | core, mcp                        | PICK     | MCP transport refactor — less code duplication                | Refactor createTransport to duplicate less code (#13010)                       |
| 10 | `0d89ac74064ffae1` | 2025-11-19 | cli, config, sessions            | PICK     | Config/session utility fixes + 692 lines of new tests         | Followup from #10719 (#13243)                                                  |
| 11 | `e1c711f5ba13db50` | 2025-11-19 | cli, core, sessions              | PICK     | Records errors/warnings in chat sessions — useful for debugging | feat(sessions): record interactive-only errors and warnings to chat recording (#13300) |
| 12 | `300205b07c2e42c5` | 2025-11-19 | cli, zed                         | PICK     | IDE integration fix — cancellation handling                   | fix(zed-integration): Correctly handle cancellation errors (#13399)            |
| 13 | `84573992b4222d7d` | 2025-11-19 | cli, ui, keyboard                | PICK     | Keyboard mode restoration fix after editor exits              | Restore keyboard mode when exiting the editor (#13350)                         |
| 14 | `25f845212799c3ba` | 2025-11-19 | cli, core, deps                  | PICK     | genai 1.16→1.30; coupled MCP/prompt API changes              | feat(core, cli): Bump genai version to 1.30.0 (#13435)                        |
| 15 | `f8a862738d12ba6a` | 2025-11-20 | cli, ui                          | PICK     | Keep header colored on non-gradient terminals                 | [cli-ui] Keep header ASCII art colored on non-gradient terminals (#13373)      |
| 16 | `0f845407f1b77acd` | 2025-11-20 | core, tools                      | PICK     | Typo fix in write_todos + fileSearch fix; adapt tool name     | Fix typo in write_todos methodology instructions (#13411)                      |
| 17 | `e4c4bb26e2d168c` | 2025-11-19 | core, client                     | PICK     | Thinking mode logic improvement for Gemini models             | feat: update thinking mode support to exclude gemini-2.0 models (#13454)       |
| 18 | `d0a845b6e6c805ba` | 2025-11-19 | cli, ui                          | PICK     | Remove unneeded console log                                   | remove unneeded log (#13456)                                                   |
| 19 | `6c126b9e58c6b5d0` | 2025-11-20 | cli, zed                         | PICK     | Zed integration classified as interactive                     | fix(zed-integration): Ensure that the zed integration is classified as interactive (#13394) |
| 20 | `4adfdad47fdcc799` | 2025-11-20 | cli                              | PICK     | GitHub setup improvement                                      | Copy commands as part of setup-github (#13464)                                 |
| 21 | `d1e35f866063f8b6` | 2025-11-20 | cli, core, a2a-server, tests     | PICK     | **SOLO/HIGH-RISK** — 82 files; stdout/stderr protection       | Protect stdout and stderr so JavaScript code can't accidentally write to stdout (#13247) |
| 22 | `ade9dfeebbe12ce3` | 2025-11-20 | cli, config                      | PICK     | Preview features toggle without restart                       | Enable switching preview features on/off without restart (#13515)              |
| 23 | `c7b5dcd28fe2b0f2` | 2025-11-20 | core, config, docs               | PICK     | Compression threshold change for API key users                | Change default compress threshold to 0.5 for api key users (#13517)            |
| 24 | `d15970e12c000f4b` | 2025-11-20 | cli, ui                          | PICK     | Remove duplicated mouse handling code                         | remove duplicated mouse code (#13525)                                          |
| 25 | `83d0bdc32e997d4b` | 2025-11-20 | cli, zed                         | PICK     | Default model routing for Zed                                 | feat(zed-integration): Use default model routing for Zed integration (#13398)  |
| ~~26~~ | ~~`843b019cef382b2c`~~ | ~~2025-11-25~~ | — | — | Moved to REIMPLEMENT table (loading indicator hooks diverged, LLxprt has WittyPhraseStyle) | — |
| 27 | `4b19a83388edb1b0` | 2025-11-26 | core, deps                       | PICK     | Patch: MCP dependency bump + mcp-client test fix              | fix(patch): cherry-pick d2a6cff — dependency bump, mcp-client (#13863)         |

---

## SKIP Table (chronological)

| #  | Upstream SHA      | Date       | Areas                   | Decision | Rationale                                                    | Subject                                                                            |
| -- | ----------------: | ---------- | ----------------------- | -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1  | `379f09d92fba7484` | 2025-11-18 | release                 | SKIP     | Nightly version bump — LLxprt has own versioning             | chore(release): v0.18.0-nightly.20251118.86828bb56 (#13309)                        |
| 2  | `7cc5234b9c70a253` | 2025-11-18 | docs                    | SKIP     | Gemini 3 access docs — Google-specific                       | Docs: Access clarification (#13304)                                                |
| 3  | `36b0a86c6935e553` | 2025-11-18 | docs                    | SKIP     | Gemini 3 docs link fixes — Google-specific                   | Fix links in Gemini 3 Pro documentation (#13312)                                   |
| 4  | `282654e7b8c3274e` | 2025-11-19 | core, telemetry         | SKIP     | ClearcutLogger (Google telemetry) — removed from LLxprt      | Capturing github action workflow name if present and send it to clearcut (#13132)   |
| 5  | `3f8d63650123d53c` | 2025-11-19 | docs                    | SKIP     | Gemini Code Wiki link in README — Google-specific             | docs: Add Code Wiki link to README (#13289)                                        |
| 6  | `b2a2ea3633d69492` | 2025-11-19 | legal                   | SKIP     | Fix Copyright in LICENSE — LLxprt has own LICENSE             | Fix Copyright line in LICENSE (#13449)                                             |
| 7  | `43d6dc36686cdec6` | 2025-11-19 | cli, core, ui           | SKIP     | Adds Google account email to about box — privacy concern, Google-specific auth | Add User email detail to about box (#13459)                                        |
| 8  | `ff725dea41dd9ed6` | 2025-11-19 | core, routing           | SKIP     | Reverted by 049a299b — net-zero                              | feat(core): Fix bug with incorrect model overriding (#13477)                       |
| 9  | `c3f1b29c1e290b6a` | 2025-11-19 | release                 | SKIP     | Nightly version bump                                         | chore/release: bump version to 0.18.0-nightly.20251120.2231497b1 (#13476)          |
| 10 | `3476a97acc490ad2` | 2025-11-20 | build                   | SKIP     | Reverted by 98cdaa01 — net-zero                              | build bun                                                                          |
| 11 | `98cdaa01b8808cb6` | 2025-11-20 | build                   | SKIP     | Revert of 3476a97a — net-zero                                | Revert "build bun"                                                                 |
| 12 | `049a299b9214521f` | 2025-11-20 | core, routing           | SKIP     | Revert of ff725dea — net-zero                                | Revert "feat(core): Fix bug with incorrect model overriding." (#13483)             |
| 13 | `e20d282088f77bb2` | 2025-11-20 | cli, ui                 | SKIP     | Banner design update — Gemini branding, LLxprt has own       | Update banner design (#13420)                                                      |
| 14 | `8c07ad2ab905cd9c` | 2025-11-20 | core                    | SKIP     | Gemini 3 thinking level in geminiChat.ts — LLxprt does this in provider layer. See #1330 | feat(core): Use thinking level for Gemini 3 (#13445)                               |
| 15 | `8e531dc029d0f5c6` | 2025-11-20 | core, config, docs      | SKIP     | No model config infra in LLxprt. Model display tracked in #1329 | feat(core): Incorporate Gemini 3 into model config hierarchy (#13447)              |
| 16 | `179010eb3b21ec87` | 2025-11-20 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.0-preview.0                                                  |
| 17 | `80ef6f854bb52b59` | 2025-11-22 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.0-preview.1                                                  |
| 18 | `313688fd1869a37c` | 2025-11-25 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.0-preview.2                                                  |
| 19 | `9f55fb50108fa7be` | 2025-11-25 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.0-preview.3                                                  |
| 20 | `a640766f10de6613` | 2025-11-25 | core, cli, fallback     | SKIP     | FlashFallback/quota fallback — disabled and slated for removal | fix(patch): cherry-pick d8a3d08 — ProQuotaDialog, fallback handler (#13826)        |
| 21 | `7beccfa03c145394` | 2025-11-25 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.0-preview.4                                                  |
| 22 | `f01890b0730f109e` | 2025-11-26 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.0                                                            |
| 23 | `236af8bb0afc3982` | 2025-11-26 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.1                                                            |
| 24 | `8c9b49ce8a91237e` | 2025-11-26 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.2                                                            |
| 25 | `9b6d47fd52fd3051` | 2025-11-26 | core                    | SKIP     | Gemini 3 thinkingLevel fix in geminiChat.ts — LLxprt has no Gemini 3 thinking in geminiChat. See #1330 | fix(patch): cherry-pick fe67ef6 — geminiChat thinkingLevel fix (#13862)             |
| 26 | `3f4d5c07b3889086` | 2025-11-26 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.3                                                            |
| 27 | `257cd07a3a89e606` | 2025-11-19 | core, agents, config, model-routing | SKIP | Upstream's single-provider model config service (sendMessageStream signature change, ModelConfigKey, runtimeAliases) is incompatible with LLxprt's multi-provider routing. LLxprt's profile system is already superior. See #1329 | feat(core): Wire up chat code path for model configs (#12850) |
| 28 | `61227ea90a73be86` | 2025-11-26 | release                 | SKIP     | Release version tag                                          | chore(release): v0.18.4                                                            |

---

## REIMPLEMENT Table (chronological)

| #  | Upstream SHA      | Date       | Areas                                | Decision     | Rationale                                                                            | Subject                                                        |
| -- | ----------------: | ---------- | ------------------------------------ | ------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1  | `b644f037a3f4e28b` | 2025-11-19 | cli, ui                              | REIMPLEMENT  | LLxprt already handles Escape but cancel handler has different signature (`() => void` vs `(shouldRestorePrompt?) => void`). Want the "Escape while idle clears input" behavior adapted to LLxprt's architecture. | fix(ui): Clear input prompt on Escape key press (#13335)       |
| 2  | `2231497b1f62a08d` | 2025-11-19 | cli, ui (17 files, 1071+/415-)       | REIMPLEMENT  | Major refactor: ToolMessage split into ToolShared+ToolResultDisplay, new useMouseClick hook, ShellToolMessage refactor. LLxprt should adopt the cleaner component structure AND add click-to-focus. Not a monolith-preserving skip. | feat: add click-to-focus support for interactive shell (#13341) |
| ~~3~~ | ~~`257cd07a3a89e606`~~ | ~~2025-11-19~~ | — | — | Moved to SKIP table (upstream's single-provider model config is incompatible with LLxprt's multi-provider routing) | — |
| 4  | `9ebf3217174e8076` | 2025-11-19 | cli, ui, keyboard                    | REIMPLEMENT  | LLxprt's kittyProtocolDetector.ts is significantly restructured vs upstream (no SGR mouse, different functions). Apply the fs.writeSync pattern + try/catch to our own file, improve code quality along the way. | Use synchronous writes when detecting keyboard modes (#13478)  |
| 5  | `b1258dd52c9ca571` | 2025-11-20 | cli, ui                              | REIMPLEMENT  | LLxprt's cancel handler is `() => void` with `inputHistoryStore` (not `userMessages`). The race condition may exist but fix must use our architecture. | fix(cli): prevent race condition when restoring prompt after context overflow (#13473) |
| 6  | `1d2e27a69897bb30` | 2025-11-20 | cli, core, config                    | REIMPLEMENT  | System instruction update on memory reload — maps to LLXPRT.md. Need to verify LLxprt's memory loading path. | Fix: Update system instruction when GEMINI.md memory is loaded (#12136) |
| 7  | `316349ca61ffb10e` | 2025-11-21 | cli, config, integration-tests       | REIMPLEMENT  | LLxprt already has alternate buffer (differently implemented — in AppContainer.tsx and inkRenderOptions.ts, not a separate hook). Want the default-to-false change and the `=== true` check pattern. | fix(patch): cherry-pick 5e218a5 — settingsSchema, useAlternateBuffer (#13626) |
| 8  | `ea3d022c8b9ec2de` | 2025-11-25 | cli, ui                              | REIMPLEMENT  | LLxprt has no useBanner.ts or persistentState.ts. The refactoring of banner state into a hook with per-content SHA256 tracking is good architecture — adopt the pattern, not just the branding. | fix(patch): cherry-pick 3e50be1 — AppHeader, useBanner, persistentState (#13821) |
| 9  | `013f984842aa8ca8` | 2025-11-26 | cli, extensions (30 files)           | REIMPLEMENT  | HIGH PRIORITY. Extensions need `exitCli()` pattern (clean shutdown), depends on stdout protection (d1e35f86). LLxprt has extensions but implemented differently. Adopt the exitCli and initializeOutputListenersAndFlush middleware. | fix(patch): cherry-pick bdf80ea — extensions commands refactor (#13861) |
| 10 | `843b019cef382b2c` | 2025-11-25 | cli, ui                              | REIMPLEMENT  | LLxprt's usePhraseCycler/useLoadingIndicator have diverged (WittyPhraseStyle system, phrasesCollections). Upstream adds useInactivityTimer + shell focus hints. Cherry-pick would conflict badly. Take the new hooks, keep LLxprt's phrase style system. | fix(patch): cherry-pick d351f07 — loading indicator + phrase cycler (#13813) |
| 11 | `2e8d7831c6a72d84` | 2025-11-26 | cli, core, auth (17 files)           | REIMPLEMENT  | Auth dialog is completely different (different path, multi-provider). Take the stdio→core move, terminal.ts utility, non-auth improvements. Drop auth dialog changes. | fix(patch): cherry-pick 030a5ac — cli/auth/stdio/terminal (#13869) |

---

## Issues Created

| Issue | Title | Related commits |
| ----- | ----- | --------------- |
| [#1329](https://github.com/vybestack/llxprt-code/issues/1329) | Display model profile/provider name on each message | `8e531dc0` (SKIP) |
| [#1330](https://github.com/vybestack/llxprt-code/issues/1330) | GeminiProvider: support thinkingLevel for Gemini 3 | `8c07ad2a`, `9b6d47fd` (SKIP) |
