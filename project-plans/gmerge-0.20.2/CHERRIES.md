# CHERRIES.md — gmerge-0.20.2 (upstream v0.19.4 → v0.20.2)

## Counts

| Decision | Count |
| --- | ---: |
| PICK | 13 |
| SKIP | 40 |
| REIMPLEMENT | 13 |
| **Total** | **66** |

## Decision Notes

### Recurring Themes

- **Release/version commits:** all `chore(release)` and version-bump commits are `SKIP` (13 total).
- **Hooks integration divergence:** upstream hook integration commits assume wiring (`coreToolHookTriggers`, `geminiChatHookTriggers`, hook-system integration tests) not present in LLxprt runtime paths, so selected items are `REIMPLEMENT` or `SKIP`.
- **MCP instructions:** upstream MCP instruction behavior is desirable, but LLxprt currently lacks `getMcpInstructions`/memory plumb-through, so this is `REIMPLEMENT`.
- **MCP Google auth headers:** `0f12d6c4` completes a partially-implemented Google Cloud MCP auth story and is `PICK`.
- **Prompt system divergence:** upstream hardcodes prompt variants in TypeScript; LLxprt uses per-model per-provider markdown templates. Prompt behavioral changes are `REIMPLEMENT` via the template system.
- **A2A privacy constraint:** A2A server fixes are `REIMPLEMENT` to preserve private-mode behavior.
- **Already landed behavior in LLxprt:** commits whose behavior is already present (e.g., pager normalization, /clear input history preservation, read-only policy subagent rules, Zed ACP schema fix, executor stateless tools) are `SKIP`.
- **Extension test files absent:** LLxprt reimplemented extensions; `extensions-reload.test.ts` doesn't exist, so upstream deflakes for that file are `SKIP`.
- **Session menu WIP:** session browser UI is being built by another agent; session-specific UX commits are `SKIP` for now.

### Revision History

