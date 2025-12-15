# 20251215gemerge Progress

Use this checklist to track what’s done vs remaining during execution.

Rules:

- Only check a batch when it is fully complete: conflicts resolved + required verification is green.
- After checking a batch, add a short entry for that batch in `project-plans/20251215gemerge/NOTES.md`.

## Preflight

- [ ] On `main`: `git pull --ff-only`
- [ ] Branch exists: `git checkout -b 20251215gemerge`
- [ ] Upstream remote + tags fetched: `git fetch upstream --tags`
- [ ] Clean worktree before Batch 01: `git status --porcelain` is empty
- [ ] File existence pre-check run (see `project-plans/20251215gemerge/PLAN.md`)

## Batches (Chronological)

- [ ] Batch 01 — QUICK — PICK — `8980276b` — Rationalize different Extension typings (#10435)
- [ ] Batch 02 — FULL — REIMPLEMENT — `8ac2c684` — chore: bundle a2a-server (#10265)
- [ ] Batch 03 — QUICK — PICK — `1af3fef3, 603ec2b2, 467a305f, b92e3bca, 1962b51d` — fix(infra) - Remove auto update from integration tests (#10656) / Add script to deflake integration tests (#10666) / chore(shell): Enable interactive shell by default (#10661) / fix(mcp): fix MCP server removal not persisting to settings (#10098) / fix: ensure positional prompt arguments work with extensions flag (#10077)
- [ ] Batch 04 — FULL — PICK — `f2852056, 76b1deec, 118aade8` — feat: prevent ansi codes in extension MCP Servers (#10748) / fix(core): refresh file contents in smart edit given newer edits from user/external process (#10084) / citations documentation (#10742)
- [ ] Batch 05 — QUICK — REIMPLEMENT — `8d8a2ab6` — Fix(doc) - Add section in docs for deflaking (#10750)
- [ ] Batch 06 — FULL — PICK — `741b57ed` — fix(core): Use shell for spawn on Windows (#9995)
- [ ] Batch 07 — QUICK — REIMPLEMENT — `bcbcaeb8` — fix(docs): Update docs/faq.md per Srinanth (#10667)
- [ ] Batch 08 — FULL — PICK — `06920402` — feat(core): Stop context window overflow when sending chat (#10459)
- [ ] Batch 09 — QUICK — PICK — `a044c259` — fix: Add a message about permissions command on startup in untrusted … (#10755)
- [ ] Batch 10 — FULL — REIMPLEMENT — `0cd490a9` — feat: support GOOGLE_CLOUD_PROJECT_ID fallback (fixes #2262) (#2725)
- [ ] Batch 11 — QUICK — PICK — `b60c8858, cd354aeb` — feat(ui): shorten context overflow message when <50% of limit (#10812) / Fix hooks to avoid unnecessary re-renders (#10820)
- [ ] Batch 12 — FULL — REIMPLEMENT — `bd6bba8d` — fix(doc) - Update doc for deflake command (#10829)
- [ ] Batch 13 — QUICK — PICK — `433ca84c, 6d84d4dc, a8379d1f` — fix(tests): log actual output in validateModelOutput on failure (#10843) / Fix prompt to make it a bit more deterministic (#10848) / fix(tests): enable and update prompt for MCP add tool test (#10850)
- [ ] Batch 14 — FULL — PICK — `5f96eba5` — fix(cli): prevent exit on non-fatal tool errors (#10671)
- [ ] Batch 15 — QUICK — REIMPLEMENT — `5e688b81` — Skip should fail safely when old_string is not found test (#10853)
- [ ] Batch 16 — FULL — REIMPLEMENT — `5aab793c` — fix(infra) - Fix interactive system error (#10805)
- [ ] Batch 17 — QUICK — REIMPLEMENT — `0b6c0200` — feat(core): Failed Response Retry via Extra Prompt (#10828)
- [ ] Batch 18 — FULL — PICK — `ed37b7c5, 21062dd3` — fix some isWorkspaceTrusted mocks (#10836) / clean up extension tests (#10857)
- [ ] Batch 19 — QUICK — REIMPLEMENT — `c82c2c2b` — chore: add a2a server bin (#10592)
- [ ] Batch 20 — FULL — REIMPLEMENT — `558be873` — Re-land bbiggs changes to reduce margin on narrow screens with fixes + full width setting (#10522)
- [ ] Batch 21 — QUICK — PICK — `65b9e367` — Docs: Fix broken links in architecture.md (#10747)
- [ ] Batch 22 — FULL — PICK — `971eb64e` — fix(cli) : fixed bug #8310 where /memory refresh will create discrepancies with initial memory load ignoring settings/config for trusted folder and file filters (#10611)
- [ ] Batch 23 — QUICK — PICK — `affd3cae, 249ea559` — fix: Prevent garbled input during "Login With Google" OAuth prompt on… (#10888) / fix(test): Fix flaky shell command test using date command (#10863)
- [ ] Batch 24 — FULL — REIMPLEMENT — `849cd1f9` — Docs: Fix Flutter extension link in docs/changelogs/index.md (#10797)
- [ ] Batch 25 — QUICK — REIMPLEMENT — `32db4ff6` — Disable flakey tests. (#10914)
- [ ] Batch 26 — FULL — PICK — `c6af4eaa, a5e47c62, 0a7ee677` — fix: Usage of folder trust config flags in FileCommandLoader (#10837) / Docs: Update to tos-privacy.md (#10754) / Show notification in screen reader mode (#10900)
- [ ] Batch 27 — QUICK — REIMPLEMENT — `ab3804d8` — refactor(core): migrate web search tool to tool-names (#10782)
- [ ] Batch 28 — FULL — PICK — `bf0f61e6` — Show final install path in extension consent dialog and fix isWorkspaceTrusted check (#10830)
- [ ] Batch 29 — QUICK — REIMPLEMENT — `a6e00d91` — Fix rough edges around extension updates (#10926)
- [ ] Batch 30 — FULL — REIMPLEMENT — `a64bb433` — Simplify auth in interactive tests. (#10921)
- [ ] Batch 31 — QUICK — REIMPLEMENT — `37678acb` — Update deployment.md -> installation.md and sidebar links. (#10662)
- [ ] Batch 32 — FULL — PICK — `265d39f3` — feat(core): improve shell execution service reliability (#10607)
- [ ] Batch 33 — QUICK — PICK — `ead8928c, cd919346` — Deflake test. (#10932) / Clean up integration test warnings. (#10931)
- [ ] Batch 34 — FULL — REIMPLEMENT — `5dc7059b` — Refactor: Introduce InteractiveRun class (#10947)
- [ ] Batch 35 — QUICK — PICK — `c23eb84b, 28e667bd` — fix(remove private) from gemini-cli-a2a-server (#11018) / Give explicit instructions for failure text in json-output.test.ts (#11029)
- [ ] Batch 36 — FULL — REIMPLEMENT — `19c1d734` — add bundle command info to integration test docs (#11034)
- [ ] Batch 37 — QUICK — REIMPLEMENT — `518caae6` — chore: Extract '.gemini' to GEMINI_DIR constant (#10540)
- [ ] Batch 38 — FULL — REIMPLEMENT — `4a5ef4d9` — fix(infra) - Fix flake for file interactive system (#11019)
- [ ] Batch 39 — QUICK — REIMPLEMENT — `a73b8145` — Rename expect methods. (#11046)
- [ ] Batch 40 — FULL — PICK — `77162750` — chore(settings): Enable 'useSmartEdit' by default (#11051)
- [ ] Batch 41 — QUICK — REIMPLEMENT — `c4bd7594` — document all settings with showInDialog: true (#11049)
- [ ] Batch 42 — FULL — REIMPLEMENT — `ada179f5` — bug(core): Process returned function calls sequentially. (#10659)
- [ ] Batch 43 — QUICK — PICK — `6787d42d, a3fe9279, 249a193c, b2ba67f3, 3ba4ba79` — perf(core): optimize Windows IDE process detection from O(N) to O(1) (#11048) / fix(compression): prevent unnecessary summarization when history is too short (#11082) / Update system instructions for optimizing shell tool commands (#10651) / fix: Exit app on pressing esc on trust dialog at launch (#10668) / Remove workflow examples from system instruction (#10811)
- [ ] Batch 44 — FULL — PICK — `9e8c7676` — fix(cli): record tool calls in non-interactive mode (#10951)
- [ ] Batch 45 — QUICK — PICK — `7b06a0be` — fix(e2e): Use rmSync instead of rm -rf for e2e tests (#11087)
- [ ] Batch 46 — FULL — REIMPLEMENT — `7c1a9024` — fix(core): add retry logic for specific fetch errors (#11066)
- [ ] Batch 47 — QUICK — REIMPLEMENT — `49b66733` — fix(infra) - Disable CTRL-C test (#11122)
- [ ] Batch 48 — FULL — REIMPLEMENT — `99c7108b` — fix integration test static errors, and run_shell_command tests to actually be testing what they intend (#11050)
- [ ] Batch 49 — QUICK — REIMPLEMENT — `769fe8b1` — Delete unworkable replace test and enabled the rest (#11125)
- [ ] Batch 50 — FULL — REIMPLEMENT — `6f0107e7` — fix(core): implement robust URL validation in web_fetch tool (#10834)
- [ ] Batch 51 — QUICK — PICK — `dabe161a` — Don't accept input until slash commands are loaded (#11162)
- [ ] Batch 52 — FULL — REIMPLEMENT — `4f5b3357` — fix(tests): enable cyclic schema MCP tool test (#10912)

