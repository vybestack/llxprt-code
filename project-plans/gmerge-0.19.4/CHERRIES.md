# CHERRIES.md — gmerge-0.19.4 (upstream v0.18.4 → v0.19.4)

## Counts

| Decision    | Count |
| ----------- | ----: |
| PICK        |    22 |
| SKIP        |    47 |
| REIMPLEMENT |     2 |
| **Total**   |    71 |

## Decision Notes

### Recurring Themes

- **Release/version bump commits**: All `chore(release)` and nightly version bumps are SKIP (12 total). LLxprt has its own versioning.
- **ClearcutLogger / Google telemetry**: SKIP — all ClearcutLogger has been removed from LLxprt. Commits `64eb14ab` and `9f9a2fa8` touch exclusively clearcut-logger code.
- **FlashFallback / quota fallback**: SKIP — FlashFallback is disabled and slated for removal in LLxprt. Commits `d8a3d08f` and `404a4468` deal with flash fallback for TerminalQuota errors.
- **Smart Edit**: Removed from LLxprt. Commits touching only smart-edit handled via conflict resolution.
- **useModelRouter removal** (`99c5bf2e`): SKIP — we already removed useModelRouter; this commit also removes smart-edit tests we don't have.
- **Hook system (upstream)**: SKIP — upstream adds a 4-part hook system (`f6ee025c`, `20340987`, `5411f4a6`, `f6d97d44`). LLxprt already has its own independent hook system (hookRegistry, hookPlanner, hookRunner, hookTranslator). The upstream hook telemetry is local observability (not send-to-Google), but integrating it into our architecture would be significant work for marginal value.
- **Model availability service** (`aeffa2a4`, `87712a0a`, `c8540b57`): SKIP — 100% Gemini-model-specific infrastructure. Hardcoded fallback chains for gemini-3 → gemini-2.5-pro → gemini-2.5-flash. LLxprt handles provider/model failures at the provider level.
- **Chat compression migration** (`e50bf6ad`, `ba0e053f`): SKIP — LLxprt has a far more sophisticated compression system (4 pluggable strategies, multi-provider, deterministic compression without LLM calls, profile-based model selection). Upstream is just reorganizing model selection for Gemini-only.
- **Session browser / resume**: SKIP — tracked by #1385, blocked on #1361 (session recording service redesign). Upstream session browser, /resume command, session docs, and session test patches all depend on infrastructure being redesigned.
- **Databricks auth / custom headers** (`acf5ed59`): SKIP — solves a Gemini-specific proxy problem (routing through Databricks gateway). Custom headers concept could be useful but better handled per-provider in our architecture.
- **Big CLI test coverage** (`95693e26`): SKIP — 5,126 lines across 47 files, but 8 new test files target source files that don't exist in LLxprt (different paths), 10 existing test modifications would massively conflict. Real bug fix (`readStdin.ts`) taken standalone. File coverage improvement issue separately.
- **Extension docs** (`19d4384f`): REIMPLEMENT — our extension docs are 95 lines vs upstream's 277 lines. Need comprehensive LLxprt extension management CLI documentation.
- **README badge update** (`03845198`): SKIP — upstream-specific branding.

---