- **v2 (post-review):** 24 decision changes from v1 based on deep code analysis and user overrides.
  - PICK 17 -> 13: removed 7 non-applicable (token calc Gemini-specific, web-fetch already disabled, executor bug doesn't exist in LLxprt, Zed ACP already fixed, 2 extension test files absent, session menu WIP), added 3 (MCP Google auth, LICENSE revert, OTel finish_reasons confirmed local-only).
  - SKIP 39 -> 40: added 7 from PICK, removed 6 to REIMPLEMENT/PICK.
  - REIMPLEMENT 10 -> 13: added 4 from SKIP (Gemini-3 prompts, interactive/non-interactive mode, inactivity timeout, auto-execute slash commands), removed 1 to PICK (OTel finish_reasons).

---

## PICK Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
| --- | ---: | --- | --- | --- | --- | --- |
| 1 | `d97bbd53247bfb985b77f6374e2c55f09471f0cc` | 2025-11-26 | core,cli,exit-codes | PICK | Runtime exit-code correctness fix; low-risk and broadly applicable. | Update error codes when process exiting the gemini cli (#13728) |
| 2 | `3406dc5b2eb05f9f24dc8be75df7107d158d852a` | 2025-11-26 | cli,extensions | PICK | Consent flag for extension linking is directly portable and useful in automation flows. | Add consent flag to Link command (#13832) |
| 3 | `0f12d6c426f6152318fd4b18dff481c9382c705c` | 2025-11-26 | mcp,google-auth | PICK | Completes partially-implemented Google Cloud MCP auth: adds McpAuthProvider interface, getRequestHeaders(), and X-Goog-User-Project header injection for Google-hosted MCP servers. | feat(mcp): Inject GoogleCredentialProvider headers in McpClient (#13783) |
| 4 | `450734e333e83007b2b33f2d31694ded9db3ffe5` | 2025-11-26 | license | PICK | Revert LICENSE copyright from "Google LLC" to Apache 2.0 boilerplate; LLxprt should also use boilerplate. | Revert to default LICENSE (Revert #13449)  (#13876) |
| 5 | `6a43b3121887e1fe03b3a40cd67c7393c877554e` | 2025-11-26 | telemetry,otlp | PICK | Adds finish_reasons to API response telemetry events; confirmed local-only (FileLogExporter/ConsoleLogRecordExporter), no Google transmission. May need OTelFinishReason type added locally. | update(telemetry): OTel API response event with finish reasons (#13849) |
| 6 | `f98e84f03f3a45c93624985abd2878188fffd0f5` | 2025-11-29 | tests,settings-schema | PICK | Small schema validation test improvement; low risk. | test: Add verification for $schema property in settings schema (#13497) |
| 7 | `2fe609cb62a7c183051480b88a5e28a11e4a981b` | 2025-12-02 | hooks,core | PICK | EPIPE guard in hook runner stdin path; LLxprt hookRunner.ts has identical vulnerable pattern at L238-239. | fix(core): handle EPIPE error in hook runner when writing to stdin (#14231) |
| 8 | `f4babf172b02dc89caf0db24b828082258503a21` | 2025-12-02 | lint,async,error-handling | PICK | Async return-await/catch hardening and related cleanup reduce missed exception paths. | fix(async): prevent missed async errors from bypassing catch handlers (#13714) |
| 9 | `70a48a3dd6620aefb8b998c48b84f83a67a0edcb` | 2025-12-02 | ui,markdown-rendering,tests | PICK | Inline markdown length regex fix and focused test are directly portable to LLxprt InlineMarkdownRenderer. | fix(ui): misaligned markdown table rendering (#8336) |
| 10 | `98d7238ed6ae0897413032d7c59b0bd6929cfbd5` | 2025-12-02 | cli,setup-github,shell | PICK | Conditional strict-shell flags fix is isolated and practical. | fix: Conditionally add set -eEuo pipefail in setup-github command (#8550) |
| 11 | `1689e9b6717711935ea9722eff4229f8fd574d37` | 2025-12-01 | cli,ui,react-state | PICK | Fixes React setState-during-render issue in input/message queue flow. | fix(cli): fix issue updating a component while rendering a different component (#14319) |
| 12 | `71b0e7ab0d30cb63d5480837fd3f601498c847f2` | 2025-12-02 | integration-tests,cleanup | PICK | Add try-catch around rm() in globalSetup.ts teardown; prevents cleanup failures from failing tests. | Don't fail test if we can't cleanup (#14389) |
| 13 | `ba8643809b882a6e726e6c252f913e3c24821610` | 2025-12-12 | core,ide-client,auth | PICK | IDE auth-token env fallback is directly portable and useful. | fix(patch): cherry-pick 3f5f030 to release/v0.20.0-pr-14843 to patch version v0.20.0 and create version 0.20.1 (#15002) |

---

## SKIP Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
| --- | ---: | --- | --- | --- | --- | --- |
| 1 | `36a0a3d37b62bb303cff8667db96a88c7ad151ce` | 2025-11-25 | release,deps | SKIP | Nightly version bump commit; LLxprt keeps independent versioning. | chore(release): bump version to 0.20.0-nightly.20251126.d2a6cff4d (#13835) |
| 2 | `e1d2653a7a2260013fae6adf54d55d569f4211ad` | 2025-11-26 | core,tokens | SKIP | Gemini-specific: uses contentGenerator.countTokens() from @google/genai SDK for media. LLxprt uses tiktoken + baseLlmClient.countTokens(). CJK heuristic is the only novel part but tiktoken handles CJK natively. Not cherry-pickable due to diverged call sites. | feat(core): Improve request token calculation accuracy (#13824) |
| 3 | `87edeb4e329ddbc80fc719a440c878dcbaba978f` | 2025-11-26 | core,fallback,availability | SKIP | Depends on upstream fallback/availability architecture absent in LLxprt. | feat(core): implement towards policy-driven model fallback mechanism (#13781) |
| 4 | `b2bdfcf1b5303eba69df42ae3871575ebaf94612` | 2025-11-26 | cli,auth-ui | SKIP | Targets upstream auth UI files not present in LLxprt auth flow. | fix(auth): improve API key authentication flow (#13829) |
| 5 | `5949d56370631ff3f33af434f5fb24de5edc98fa` | 2025-11-27 | cli,ui,mcp | SKIP | Depends on ConfigInitDisplay component absent in LLxprt UI. | feat(ui): Show waiting MCP servers in ConfigInitDisplay (#13721) |
| 6 | `b9dc8eb14d9f9ea3e9b50178991fc413492d642b` | 2025-11-26 | shell | SKIP | Already present: LLxprt sets PAGER='cat' in both child_process and PTY paths in shellExecutionService.ts. Only diff is upstream also adds GIT_PAGER. | feat(shell): Standardize pager to 'cat' for shell execution by model (#13878) |
| 7 | `cf7f6b49ed50ad89791ed1e4445f3efe19ea382f` | 2025-11-26 | release,deps | SKIP | Nightly version bump commit. | chore/release: bump version to 0.20.0-nightly.20251127.5bed97064 (#13877) |
| 8 | `7a4280a482026f2127d4b9215f2cef4b58447af5` | 2025-11-26 | integration-tests,hooks | SKIP | Upstream hook-system integration test harness does not exist in LLxprt integration tests. | feat(hooks): Hooks Comprehensive Integration Testing (#9112) |
| 9 | `576fda18ebf574b325cd4d5236053e998459fb3c` | 2025-11-28 | tests | SKIP | Patch targets upstream session browser/hook tests not present in LLxprt. | chore: fix session browser test and skip hook system tests (#14099) |
| 10 | `bbd61f375fa4f3ca2763dcb58cb4f8cf3f0ca370` | 2025-11-30 | telemetry,semantic | SKIP | Semantic request logging assumes upstream telemetry/event model and provider tags. | feat(telemetry): Add Semantic logging for to ApiRequestEvents (#13912) |
| 11 | `f2466e5224e2c7e6e319346ee04fc09079337b84` | 2025-12-01 | cli,clear,input-history | SKIP | LLxprt already preserves independent input history across /clear (AppContainer L1533). | Fixes /clear command to preserve input history for up-arrow navigation while still clearing the context window and screen (#14182) |
| 12 | `4228a75186f5f375d135772966d5b96be0455774` | 2025-12-01 | cli,non-interactive,tool-policy | SKIP | LLxprt disables google_web_fetch by default and does not have the hang issue; user override. | fix: Exclude web-fetch tool from executing in default non-interactive mode to avoid CLI hang. (#14244) |
| 13 | `613fb2fed62214e416b612b6751e64afd469083d` | 2025-12-01 | release,deps | SKIP | Nightly version bump commit. | chore/release: bump version to 0.20.0-nightly.20251201.2fe609cb6 (#14304) |
| 14 | `db027dd95b9ff955a812e07f1d8fd219ac188c1b` | 2025-12-01 | telemetry,startup-profiler | SKIP | Startup profiler subsystem is absent in LLxprt and high-churn for this sync. | feat: Add startup profiler to measure and record application initialization phases. (#13638) |
| 15 | `62f890b5aa1606ebe968cf43c5f2c56f504d2cbd` | 2025-12-01 | core,agents,executor | SKIP | Bug does not exist in LLxprt: upstream fixed stateful setTools() mutation between turns, but LLxprt passes tools per-message via config params (already stateless). No setTools() method exists. | bug(core): Avoid stateful tool use in executor. (#14305) |
| 16 | `bde8b78a88f10ac290bc2b1a52124d8e37b781e0` | 2025-12-01 | ui,themes | SKIP | Emoji-themed holiday changes are out-of-policy for LLxprt. | feat(themes): add built-in holiday theme (#14301) |
| 17 | `26f050ff10dd90a8c4e6e125effe79d0272aa474` | 2025-12-01 | docs | SKIP | Docs title-casing/ToC maintenance only. | Updated ToC on docs intro; updated title casing to match Google style (#13717) |
| 18 | `b4df7e351bd87aaaa9fd8feec84ae7cc68527e14` | 2025-12-01 | core,availability,fallback | SKIP | Depends on upstream model-availability/policy-catalog stack not present in LLxprt. | feat(core): enhance availability routing with wrapped fallback and single-model policies (#13874) |
| 19 | `fcb85e612f507335a6a9dc18188f47ce3a5f33fe` | 2025-12-01 | a2a-server,logging | SKIP | Minor logging patch with low value given A2A divergence. | chore(logging): log the problematic event for #12122 (#14092) |
| 20 | `784d3c6c9a09162614862f4c46a3e35011c39f79` | 2025-12-02 | github,templates | SKIP | GitHub issue-template metadata fix only. | fix: remove invalid type key in bug_report.yml (#13576) |
| 21 | `4df43c802b248d4c7e6875a392bc86b422dec440` | 2025-12-02 | docs,assets | SKIP | Screenshot update only. | update screenshot (#13976) |
| 22 | `0c463e664e8bd3afce30f4a41ecfc7999d5e789d` | 2025-12-01 | docs | SKIP | Grammar-only docs fix. | docs: Fix grammar error in Release Cadence (Nightly section) (#13866) |
| 23 | `57296425568ff64aa960dd9862a168e628004ef9` | 2025-12-01 | zed-integration,acp | SKIP | Already fixed: LLxprt authenticateRequestSchema already has only methodId (no extra authMethod field). | fix(zed-integration): remove extra field from acp auth request (#13646) |
| 24 | `5fa6d87c25af697fed730fd02ae27d3b7fe3dbfa` | 2025-12-01 | docs,model-config | SKIP | Upstream model-config docs are Gemini-centric; LLxprt provider docs differ. | feat(cli): Documentation for model configs. (#12967) |
| 25 | `d24e5cf3534acc22c371a8952cf11ede88290d48` | 2025-12-01 | docs | SKIP | General docs refresh only. | docs: Update 4 files (#13628) |
| 26 | `f7f047936bb92923037cc14258479a428f333b88` | 2025-12-02 | github,workflows | SKIP | Label reference cleanup in workflows only. | Remove references to deleted kind/bug label (#14383) |
| 27 | `2a3c0eddb915a6592192f728eb92a5685bd51133` | 2025-12-02 | integration-tests,deflake | SKIP | LLxprt does not have extensions-reload.test.ts (extensions reimplemented). | Increase flakey test timeout (#14377) |
| 28 | `2b1a791a0b24be48902f0cbbf1c617ee53b69bd1` | 2025-12-02 | integration-tests,deflake | SKIP | LLxprt does not have extensions-reload.test.ts; pollCommand() utility useful but test target absent. | Use polling for extensions-reload integration test (#14391) |
| 29 | `c78f2574a2e985daddf88185cd931e327372277f` | 2025-12-02 | docs,branding | SKIP | GEMINI-branded docs directive not applicable to LLxprt branding. | Add docs directive to GEMINI.md (#14327) |
| 30 | `aa544c40de0509fd06863c529565173cbfdba81d` | 2025-12-02 | cli,sessions,ui | SKIP | Session browser UI is WIP (another agent building session continuation); defer until that work lands. | Hide sessions that don't have user messages (#13994) |
| 31 | `2d935b3798f8bd10d87150241bcbdb1d86d17ba5` | 2025-12-03 | ci,release | SKIP | Upstream release-channel workflow behavior only. | chore(ci): mark GitHub release as pre-release if not on "latest" npm channel (#7386) |
| 32 | `290855543561c19b1d646fbfb7b1892b963dfc3a` | 2025-12-02 | release | SKIP | Release tag commit. | chore(release): v0.20.0-preview.0 |
| 33 | `356eb7ced0a47c58574d854895302f4f63641bf8` | 2025-12-04 | core,shell,patch | SKIP | Underlying shell scrollback/line handling changes are already superseded in LLxprt. | fix(patch): cherry-pick d284fa6 to release/v0.20.0-preview.0-pr-14545 [CONFLICTS] (#14559) |
| 34 | `aae64683cee2752a23d01bd0f1201df32d9ec011` | 2025-12-05 | release | SKIP | Release tag commit. | chore(release): v0.20.0-preview.1 |
| 35 | `9d7b9e6cd1e77cd691f4810718531e9b2baa7286` | 2025-12-08 | release | SKIP | Release tag commit. | chore(release): v0.20.0-preview.2 |
| 36 | `d0ce3c4c5d99688789460986d82f38062ac1b01c` | 2025-12-09 | release | SKIP | Release tag commit. | chore(release): v0.20.0-preview.5 |
| 37 | `b05fb545ef78e1ce2a0a1680b095542011640b0a` | 2025-12-09 | release | SKIP | Release tag commit. | chore(release): v0.20.0 |
| 38 | `c9b9435ceffb53a6873931ee16bf56bd33320810` | 2025-12-12 | release | SKIP | Release tag commit. | chore(release): v0.20.1 |
| 39 | `af894e46862eb607a6b5cb274212b1014a863da8` | 2025-12-12 | policy,read-only | SKIP | Subagent/task/list_subagents allow rule already exists in LLxprt read-only policy. | fix(patch): cherry-pick edbe548 to release/v0.20.1-pr-15007 [CONFLICTS] (#15016) |
| 40 | `e666b26d79e3f85b0574262b3e87e508f46920e3` | 2025-12-12 | release | SKIP | Release tag commit. | chore(release): v0.20.2 |

---

## REIMPLEMENT Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
| --- | ---: | --- | --- | --- | --- | --- |
| 1 | `1187c7fdacee20b2f1f728eaf2093a1c44b5f6f1` | 2025-11-26 | prompts,gemini-specific | REIMPLEMENT | Add "Do not call tools in silence" and remove "No Chitchat" as gemini-3-specific prompt override in defaults/providers/gemini/models/ (same pattern as gemini-2.5-flash and gemini-3-pro-preview overrides). | Changes in system instruction to adapt to gemini 3.0 to ensure that the CLI explains its actions before calling tools (#13810) |
| 2 | `558c8ece2ca2f3fec851228e050227fdb0cec8fb` | 2025-11-26 | hooks,core-tool-scheduler | REIMPLEMENT | Upstream integrates hooks into scheduler via files absent in LLxprt runtime path. | feat(hooks): Hook Tool Execution Integration (#9108) |
| 3 | `bc365f1eaa39c0414b4d70e600d733eb0867aec6` | 2025-11-26 | mcp,config,memory | REIMPLEMENT | MCP instruction aggregation (getMcpInstructions + useInstructions setting) is valuable but needs LLxprt-specific plumbing. | Add support for MCP server instructions behind config option (#13432) |
| 4 | `4a82b0d891a8caed2fa3e6b5761fc785cd4dcc38` | 2025-11-26 | prompts,interactive-mode | REIMPLEMENT | Add interactionMode ('interactive' / 'non-interactive' / 'subagent') to PromptEnvironment. Use template variables (like SUBAGENT_DELEGATION) to conditionally render "Confirm Ambiguity" vs "Handle Ambiguity" + "Continue the work" directive. Critical for fixing subagent mode where models stop to ask for instructions despite being told not to (contradictory instructions between core prompt and appended non-interactive rules). | Update System Instructions for interactive vs non-interactive mode. (#12315) |
| 5 | `0d29385e1bdf0f73e663df490a1b88ed3117ae16` | 2025-11-26 | core,shell,config | REIMPLEMENT | Inactivity timeout (resets on output) is distinct from total timeout_seconds. Detects hung commands waiting for input vs actively producing output. Controlled via /set ephemeral or /setting. Would NOT false-trigger on gh pr checks --watch (produces output periodically). | feat(core): Add configurable inactivity timeout for shell commands (#13531) |
| 6 | `5bed97064a99233e4c116849abb138db4e15daa3` | 2025-11-26 | hooks,llm-request-response | REIMPLEMENT | Upstream geminiChat hook wiring depends on trigger/hook-system files not present in LLxprt runtime integration. | feat(hooks): Hook LLM Request/Response Integration (#9110) |
| 7 | `69188c8538af44f6cbae7c57f4d8478a474802d0` | 2025-11-26 | cli,stats,code-assist | REIMPLEMENT | Quota display in /stats treating Gemini quotas like other provider quotas (OAuth/bucket-based); needs generic quota API surface in code_assist types. | Add usage limit remaining in /stats (#13843) |
| 8 | `844d3a4dfa207fbfe3c083ecb12f0c090ddfa524` | 2025-12-01 | mcp,instructions | REIMPLEMENT | "Always include MCP server instructions" requires LLxprt instruction-collection path first (depends on bc365f1e REIMPLEMENT). | Always use MCP server instructions (#14297) |
| 9 | `f918af82fe13eae28b324843d03e00f02937b521` | 2025-12-01 | cli,slash-commands | REIMPLEMENT | Add autoExecute boolean flag per SlashCommand: simple commands (/about, /clear, /help) execute immediately on Enter from suggestion; complex commands (/chat save) just autocomplete. Tab always autocompletes. Different from LLxprt's existing exact-match submit. | feat: auto-execute simple slash commands on Enter (#13985) |
| 10 | `806cd112ac974ca54e39d6c28d2d243839aa9fd0` | 2025-12-01 | a2a-server,agent | REIMPLEMENT | A2A modelInfo propagation likely useful but should be ported through LLxprt private A2A architecture. | feat(a2a): Urgent fix - Process modelInfo agent message (#14315) |
| 11 | `752a521423630589e49f9b5c1aed3b05173f686f` | 2025-12-03 | core,context,jit | REIMPLEMENT | LLxprt has JIT memory discovery utility but lacks settings/config/service wiring from upstream context manager approach. | feat(core): Implement JIT context manager and setting (#14324) |
| 12 | `f9997f92c99f9ec2d0eaee6910c47dffe9d25745` | 2025-12-08 | stdio,cli,core | REIMPLEMENT | Stdio hardening (createWorkingStdio pattern) overlaps LLxprt's createInkStdio; apply intent selectively. | fix(patch): cherry-pick 828afe1 to release/v0.20.0-preview.1-pr-14159 (#14733) |
| 13 | `8872ee0ace406f105476764be54c1e029684093c` | 2025-12-08 | core,shell,security | REIMPLEMENT | CI env sanitization for shell execution; LLxprt must preserve LLXPRT_TEST env variables and local behavior. | fix(patch): cherry-pick 171103a to release/v0.20.0-preview.2-pr-14742 (#14752) |
