# 20251215gemerge Progress

Use this checklist to track what's done vs remaining during execution.

---

## Current Status (Update after each batch)

| Field | Value |
|-------|-------|
| **Last Completed** | Batch 25 |
| **In Progress** | — |
| **Next Up** | Batch 26 |
| **Progress** | 25/52 (48%) |
| **Last Updated** | 2025-12-15 |

---

## Rules

- Only check a batch when it is **fully complete**: conflicts resolved + required verification is green + records committed/pushed.
- After checking a batch, add a full entry for that batch in `project-plans/20251215gemerge/NOTES.md`.
- **PREREQUISITE ENFORCEMENT**: Each batch requires the previous batch's record to exist. If missing, Researcher Subagent must fill the gap.
- **EVIDENCE REQUIRED**: Records must include actual command output, not summaries.

---

## Record Requirements Per Batch

Each completed batch MUST have the following in `NOTES.md`:

| Record Type | Required For | Contents |
|-------------|--------------|----------|
| Selection Record | All | Batch number, type, upstream SHA(s), prerequisites check |
| Execution Record | All | Resulting commit SHA, conflicts, files modified |
| Verification Record | All | Command output (typecheck, lint, optionally test/build/synthetic) |
| Feature Landing | All | Evidence showing the actual code change landed |
| Commit/Push Record | All | Branch commit SHA, push confirmation |

---

## Preflight

- [ ] On `main`: `git pull --ff-only`
- [ ] Branch exists: `git checkout -b 20251215gemerge`
- [ ] Upstream remote + tags fetched: `git fetch upstream --tags`
- [ ] Clean worktree before Batch 01: `git status --porcelain` is empty
- [ ] File existence pre-check run (see `project-plans/20251215gemerge/PLAN.md`)

**Preflight Record Required**: Before Batch 01, document the preflight steps with actual command output.

---

## Batches (Chronological)

### Legend

- `[ ]` = Not started
- `[P]` = In progress (batch executing)
- `[V]` = Verification pending
- `[R]` = Records pending (batch done, records not committed)
- `[x]` = Complete (verified + records committed/pushed)

### Batch Checklist

