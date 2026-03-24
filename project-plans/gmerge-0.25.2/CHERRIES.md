# Cherry-Pick Decisions: v0.24.5 → v0.25.2

## Counts
- PICK: 48
- SKIP: 78
- REIMPLEMENT: 28
- NO_OP: 15
- **Total: 169**

## Audit Methodology
Code-level audit performed via 8 parallel codeanalyzer subagents. Each commit audited with `git show` full diff + comparison against LLxprt source files.

## Decision Notes
- A2A-specific confirmation details, interactive-shell enablement, and `/memory` server work are deferred to follow-up issue #1675 rather than merged in this pass.
- Auto model routing is explicitly out of scope for LLxprt, so upstream routing-to-subagent work is skipped even when the feature is valuable upstream.
- Upstream agent architecture centered on `/agents`, AgentRegistry, DelegateToAgentTool, CliHelpAgent, and markdown-frontmatter agents was skipped because LLxprt uses `/subagent`, SubagentManager, task(), and JSON-backed subagent definitions.
- `@subagent` suggestion UX remains desirable, but it must be reimplemented for LLxprt’s SubagentManager + `task()` workflow rather than cherry-picked verbatim.
- Telemetry, Clearcut, Google Cloud Monitoring, Google auth, quota dialogs, and other Gemini-only surfaces were skipped because LLxprt removed or replaced that infrastructure.
- Release/version bumps, upstream-only CI/workflow churn, and repo-automation commits were skipped unless they carried an independent product fix.
- Several upstream fixes were already present in LLxprt; those are marked NO_OP rather than PICK.