## PICK Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
| --- | ----------: | ---- | ----- | -------- | --------- | ------- |
| 1 | `9937fb22` | 2025-11-20 | core, mcp | PICK | MCP schema validation improvement; affects mcp-client.ts | Use lenient MCP output schema validator (#13521) |
| 2 | `fec0eba0` | 2025-11-20 | cli, core | PICK | Moves stdio utils to core; improves architecture | move stdio (#13528) |
| 3 | `78b10dcc` | 2025-11-20 | core | PICK | Skip pre-commit hooks for shadow repo; useful git service improvement | Skip pre-commit hooks for shadow repo (#13331) (#13488) |
| 4 | `5982abef` | 2025-11-21 | cli | PICK | Fix wide-character cursor positioning; UI bug fix | fix(ui): Correct mouse click cursor positioning for wide characters (#13537) |
| 5 | `613b8a45` | 2025-11-20 | core | PICK | Bash prompt detection fix; shell-utils improvement | fix(core): correct bash @P prompt transformation detection (#13544) |
| 6 | `0f0b463a` | 2025-11-21 | docs, cli, core | PICK | Typo fixes across codebase; low-risk cleanup | docs: fix typos in source code and documentation (#13577) |
| 7 | `3370644f` | 2025-11-21 | cli | PICK | Zed integration tests: 1,121 lines added for connection, fileSystemService, zedIntegration; we have 27 lines of coverage | Improved code coverage for cli/src/zed-integration (#13570) |
| 8 | `030a5ace` | 2025-11-21 | cli, core | PICK | Auth flow bug fixes including restart support; important fix | Fix multiple bugs with auth flow including using the implemented but unused restart support (#13565) |
| 9 | `d351f077` | 2025-11-21 | cli | PICK | Custom loading phrases when shell requires input; UX improvement | feat: custom loading phrase when interactive shell requires input (#12535) |
| 10 | `0713c86d` | 2025-11-21 | docs, schemas, scripts | PICK | Multiline JS object rendering in config docs; docs improvement | feat(docs): Ensure multiline JS objects are rendered properly (#13535) |
| 11 | `1e715d1e` | 2025-11-21 | cli | PICK | Restore bracketed paste after editor exit; important terminal fix | Restore bracketed paste mode after external editor exit (#13606) |
| 12 | `8c36b106` | 2025-11-21 | core | PICK | Add `BaseLlmClient.generateContent`; enhances base LLM client | feat(core): Add `BaseLlmClient.generateContent` (#13591) |
| 13 | `5e218a56` | 2025-11-21 | cli, docs, schemas | PICK | Turn off alternate buffer mode by default; UX improvement | Turn off alternate buffer mode by default (#13623) |
| 14 | `bdf80ea7` | 2025-11-21 | cli | PICK | Prevent stdout/stderr patching for extension commands; bug fix | fix(cli): Prevent stdout/stderr patching for extension commands (#13600) |
| 15 | `b3fcddde` | 2025-11-21 | deps | PICK | Update ink to 6.4.6; dependency update | Update ink version to 6.4.6 (#13631) |
| 16 | `7350399a` | 2025-11-24 | core | PICK | Fix context window overflow warning for PDF files; bug fix | fix(core): Fix context window overflow warning for PDF files (#13548) |
| 17 | `569c6f1d` | 2025-11-24 | cli | PICK | Improve extension explore messaging; UX improvement | feat: rephrasing the extension logging messages (#13740) |
| 18 | `d53a5c4f` | 2025-11-25 | cli, core, config | PICK | Minor config/package.json improvements; low-risk fixes | fix: (some minor improvements to configs and getPackageJson return behaviour) (#12510) |
| 19 | `d14779b2` | 2025-11-24 | core | PICK | Add bool for alternate system prompt; useful feature | feat(core): Land bool for alternate system prompt (#13764) |
| 20 | `2b41263a` | 2025-11-25 | schemas, scripts | PICK | Add $schema property to settings.schema.json; schema improvement | fix: Add $schema property to settings.schema.json (#12763) |
| 21 | `f2c52f77` | 2025-11-26 | cli | PICK | Allow non-GitHub SCP-styled URLs for extensions; feature enhancement | fix(cli): allow non-GitHub SCP-styled URLs for extension installation (#13800) |
| 22 | `6f9118dc` | 2025-11-25 | cli | PICK | Fix URL.parse for Node.js < v22; compatibility fix | Fix TypeError: "URL.parse is not a function" for Node.js < v22 (#13698) |

---

## SKIP Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
| --- | ----------: | ---- | ----- | -------- | --------- | ------- |
| 1 | `3e50be16` | 2025-11-20 | cli | SKIP | Banner persistence state tracking — LLxprt has different banner logic | Update persistence state to track counts of messages instead of times banner has been displayed (#13428) |
| 2 | `f92e79eb` | 2025-11-20 | docs | SKIP | Upstream-specific HTTP proxy docs referencing gemini-cli config paths | update docs for http proxy (#13538) |
| 3 | `85bc25a7` | 2025-11-20 | release | SKIP | Nightly version bump | chore(release): bump version to 0.19.0-nightly.20251120 (#13540) |
| 4 | `61582678` | 2025-11-20 | cli | SKIP | Test coverage for cli/src/config; mostly test-only, high conflict risk with divergent config | Optimize and improve test coverage for cli/src/config (#13485) |
| 5 | `8d082a90` | 2025-11-20 | cli | SKIP | Privacy notice test coverage; LLxprt has different privacy notices | Improve code coverage for cli/src/ui/privacy package (#13493) |
| 6 | `b9766155` | 2025-11-21 | cli | SKIP | Session browser component; tracked by #1385, blocked on #1361 | feat(ui): build interactive session browser component (#13351) |
| 7 | `030a5ace` | — | — | — | (this is a PICK, listed above) | — |
| 8 | `aeffa2a4` | 2025-11-21 | core | SKIP | Gemini-only model health tracking; hardcoded Gemini model states | feat(core): add modelAvailabilityService for managing and tracking model health (#13426) |
| 9 | `d72f35c2` | 2025-11-22 | docs | SKIP | Grammar fix in tutorials.md; trivial upstream doc fix | docs: fix grammar typo "a MCP" to "an MCP" (#13595) |
| 10 | `fe67ef63` | 2025-11-21 | core | SKIP | Thinking budget on fallback to 2.5; Gemini-specific fallback logic | bug(core): Ensure we use thinking budget on fallback to 2.5 (#13596) |
| 11 | `99c5bf2e` | 2025-11-21 | cli, core, docs | SKIP | Remove useModelRouter flag; already removed in LLxprt + touches smart-edit + clearcut | Remove useModelRouter experimental flag (#13593) |
| 12 | `64eb14ab` | 2025-11-21 | cli, core | SKIP | ClearcutLogger experiment ID logging; telemetry removed from LLxprt | Fix exp id logging (#13430) |
| 13 | `9f9a2fa8` | 2025-11-21 | core | SKIP | ClearcutLogger client ID logging; telemetry removed from LLxprt | Moved client id logging into createBasicLogEvent (#13607) |
| 14 | `42c2e1b2` | 2025-11-21 | core, cli, docs | SKIP | Custom aliases for model configs; requires modelConfigService.ts which doesn't exist in LLxprt | feat(core): Add support for custom aliases for model configs (#13546) |
| 15 | `e205a468` | 2025-11-22 | cli | SKIP | Test coverage for UI components; massive test-only commit, high conflict risk | Improve test coverage for cli/src/ui/components (#13598) |
| 16 | `dadd606c` | 2025-11-21 | release | SKIP | Nightly version bump | chore/release: bump version to 0.19.0-nightly.20251122 (#13637) |
| 17 | `e177314a` | 2025-11-22 | release | SKIP | Nightly version bump | chore/release: bump version to 0.19.0-nightly.20251123 (#13675) |
| 18 | `c2a741ee` | 2025-11-23 | release | SKIP | Nightly version bump | chore/release: bump version to 0.19.0-nightly.20251124 (#13713) |
| 19 | `95693e26` | 2025-11-24 | cli | SKIP | Massive test coverage commit (5,126 lines, 47 files); 8 test files target missing source, 10 would massively conflict; readStdin fix taken standalone | Improve code coverage for cli package (#13724) |
| 20 | `e50bf6ad` | 2025-11-24 | core, docs, schemas | SKIP | Chat compression migration; LLxprt has completely different multi-strategy compression system | feat(core): Migrate chatCompressionService to model configs (#12863) |
| 21 | `f6ee025c` | 2025-11-24 | core | SKIP | Hook telemetry infrastructure; LLxprt has independent hook system | feat(hooks): Hook Telemetry Infrastructure (#9082) |
| 22 | `20340987` | 2025-11-24 | core | SKIP | Hook event handling; LLxprt has independent hook system | feat(hooks): Hook Event Handling (#9097) |
| 23 | `5411f4a6` | 2025-11-24 | core, cli | SKIP | Hook agent lifecycle; LLxprt has independent hook system | feat(hooks): Hook Agent Lifecycle Integration (#9105) |
| 24 | `ba0e053f` | 2025-11-24 | core, docs, schemas | SKIP | Default chat compression config; depends on compression migration we're skipping | bug(core): Add default chat compression config (#13766) |
| 25 | `87712a0a` | 2025-11-24 | core | SKIP | Hardcoded Gemini model fallback chains; LLxprt handles failures per-provider | feat(model-availability): introduce ModelPolicy and PolicyCatalog (#13751) |
| 26 | `f6d97d44` | 2025-11-24 | — | SKIP | Empty commit (no file changes) | feat(hooks): Hook System Orchestration (#9102) |
| 27 | `c8540b57` | 2025-11-24 | cli, core, docs | SKIP | isModelAvailabilityServiceEnabled setting; model availability skipped | feat(config): add isModelAvailabilityServiceEnabled setting (#13777) |
| 28 | `7f67c7f9` | 2025-11-24 | release | SKIP | Nightly version bump | chore/release: bump version to 0.19.0-nightly.20251125 (#13782) |
| 29 | `404a4468` | 2025-11-24 | core | SKIP | Remove console.error from fallback handler; handler doesn't exist in LLxprt | chore: remove console.error (#13779) |
| 30 | `098e5c28` | 2025-11-25 | cli | SKIP | Resume with stdin prompt; tracked by #1385, blocked on #1361 | fix(resume): allow passing a prompt via stdin while resuming using --resume (#13520) |
| 31 | `94c3eecb` | 2025-11-25 | cli, core | SKIP | /resume slash command; tracked by #1385, blocked on #1361 | feat(sessions): add /resume slash command to open the session browser (#13621) |
| 32 | `d0b6701f` | 2025-11-25 | docs | SKIP | Session management docs; tracked by #1385, blocked on #1361 | docs(sessions): add documentation for chat recording and session management (#13667) |
| 33 | `d8a3d08f` | 2025-11-25 | cli, core | SKIP | Flash fallback for TerminalQuota errors; FlashFallback removed from LLxprt | fallback to flash for TerminalQuota errors (#13791) |
| 34 | `03845198` | 2025-11-25 | docs | SKIP | Upstream README badge update; branding-specific | Update Code Wiki README badge (#13768) |
| 35 | `acf5ed59` | 2025-11-25 | core, docs | SKIP | Databricks auth + custom headers; Gemini-specific proxy solution | Add Databricks auth support and custom header option to gemini cli (#11893) |
| 36 | `d2a6cff4` | 2025-11-25 | deps | SKIP | MCP SDK 1.23.0 update; package-lock conflicts likely, evaluate independently | Update dependency for modelcontextprotocol/sdk to 1.23.0 (#13827) |
| 37 | `e1ea2480` | 2025-11-26 | release | SKIP | Release v0.19.0-preview.0 | chore(release): v0.19.0-preview.0 |
| 38 | `403d29c6` | 2025-12-02 | cli | SKIP | SessionBrowser test fix; tracked by #1385, blocked on #1361 | fix(patch): cherry-pick 576fda1 (#14402) |
| 39 | `90a5dc3d` | 2025-12-02 | release | SKIP | Release v0.19.0-preview.1 | chore(release): v0.19.0-preview.1 |
| 40 | `933e0dc8` | 2025-12-02 | release | SKIP | Release v0.19.0 | chore(release): v0.19.0 |
| 41 | `6169ef04` | 2025-12-02 | cli | SKIP | ThemeDialog / holiday theme; patch to release branch, may conflict | fix(patch): cherry-pick bde8b78 (#14418) |
| 42 | `578c4974` | 2025-12-03 | release | SKIP | Release v0.19.1 | chore(release): v0.19.1 |
| 43 | `95f9032b` | 2025-12-04 | core, config | SKIP | Shell execution service fix + .gemini commands; patch to release branch | fix(patch): cherry-pick d284fa6 (#14558) |
| 44 | `a35d001f` | 2025-12-05 | release | SKIP | Release v0.19.2 | chore(release): v0.19.2 |
| 45 | `ee6b01f9` | 2025-12-04 | core | SKIP | Shell execution service fix; patch to release branch | fix(patch): cherry-pick 934b309 (#14571) |
| 46 | `de13a2cc` | 2025-12-05 | release | SKIP | Release v0.19.3 | chore(release): v0.19.3 |
| 47 | `93511487` | 2025-12-05 | a2a-server | SKIP | A2A server task fix; patch to release branch, a2a stays private | fix(patch): cherry-pick fcb85e6 (#14588) |
| 48 | `54c90d73` | 2025-12-05 | release | SKIP | Release v0.19.4 | chore(release): v0.19.4 |

> **Note on patch cherry-picks (rows 38–48):** Upstream commits `6169ef04`, `95f9032b`, `ee6b01f9`, `93511487` are release-branch patches. The underlying fixes they carry (ThemeDialog, shellExecutionService, a2a task) will arrive via the main-branch originals in future gmerge ranges if not already present. Picking release-branch patches risks duplicate application and merge conflicts from release-branch scaffolding.

---

## REIMPLEMENT Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
| --- | ----------: | ---- | ----- | -------- | --------- | ------- |
| 1 | `19d4384f` | 2025-11-21 | docs | REIMPLEMENT | Our extension docs (95 lines) need parity with upstream (277 lines); write comprehensive LLxprt extension management CLI docs | docs: Update uninstall command to reflect multiple extension support (#13582) |
| 2 | `c21b6899` | 2025-11-24 | cli | REIMPLEMENT | Our statsCommand.ts is radically different (330 lines, 7 subcommands vs upstream's 65 lines, 2 subcommands); trivial to add /stats session manually | Add session subtask in /stats command (#13750) |