- [x] Batch 01 — QUICK — PICK — `8980276b` — Rationalize different Extension typings (#10435)
  - Prerequisites: Preflight complete
  - Record Location: NOTES.md ## Batch 01

- [x] Batch 02 — FULL — REIMPLEMENT — `8ac2c684` — chore: bundle a2a-server (#10265)
  - Prerequisites: Batch 01 record exists
  - Record Location: NOTES.md ## Batch 02

- [x] Batch 03 — QUICK — PICK — `1af3fef3, 603ec2b2, 467a305f, b92e3bca, 1962b51d` — fix(infra) - Remove auto update from integration tests (#10656) / Add script to deflake integration tests (#10666) / chore(shell): Enable interactive shell by default (#10661) / fix(mcp): fix MCP server removal not persisting to settings (#10098) / fix: ensure positional prompt arguments work with extensions flag (#10077)
  - Prerequisites: Batch 02 record exists
  - Record Location: NOTES.md ## Batch 03

- [x] Batch 04 — FULL — PICK — `f2852056, 76b1deec, 118aade8` — feat: prevent ansi codes in extension MCP Servers (#10748) / fix(core): refresh file contents in smart edit given newer edits from user/external process (#10084) / citations documentation (#10742)
  - Prerequisites: Batch 03 record exists
  - Record Location: NOTES.md ## Batch 04

- [x] Batch 05 — QUICK — REIMPLEMENT — `8d8a2ab6` — Fix(doc) - Add section in docs for deflaking (#10750)
  - Prerequisites: Batch 04 record exists, Batch 03 (`603ec2b2`) adds `scripts/deflake.js`
  - Record Location: NOTES.md ## Batch 05

- [x] Batch 06 — FULL — PICK — `741b57ed` — fix(core): Use shell for spawn on Windows (#9995)
  - Prerequisites: Batch 05 record exists
  - Record Location: NOTES.md ## Batch 06

- [x] Batch 07 — QUICK — REIMPLEMENT — `bcbcaeb8` — fix(docs): Update docs/faq.md per Srinanth (#10667)
  - Prerequisites: Batch 06 record exists
  - Record Location: NOTES.md ## Batch 07
  - Note: NO-OP - target files don't exist in LLxprt

- [x] Batch 08 — FULL — PICK — `06920402` — feat(core): Stop context window overflow when sending chat (#10459)
  - Prerequisites: Batch 07 record exists
  - Record Location: NOTES.md ## Batch 08

- [x] Batch 09 — QUICK — PICK — `a044c259` — fix: Add a message about permissions command on startup in untrusted … (#10755)
  - Prerequisites: Batch 08 record exists
  - Record Location: NOTES.md ## Batch 09

- [x] Batch 10 — FULL — REIMPLEMENT — `0cd490a9` — feat: support GOOGLE_CLOUD_PROJECT_ID fallback (fixes #2262) (#2725)
  - Prerequisites: Batch 09 record exists
  - Record Location: NOTES.md ## Batch 10

- [x] Batch 11 — QUICK — PICK — `b60c8858, cd354aeb` — feat(ui): shorten context overflow message when <50% of limit (#10812) / Fix hooks to avoid unnecessary re-renders (#10820)
  - Prerequisites: Batch 10 record exists
  - Record Location: NOTES.md ## Batch 11

- [x] Batch 12 — FULL — REIMPLEMENT — `bd6bba8d` — fix(doc) - Update doc for deflake command (#10829)
  - Prerequisites: Batch 11 record exists, Batch 03 (`603ec2b2`) adds `scripts/deflake.js`
  - Record Location: NOTES.md ## Batch 12

- [x] Batch 13 — QUICK — PICK — `433ca84c, 6d84d4dc, a8379d1f` — fix(tests): log actual output in validateModelOutput on failure (#10843) / Fix prompt to make it a bit more deterministic (#10848) / fix(tests): enable and update prompt for MCP add tool test (#10850)
  - Prerequisites: Batch 12 record exists
  - Record Location: NOTES.md ## Batch 13

- [x] Batch 14 — FULL — PICK — `5f96eba5` — fix(cli): prevent exit on non-fatal tool errors (#10671)
  - Prerequisites: Batch 13 record exists
  - Record Location: NOTES.md ## Batch 14

- [x] Batch 15 — QUICK — REIMPLEMENT — `5e688b81` — Skip should fail safely when old_string is not found test (#10853)
  - Prerequisites: Batch 14 record exists
  - Record Location: NOTES.md ## Batch 15

- [x] Batch 16 — FULL — REIMPLEMENT — `5aab793c` — fix(infra) - Fix interactive system error (#10805)
  - Prerequisites: Batch 15 record exists
  - Record Location: NOTES.md ## Batch 16
  - Note: NO-OP - file doesn't exist in LLxprt

- [x] Batch 17 — QUICK — REIMPLEMENT — `0b6c0200` — feat(core): Failed Response Retry via Extra Prompt (#10828)
  - Prerequisites: Batch 16 record exists
  - Record Location: NOTES.md ## Batch 17

- [x] Batch 18 — FULL — PICK — `ed37b7c5, 21062dd3` — fix some isWorkspaceTrusted mocks (#10836) / clean up extension tests (#10857)
  - Prerequisites: Batch 17 record exists
  - Record Location: NOTES.md ## Batch 18

- [x] Batch 19 — QUICK — REIMPLEMENT — `c82c2c2b` — chore: add a2a server bin (#10592)
  - Prerequisites: Batch 18 record exists, Batch 02 (`8ac2c684`) bundles a2a-server
  - Record Location: NOTES.md ## Batch 19

- [x] Batch 20 — FULL — REIMPLEMENT — `558be873` — Re-land bbiggs changes to reduce margin on narrow screens with fixes + full width setting (#10522)
  - Prerequisites: Batch 19 record exists
  - Record Location: NOTES.md ## Batch 20

- [x] Batch 21 — QUICK — PICK — `65b9e367` — Docs: Fix broken links in architecture.md (#10747)
  - Prerequisites: Batch 20 record exists
  - Record Location: NOTES.md ## Batch 21
  - Note: NO-OP - LLxprt already uses correct relative paths

- [x] Batch 22 — FULL — PICK — `971eb64e` — fix(cli) : fixed bug #8310 where /memory refresh will create discrepancies with initial memory load ignoring settings/config for trusted folder and file filters (#10611)
  - Prerequisites: Batch 21 record exists
  - Record Location: NOTES.md ## Batch 22

- [x] Batch 23 — QUICK — PICK — `affd3cae, 249ea559` — fix: Prevent garbled input during "Login With Google" OAuth prompt on… (#10888) / fix(test): Fix flaky shell command test using date command (#10863)
  - Prerequisites: Batch 22 record exists
  - Record Location: NOTES.md ## Batch 23

- [x] Batch 24 — FULL — REIMPLEMENT — `849cd1f9` — Docs: Fix Flutter extension link in docs/changelogs/index.md (#10797)
  - Prerequisites: Batch 23 record exists
  - Record Location: NOTES.md ## Batch 24
  - Note: NO-OP - No Flutter references in LLxprt docs

- [x] Batch 25 — QUICK — REIMPLEMENT — `32db4ff6` — Disable flakey tests. (#10914)
  - Prerequisites: Batch 24 record exists
  - Record Location: NOTES.md ## Batch 25
  - Note: NO-OP - LLxprt uses targeted skips, not blanket describe.skip()

- [ ] Batch 26 — FULL — PICK — `c6af4eaa, a5e47c62, 0a7ee677` — fix: Usage of folder trust config flags in FileCommandLoader (#10837) / Docs: Update to tos-privacy.md (#10754) / Show notification in screen reader mode (#10900)
  - Prerequisites: Batch 25 record exists
  - Record Location: NOTES.md ## Batch 26

- [ ] Batch 27 — QUICK — REIMPLEMENT — `ab3804d8` — refactor(core): migrate web search tool to tool-names (#10782)
  - Prerequisites: Batch 26 record exists
  - Record Location: NOTES.md ## Batch 27

- [ ] Batch 28 — FULL — PICK — `bf0f61e6` — Show final install path in extension consent dialog and fix isWorkspaceTrusted check (#10830)
  - Prerequisites: Batch 27 record exists
  - Record Location: NOTES.md ## Batch 28

- [ ] Batch 29 — QUICK — REIMPLEMENT — `a6e00d91` — Fix rough edges around extension updates (#10926)
  - Prerequisites: Batch 28 record exists
  - Record Location: NOTES.md ## Batch 29

- [ ] Batch 30 — FULL — REIMPLEMENT — `a64bb433` — Simplify auth in interactive tests. (#10921)
  - Prerequisites: Batch 29 record exists
  - Record Location: NOTES.md ## Batch 30

- [ ] Batch 31 — QUICK — REIMPLEMENT — `37678acb` — Update deployment.md -> installation.md and sidebar links. (#10662)
  - Prerequisites: Batch 30 record exists
  - Record Location: NOTES.md ## Batch 31

- [ ] Batch 32 — FULL — PICK — `265d39f3` — feat(core): improve shell execution service reliability (#10607)
  - Prerequisites: Batch 31 record exists
  - Record Location: NOTES.md ## Batch 32

- [ ] Batch 33 — QUICK — PICK — `ead8928c, cd919346` — Deflake test. (#10932) / Clean up integration test warnings. (#10931)
  - Prerequisites: Batch 32 record exists
  - Record Location: NOTES.md ## Batch 33

- [ ] Batch 34 — FULL — REIMPLEMENT — `5dc7059b` — Refactor: Introduce InteractiveRun class (#10947)
  - Prerequisites: Batch 33 record exists
  - Note: Required before Batch 52; incorporates Batch 39
  - Record Location: NOTES.md ## Batch 34

- [ ] Batch 35 — QUICK — PICK — `c23eb84b, 28e667bd` — fix(remove private) from gemini-cli-a2a-server (#11018) / Give explicit instructions for failure text in json-output.test.ts (#11029)
  - Prerequisites: Batch 34 record exists
  - Record Location: NOTES.md ## Batch 35

- [ ] Batch 36 — FULL — REIMPLEMENT — `19c1d734` — add bundle command info to integration test docs (#11034)
  - Prerequisites: Batch 35 record exists
  - Record Location: NOTES.md ## Batch 36

- [ ] Batch 37 — QUICK — REIMPLEMENT — `518caae6` — chore: Extract '.gemini' to GEMINI_DIR constant (#10540)
  - Prerequisites: Batch 36 record exists
  - Record Location: NOTES.md ## Batch 37

- [ ] Batch 38 — FULL — REIMPLEMENT — `4a5ef4d9` — fix(infra) - Fix flake for file interactive system (#11019)
  - Prerequisites: Batch 37 record exists
  - Record Location: NOTES.md ## Batch 38

- [ ] Batch 39 — QUICK — REIMPLEMENT — `a73b8145` — Rename expect methods. (#11046)
  - Prerequisites: Batch 38 record exists
  - Note: NO-OP (folded into Batch 34)
  - Record Location: NOTES.md ## Batch 39

- [ ] Batch 40 — FULL — PICK — `77162750` — chore(settings): Enable 'useSmartEdit' by default (#11051)
  - Prerequisites: Batch 39 record exists
  - Record Location: NOTES.md ## Batch 40

- [ ] Batch 41 — QUICK — REIMPLEMENT — `c4bd7594` — document all settings with showInDialog: true (#11049)
  - Prerequisites: Batch 40 record exists
  - Record Location: NOTES.md ## Batch 41

- [ ] Batch 42 — FULL — REIMPLEMENT — `ada179f5` — bug(core): Process returned function calls sequentially. (#10659)
  - Prerequisites: Batch 41 record exists
  - Note: Must preserve parallel batching (buffered publish ordering)
  - Record Location: NOTES.md ## Batch 42

- [ ] Batch 43 — QUICK — PICK — `6787d42d, a3fe9279, 249a193c, b2ba67f3, 3ba4ba79` — perf(core): optimize Windows IDE process detection from O(N) to O(1) (#11048) / fix(compression): prevent unnecessary summarization when history is too short (#11082) / Update system instructions for optimizing shell tool commands (#10651) / fix: Exit app on pressing esc on trust dialog at launch (#10668) / Remove workflow examples from system instruction (#10811)
  - Prerequisites: Batch 42 record exists
  - Record Location: NOTES.md ## Batch 43

- [ ] Batch 44 — FULL — PICK — `9e8c7676` — fix(cli): record tool calls in non-interactive mode (#10951)
  - Prerequisites: Batch 43 record exists
  - Record Location: NOTES.md ## Batch 44

- [ ] Batch 45 — QUICK — PICK — `7b06a0be` — fix(e2e): Use rmSync instead of rm -rf for e2e tests (#11087)
  - Prerequisites: Batch 44 record exists
  - Record Location: NOTES.md ## Batch 45

- [ ] Batch 46 — FULL — REIMPLEMENT — `7c1a9024` — fix(core): add retry logic for specific fetch errors (#11066)
  - Prerequisites: Batch 45 record exists
  - Note: NO-OP (already covered)
  - Record Location: NOTES.md ## Batch 46

- [ ] Batch 47 — QUICK — REIMPLEMENT — `49b66733` — fix(infra) - Disable CTRL-C test (#11122)
  - Prerequisites: Batch 46 record exists
  - Record Location: NOTES.md ## Batch 47

- [ ] Batch 48 — FULL — REIMPLEMENT — `99c7108b` — fix integration test static errors, and run_shell_command tests to actually be testing what they intend (#11050)
  - Prerequisites: Batch 47 record exists
  - Record Location: NOTES.md ## Batch 48

- [ ] Batch 49 — QUICK — REIMPLEMENT — `769fe8b1` — Delete unworkable replace test and enabled the rest (#11125)
  - Prerequisites: Batch 48 record exists
  - Record Location: NOTES.md ## Batch 49

- [ ] Batch 50 — FULL — REIMPLEMENT — `6f0107e7` — fix(core): implement robust URL validation in web_fetch tool (#10834)
  - Prerequisites: Batch 49 record exists
  - Record Location: NOTES.md ## Batch 50

- [ ] Batch 51 — QUICK — PICK — `dabe161a` — Don't accept input until slash commands are loaded (#11162)
  - Prerequisites: Batch 50 record exists
  - Record Location: NOTES.md ## Batch 51

- [ ] Batch 52 — FULL — REIMPLEMENT — `4f5b3357` — fix(tests): enable cyclic schema MCP tool test (#10912)
  - Prerequisites: Batch 51 record exists, Batch 34 (`5dc7059b`) introduces InteractiveRun
  - Record Location: NOTES.md ## Batch 52

---

## Summary Statistics

| Status | Count |
|--------|-------|
| Total Batches | 52 |
| PICK Batches | 23 |
| REIMPLEMENT Batches | 29 |
| Completed | 0 |
| Remaining | 52 |

---

## Prerequisite Verification

Before starting any batch, the Picker Subagent must verify:

1. **Previous batch record exists** in `NOTES.md`
2. **Previous batch verification passed** (PASS recorded)
3. **Previous batch was pushed** (commit SHA recorded)
4. **Any special dependencies** (listed in batch prerequisites above)

If any prerequisite is missing:

1. STOP batch execution
2. Invoke Researcher Subagent to investigate
3. Researcher generates missing record with evidence
4. Only then proceed with current batch