## PICK Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 1 | da85e3f8f23 | — | skills, tools, prompts | PICK | LLxprt has the activate_skill tool and matching prompt surface, so the improved error handling and lowercase skill XML are directly applicable. | feat(core): improve activate_skill tool and use lowercase XML tags (#16009) |
| 4 | 982eee63b61 | — | editor, terminal | PICK | LLxprt uses the same editor detection tables and lacks Helix support, so this is a clean editor-capability addition. | Hx support (#16032) |
| 5 | a26463b056d | — | skills, settings, cli | PICK | LLxprt still carries inline skill enable/disable logic, so the centralized skill settings/utilities improve maintainability on existing code paths. | [Skills] Foundation: Centralize management logic and feedback rendering (#15952) |
| 7 | 2d683bb6f8a | — | skills, settings | PICK | LLxprt inherits the same multi-scope skill shadowing problem once centralized skill management lands, so the enablement fix applies. | [Skills] Multi-scope skill enablement and shadowing fix (#15953) |
| 10 | 8f9bb6bccc6 | — | documentation | PICK | LLxprt ships the same troubleshooting doc and the SSL guidance is Node/tooling-generic rather than Gemini-specific. | Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY (#16069) |
| 14 | 57012ae5b33 | — | rewind, compression, session | PICK | LLxprt already has Rewind, and these data-structure fields are still useful because filePath/isNewFile are currently missing. | Core data structure updates for Rewind functionality (#15714) |
| 28 | 1bd4f9d8b6f | — | integration tests | PICK | Mock-response-based json-output tests are provider-agnostic test hardening and reduce live dependency in LLxprt’s integration suite. | Optimize json-output tests with mock responses (#16102) |
| 31 | d48c934357c | — | command completion, ui | PICK | LLxprt has the same slash-command/file-completion hook and benefits from prioritizing `@` file completion after slash commands. | feat(cli): add filepath autosuggestion after slash commands (#14738) |
| 33 | 3e2f4eb8ba1 | — | skills, cli | PICK | LLxprt’s skills CLI can directly use the improved feedback and default-scope UX refinements. | [Skills] UX Polishing: Transparent feedback and CLI refinements (#15954) |
| 34 | 722c4933dc3 | — | skills, logging | PICK | LLxprt’s skill loader still emits noisy warnings and can adopt the same debug-log downgrade without architecture changes. | Polish: Move 'Failed to load skills' warning to debug logs (#16142) |
| 46 | 1a4ae413978 | — | policy, security | PICK | LLxprt already has the yolo redirection allowance, so this upstream bug fix is effectively already present but still belongs in the direct-pick bucket from the audit record. | fix: yolo should auto allow redirection (#16183) |
| 47 | f8138262fa7 | — | config, approval-mode | PICK | LLxprt’s CLI config behavior should likewise respect explicit approval-mode args instead of letting disableYoloMode force defaults. | fix(cli): disableYoloMode shouldn't enforce default approval mode against args (#16155) |
| 48 | fbfad06307c | — | ide-detection | PICK | Sublime Text detection is additive and LLxprt’s IDE detection table currently lacks it. | feat: add native Sublime Text support to IDE detection (#16083) |
| 50 | 01d2d437372 | — | terminal-setup, ide-integration | PICK | Antigravity terminal support is a self-contained terminal capability expansion against LLxprt’s existing setup helper. | Add support for Antigravity terminal in terminal setup utility (#16051) |
| 54 | e5f7a9c4240 | — | rewind, file-operations | PICK | The rewind file operation utilities are general filesystem helpers and were audited as applicable to LLxprt’s rewind-capable flow. | feat: implement file system reversion utilities for rewind (#15715) |
| 61 | 4ab1b9895ad | — | terminal, shell-execution | PICK | Switching PTY TERM to xterm-256color is a low-risk compatibility improvement in LLxprt’s shell execution service. | Ensure TERM is set to xterm-256color (#15828) |
| 67 | 88f1ec8d0ae | — | keypress, terminal capability | PICK | LLxprt still carries the bracketed-paste gate and can simplify to always-enable behavior like upstream. | Always enable bracketed paste (#16179) |
| 71 | 8bc3cfe29a6 | — | skills | PICK | The pr-creator skill is reusable prompt content and LLxprt’s skills system can consume it with minor settings-path adaptation. | feat(skills): add pr-creator skill and enable skills (#16232) |
| 72 | c1401682ed0 | — | keypress | PICK | Kitty protocol Shift+Space handling is a targeted terminal bug fix against LLxprt’s existing key map. | fix: handle Shift+Space in Kitty keyboard protocol terminals (#15767) |
| 75 | 14f0cb45389 | — | ui, settings, startup warnings | PICK | The home-directory warning opt-out is user-facing polish that maps cleanly onto LLxprt’s startup warning and trust settings. | feat(ui): reduce home directory warning noise and add opt-out setting (#16229) |
| 78 | ea7393f7fd5 | — | terminal capability | PICK | Inferring modifyOtherKeys support from terminal behavior is a compatible terminal UX improvement in LLxprt. | Infer modifyOtherKeys support (#16270) |
| 79 | e04a5f0cb0e | — | gitignore parser | PICK | Caching compiled ignore instances is a self-contained performance improvement in LLxprt’s ignore parser. | feat(core): Cache ignore instances for performance (#16185) |
| 81 | 1fb55dcb2e0 | — | docs, settings generation | PICK | Auto-generated settings docs align with LLxprt’s schema-driven docs tooling and are mainly developer/documentation improvements. | Autogenerate docs/cli/settings.md (#14408) |
| 96 | 93b57b82c10 | — | skills | PICK | This is harmless formatting cleanup for the pr-creator skill content LLxprt can ship. | style: format pr-creator skill (#16381) |
| 100 | 64c75cb767c | — | ui, text width | PICK | LLxprt’s text width helper lacks the Unicode crash guard, so this is a direct bug fix. | Fix crash on unicode character (#16420) |
| 106 | 15891721ad0 | — | ui, rewind | PICK | LLxprt lacks the dedicated rewind hook and can adopt this clean UI-state abstraction on top of existing rewind support. | feat: introduce useRewindLogic hook for conversation history navigation (#15716) |
| 108 | 64cde8d4395 | — | policy, security, shell | PICK | The shell-safety hardening addresses real parsing/injection edge cases and was called out as a critical security improvement. | fix(policy): enhance shell command safety and parsing (#15034) |
| 109 | 3b678a4da0f | — | core, skills | PICK | LLxprt’s tool registration path can take the same unregister-before-reregister fix to avoid activate_skill warnings. | fix(core): avoid 'activate_skill' re-registration warning (#16398) |
| 113 | 8437ce940a1 | — | examples, extensions | PICK | The revert/repair of extension examples was audited as a useful example-quality correction where those examples exist. | Revert "Update extension examples" (#16442) |
| 114 | e049d5e4e8f | — | ui, terminal, keypress | PICK | Fast-return buffering improves paste behavior on older terminals and fits LLxprt’s existing keypress stack. | Fix: add back fastreturn support (#16440) |
| 117 | 95d9a339966 | — | ui, keybindings | PICK | LLxprt still hardcodes YOLO/auto-edit shortcuts and can move them into the keybinding registry like upstream. | migrate yolo/auto-edit keybindings (#16457) |
| 118 | 2e8c6cfdbb8 | — | cli, skills | PICK | Skill install/uninstall commands are additive functionality missing from LLxprt’s current skills CLI. | feat(cli): add install and uninstall commands for skills (#16377) |
| 119 | ca6786a28bd | — | ui, shell, keybindings | PICK | Tab-based shell/input focus switching is a substantive UX improvement and LLxprt still uses the older focus behavior. | feat(ui): use Tab to switch focus between shell and input (#14332) |
| 120 | e9c9dd1d672 | — | skills, build | PICK | Built-in skill bundling infrastructure is additive and enables LLxprt to ship default skills with the CLI. | feat(core): support shipping built-in skills with the CLI (#16300) |
| 123 | 8d3e93cdb0d | — | keybindings, text-buffer | PICK | LLxprt still has hardcoded text-buffer shortcuts, so this broader keybinding migration improves configurability and consistency. | Migrate keybindings (#16460) |
| 125 | 2fc61685a32 | — | ui, terminal title | PICK | Dynamic terminal titles are a user-facing enhancement missing from LLxprt’s current terminal title handling. | feat(cli): implement dynamic terminal tab titles for CLI status (#16378) |
| 127 | 6adae9f7756 | — | terminal-title | PICK | LLxprt still writes only OSC 2 titles, so switching to OSC 0 fixes tab-title updates as upstream observed. | fix: Set both tab and window title instead of just window title (#16464) |
| 133 | 91fcca3b1c7 | — | ui-history | PICK | LLxprt still requires explicit base timestamps in `addItem`, so the optional-baseTimestamp cleanup is still missing. | refactor: make baseTimestamp optional in addItem and remove redundant calls (#16471) |
| 134 | e931ebe581b | — | keybindings, docs | PICK | LLxprt retains the older keybinding names/descriptions and can take the same terminology cleanup. | Improve key binding names and descriptions (#16529) |
| 137 | e8be252b755 | — | skills-cli | PICK | LLxprt ships the same skills install/uninstall yargs bug, so this is a direct applicable fix. | fix(cli): fix 'gemini skills install' unknown argument error (#16537) |
| 142 | c7c409c68fb | — | clipboard, terminal-interop | PICK | LLxprt still overuses OSC52 in tmux/screen locally, so narrowing it to SSH/WSL contexts is a focused compatibility fix. | fix(cli): copy uses OSC52 only in SSH/WSL (#16554) |
| 143 | 778de55fd8c | — | docs, skills | PICK | LLxprt’s skills docs can directly absorb the directory-structure clarification. | docs(skills): clarify skill directory structure and file location (#16532) |
| 144 | 8dbaa2bceaf | — | editor-integration | PICK | LLxprt still ignores preferred-editor config for Ctrl+X launches, so this upstream editor-plumbing fix applies. | Fix: make ctrl+x use preferred editor (#16556) |
| 145 | eda47f587cf | — | tool-scheduler | PICK | The scheduler still uses the race-prone completion-reporting pattern identified upstream, so the guarded drain/finalization fix is relevant. | fix(core): Resolve race condition in tool response reporting (#16557) |
| 152 | bb6c5741443 | — | config, skills, admin | PICK | Admin-enforced skill settings are provider-agnostic governance controls that fit LLxprt’s config and builtin-command model. | feat(admin): support admin-enforced settings for Agent Skills (#16406) |
| 157 | f6a5fa0e03a | — | ui, history | PICK | Flushing pending rationale before tool scheduling fixes a real ordering bug and the necessary history refs already exist in LLxprt. | fix(ui): ensure rationale renders before tool calls (#17043) |
| 158 | ea0e3de4302 | — | core, client | PICK | LLxprt’s GeminiClient still tracks `currentSequenceModel`, so deduplicating ModelInfo emission on unchanged model is applicable. | fix(core): deduplicate ModelInfo emission in GeminiClient (#17075) |
| 163 | 217f2775805 | — | core, client, model-switching | PICK | LLxprt lacks the model-changed reset hook for `currentSequenceModel`, so this is a valid model-switching bug fix. | fix: update currentSequenceModel when modelChanged (#17051) |

## SKIP Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 2 | 521dc7f26c3 | — | telemetry | SKIP | LLxprt removed the referenced Clearcut/code_assist telemetry infrastructure, so there is no meaningful patch target. | Add initiation method telemetry property (#15818) |
| 3 | b54215f0a55 | — | release | SKIP | Pure upstream version bump with no product behavior change for LLxprt. | chore(release): bump version to 0.25.0-nightly.20260107.59a18e710 (#16048) |
| 6 | 7956eb239e8 | — | testing, paths | SKIP | GEMINI_CLI_HOME is upstream-specific test/home isolation and would need LLxprt-specific redesign rather than cherry-pick. | Introduce GEMINI_CLI_HOME for strict test isolation (#15907) |
| 11 | d1eb87c81ff | — | dependencies, security | SKIP | LLxprt uses @napi-rs/keyring rather than keytar, so this dependency change does not fit the current credential-storage stack. | Add keytar to dependencies (#15928) |
| 13 | db99beda369 | — | admin, extensions | SKIP | This first extensions-disabled attempt was reverted upstream and should not be carried separately. | feat(admin): implement extensions disabled (#16024) |
| 16 | 143bb63483a | — | telemetry | SKIP | Telemetry experiment-field changes target removed Clearcut logging code. | Add exp.gws_experiment field to LogEventEntry (#16062) |
| 20 | a1dd19738e3 | — | routing, model-config | SKIP | LLxprt lacks the upstream routing subsystem targeted by this preliminary subagent routing commit. | feat(core): Preliminary changes for subagent model routing. (#16035) |
| 21 | d5996fea999 | — | ci, github-actions | SKIP | Upstream CI parallelization and linter caching are repo-specific workflow changes outside LLxprt’s product surface. | Optimize CI workflow: Parallelize jobs and cache linters (#16054) |
| 22 | 0be8b5b1ed2 | — | quota dialog, Gemini UI | SKIP | ProQuotaDialog and Gemini-capacity fallback UI do not exist in LLxprt’s multi-provider CLI. | Add option to fallback for capacity errors in ProQuotaDialog (#16050) |
| 23 | 1c77bac146a | — | agents, a2a, remote-invocation | SKIP | A2A confirmation details are deferred to the dedicated A2A follow-up tracked in issue #1675. | feat: add confirmation details support + jsonrpc vs http rest support (#16079) |
| 24 | bd77515fd93 | — | workflows | SKIP | PR-triage script changes are upstream repo automation rather than LLxprt product code. | fix(workflows): fix and limit labels for pr-triage.sh script (#16096) |
| 25 | d4b418ba01f | — | agents, cli-help | SKIP | LLxprt does not ship the introspection/cli-help agent feature path this rename depends on. | Fix and rename introspection agent -> cli help agent (#16097) |
| 26 | 51d3f44d510 | — | docs, changelogs | SKIP | Upstream changelog and Gemini release docs are not sync targets for LLxprt. | Docs: Changelogs update 20260105 (#15937) |
| 27 | 1aa35c87960 | — | agents | SKIP | Enabling the absent cli-help agent by default is not applicable to LLxprt. | enable cli_help agent by default (#16100) |
| 29 | dd04b46e86d | — | ci workflows | SKIP | Fork-specific CI fixes are repo-automation noise for this merge audit. | Fix CI for forks (#16113) |
| 30 | 41cc6cf105d | — | workflows | SKIP | More upstream PR-triage tuning with no LLxprt product impact. | Reduce nags about PRs that reference issues but don't fix them. (#16112) |
| 32 | aca6bf6aa03 | — | quota dialog, billing | SKIP | Paid-tier upgrade UI is Gemini-billing-specific and absent from LLxprt. | Add upgrade option for paid users (#15978) |
| 37 | eb75f59a96e | — | model config, config resolution | SKIP | LLxprt model profiles and inheritance differ substantially from upstream, so this override fix does not map cleanly. | bug(core): fix issue with overrides to bases. (#15255) |
| 38 | cf021ccae46 | — | a2a-server, config | SKIP | A2A interactive-shell enablement is deferred to the broader A2A follow-up tracked in issue #1675. | enableInteractiveShell for external tooling relying on a2a server (#16080) |
| 43 | 76d020511fd | — | docs | SKIP | Minor upstream doc-title formatting for model-routing docs is not worth syncing. | Update the page's title to be consistent and show in site. (#16174) |
| 49 | 16da6918cb5 | — | scheduler refactor | SKIP | This is mainly structural extraction in a locally diverged scheduler and was not audited as worth carrying as a cherry-pick. | refactor(core): extract ToolModificationHandler from scheduler (#16118) |
| 51 | 41a8809280f | — | agents, model-routing | SKIP | The user explicitly said LLxprt does not do auto model routing, so this should not be pursued. | feat(core): Wire up model routing to subagents. (#16043) |
| 52 | 7e02ef697dd | — | cli, agents | SKIP | Upstream /agents discovery does not apply because LLxprt uses /subagent rather than the upstream agent command model. | feat(cli): add /agents slash command to list available agents (#16182) |
| 55 | d75792703a0 | — | security, environment sanitization | SKIP | GitHub-specific redaction enforcement depends on upstream deployment context rather than LLxprt runtime behavior. | Always enable redaction in GitHub actions. (#16200) |
| 56 | e51f3e11f1f | — | ci, workflows | SKIP | Workflow-key cleanup touches upstream triage automation only. | fix: remove unsupported 'enabled' key from workflow config (#15611) |
| 57 | 26505b580cc | — | docs | SKIP | Documentation deletions and link reshaping are specific to upstream doc structure. | docs: Remove redundant and duplicate documentation files (#14699) |
| 58 | a7f758eb3a4 | — | docs, branding | SKIP | README/package-name branding changes are upstream-specific and not suitable for cherry-pick. | docs: shorten run command and use published version (#16172) |
| 59 | 84710b19532 | — | testing | SKIP | Upstream-only test timeout adjustment was not justified as a product sync item for LLxprt. | test(command-registry): increase initialization test timeout (#15979) |
| 62 | ffb80c2426d | — | telemetry | SKIP | Telemetry script fixes are excluded because LLxprt removed telemetry. | The telemetry.js script should handle paths that contain spaces (#12078) |
| 64 | 6166d7f6ec6 | — | ci workflows | SKIP | Fork guards for upstream links workflow are not part of LLxprt product behavior. | ci: guard links workflow from running on forks (#15461) |
| 65 | f1ca7fa40a2 | — | ci workflows | SKIP | Upstream nightly-release workflow guards are intentionally skipped. | ci: guard nightly release workflow from running on forks (#15463) |
| 66 | aa480e5fbbb | — | token limits, model consts | SKIP | The constants cleanup is Gemini-model-specific and does not align with LLxprt’s different model catalog. | chore: clean up unused models and use consts (#16246) |
| 68 | f7b97ef55ec | — | hooks, AppContainer | SKIP | LLxprt already uses HookSystem-based session hooks, so this migration from the old pattern is redundant. | refactor: migrate app container hook calls to hook system (#16161) |
| 69 | b9f8858bfb6 | — | hooks, clearCommand | SKIP | Same as above: upstream migrates legacy hook calls LLxprt no longer has. | refactor: migrate clearCommand hook calls to HookSystem (#16157) |
| 73 | 041463d1122 | — | agents, a2a, events | SKIP | The /agents refresh flow is tied to upstream AgentRegistry behavior that LLxprt does not share. | feat(core, ui): Add /agents refresh command. (#16204) |
| 74 | ca486614233 | — | experiments | SKIP | Local Google experiment overrides were explicitly rejected by the user and are outside LLxprt’s desired product surface. | feat(core): add local experiments override via GEMINI_EXP (#16181) |
| 76 | 9d187e041c8 | — | compression, hooks | SKIP | LLxprt’s compression stack already diverged and the upstream HookSystem migration does not map cleanly. | refactor: migrate chatCompressionService to use HookSystem (#16259) |
| 80 | d74bf9ef2f2 | — | remote admin settings | SKIP | Remote admin settings depend on Google Code Assist platform infrastructure absent from LLxprt. | feat: apply remote admin settings (no-op) (#16106) |
| 82 | 356f76e545d | — | config migration | SKIP | Removal of legacy V1 migration logic is not relevant where LLxprt does not carry the same migration layer. | refactor(config): remove legacy V1 settings migration logic (#16252) |
| 83 | c87d1aed4c5 | — | quota fallback, ui, config | SKIP | The quota fallback behavior is part of upstream Gemini-specific capacity handling that LLxprt does not want to adopt. | Fix an issue where the agent stops prematurely (#16269) |
| 85 | b54e688c75f | — | dependencies | SKIP | Routine ink version bumps are LLxprt dependency-management decisions, not upstream behavior syncs. | Update ink version to 6.4.7 (#16284) |
| 87 | 3090008b1c0 | — | skills UX | SKIP | The specific restart-required message being removed does not exist in LLxprt’s differing non-interactive skills flow. | fix(skills): remove "Restart required" message from non-interactive commands (#16307) |
| 89 | 72dae7e0eeb | — | ci | SKIP | Triage workflow cleanup is explicitly out of scope for LLxprt merge picks. | Triage action cleanup (#16319) |
| 90 | d130d99ff02 | — | ci | SKIP | Event-driven issue triage workflow triggers are upstream automation only. | fix: Add event-driven trigger to issue triage workflow (#16334) |
| 91 | 446058cb1c7 | — | ci | SKIP | GitHub token fallback in triage workflow is upstream repo-management code. | fix: fallback to GITHUB_TOKEN if App ID is missing |
| 92 | 33e3ed0f6ce | — | ci | SKIP | Actionlint and triage workflow repairs are upstream-only workflow churn. | fix(workflows): resolve triage workflow failures and actionlint errors (#16338) |
| 93 | b9762a3ee1b | — | docs | SKIP | The user explicitly said no to carrying the experimental hooks documentation note. | docs: add note about experimental hooks (#16337) |
| 94 | 39b3f20a228 | — | debug, activity logging | SKIP | Passive activity logging adds telemetry-adjacent overhead the user does not want in LLxprt. | feat(cli): implement passive activity logger for session analysis (#15829) |
| 98 | d315f4d3dad | — | agents, policy | SKIP | DelegateToAgentTool does not exist in LLxprt, so the delegation-confirmation patch has no direct target. | fix(core): ensure silent local subagent delegation while allowing remote confirmation (#16395) |
| 99 | 7b7f2fc69e3 | — | agents, parser | SKIP | The markdown/frontmatter agent config format is upstream-specific; LLxprt uses JSON-backed subagents instead. | Markdown w/ Frontmatter Agent Parser (#16094) |
| 102 | 465ec9759db | — | agents, config | SKIP | Runtime sub-agent refresh depends on upstream registry/schema architecture that LLxprt does not share. | fix(core): ensure sub-agent schema and prompt refresh during runtime (#16409) |
| 103 | ed7bcf9968e | — | docs, extensions | SKIP | The extension examples update was reverted upstream by 8437ce940a1 anyway, so there is nothing useful to carry. | Update extension examples (#16274) |
| 104 | 8656ce8a274 | — | config, fallback | SKIP | This revert touches upstream FlashFallback behavior that LLxprt removed or significantly altered. | revert the change that was recently added from a fix (#16390) |
| 110 | 2306e60be45 | — | ci, workflows | SKIP | PR-triage performance work is upstream CI automation, not LLxprt product code. | perf(workflows): optimize PR triage script for faster execution (#16355) |
| 111 | d65eab01d25 | — | auth, ui | SKIP | Google OAuth restart prompting is tied to upstream auth UX rather than LLxprt’s provider-auth model. | feat(admin): prompt user to restart the CLI if they change auth to oauth mid-session (#16426) |
| 112 | 7d922420110 | — | agents, docs | SKIP | CliHelpAgent does not exist in LLxprt, so this prompt tweak is inapplicable. | Update cli-help agent's system prompt in sub-agents section (#16441) |
| 115 | d7bff8610f8 | — | memory, a2a, commands | SKIP | Adding /memory to A2A is deferred to the dedicated A2A work in issue #1675. | feat(a2a): Introduce /memory command for a2a server (#14456) |
| 121 | 6ef2a92233b | — | telemetry | SKIP | Hardware telemetry collection is excluded with the rest of Clearcut telemetry. | Collect hardware details telemetry. (#16119) |
| 122 | 548641c952a | — | agents, parser | SKIP | This parser/UI feedback work is coupled to the upstream /agents command and frontmatter agent loader that LLxprt skipped. | feat(agents): improve UI feedback and parser reliability (#16459) |
| 126 | b81fe683258 | — | tools, edit, settings | SKIP | The user explicitly confirmed this smart-edit auto-correction setting should be skipped. | feat(core): add disableLLMCorrection setting to skip auto-correction in edit tools (#16000) |
| 130 | 8faa23cea6c | — | agents, docs | SKIP | The loader file this YAML-frontmatter clarification targets is absent in LLxprt’s current tree. | feat(agents): clarify mandatory YAML frontmatter for sub-agents (#16515) |
| 131 | 0f7a136612e | — | docs, telemetry | SKIP | Google Cloud Monitoring telemetry docs are explicitly excluded from this fork sync. | docs(telemetry): add Google Cloud Monitoring dashboard documentation (#16520) |
| 138 | b518125c461 | — | ui, agents status | SKIP | The tuned AgentsStatus component does not exist under the same path in LLxprt. | chore(ui): optimize AgentsStatus layout with dense list style and group separation (#16545) |
| 141 | d66ec38f829 | — | agents, model-config | SKIP | LLxprt uses ephemeral profiles rather than persisted agent settings in settings.json, so this architecture is not applicable. | feat(core): Align internal agent settings with configs exposed through settings.json (#16458) |
| 146 | 04f65d7b4ef | — | ui, model dialog | SKIP | Persist-mode highlighting was not shown to map cleanly onto LLxprt’s model dialog semantics. | feat(ui): highlight persist mode status in ModelDialog (#16483) |
| 147 | 428e6028822 | — | a2a, remote-agents | SKIP | The exact A2A utility/invocation files touched upstream are absent in LLxprt’s implementation. | refactor: clean up A2A task output for users and LLMs (#16561) |
| 149 | 933bc5774fe | — | ui components | SKIP | LLxprt’s MaxSizedBox implementation is architecturally different from the upstream ResizeObserver rewrite. | Modernize MaxSizedBox to use <Box maxHeight> and ResizeObservers (#16565) |
| 153 | cd7a5c96045 | — | release | SKIP | Release preview version bump is not product code. | chore(release): v0.25.0-preview.0 |
| 155 | 46079d9daae | — | build, tsconfig | SKIP | Package-path mapping is upstream-branding-specific and would need LLxprt-specific configuration instead. | Patch #16730 into v0.25.0 preview (#16882) |
| 156 | de86bccd0d7 | — | release | SKIP | Release preview bump only. | chore(release): v0.25.0-preview.1 |
| 159 | b1f7a7e6f7d | — | release | SKIP | Release preview bump only. | chore(release): v0.25.0-preview.2 |
| 160 | 6289c3ee3f6 | — | config, extensions | SKIP | The extension-config feature flag was not audited as a necessary sync for LLxprt’s extension model. | fix(patch): cherry-pick 3b55581 to release/v0.25.0-preview.2-pr-16506 |
| 161 | 982fd1fc294 | — | release | SKIP | Release preview bump only. | chore(release): v0.25.0-preview.3 |
| 164 | eb883434196 | — | release | SKIP | Release preview bump only. | chore(release): v0.25.0-preview.4 |
| 165 | c9dbf700433 | — | release | SKIP | Final 0.25.0 release bump only. | chore(release): v0.25.0 |
| 166 | 2a8e1a8cc1c | — | auth, startup | SKIP | LLxprt auth and startup flows are completely different from upstream’s auth recovery path. | fix(patch): cherry-pick 87a0db2 to release/v0.25.0-pr-17308 [CONFLICTS] |
| 167 | 29d4b1e6b84 | — | release | SKIP | 0.25.1 release bump only. | chore(release): v0.25.1 |
| 169 | 83a3b070505 | — | release | SKIP | 0.25.2 release bump only. | chore(release): v0.25.2 |

## REIMPLEMENT Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 8 | 5fe5d1da467 | — | policy, scheduler | REIMPLEMENT | The useful regex/policy behavior exists in a diverged policy engine, so LLxprt should port the intent rather than cherry-pick the mixed scheduler refactor. | policy: extract legacy policy from core tool scheduler to policy engine (#15902) |
| 9 | 416d243027d | — | testing, integration-tests | REIMPLEMENT | TestRig timeout/process-management improvements are valuable, but LLxprt’s test harness diverges enough to require a local implementation. | Enhance TestRig with process management and timeouts (#15908) |
| 12 | 97b31c4eefa | — | extensions, cli | REIMPLEMENT | LLxprt needs the extension-settings UX improvement, but must reimplement it against its own command structure and config surfaces. | Simplify extension settings command (#16001) |
| 15 | c64b5ec4a3a | — | hooks | REIMPLEMENT | HookSystem wrapper methods are useful, but LLxprt’s rewritten HookSystem requires architectural adaptation. | feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982) |
| 17 | 4c961df3136 | — | hooks, config | REIMPLEMENT | Separating hooks UI visibility from execution is a good idea, but LLxprt’s config/hooks architecture differs substantially. | feat(core): Decouple enabling hooks UI from subsystem. (#16074) |
| 18 | 17b3eb730a9 | — | documentation | REIMPLEMENT | LLxprt has its own docs set; the useful part is a hooks-in-extensions section that should be written in LLxprt’s documentation style. | docs: add docs for hooks + extensions (#16073) |
| 35 | 030847a80a4 | — | bug command, history export | REIMPLEMENT | Chat-history export in `/bug` is desirable, but the command content, URLs, and utility plumbing need LLxprt-specific branding and code shape. | feat(cli): export chat history in /bug and prefill GitHub issue (#16115) |
| 39 | 97ad3d97cba | — | admin, extensions, config | REIMPLEMENT | Disabling admin-managed extensions is valuable, but LLxprt’s extension architecture differs enough to require a fresh implementation. | Reapply "feat(admin): implement extensions disabled" (#16082) (#16109) |
| 40 | 660368f2490 | — | hooks, translator | REIMPLEMENT | LLxprt may have the same hookTranslator spew issue, but the implementation differs and should be fixed locally rather than cherry-picked. | bug(core): Fix spewie getter in hookTranslator.ts (#16108) |
| 41 | eb3f3cfdb8a | — | hooks, MCP | REIMPLEMENT | MCP context in hook inputs is valuable, but LLxprt’s hook trigger architecture differs from upstream’s implementation path. | feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656) |
| 63 | 18dd399cb57 | — | ui, agents, suggestions | REIMPLEMENT | The @subagent suggestion idea is strong, but it should be rebuilt for LLxprt’s SubagentManager and task() flow. | Support @ suggestions for subagents (#16201) |
| 64 | e1e3efc9d04 | — | hooks, model execution | REIMPLEMENT | Stop/block execution control is a good feature, but LLxprt needs it integrated into its own HookSystem/event model. | feat(hooks): Support explicit stop and block execution control in model hooks (#15947) |
| 65 | 41e627a7ee4 | — | prompts | REIMPLEMENT | Gemini 3 verbosity reduction guidance should be added via per-model prompt .md files (gemini-3-pro-preview and gemini-3-flash-preview) in LLxprt's prompt system. | Refine Gemini 3 system instructions to reduce model verbosity (#16139) |

| 70 | 77e226c55fe | — | extensions, config, ui | REIMPLEMENT | Showing extension settings source is useful, but LLxprt’s settings infrastructure differs from upstream’s implementation. | Show settings source in extensions lists (#16207) |
| 77 | c7d17dda49d | — | hooks, ui | REIMPLEMENT | The `systemMessage` handling depends on hook stop/block events that LLxprt does not implement in the same way. | fix: properly use systemMessage for hooks in UI (#16250) |
| 84 | b08b0d715b5 | — | prompts | REIMPLEMENT | The non-interactive guidance is valuable, but LLxprt should apply it in its own prompt .md system rather than upstream prompt files. | Update system prompt to prefer non-interactive commands (#16117) |
| 86 | 461c277bf2d | — | skills, ui | REIMPLEMENT | Built-in skill filtering/`--all` support is relevant, but LLxprt’s skill types and command architecture have diverged. | Support for Built-in Agent Skills (#16045) |
| 95 | 0e955da1710 | — | debug, ui | REIMPLEMENT | `/chat debug` is useful, but upstream’s nightly gating and request-export plumbing need LLxprt-specific adaptation. | feat(cli): add /chat debug command for nightly builds (#16339) |
| 97 | 9703fe73cf9 | — | hooks, ui | REIMPLEMENT | Enable-all/disable-all hooks UX is desirable, but the command logic must be rebuilt on LLxprt’s HookSystem registry APIs. | feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552) |
| 101 | 950244f6b00 | — | performance, ui | REIMPLEMENT | LLxprt has the same OOM/perf risk in both alternate-buffer and ScrollableList rendering paths (neither uses useMemo/React.memo), but DefaultAppLayout.tsx differs from upstream's MainContent.tsx. | Attempt to resolve OOM w/ useMemo on history items (#16424) |

| 105 | 8a2e0fac0d8 | — | hooks | REIMPLEMENT | Additional HookSystem wrapper methods fit LLxprt in concept, but not as a direct patch against the rewritten hook architecture. | Add other hook wrapper methods to hooksystem (#16361) |
| 124 | c572b9e9ac6 | — | cli, session-cleanup | REIMPLEMENT | Session activity-log cleanup is good housekeeping, but LLxprt has a different session management system requiring adapted implementation. | feat(cli): cleanup activity logs alongside session files (#16399) |

| 128 | 304caa4e43a | — | ui, loading indicator | REIMPLEMENT | The action-required/focus-hint refinement solves a real UX problem, but LLxprt’s state model differs too much for a direct cherry-pick. | fix(cli): refine 'Action Required' indicator and focus hints (#16497) |
| 129 | a6dca02344b | — | hooks, agent lifecycle | REIMPLEMENT | Hook event output refactoring for beforeAgent/afterAgent is needed for upstream hooks compatibility, but must be adapted to LLxprt's HookSystem. | Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495) |

| 132 | aa524625503 | — | extensions, subagents | REIMPLEMENT | Extension-provided subagents are in-scope, but LLxprt’s extension and agent registration systems have diverged and need a fresh implementation. | Implement support for subagents as extensions. (#16473) |
| 135 | 92e31e3c4ae | — | settings, agents, config | REIMPLEMENT | Agent settings in settings.json are relevant, but LLxprt needs a provider-aware config/schema design rather than upstream’s exact shape. | feat(core, cli): Add support for agents in settings.json. (#16433) |
| 150 | 8030404b08b | — | ci, testing | REIMPLEMENT | Behavioral evals framework concept is valuable for validating model steering across providers, but needs reimplementation for LLxprt's multi-provider architecture and existing CI setup. | Behavioral evals framework. (#16047) |
| 151 | 66e7b479ae4 | — | ci, testing | REIMPLEMENT | Test-result aggregation and nightly pass-rate trending pairs with the behavioral evals framework reimplementation. | Aggregate test results. (#16581) |


## NO_OP Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 19 | 19bdd95eab6 | — | admin, extensions | NO_OP | This is only the revert of the skipped extensions-disabled attempt, so it has no standalone action for LLxprt. | Revert "feat(admin): implement extensions disabled" (#16082) |
| 42 | 02cf264ee10 | — | extensions, cli | NO_OP | LLxprt already has extension linking in packages/cli/src/commands/extensions/link.ts, so this upstream addition is already covered. | Add extension linking capabilities in cli (#16040) |
| 44 | ced5110dab1 | — | docs | NO_OP | Trivial JSDoc typo fix with no functional effect and uncertain presence in LLxprt. | docs: correct typo in bufferFastReturn JSDoc (#16056) |
| 45 | 75bc41fc20e | — | docs | NO_OP | Trivial documentation typo fix with no product significance. | fix: typo in MCP servers settings description (#15929) |
| 53 | 9062a943e73 | — | docs | NO_OP | The includeDirectories doc fix is immediately obsoleted by later doc deletion and is not meaningful to carry. | docs(cli): fix includeDirectories nesting in configuration.md (#15067) |
| 88 | 6f7d7981894 | — | hooks | NO_OP | LLxprt does not have the removed sessionHookTriggers path, so this cleanup has no effect. | remove unused sessionHookTriggers and exports (#16324) |
| 107 | 0167392f226 | — | docs | NO_OP | Minor markdown formatting fix in docs with no product impact. | docs: Fix formatting issue in memport documentation (#14774) |
| 116 | b8cc414d5b3 | — | docs | NO_OP | Broken internal-link repair is a trivial doc-only tweak and may not map to LLxprt’s docs tree. | docs: fix broken internal link by using relative path (#15371) |
| 127 | 7bbfaabffa7 | — | policy, MCP | NO_OP | LLxprt’s policy engine already carries the MCP qualification/server-name behavior this fix was addressing. | fix(policy): ensure MCP policies match unqualified names in non-interactive mode (#16490) |
| 136 | b2e866585d4 | — | command completion, file selector | NO_OP | LLxprt already has the completion-mode plumbing that enabled `@` file selection on slash-command lines. | fix(cli): allow @ file selector on slash command lines (#16370) |
| 140 | 63c918fe7de | — | ui, sticky headers | NO_OP | LLxprt already contains part of the sticky-header fix and the remaining upstream shape does not map cleanly enough to treat as a pick. | fix(ui): resolve sticky header regression in tool messages (#16514) |
| 148 | 4afd3741df7 | — | retry, ux | NO_OP | The batch audit treated this retry/UX change as already sufficiently covered or not directly actionable in LLxprt’s current stack. | feat(core/ui): enhance retry mechanism and UX (#16489) |
| 154 | 1d5e792a411 | — | hooks, tool-scheduler | NO_OP | LLxprt already has async `scheduleToolCalls` typing and await sites, so this patch is present. | fix(patch): cherry-pick cfdc4cf to release/v0.25.0-preview.0-pr-16759 |
| 162 | 02e68e45547 | — | thinking, turn parsing | NO_OP | LLxprt already iterates all parts for thoughts and excludes thought parts from extracted text. | Fix: Process all parts in response chunks when thought is first (#13539) |
| 168 | 18e854c3309 | — | ui, editor | NO_OP | LLxprt already has the corrected VISUAL/EDITOR fallback expression. | fix(patch): cherry-pick 9866eb0 to release/v0.25.1-pr-17166 |
