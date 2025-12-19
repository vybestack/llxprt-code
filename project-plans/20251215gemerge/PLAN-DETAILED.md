# Plan: 20251215gemerge — gemini-cli v0.9.0 → v0.10.0 (Deprecated Inline Version)

> Deprecated: use `project-plans/20251215gemerge/PLAN.md` (orchestrator) and the per-commit `project-plans/20251215gemerge/*-plan.md` files.

This plan executes the `PICK`/`REIMPLEMENT` decisions in `project-plans/20251215gemerge/CHERRIES.md` using:

- **Batches of 5** for `PICK` commits (applied in one `git cherry-pick …` command per batch).
- **Batch size 1** for every `REIMPLEMENT` (and a few intentionally-solo `PICK`s).
- **Chronological order** (upstream commit index order).
- **Verification cadence**:
  - After **every** batch: “quick” verification (**compile + lint**).
  - After **every 2nd** batch: **full verification suite**.

References:

- `dev-docs/cherrypicking.md` (process + what to preserve/skip)
- `project-plans/20251215gemerge/CHERRIES.md` (full decision table)
- `project-plans/20251215gemerge/SUMMARY.md` (actionable subset)
- Upstream issue context: https://github.com/vybestack/llxprt-code/issues/707

---

## Non-Negotiables (LLxprt Invariants)

These are the rules for conflict resolution and reimplementation. If an upstream commit conflicts with these, **keep LLxprt behavior**.

### Privacy / telemetry

- **Do not reintroduce `ClearcutLogger`** or any telemetry that sends data to Google.
- If an upstream commit adds telemetry events/loggers/types solely for Clearcut, **drop those hunks**.

### Multi-provider architecture

- Keep LLxprt’s provider selection and routing (OpenAI/Anthropic/etc). Do not regress to Google-only flows.
- Be wary of upstream changes that assume Gemini-only auth or single-provider config.

### Tool scheduler and batching

- `dev-docs/cherrypicking.md` explicitly warns against upstream scheduler/queue work that reduces LLxprt batching.
- If upstream fixes a real correctness bug in scheduling, **port the fix** but keep LLxprt’s parallel batching model (see reimplementation playbook for `ada179f5`).

### Branding / naming (apply everywhere)

- CLI name: **`llxprt`**, not `gemini`.
- Packages: **`@vybestack/llxprt-code-*`**, not `@google/gemini-cli-*`.
- Config dir: **`.llxprt`**, not `.gemini` (only keep `.gemini` in explicit migration code paths; prefer `LLXPRT_CONFIG_DIR` constant).
- Context file: **`LLXPRT.md`**, not `GEMINI.md`.
- Env vars: **`LLXPRT_CODE_*`** (and existing LLXPRT vars), not `GEMINI_CLI_*`.
  - Examples to preserve:
    - `LLXPRT_CODE_NO_RELAUNCH` (not `GEMINI_CLI_NO_RELAUNCH`)
    - `LLXPRT_CODE_IDE_SERVER_PORT` / `LLXPRT_CODE_IDE_WORKSPACE_PATH` (not `GEMINI_CLI_IDE_*`)
    - `LLXPRT_CODE_INTEGRATION_TEST` (not `GEMINI_CLI_INTEGRATION_TEST`) if we still need an env marker.

### “Emoji-free” policy

- Skip or edit any upstream changes that introduce emoji UI/phrases (per `dev-docs/cherrypicking.md`).

---

## Preflight (Do Once Before Batch 01)

1. Start from a clean base:
   - `git checkout main`
   - `git pull --ff-only`
   - `git checkout -b 20251215gemerge`
2. Ensure the upstream remote exists and is up to date:
   - `git remote add upstream https://github.com/google-gemini/gemini-cli.git` (if missing)
   - `git fetch upstream --tags`
3. Ensure working tree is clean before beginning:
   - `git status --porcelain` should be empty.
4. Optional but recommended: ensure you can view upstream commits locally:
   - `git show 8980276b` (should succeed)

---

## File Existence Pre-Check

Before starting the batches, verify which upstream-targeted files exist in LLXPRT. Any batch whose **LLXPRT target files are missing** must follow its playbook’s `SKIP-IF-MISSING` rule.

| File | Current Status | Affected Batches |
|------|----------------|------------------|
| `integration-tests/test-helper.ts` | MUST EXIST | 30, 34, 38, 39, 48, 52 |
| `integration-tests/file-system-interactive.test.ts` | LIKELY MISSING | 16, 25, 38 |
| `integration-tests/ctrl-c-exit.test.ts` | MUST EXIST | 47 |
| `docs/integration-tests.md` | MISSING (use `dev-docs/`) | 05, 12, 36 |
| `dev-docs/integration-tests.md` | MUST EXIST | 05, 12, 36 |
| `docs/changelogs/index.md` | MISSING (use grep fallback) | 24 |

Run this check:

```bash
for f in \
  integration-tests/test-helper.ts \
  integration-tests/file-system-interactive.test.ts \
  integration-tests/ctrl-c-exit.test.ts \
  dev-docs/integration-tests.md \
  docs/integration-tests.md \
  docs/changelogs/index.md; do
  test -f \"$f\" && echo \"✓ $f\" || echo \"✗ $f MISSING\"
done
```

---

## Branding Substitutions (apply to ALL files touched)

Apply these substitutions whenever upstream content uses Gemini CLI naming, unless a playbook explicitly says “keep for compatibility”.

| Pattern | Replacement |
|---------|-------------|
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |
| `gemini-cli-a2a-server` | `llxprt-code-a2a-server` (or chosen LLXPRT bin name) |
| `.gemini` (primary config dir) | `.llxprt` |
| `GEMINI.md` | `LLXPRT.md` |
| `GEMINI_CLI_*` (env vars) | `LLXPRT_CODE_*` |
| `gemini` (CLI command) | `llxprt` |

Bulk replacement helper (macOS `sed`):

```bash
sed -i '' \
  -e 's/@google\\/gemini-cli-core/@vybestack\\/llxprt-code-core/g' \
  -e 's/@google\\/gemini-cli/@vybestack\\/llxprt-code/g' \
  -e 's/gemini-cli-a2a-server/llxprt-code-a2a-server/g' \
  -e 's/\\.gemini\\//\\.llxprt\\//g' \
  -e 's/GEMINI\\.md/LLXPRT\\.md/g' \
  -e 's/GEMINI_CLI_/LLXPRT_CODE_/g' \
  \"$FILE\"
```

Bulk replacement helper (GNU `sed`):

```bash
sed -i \
  -e 's/@google\\/gemini-cli-core/@vybestack\\/llxprt-code-core/g' \
  -e 's/@google\\/gemini-cli/@vybestack\\/llxprt-code/g' \
  -e 's/gemini-cli-a2a-server/llxprt-code-a2a-server/g' \
  -e 's/\\.gemini\\//\\.llxprt\\//g' \
  -e 's/GEMINI\\.md/LLXPRT\\.md/g' \
  -e 's/GEMINI_CLI_/LLXPRT_CODE_/g' \
  \"$FILE\"
```

---

## Verification Commands

### After every batch (Quick: compile + lint)

Run:

```bash
npm run typecheck
npm run lint
```

If either fails: fix the batch issues, then re-run the quick verification before proceeding.

### After every 2nd batch (Full suite)

Run the full repository checklist (matches AGENTS.md):

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run build
node scripts/start.js --profile-load synthetic --prompt \"write me a haiku\"
```

If anything fails: fix, then re-run the full suite (don’t proceed with a red batch).

---

## Batching Rules

### “5-at-a-time” PICK batches

- For each `PICK` batch, run one command:
  - `git cherry-pick <sha1> <sha2> ...`
- Git will stop at conflicts; resolve; then `git cherry-pick --continue` until the batch completes.

### Mandatory singleton batches

- Every `REIMPLEMENT` is a single batch (manual port + one local commit).
- These `PICK`s are also singled out as “likely difficult / high-churn” (batch size 1):
  - `8980276b` (extension typing refactor; broad churn)
  - `06920402` (context-window core change)
  - `5f96eba5` (tool error handling / exit behavior)
  - `265d39f3` (shell execution reliability; OS-specific)
  - `971eb64e` (/memory refresh trust/filter interactions)
  - `9e8c7676` (non-interactive tool-call recording; overlaps LLxprt logging)
  - `dabe161a` (UI input gating / race conditions)

---

## Batch Schedule (Chronological)

Legend:

- **Verify**: `QUICK` means quick verification only; `FULL` means quick + full suite (because batch number is even).
- **Action**: `PICK` = cherry-pick upstream commit(s); `REIMPLEMENT` = port manually (one local commit).

| Batch | Verify | Action | Upstream # | Commits | Subject(s) |
|---:|:---:|:---|:---|:---|:---|
| 01 | QUICK | PICK | 3 | 8980276b | Rationalize different Extension typings (#10435) |
| 02 | FULL | REIMPLEMENT | 4 | 8ac2c684 | chore: bundle a2a-server (#10265) |
| 03 | QUICK | PICK | 6,7,11,12,13 | 1af3fef3, 603ec2b2, 467a305f, b92e3bca, 1962b51d | fix(infra) - Remove auto update from integration tests (#10656) / Add script to deflake integration tests (#10666) / chore(shell): Enable interactive shell by default (#10661) / fix(mcp): fix MCP server removal not persisting to settings (#10098) / fix: ensure positional prompt arguments work with extensions flag (#10077) |
| 04 | FULL | PICK | 14,15,16 | f2852056, 76b1deec, 118aade8 | feat: prevent ansi codes in extension MCP Servers (#10748) / fix(core): refresh file contents in smart edit given newer edits from user/external process (#10084) / citations documentation (#10742) |
| 05 | QUICK | REIMPLEMENT | 18 | 8d8a2ab6 | Fix(doc) - Add section in docs for deflaking (#10750) |
| 06 | FULL | PICK | 19 | 741b57ed | fix(core): Use shell for spawn on Windows (#9995) |
| 07 | QUICK | REIMPLEMENT | 22 | bcbcaeb8 | fix(docs): Update docs/faq.md per Srinanth (#10667) |
| 08 | FULL | PICK | 23 | 06920402 | feat(core): Stop context window overflow when sending chat (#10459) |
| 09 | QUICK | PICK | 27 | a044c259 | fix: Add a message about permissions command on startup in untrusted … (#10755) |
| 10 | FULL | REIMPLEMENT | 28 | 0cd490a9 | feat: support GOOGLE_CLOUD_PROJECT_ID fallback (fixes #2262) (#2725) |
| 11 | QUICK | PICK | 31,32 | b60c8858, cd354aeb | feat(ui): shorten context overflow message when <50% of limit (#10812) / Fix hooks to avoid unnecessary re-renders (#10820) |
| 12 | FULL | REIMPLEMENT | 33 | bd6bba8d | fix(doc) - Update doc for deflake command (#10829) |
| 13 | QUICK | PICK | 34,36,37 | 433ca84c, 6d84d4dc, a8379d1f | fix(tests): log actual output in validateModelOutput on failure (#10843) / Fix prompt to make it a bit more deterministic (#10848) / fix(tests): enable and update prompt for MCP add tool test (#10850) |
| 14 | FULL | PICK | 38 | 5f96eba5 | fix(cli): prevent exit on non-fatal tool errors (#10671) |
| 15 | QUICK | REIMPLEMENT | 39 | 5e688b81 | Skip should fail safely when old_string is not found test (#10853) |
| 16 | FULL | REIMPLEMENT | 40 | 5aab793c | fix(infra) - Fix interactive system error (#10805) |
| 17 | QUICK | REIMPLEMENT | 42 | 0b6c0200 | feat(core): Failed Response Retry via Extra Prompt (#10828) |
| 18 | FULL | PICK | 43,44 | ed37b7c5, 21062dd3 | fix some isWorkspaceTrusted mocks (#10836) / clean up extension tests (#10857) |
| 19 | QUICK | REIMPLEMENT | 49 | c82c2c2b | chore: add a2a server bin (#10592) |
| 20 | FULL | REIMPLEMENT | 50 | 558be873 | Re-land bbiggs changes to reduce margin on narrow screens with fixes + full width setting (#10522) |
| 21 | QUICK | PICK | 52 | 65b9e367 | Docs: Fix broken links in architecture.md (#10747) |
| 22 | FULL | PICK | 53 | 971eb64e | fix(cli) : fixed bug #8310 where /memory refresh will create discrepancies with initial memory load ignoring settings/config for trusted folder and file filters (#10611) |
| 23 | QUICK | PICK | 56,57 | affd3cae, 249ea559 | fix: Prevent garbled input during \"Login With Google\" OAuth prompt on… (#10888) / fix(test): Fix flaky shell command test using date command (#10863) |
| 24 | FULL | REIMPLEMENT | 58 | 849cd1f9 | Docs: Fix Flutter extension link in docs/changelogs/index.md (#10797) |
| 25 | QUICK | REIMPLEMENT | 59 | 32db4ff6 | Disable flakey tests. (#10914) |
| 26 | FULL | PICK | 60,62,63 | c6af4eaa, a5e47c62, 0a7ee677 | fix: Usage of folder trust config flags in FileCommandLoader (#10837) / Docs: Update to tos-privacy.md (#10754) / Show notification in screen reader mode (#10900) |
| 27 | QUICK | REIMPLEMENT | 64 | ab3804d8 | refactor(core): migrate web search tool to tool-names (#10782) |
| 28 | FULL | PICK | 66 | bf0f61e6 | Show final install path in extension consent dialog and fix isWorkspaceTrusted check (#10830) |
| 29 | QUICK | REIMPLEMENT | 67 | a6e00d91 | Fix rough edges around extension updates (#10926) |
| 30 | FULL | REIMPLEMENT | 68 | a64bb433 | Simplify auth in interactive tests. (#10921) |
| 31 | QUICK | REIMPLEMENT | 69 | 37678acb | Update deployment.md -> installation.md and sidebar links. (#10662) |
| 32 | FULL | PICK | 70 | 265d39f3 | feat(core): improve shell execution service reliability (#10607) |
| 33 | QUICK | PICK | 71,72 | ead8928c, cd919346 | Deflake test. (#10932) / Clean up integration test warnings. (#10931) |
| 34 | FULL | REIMPLEMENT | 74 | 5dc7059b | Refactor: Introduce InteractiveRun class (#10947) |
| 35 | QUICK | PICK | 78,81 | c23eb84b, 28e667bd | fix(remove private) from gemini-cli-a2a-server (#11018) / Give explicit instructions for failure text in json-output.test.ts (#11029) |
| 36 | FULL | REIMPLEMENT | 82 | 19c1d734 | add bundle command info to integration test docs (#11034) |
| 37 | QUICK | REIMPLEMENT | 84 | 518caae6 | chore: Extract '.gemini' to GEMINI_DIR constant (#10540) |
| 38 | FULL | REIMPLEMENT | 85 | 4a5ef4d9 | fix(infra) - Fix flake for file interactive system (#11019) |
| 39 | QUICK | REIMPLEMENT | 86 | a73b8145 | Rename expect methods. (#11046) |
| 40 | FULL | PICK | 87 | 77162750 | chore(settings): Enable 'useSmartEdit' by default (#11051) |
| 41 | QUICK | REIMPLEMENT | 88 | c4bd7594 | document all settings with showInDialog: true (#11049) |
| 42 | FULL | REIMPLEMENT | 91 | ada179f5 | bug(core): Process returned function calls sequentially. (#10659) |
| 43 | QUICK | PICK | 95,97,98,99,102 | 6787d42d, a3fe9279, 249a193c, b2ba67f3, 3ba4ba79 | perf(core): optimize Windows IDE process detection from O(N) to O(1) (#11048) / fix(compression): prevent unnecessary summarization when history is too short (#11082) / Update system instructions for optimizing shell tool commands (#10651) / fix: Exit app on pressing esc on trust dialog at launch (#10668) / Remove workflow examples from system instruction  (#10811) |
| 44 | FULL | PICK | 103 | 9e8c7676 | fix(cli): record tool calls in non-interactive mode (#10951) |
| 45 | QUICK | PICK | 104 | 7b06a0be | fix(e2e): Use rmSync instead of rm -rf for e2e tests (#11087) |
| 46 | FULL | REIMPLEMENT | 106 | 7c1a9024 | fix(core): add retry logic for specific fetch errors (#11066) |
| 47 | QUICK | REIMPLEMENT | 110 | 49b66733 | fix(infra) - Disable CTRL-C test (#11122) |
| 48 | FULL | REIMPLEMENT | 111 | 99c7108b | fix integration test static errors, and run_shell_command tests to actually be testing what they intend (#11050) |
| 49 | QUICK | REIMPLEMENT | 115 | 769fe8b1 | Delete unworkable replace test and enabled the rest (#11125) |
| 50 | FULL | REIMPLEMENT | 116 | 6f0107e7 | fix(core): implement robust URL validation in web_fetch tool (#10834) |
| 51 | QUICK | PICK | 120 | dabe161a | Don't accept input until slash commands are loaded (#11162) |
| 52 | FULL | REIMPLEMENT | 121 | 4f5b3357 | fix(tests): enable cyclic schema MCP tool test (#10912) |

---

## Copy/Paste: PICK Batch Commands

Run these exactly for `PICK` batches (git will pause on conflicts as needed):

```bash
# Batch 01 PICK #3 (8980276b)
git cherry-pick 8980276b205e2b8f327b8b55f785a01e36ce18b8

# Batch 03 PICK #6 #7 #11 #12 #13 (1af3fef3 603ec2b2 467a305f b92e3bca 1962b51d)
git cherry-pick 1af3fef33a611f17957f8043211b9e1ea3ac15bb 603ec2b21bd95be249f0f0c6d4d6ee267fab436a 467a305f266d30047d3c69b5fd680745e7580e39 b92e3bca508036514bd7bb3fb566e93f82edfc18 1962b51d8d3b971d820eef288d9d4f3346d3a1a0

# Batch 04 PICK #14 #15 #16 (f2852056 76b1deec 118aade8)
git cherry-pick f2852056a11d10cd56045b57ba1deec5822a089e 76b1deec25c7fa528c42c42a0e1b47c1e0d9f2ec 118aade84cc7e3f6d4680bd17adf73561153050c

# Batch 06 PICK #19 (741b57ed)
git cherry-pick 741b57ed061c767ed25777f39b9fe826aaa1bcbc

# Batch 08 PICK #23 (06920402)
git cherry-pick 06920402f8acd2c53857c06253c05a71ac42f05e

# Batch 09 PICK #27 (a044c259)
git cherry-pick a044c25981d7ae74fa1cd42cb002ed721b65c7a0

# Batch 11 PICK #31 #32 (b60c8858 cd354aeb)
git cherry-pick b60c8858afefd84de4cae672aa62161e8a42b0d8 cd354aebedebe5380ccc5a4917268b4d756fe80c

# Batch 13 PICK #34 #36 #37 (433ca84c 6d84d4dc a8379d1f)
git cherry-pick 433ca84ce06569b653a67fa8fd2f9a21256fedf0 6d84d4dc9c163ad5c34b0c9279617c84c3a0918c a8379d1f4bea1c0786a41b22694119dee97972f2

# Batch 14 PICK #38 (5f96eba5)
git cherry-pick 5f96eba54a013b47f8110a1338ece5d9b8aeb1f8

# Batch 18 PICK #43 #44 (ed37b7c5 21062dd3)
git cherry-pick ed37b7c5e7a88c69654a9328a2240577900d32fc 21062dd30e0e8509f420e6ffeb8ad78e7f56297b

# Batch 21 PICK #52 (65b9e367)
git cherry-pick 65b9e367f080298c78b754b694aa2603bf1c1651

# Batch 22 PICK #53 (971eb64e)
git cherry-pick 971eb64e9867a9fc8a4f7395e9915bfd87b0a9c7

# Batch 23 PICK #56 #57 (affd3cae 249ea559)
git cherry-pick affd3cae9afd9785064849cac8009409b661e515 249ea5594202c9d39cce894fbe92c1da39666a25

# Batch 26 PICK #60 #62 #63 (c6af4eaa a5e47c62 0a7ee677)
git cherry-pick c6af4eaa0099c390e4e1a503b52e92339e0755c8 a5e47c62e4372e02259fafeec21c247e63af87c0 0a7ee67707f0cbd0357442ae33f8a5cb602d22c2

# Batch 28 PICK #66 (bf0f61e6)
git cherry-pick bf0f61e656c4a4d3fe8dd4c98a811073b060eae6

# Batch 32 PICK #70 (265d39f3)
git cherry-pick 265d39f337893c53e58896b3d94061889d9eca8b

# Batch 33 PICK #71 #72 (ead8928c cd919346)
git cherry-pick ead8928c39018b08fad5a173243df37519f8c2ae cd9193466e95539f8e3defcd17f24705c28dabec

# Batch 35 PICK #78 #81 (c23eb84b 28e667bd)
git cherry-pick c23eb84b049ff5d8d19e5f0a5d8f37ba643e1278 28e667bd97820859b9f28bbd535fd35ec661cd41

# Batch 40 PICK #87 (77162750)
git cherry-pick 771627505daf4357b8cb6e1ff386ad8fda6c3a08

# Batch 43 PICK #95 #97 #98 #99 #102 (6787d42d a3fe9279 249a193c b2ba67f3 3ba4ba79)
git cherry-pick 6787d42de4ce46bc764ccd788d4605aef4868fdd a3fe9279d8b1b8826502d1f0522e381792003ec4 249a193c001b4d63f9eb28c29d401a70ac4465a0 b2ba67f33742461024c5a113ca3658b76d7685cf 3ba4ba79fa09ce990e25e272cffca8d5d5a239fd

# Batch 44 PICK #103 (9e8c7676)
git cherry-pick 9e8c76769434eb578e566d06b16084e01cc36073

# Batch 45 PICK #104 (7b06a0be)
git cherry-pick 7b06a0bebd48c2bbcba730ab4b085c7cc07ef4b6

# Batch 51 PICK #120 (dabe161a)
git cherry-pick dabe161a6f73f25e97c5bae914eb6e26454b6253
```

---

## Per-Batch Execution Checklist (repeat for every batch)

1. Ensure correct branch: `git rev-parse --abbrev-ref HEAD` → `20251215gemerge`
2. Ensure clean state (no unfinished cherry-pick):
   - `git status` should not show “cherry-pick in progress”.
3. Apply the batch:
   - `PICK`: run the batch command; resolve conflicts; `git cherry-pick --continue`.
   - `REIMPLEMENT`: follow the playbook section below; make **one local commit**.
4. Run verification:
   - Always: quick verification (`npm run typecheck && npm run lint`)
   - If batch is even-numbered: run full suite.
5. If you had to make extra fixes that are *not* part of a conflict resolution:
   - Create a fix commit: `git commit -am "fix: batch NN follow-ups"`
6. Do not proceed to next batch until the required verification is green.

---

## Reimplementation Playbooks (Detailed, “Stupid-LLM-Ready”)

For every `REIMPLEMENT` batch, follow these rules exactly:

- Make exactly one local commit (even if the batch becomes a NO-OP due to missing files).
- Use this commit message template (subject line must match exactly):

  ```text
  reimplement: <subject> (upstream <shortsha>)
  ```

- In the commit body, always include:
  - `Upstream: <full sha>`
  - `LLXPRT adaptations:` (bulleted list)
  - If NO-OP: `SKIPPED: <reason>`

If a playbook says `SKIP-IF-MISSING` and its target file does not exist:

- DO NOT create the file.
- Create an empty commit with the template above and the skip reason in the body.

### Batch 02 — `8ac2c684` — chore: bundle a2a-server (#10265)

**Upstream files touched:**

- `esbuild.config.js`

**LLXPRT target files:**

- `esbuild.config.js` (EXISTS)
- `packages/a2a-server/src/http/server.ts` (EXISTS)
- `packages/a2a-server/dist/a2a-server.mjs` (CREATE; build artifact)

**Pre-check (run before starting):**

```bash
test -f esbuild.config.js || echo "ABORT: missing esbuild.config.js"
test -f packages/a2a-server/src/http/server.ts || echo "ABORT: missing packages/a2a-server/src/http/server.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Run: `git show 8ac2c684 -- esbuild.config.js`
2. Edit `esbuild.config.js` to bundle an additional entrypoint:
   - Entry: `packages/a2a-server/src/http/server.ts`
   - Output: `packages/a2a-server/dist/a2a-server.mjs`
3. Ensure the output is executable: `fs.chmodSync('packages/a2a-server/dist/a2a-server.mjs', 0o755)`
4. Run: `npm run bundle`
5. Verify: `test -f packages/a2a-server/dist/a2a-server.mjs`

Commit message template:

```text
reimplement: bundle a2a-server (upstream 8ac2c684)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run bundle` produces `packages/a2a-server/dist/a2a-server.mjs`

On failure:

- If esbuild fails: add missing deps to `external` (do not rewrite the a2a server code to “make it bundle”).
- If output is missing: ensure the a2a build target is not behind any conditional and uses `write: true`.

### Batch 05 — `8d8a2ab6` — Fix(doc) - Add section in docs for deflaking (#10750)

**Upstream files touched:**

- `docs/integration-tests.md`
- `scripts/deflake.js`

**LLXPRT target files:**

- `scripts/deflake.js` (EXISTS; must land in Batch 03 via `603ec2b2`)
- `dev-docs/integration-tests.md` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f scripts/deflake.js || echo "ABORT: missing scripts/deflake.js (did Batch 03 land?)"
test -f dev-docs/integration-tests.md || echo "ABORT: missing dev-docs/integration-tests.md"
```

Steps (numbered, imperative, no ambiguity):

1. Run: `git show 8d8a2ab6 -- scripts/deflake.js docs/integration-tests.md`
2. In `scripts/deflake.js`, change the yargs default from `runs: 50` to `runs: 5`.
3. In `scripts/deflake.js`, remove emoji output to satisfy the emoji-free policy:
   - Replace `✅ Run PASS` → `Run PASS`
   - Replace `❌ Run FAIL` → `Run FAIL`
4. In `dev-docs/integration-tests.md`, add a `## Deflaking` section that uses LLXPRT commands:
   - Example (exact): `npm run deflake -- --runs=5 --command="npm run test:e2e -- -- --test-name-pattern '<your-test-name>'"`

Commit message template:

```text
reimplement: deflake docs + runs=5 (upstream 8d8a2ab6)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `node scripts/deflake.js -- --command=\"echo ok\" --runs=1` exits `0`
- `dev-docs/integration-tests.md` contains a `Deflaking` section

On failure:

- If `scripts/deflake.js` is missing: do not continue; go back and fix Batch 03 first.

### Batch 07 — `bcbcaeb8` — fix(docs): Update docs/faq.md per Srinanth (#10667)

**Upstream files touched:**

- `docs/extensions/index.md`
- `docs/faq.md`

**LLXPRT target files:**

- `docs/extension.md` (EXISTS)
- `docs/troubleshooting.md` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f docs/extension.md || echo "ABORT: missing docs/extension.md"
test -f docs/troubleshooting.md || echo "ABORT: missing docs/troubleshooting.md"
```

Steps (numbered, imperative, no ambiguity):

1. Run: `git show bcbcaeb8 -- docs/extensions/index.md docs/faq.md`
2. Port markdown-only fixes from upstream’s `docs/extensions/index.md` into `docs/extension.md` (typos, backticks, broken code fences).
3. Port FAQ wording/link fixes from upstream’s `docs/faq.md` into a new `## FAQ` section at the end of `docs/troubleshooting.md`.
4. Replace command examples:
   - `gemini ...` → `llxprt ...`
5. Replace support links:
   - Upstream support links → `https://github.com/vybestack/llxprt-code/issues`

Commit message template:

```text
reimplement: docs faq + extensions fixes (upstream bcbcaeb8)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- Docs changes are LLXPRT-branded (no `@google/gemini-cli` / `gemini` command examples)

On failure:

- If doc paths differ: keep the same intent (formatting + link fixes) but apply to the closest LLXPRT doc page.

### Batch 10 — `0cd490a9` — feat: support GOOGLE_CLOUD_PROJECT_ID fallback (fixes #2262) (#2725)

**Upstream files touched:**

- `docs/get-started/authentication.md`
- `packages/core/src/code_assist/setup.ts`
- `packages/core/src/core/contentGenerator.ts`

**LLXPRT target files:**

- `packages/core/src/code_assist/setup.ts` (EXISTS)
- `packages/core/src/code_assist/setup.test.ts` (EXISTS)
- `packages/core/src/core/contentGenerator.ts` (EXISTS)
- `packages/core/src/core/contentGenerator.test.ts` (EXISTS)
- `docs/cli/authentication.md` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f packages/core/src/code_assist/setup.ts || echo "ABORT: missing setup.ts"
test -f packages/core/src/code_assist/setup.test.ts || echo "ABORT: missing setup.test.ts"
test -f packages/core/src/core/contentGenerator.ts || echo "ABORT: missing contentGenerator.ts"
test -f packages/core/src/core/contentGenerator.test.ts || echo "ABORT: missing contentGenerator.test.ts"
test -f docs/cli/authentication.md || echo "ABORT: missing docs/cli/authentication.md"
```

Steps (numbered, imperative, no ambiguity):

1. Run: `git show 0cd490a9 -- packages/core/src/code_assist/setup.ts packages/core/src/core/contentGenerator.ts docs/get-started/authentication.md`
2. In `packages/core/src/code_assist/setup.ts`, when reading project ID:
   - Change `process.env.GOOGLE_CLOUD_PROJECT` to `process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || undefined`
3. In `packages/core/src/code_assist/setup.test.ts`, add a test:
   - IF `GOOGLE_CLOUD_PROJECT` is unset AND `GOOGLE_CLOUD_PROJECT_ID` is set THEN project ID resolves to `_ID`.
4. In `packages/core/src/core/contentGenerator.ts`, apply the same fallback logic.
5. In `packages/core/src/core/contentGenerator.test.ts`, add coverage for the fallback.
6. In `docs/cli/authentication.md`, add a note under GCP env vars:
   - Precedence is `GOOGLE_CLOUD_PROJECT` then `GOOGLE_CLOUD_PROJECT_ID`.

Commit message template:

```text
reimplement: add GOOGLE_CLOUD_PROJECT_ID fallback (upstream 0cd490a9)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- Added tests cover the fallback and pass

On failure:

- If tests fail due to env pollution: ensure tests restore `process.env` after each case.

### Batch 12 — `bd6bba8d` — fix(doc) - Update doc for deflake command (#10829)

**Upstream files touched:**

- `docs/integration-tests.md`

**LLXPRT target files:**

- `dev-docs/integration-tests.md` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f dev-docs/integration-tests.md || echo "ABORT: missing dev-docs/integration-tests.md"
```

Steps (numbered, imperative, no ambiguity):

1. Run: `git show bd6bba8d -- docs/integration-tests.md`
2. In `dev-docs/integration-tests.md`, update the deflake example to include the extra `--` required for npm arg forwarding:
   - Use (exact): `--command="npm run test:e2e -- -- --test-name-pattern '<your-new-test-name>'"`

Commit message template:

```text
reimplement: docs deflake invocation fix (upstream bd6bba8d)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- Deflake example contains the corrected `-- -- --test-name-pattern` sequence

On failure:

- If `npm run deflake` is not present yet: ensure Batch 03 landed, then re-apply this change.

### Batch 15 — `5e688b81` — Skip should fail safely when old_string is not found test (#10853)

**Upstream files touched:**

- `integration-tests/replace.test.ts`

**LLXPRT target files:**

- `integration-tests/replace.test.ts` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f integration-tests/replace.test.ts || echo "ABORT: missing integration-tests/replace.test.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Run: `git show 5e688b81 -- integration-tests/replace.test.ts`
2. Inspect LLXPRT `integration-tests/replace.test.ts`:
   - IF the test `it('should fail safely when old_string is not found'...)` exists AND it asserts the file content is unchanged, THEN do not change the test.
   - ELSE add a test that (a) disables `write_file` via `excludeTools`, and (b) asserts the file content remains unchanged after the attempted replace.
3. Do not add `it.skip` or `describe.skip` for this test in LLXPRT.
4. If no code changes were necessary, make this a NO-OP commit with the skip note in the commit body.

Commit message template:

```text
reimplement: keep replace old_string-not-found coverage (upstream 5e688b81)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test:integration:sandbox:none -- replace.test.ts` passes

On failure:

- If the test flakes: do not blanket-skip; proceed to Batch 48 and fix the harness/allowlist wiring first.

### Batch 16 — `5aab793c` — fix(infra) - Fix interactive system error (#10805)

**Upstream files touched:**

- `integration-tests/file-system-interactive.test.ts`

**LLXPRT target files:**

- `integration-tests/file-system-interactive.test.ts` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f integration-tests/file-system-interactive.test.ts && echo "PROCEED" || echo "SKIP: integration-tests/file-system-interactive.test.ts missing in LLXPRT"
```

Steps (numbered, imperative, no ambiguity):

1. IF `integration-tests/file-system-interactive.test.ts` exists THEN:
   1. Run: `git show 5aab793c -- integration-tests/file-system-interactive.test.ts`
   2. Port the upstream change into the LLXPRT file as-is (timeouts/ready handling only).
2. ELSE (file missing):
   1. Make an empty commit and write `SKIPPED: file-system-interactive test does not exist in LLXPRT` in the commit body.

Commit message template:

```text
reimplement: interactive test infra fix (upstream 5aab793c)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes

On failure:

- If the file exists but differs heavily: keep this batch limited to the upstream reliability fix (do not add new tests here).

### Batch 17 — `0b6c0200` — feat(core): Failed Response Retry via Extra Prompt (#10828)

**Upstream files touched:**

- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/core/src/config/config.test.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/core/client.test.ts`
- `packages/core/src/core/client.ts`
- `packages/core/src/core/turn.test.ts`
- `packages/core/src/core/turn.ts`

**LLXPRT target files:**

- `packages/cli/src/ui/hooks/useGeminiStream.ts` (EXISTS)
- `packages/core/src/config/config.ts` (EXISTS)
- `packages/core/src/config/config.test.ts` (EXISTS)
- `packages/core/src/core/client.ts` (EXISTS)
- `packages/core/src/core/client.test.ts` (EXISTS)
- `packages/core/src/core/turn.ts` (EXISTS)
- `packages/core/src/core/turn.test.ts` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f packages/cli/src/ui/hooks/useGeminiStream.ts || echo "ABORT: missing packages/cli/src/ui/hooks/useGeminiStream.ts"
test -f packages/core/src/config/config.ts || echo "ABORT: missing packages/core/src/config/config.ts"
test -f packages/core/src/config/config.test.ts || echo "ABORT: missing packages/core/src/config/config.test.ts"
test -f packages/core/src/core/client.ts || echo "ABORT: missing packages/core/src/core/client.ts"
test -f packages/core/src/core/client.test.ts || echo "ABORT: missing packages/core/src/core/client.test.ts"
test -f packages/core/src/core/turn.ts || echo "ABORT: missing packages/core/src/core/turn.ts"
test -f packages/core/src/core/turn.test.ts || echo "ABORT: missing packages/core/src/core/turn.test.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Run:
   - `git show 0b6c0200 -- packages/core/src/config/config.ts`
   - `git show 0b6c0200 -- packages/core/src/core/client.ts`
   - `git show 0b6c0200 -- packages/core/src/core/turn.ts`
   - `git show 0b6c0200 -- packages/cli/src/ui/hooks/useGeminiStream.ts`
   - `git show 0b6c0200 -- packages/core/src/config/config.test.ts packages/core/src/core/client.test.ts packages/core/src/core/turn.test.ts`
2. In `packages/core/src/config/config.ts`:
   1. Add `continueOnFailedApiCall?: boolean` to the config parameter type.
   2. Store it on the `Config` instance (default must be `true`).
   3. Add `getContinueOnFailedApiCall(): boolean`.
3. In `packages/core/src/core/turn.ts`:
   1. IF `GeminiEventType.InvalidStream` and its event union type already exist THEN do not change the event types.
   2. ELSE add:
      - `GeminiEventType.InvalidStream = 'invalid_stream'`
      - `ServerGeminiInvalidStreamEvent`
      - include it in the exported stream event union.
   3. Ensure `Turn.run()` yields `{ type: GeminiEventType.InvalidStream }` when it catches an `InvalidStreamError`.
4. In `packages/core/src/core/client.ts` (retry prompt injection; keep LLXPRT batching intact):
   1. Add an optional boolean parameter `isInvalidStreamRetry` to `sendMessageStream(...)` (default `false`).
   2. In the event loop, when `event.type === GeminiEventType.InvalidStream`:
      - IF `this.config.getContinueOnFailedApiCall()` is `false` THEN return without retrying.
      - ELSE IF `isInvalidStreamRetry` is `true` THEN return without retrying (max 1 retry).
      - ELSE:
        1. Define `nextRequest = [{ text: 'System: Please continue.' }]`.
        2. `yield* this.sendMessageStream(nextRequest, signal, prompt_id, boundedTurns - 1, true)`.
        3. Return (do not continue the current loop).
   3. DO NOT port any upstream telemetry hunks (no `ClearcutLogger`, no `logContentRetryFailure`, no new telemetry event types).
5. In `packages/cli/src/ui/hooks/useGeminiStream.ts`:
   1. Add `ServerGeminiEventType.InvalidStream` to the existing “ignored/unhandled for now” switch alongside `Retry` (so the UI does not crash).
6. Add tests (mirror upstream intent, adapted to LLXPRT mocks):
   1. In `packages/core/src/config/config.test.ts`, add coverage for:
      - default is `true`
      - explicit `false` stays `false`
   2. In `packages/core/src/core/client.test.ts`, add 3 tests:
      - retries once with the injected prompt
      - does not retry when flag is `false`
      - stops after 1 retry when InvalidStream repeats

Commit message template:

```text
reimplement: invalid-stream retry via prompt injection (upstream 0b6c0200)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test --workspace @vybestack/llxprt-code-core` passes

On failure:

- If you hit telemetry conflicts: delete those hunks entirely (LLXPRT does not ship Google telemetry).
- If tests are hard to mock: copy upstream’s strategy (mock `Turn.run()` to yield `InvalidStream`, assert 2nd call uses `System: Please continue.`).

### Batch 19 — `c82c2c2b` — chore: add a2a server bin (#10592)

**Upstream files touched:**

- `package-lock.json`
- `packages/a2a-server/package.json`
- `packages/a2a-server/src/http/server.ts`

**LLXPRT target files:**

- `packages/a2a-server/package.json` (EXISTS)
- `packages/a2a-server/src/http/server.ts` (EXISTS)
- `packages/a2a-server/dist/a2a-server.mjs` (CREATE; build artifact)
- `package-lock.json` (SKIP; do not touch)

**Pre-check (run before starting):**

```bash
test -f packages/a2a-server/package.json || echo "ABORT: missing packages/a2a-server/package.json"
test -f packages/a2a-server/src/http/server.ts || echo "ABORT: missing packages/a2a-server/src/http/server.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Run:
   - `git show c82c2c2b -- packages/a2a-server/package.json`
   - `git show c82c2c2b -- packages/a2a-server/src/http/server.ts`
2. In `packages/a2a-server/package.json`:
   1. Set `"main": "dist/index.js"` (do not use upstream’s `"dist/server.js"` path).
   2. Add a `"bin"` entry and **use an LLXPRT-branded name**:
      - Key (exact): `llxprt-code-a2a-server`
      - Value (exact): `dist/a2a-server.mjs`
   3. Do not edit `package-lock.json` in this batch.
3. In `packages/a2a-server/src/http/server.ts`:
   1. Add the shebang as the first line: `#!/usr/bin/env node`
   2. Change the main-module detection to basename compare (match upstream intent).
   3. Move the `process.on('uncaughtException', ...)` handler inside the “main module” block so importing this file has no side effects.
4. Run: `npm run bundle`
5. Verify artifacts/behavior:
   1. `test -f packages/a2a-server/dist/a2a-server.mjs`
   2. `node -e \"import('./packages/a2a-server/dist/a2a-server.mjs')\"` exits `0` (must not auto-start the server on import).

Commit message template:

```text
reimplement: add a2a-server bin entry (upstream c82c2c2b)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run bundle` produces `packages/a2a-server/dist/a2a-server.mjs`
- Importing `packages/a2a-server/dist/a2a-server.mjs` has no side effects

On failure:

- If the bin file is missing after `npm run bundle`: ensure Batch 02’s bundling changes exist and `esbuild.config.js` outputs `packages/a2a-server/dist/a2a-server.mjs`.

### Batch 20 — `558be873` — Re-land bbiggs changes to reduce margin on narrow screens with fixes + full width setting (#10522)

**Upstream files touched:**

- `packages/cli/src/config/settingsSchema.ts`
- `packages/cli/src/gemini.test.tsx`
- `packages/cli/src/gemini.tsx`
- `packages/cli/src/test-utils/render.tsx`
- `packages/cli/src/ui/AppContainer.tsx`
- `packages/cli/src/ui/components/AnsiOutput.test.tsx`
- `packages/cli/src/ui/components/AnsiOutput.tsx`
- `packages/cli/src/ui/components/Composer.tsx`
- `packages/cli/src/ui/components/ContextSummaryDisplay.test.tsx`
- `packages/cli/src/ui/components/ContextSummaryDisplay.tsx`
- `packages/cli/src/ui/components/ContextUsageDisplay.tsx`
- `packages/cli/src/ui/components/Footer.test.tsx`
- `packages/cli/src/ui/components/Footer.tsx`
- `packages/cli/src/ui/components/InputPrompt.tsx`
- `packages/cli/src/ui/components/MainContent.tsx`
- `packages/cli/src/ui/components/__snapshots__/Footer.test.tsx.snap`
- `packages/cli/src/ui/components/__snapshots__/InputPrompt.test.tsx.snap`
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx`
- `packages/cli/src/ui/components/messages/ToolMessage.tsx`
- `packages/cli/src/ui/components/messages/__snapshots__/ToolGroupMessage.test.tsx.snap`
- `packages/cli/src/ui/hooks/useTerminalSize.ts`
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`
- `packages/cli/src/ui/utils/ui-sizing.ts`
- `packages/cli/src/utils/math.ts`

**LLXPRT target files:**

- `packages/cli/src/config/settingsSchema.ts` (EXISTS)
- `packages/cli/src/ui/AppContainer.tsx` (EXISTS)
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` (EXISTS)
- `packages/cli/src/ui/components/MainContent.tsx` (EXISTS)
- `packages/cli/src/ui/components/Footer.tsx` (EXISTS)
- `packages/cli/src/ui/components/InputPrompt.tsx` (EXISTS)
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` (EXISTS)
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx` (EXISTS)
- `packages/cli/src/ui/components/messages/ToolMessage.tsx` (EXISTS)
- `packages/cli/src/ui/hooks/useTerminalSize.ts` (EXISTS)
- `packages/cli/src/ui/utils/ui-sizing.ts` (CREATE)
- `packages/cli/src/utils/math.ts` (CREATE)
- `packages/cli/src/ui/components/__snapshots__/Footer.test.tsx.snap` (EXISTS)
- `packages/cli/src/ui/components/__snapshots__/InputPrompt.test.tsx.snap` (EXISTS)
- `packages/cli/src/ui/components/messages/__snapshots__/ToolGroupMessage.test.tsx.snap` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f packages/cli/src/config/settingsSchema.ts || echo "ABORT: missing packages/cli/src/config/settingsSchema.ts"
test -f packages/cli/src/ui/AppContainer.tsx || echo "ABORT: missing packages/cli/src/ui/AppContainer.tsx"
test -f packages/cli/src/ui/layouts/DefaultAppLayout.tsx || echo "ABORT: missing packages/cli/src/ui/layouts/DefaultAppLayout.tsx"
test -f packages/cli/src/ui/components/InputPrompt.tsx || echo "ABORT: missing packages/cli/src/ui/components/InputPrompt.tsx"
test -f packages/cli/src/ui/components/Footer.tsx || echo "ABORT: missing packages/cli/src/ui/components/Footer.tsx"
test -f packages/cli/src/ui/components/MainContent.tsx || echo "ABORT: missing packages/cli/src/ui/components/MainContent.tsx"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diffs:
   1. `git show 558be873 --name-only`
   2. `git show 558be873 -- packages/cli/src/config/settingsSchema.ts`
   3. `git show 558be873 -- packages/cli/src/utils/math.ts`
   4. `git show 558be873 -- packages/cli/src/ui/utils/ui-sizing.ts`
   5. `git show 558be873 -- packages/cli/src/ui/AppContainer.tsx`
2. Add the setting:
   1. In `packages/cli/src/config/settingsSchema.ts`, add `ui.useFullWidth` (boolean):
      - Default: `false`
      - `showInDialog: true`
3. Add the new helper files (copy upstream exactly; adjust imports if needed):
   1. CREATE `packages/cli/src/utils/math.ts` exporting `lerp(start, end, t)`.
   2. CREATE `packages/cli/src/ui/utils/ui-sizing.ts` exporting `calculateMainAreaWidth(terminalWidth, settings: LoadedSettings)`:
      - If `settings.merged.ui?.useFullWidth` is true, return `terminalWidth`.
      - Else: use upstream interpolation (≤80 → 98%, ≥132 → 90%).
4. Wire the main-area width:
   1. In `packages/cli/src/ui/AppContainer.tsx`, compute:
      - `const mainAreaWidth = calculateMainAreaWidth(terminalWidth, settings);`
   2. Pass `mainAreaWidth` into `calculatePromptWidths(...)` (remove the previous hardcoded 90% width).
5. Apply the upstream layout/snapshot changes:
   1. For each of these files, run `git show 558be873 -- <file>` and apply the UI width/margin hunks:
      - `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`
      - `packages/cli/src/ui/components/MainContent.tsx`
      - `packages/cli/src/ui/components/Footer.tsx`
      - `packages/cli/src/ui/components/InputPrompt.tsx`
      - `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`
      - `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx`
      - `packages/cli/src/ui/components/messages/ToolMessage.tsx`
      - `packages/cli/src/ui/hooks/useTerminalSize.ts`
   2. Update snapshots if they change due to layout adjustments (do not “fix” snapshots by reverting layout hunks).
6. Run CLI tests and update snapshots intentionally:
   1. `npm run test --workspace @vybestack/llxprt-code-cli`

Commit message template:

```text
reimplement: ui margins + full-width setting (upstream 558be873)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test --workspace @vybestack/llxprt-code-cli` passes (update snapshots as needed)
- `ui.useFullWidth` exists in settings schema and toggles full-width layout

On failure:

- If layout diffs are too large: keep the change limited to `ui.useFullWidth` + `calculateMainAreaWidth` + `AppContainer.tsx`, and leave the remaining UI component tweaks for a follow-up fix commit (do not block the branch).

### Batch 24 — `849cd1f9` — Docs: Flutter extension link fix

**Upstream files touched:**

- `docs/changelogs/index.md`

**LLXPRT target files:**

- `docs/changelogs/index.md` (SKIP-IF-MISSING)
- `docs/extension.md` (EXISTS)
- `docs/troubleshooting.md` (EXISTS)
- `docs/index.md` (EXISTS)

**Pre-check (run before starting):**

```bash
test -d docs || echo "ABORT: missing docs/"
test -f docs/extension.md || echo "ABORT: missing docs/extension.md"
test -f docs/troubleshooting.md || echo "ABORT: missing docs/troubleshooting.md"
test -f docs/index.md || echo "ABORT: missing docs/index.md"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream change:
   - `git show 849cd1f9 -- docs/changelogs/index.md`
   - Old URL (exact): `https://github.com/flutter/gemini-cli-extension`
   - New URL (exact): `https://github.com/gemini-cli-extensions/flutter`
2. Search LLXPRT docs for the old URL:

   ```bash
   rg -n \"https://github.com/flutter/gemini-cli-extension\" docs dev-docs || true
   ```

3. IF the search returns **no matches** THEN:
   1. Make an empty commit with the message below.
   2. In the commit body write: `SKIPPED: no references to flutter/gemini-cli-extension found in LLXPRT docs`
4. ELSE (matches found) THEN:
   1. Replace every occurrence of `https://github.com/flutter/gemini-cli-extension` with `https://github.com/gemini-cli-extensions/flutter` in the matched files.
   2. Ensure examples remain LLXPRT-branded (`llxprt`, `.llxprt`, `LLXPRT.md`).

Commit message template:

```text
reimplement: docs flutter extension link fix (upstream 849cd1f9)
```

Acceptance criteria (all must pass):

- Any updated doc files are formatted (run `prettier` on the touched docs)
- No remaining references in docs: `rg -n \"flutter/gemini-cli-extension\" docs dev-docs` prints nothing

On failure:

- If docs mention upstream branding nearby: apply the Branding Substitutions table at the top of this plan.

### Batch 25 — `32db4ff6` — Blanket “disable flaky tests” (avoid, port selectively)

**Upstream files touched:**

- `integration-tests/file-system-interactive.test.ts`
- `integration-tests/replace.test.ts`

**LLXPRT target files:**

- `integration-tests/file-system-interactive.test.ts` (SKIP-IF-MISSING)
- `integration-tests/replace.test.ts` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f integration-tests/replace.test.ts || echo "ABORT: missing integration-tests/replace.test.ts"
test -f integration-tests/file-system-interactive.test.ts && echo "NOTE: file-system-interactive exists" || echo "NOTE: file-system-interactive missing (OK)"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diff:
   - `git show 32db4ff6 -- integration-tests/file-system-interactive.test.ts integration-tests/replace.test.ts`
2. IF `integration-tests/file-system-interactive.test.ts` exists in LLXPRT THEN:
   1. DO NOT apply upstream’s blanket `it.skip(...)`.
   2. Keep LLXPRT’s existing skip/timeout logic unchanged in this batch.
3. In `integration-tests/replace.test.ts`:
   1. DO NOT apply upstream’s `describe.skip('replace')`.
   2. IF LLXPRT already has a suite-level `describe.skip('replace')` THEN remove it (enable the suite) and rely on targeted fixes/harness work in Batch 48 instead.
   3. ELSE make no changes.
4. Make this batch a NO-OP commit unless you had to remove a blanket `describe.skip`.

Commit message template:

```text
reimplement: avoid blanket skipping tests (upstream 32db4ff6)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test:integration:sandbox:none -- replace.test.ts` passes

On failure:

- If replace tests are flaky: do not blanket-skip; proceed to Batch 48 and fix allowlist/harness wiring first.

### Batch 27 — `ab3804d8` — Web search tool-name refactor (LLXPRT already renamed)

**Upstream files touched:**

- `integration-tests/google_web_search.test.ts`
- `packages/core/src/agents/executor.ts`
- `packages/core/src/tools/tool-names.ts`
- `packages/core/src/tools/web-search.ts`

**LLXPRT target files:**

- `packages/core/src/agents/executor.ts` (EXISTS)
- `packages/core/src/tools/tool-names.ts` (CREATE)
- `packages/core/src/tools/google-web-search.ts` (EXISTS)
- `integration-tests/google_web_search.test.ts` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f packages/core/src/agents/executor.ts || echo "ABORT: missing packages/core/src/agents/executor.ts"
test -f packages/core/src/tools/google-web-search.ts || echo "ABORT: missing packages/core/src/tools/google-web-search.ts"
test -f integration-tests/google_web_search.test.ts || echo "ABORT: missing integration-tests/google_web_search.test.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diffs:
   - `git show ab3804d8 -- packages/core/src/tools/tool-names.ts`
   - `git show ab3804d8 -- packages/core/src/agents/executor.ts`
   - `git show ab3804d8 -- packages/core/src/tools/web-search.ts`
   - `git show ab3804d8 -- integration-tests/google_web_search.test.ts`
2. CREATE `packages/core/src/tools/tool-names.ts` with these exports (exact values):
   - `export const GLOB_TOOL_NAME = 'glob';`
   - `export const WEB_SEARCH_TOOL_NAME = 'google_web_search';`
3. Update `packages/core/src/tools/google-web-search.ts`:
   1. Import `WEB_SEARCH_TOOL_NAME` from `./tool-names.js`.
   2. Set `GoogleWebSearchTool.Name = WEB_SEARCH_TOOL_NAME` (no hardcoded string).
4. Update `packages/core/src/agents/executor.ts`:
   1. Remove imports of `GlobTool` and `GoogleWebSearchTool` (they were only used for `.Name`).
   2. Import `{ GLOB_TOOL_NAME, WEB_SEARCH_TOOL_NAME }` from `../tools/tool-names.js`.
   3. Replace the allowlist entries:
      - `GlobTool.Name` → `GLOB_TOOL_NAME`
      - `GoogleWebSearchTool.Name` → `WEB_SEARCH_TOOL_NAME`
5. Update `integration-tests/google_web_search.test.ts`:
   1. Import `WEB_SEARCH_TOOL_NAME` from `../packages/core/src/tools/tool-names.js`.
   2. Replace all `'google_web_search'` string literals with `WEB_SEARCH_TOOL_NAME`.

Commit message template:

```text
reimplement: tool-name constant for web search (upstream ab3804d8)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes

On failure:

- If the integration test import fails due to extension resolution: keep the constant in core and fall back to using the string literal only in the test (do not reintroduce the executor imports that create circular deps).

### Batch 29 — `a6e00d91` — Extension update rough edges (port without telemetry)

**Upstream files touched:**

- `packages/cli/src/commands/extensions/install.test.ts`
- `packages/cli/src/commands/extensions/install.ts`
- `packages/cli/src/commands/extensions/link.ts`
- `packages/cli/src/commands/extensions/uninstall.ts`
- `packages/cli/src/config/extension.test.ts`
- `packages/cli/src/config/extension.ts`
- `packages/cli/src/config/extensions/update.ts`
- `packages/core/index.ts`
- `packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts`
- `packages/core/src/telemetry/clearcut-logger/event-metadata-key.ts`
- `packages/core/src/telemetry/index.ts`
- `packages/core/src/telemetry/loggers.test.ts`
- `packages/core/src/telemetry/loggers.ts`
- `packages/core/src/telemetry/types.ts`

**LLXPRT target files:**

- `packages/cli/src/config/extension.ts` (EXISTS)
- `packages/cli/src/config/extension.test.ts` (EXISTS)
- `packages/cli/src/config/extensions/update.ts` (EXISTS)
- `packages/cli/src/commands/extensions/install.ts` (EXISTS)
- `packages/cli/src/commands/extensions/install.test.ts` (EXISTS)
- `packages/cli/src/commands/extensions/link.ts` (EXISTS)
- `packages/cli/src/commands/extensions/uninstall.ts` (EXISTS)
- `packages/core/src/telemetry/*` (SKIP; do not add Clearcut telemetry)
- `packages/core/index.ts` (SKIP; do not export Clearcut telemetry)

**Pre-check (run before starting):**

```bash
test -f packages/cli/src/config/extension.ts || echo "ABORT: missing packages/cli/src/config/extension.ts"
test -f packages/cli/src/config/extensions/update.ts || echo "ABORT: missing packages/cli/src/config/extensions/update.ts"
test -f packages/cli/src/commands/extensions/install.ts || echo "ABORT: missing packages/cli/src/commands/extensions/install.ts"
test -f packages/cli/src/commands/extensions/uninstall.ts || echo "ABORT: missing packages/cli/src/commands/extensions/uninstall.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diffs (do not copy telemetry hunks):
   - `git show a6e00d91 -- packages/cli/src/config/extension.ts`
   - `git show a6e00d91 -- packages/cli/src/config/extensions/update.ts`
   - `git show a6e00d91 -- packages/cli/src/commands/extensions/install.ts packages/cli/src/commands/extensions/link.ts packages/cli/src/commands/extensions/uninstall.ts`
   - `git show a6e00d91 -- packages/cli/src/config/extension.test.ts packages/cli/src/commands/extensions/install.test.ts`
2. In `packages/cli/src/config/extension.ts`:
   1. Rename (or wrap) `installExtension(...)` → `installOrUpdateExtension(...)` and keep the same parameters plus `previousExtensionConfig?: ExtensionConfig`.
   2. Define `const isUpdate = previousExtensionConfig !== undefined`.
   3. IF `isUpdate` is `false` THEN keep the “already installed” check and keep auto-enabling the extension.
   4. IF `isUpdate` is `true` THEN:
      - Allow updating an already-installed extension.
      - Delete the existing extension directory **without removing enablement state** (see step 3).
      - Do not auto-enable the extension (preserve enabled/disabled state).
   5. Update `performWorkspaceExtensionMigration(...)` to call `installOrUpdateExtension(...)`.
3. Update uninstall behavior to preserve enablement on update:
   1. Change `uninstallExtension(...)` signature to include `isUpdate: boolean`.
   2. Always delete the extension directory on disk.
   3. IF `isUpdate` is `true` THEN return early (do not call `ExtensionEnablementManager.remove(...)`).
   4. ELSE remove enablement state as before.
4. Update command handlers:
   1. In `packages/cli/src/commands/extensions/install.ts` and `packages/cli/src/commands/extensions/link.ts`, import and call `installOrUpdateExtension(...)`.
   2. In `packages/cli/src/commands/extensions/uninstall.ts`, call `uninstallExtension(args.name, false)`.
5. Update extension update flow:
   1. In `packages/cli/src/config/extensions/update.ts`, call `installOrUpdateExtension(installMetadata, requestConsent, cwd, previousExtensionConfig ?? undefined)`.
   2. DO NOT remove LLXPRT’s rollback copy unless you also remove the rollback restore:
      - IF the file currently uses `copyExtension(extension.path, tempDir)` and `copyExtension(tempDir, extension.path)` THEN keep both (don’t replicate upstream’s “empty rollback” bug).
6. Update tests:
   1. Fix imports/renames from `installExtension` → `installOrUpdateExtension`.
   2. Add one test ensuring enablement state is preserved across update:
      - Arrange: disable an extension; run update; assert it is still disabled.
   3. Add one test ensuring true uninstall still removes enablement:
      - Arrange: disable an extension; uninstall with `isUpdate=false`; assert enablement record removed.
7. Explicitly skip upstream telemetry additions:
   - Do not edit `packages/core/src/telemetry/*` for this batch.
   - Do not add any new exports in `packages/core/index.ts` related to Clearcut.

Commit message template:

```text
reimplement: preserve extension enablement on update (upstream a6e00d91)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test --workspace @vybestack/llxprt-code-cli` passes

On failure:

- If tests mention Google telemetry symbols: remove those hunks; LLXPRT does not ship Clearcut.
- If update rollback fails: verify `copyExtension(extension.path, tempDir)` happens before any uninstall/removal.

### Batch 30 — `a64bb433` — Simplify auth in interactive tests (adapt to LLXPRT harness)

**Upstream files touched:**

- `integration-tests/context-compress-interactive.test.ts`
- `integration-tests/ctrl-c-exit.test.ts`
- `integration-tests/file-system-interactive.test.ts`
- `integration-tests/test-helper.ts`

**LLXPRT target files:**

- `integration-tests/test-helper.ts` (EXISTS)
- `integration-tests/ctrl-c-exit.test.ts` (EXISTS)
- `integration-tests/context-compress-interactive.test.ts` (SKIP-IF-MISSING)
- `integration-tests/file-system-interactive.test.ts` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f integration-tests/test-helper.ts || echo "ABORT: missing integration-tests/test-helper.ts"
test -f integration-tests/ctrl-c-exit.test.ts || echo "ABORT: missing integration-tests/ctrl-c-exit.test.ts"
test -f integration-tests/context-compress-interactive.test.ts && echo "NOTE: context-compress-interactive exists" || echo "NOTE: context-compress-interactive missing (OK)"
test -f integration-tests/file-system-interactive.test.ts && echo "NOTE: file-system-interactive exists" || echo "NOTE: file-system-interactive missing (OK)"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diffs:
   - `git show a64bb433 -- integration-tests/test-helper.ts`
   - `git show a64bb433 -- integration-tests/ctrl-c-exit.test.ts`
2. In `integration-tests/test-helper.ts`, make interactive runs deterministic (no provider/auth prompts):
   1. Update `TestRig.runInteractive(...)` to pass the same provider/model flags used by `TestRig.run(...)`:
      - `--provider <LLXPRT_DEFAULT_PROVIDER>`
      - `--model <LLXPRT_DEFAULT_MODEL>`
      - `--key <OPENAI_API_KEY>` (or the provider-equivalent key flag used by LLXPRT)
      - `--ide-mode disable`
   2. Ensure the interactive process environment includes:
      - `NO_BROWSER=true`
      - `LLXPRT_NO_BROWSER_AUTH=true`
      - `CI=true` (to force non-interactive behaviors where applicable)
   3. IF `LLXPRT_DEFAULT_PROVIDER`, `LLXPRT_DEFAULT_MODEL`, or required auth env vars are missing THEN:
      - Throw an error explaining which env var is missing (fail fast).
3. In `integration-tests/ctrl-c-exit.test.ts`, change the “ready” check to match upstream intent:
   1. Replace the current readiness probe for the prompt glyph (`▶`) with:
      - Wait for `Type your message` to appear in output.
   2. Do not add “press 2” or other auth-menu scripting.
4. IF `integration-tests/file-system-interactive.test.ts` exists in LLXPRT THEN:
   1. Do not add auth-menu scripting.
   2. Update readiness checks to wait for `Type your message` only.

Commit message template:

```text
reimplement: deflake interactive auth startup (upstream a64bb433)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes

On failure:

- If interactive runs still prompt for auth/provider selection: fix `TestRig.runInteractive()` flags/env until the prompt never appears (do not script keypresses).

### Batch 31 — `37678acb` — Docs restructure (deployment → installation)

**Upstream files touched:**

- `docs/get-started/deployment.md`
- `docs/get-started/index.md`
- `docs/get-started/installation.md`
- `docs/index.md`
- `docs/sidebar.json`

**LLXPRT target files:**

- `docs/installation.md` (CREATE)
- `docs/deployment.md` (EXISTS)
- `docs/index.md` (EXISTS)
- `docs/sidebar.json` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f docs/deployment.md || echo "ABORT: missing docs/deployment.md"
test -f docs/index.md || echo "ABORT: missing docs/index.md"
test -f docs/sidebar.json && echo "NOTE: docs/sidebar.json exists" || echo "NOTE: docs/sidebar.json missing (OK)"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream content:
   - `git show 37678acb -- docs/get-started/installation.md`
   - `git show 37678acb -- docs/get-started/deployment.md`
   - `git show 37678acb -- docs/index.md`
2. CREATE `docs/installation.md` by porting the upstream `installation.md` structure, with these mandatory substitutions:
   - `@google/gemini-cli` → `@vybestack/llxprt-code`
   - `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`
   - `gemini` command → `llxprt`
   - `.gemini` → `.llxprt`
   - `GEMINI.md` → `LLXPRT.md`
3. In `docs/installation.md`, ensure the sandbox section matches LLXPRT:
   1. Replace upstream’s Google registry image with LLXPRT’s sandbox image (see `package.json` `config.sandboxImageUri`).
   2. Do not mention Google-only auth as a requirement; LLXPRT is multi-provider.
4. Update `docs/index.md` navigation:
   1. Change the “Execution and Deployment” link target from `./deployment.md` to `./installation.md`.
   2. Rename the bullet label to “Installation and Deployment”.
5. Update `docs/deployment.md`:
   1. Add a short note at the top linking to `docs/installation.md` as the primary page.
   2. Keep existing LLXPRT content below that note (do not delete).
6. Format the touched docs:
   1. Run `prettier` on `docs/installation.md`, `docs/index.md`, and `docs/deployment.md`.

Commit message template:

```text
reimplement: docs installation page (upstream 37678acb)
```

Acceptance criteria (all must pass):

- The docs are LLXPRT-branded (no `@google/gemini-cli` or `gemini` command examples in the new/modified sections)
- Links from `docs/index.md` point to `docs/installation.md`
- New doc file is formatted (Prettier)

On failure:

- If this batch conflicts with existing docs structure: keep `docs/deployment.md` as-is and only add `docs/installation.md` + the `docs/index.md` link update.

### Batch 34 — `5dc7059b` — Introduce `InteractiveRun` wrapper for PTY tests

**Upstream files touched:**

- `integration-tests/context-compress-interactive.test.ts`
- `integration-tests/ctrl-c-exit.test.ts`
- `integration-tests/file-system-interactive.test.ts`
- `integration-tests/json-output.test.ts`
- `integration-tests/list_directory.test.ts`
- `integration-tests/simple-mcp-server.test.ts`
- `integration-tests/test-helper.ts`

**LLXPRT target files:**

- `integration-tests/test-helper.ts` (EXISTS)
- `integration-tests/ctrl-c-exit.test.ts` (EXISTS)
- `integration-tests/list_directory.test.ts` (EXISTS)
- `integration-tests/simple-mcp-server.test.ts` (EXISTS)
- `integration-tests/context-compress-interactive.test.ts` (SKIP-IF-MISSING)
- `integration-tests/file-system-interactive.test.ts` (SKIP-IF-MISSING)
- `integration-tests/json-output.test.ts` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f integration-tests/test-helper.ts || echo "ABORT: missing integration-tests/test-helper.ts"
test -f integration-tests/list_directory.test.ts || echo "ABORT: missing integration-tests/list_directory.test.ts"
test -f integration-tests/simple-mcp-server.test.ts || echo "ABORT: missing integration-tests/simple-mcp-server.test.ts"
test -f integration-tests/ctrl-c-exit.test.ts || echo "ABORT: missing integration-tests/ctrl-c-exit.test.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diffs:
   - `git show 5dc7059b -- integration-tests/test-helper.ts`
   - `git show 5dc7059b -- integration-tests/ctrl-c-exit.test.ts`
   - `git show 5dc7059b -- integration-tests/list_directory.test.ts`
   - `git show 5dc7059b -- integration-tests/simple-mcp-server.test.ts`
2. In `integration-tests/test-helper.ts`, add exported helpers (match upstream shape):
   1. Add `export function getDefaultTimeout()` using LLXPRT env naming:
      - IF `process.env.CI` is truthy THEN `60000`
      - ELSE IF `process.env.LLXPRT_SANDBOX` is set THEN `30000`
      - ELSE `15000`
   2. Add `export async function poll(predicate, timeout, interval)` and implement it by moving the existing `TestRig.poll` logic into the exported helper.
   3. Keep `TestRig.poll(...)` as a wrapper that calls the exported `poll(...)` (so existing tests don’t break).
3. In `integration-tests/test-helper.ts`, introduce `export class InteractiveRun`:
   1. Constructor takes `ptyProcess` and accumulates `output` (and respects `KEEP_OUTPUT`/`VERBOSE`).
   2. Implement:
      - `waitForText(text, timeout?)` (asserts via `expect(...)`).
      - `type(text)` (character-by-character typing).
      - `kill()`
      - `waitForExit()` (60s timeout, returns exit code).
4. In `integration-tests/test-helper.ts`, change `TestRig.runInteractive()`:
   1. Return type: `Promise<InteractiveRun>`.
   2. Spawn the PTY using the same CLI args/env as the current implementation.
   3. Create `const run = new InteractiveRun(ptyProcess)`.
   4. Wait for readiness: `await run.waitForText('Type your message', 30000)`.
   5. Return `run`.
5. Update existing tests to use the wrapper:
   1. In `integration-tests/ctrl-c-exit.test.ts`:
      - Replace `{ ptyProcess, promise } = rig.runInteractive()` with `const run = await rig.runInteractive()`.
      - Replace `ptyProcess.write(...)` with `await run.type(...)`.
      - Replace manual exit-wait logic with `await run.waitForExit()`.
   2. In `integration-tests/list_directory.test.ts` and `integration-tests/simple-mcp-server.test.ts`:
      - (Optional but preferred) switch `await rig.poll(...)` to `await poll(...)` and import `{ poll }` from `./test-helper.js`.

Commit message template:

```text
reimplement: introduce InteractiveRun for integration tests (upstream 5dc7059b)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test:integration:sandbox:none -- list_directory.test.ts` passes
- `npm run test:integration:sandbox:none -- simple-mcp-server.test.ts` passes

On failure:

- If changing `ctrl-c-exit.test.ts` is too invasive: keep the `InteractiveRun` class + `runInteractive()` return type, and leave the Ctrl+C test conversion for Batch 39 (rename batch) with a NO-OP note here.

### Batch 36 — `19c1d734` — Docs: integration tests require `npm run bundle`

**Upstream files touched:**

- `docs/integration-tests.md`

**LLXPRT target files:**

- `dev-docs/integration-tests.md` (EXISTS)
- `docs/integration-tests.md` (SKIP-IF-MISSING; LLXPRT uses `dev-docs/`)

**Pre-check (run before starting):**

```bash
test -f dev-docs/integration-tests.md || echo "ABORT: missing dev-docs/integration-tests.md"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream doc change:
   - `git show 19c1d734 -- docs/integration-tests.md`
2. In `dev-docs/integration-tests.md`, add a short section near the top (before commands) with this requirement:
   - “Before running integration tests, run `npm run bundle`.”
3. Include an explicit re-run rule:
   - “Re-run `npm run bundle` after changes to `packages/cli` or `packages/core`; test-only changes do not require rebundling.”
4. Ensure all examples use LLXPRT naming (`llxprt`, `.llxprt`, `LLXPRT.md`).

Commit message template:

```text
reimplement: docs require bundle before integration tests (upstream 19c1d734)
```

Acceptance criteria (all must pass):

- Touched docs are formatted (Prettier)
- `dev-docs/integration-tests.md` mentions `npm run bundle` near the top

On failure:

- If the doc structure differs: keep the content but place it in the most prominent “Prerequisites” section.

### Batch 37 — `518caae6` — Extract `.gemini` dir constant (LLXPRT uses `.llxprt` + compat)

**Upstream files touched:**

- `integration-tests/globalSetup.ts`
- `integration-tests/test-helper.ts`
- `packages/a2a-server/src/config/config.ts`
- `packages/a2a-server/src/config/extension.ts`
- `packages/a2a-server/src/config/settings.ts`
- `packages/cli/src/commands/mcp/list.test.ts`
- `packages/cli/src/commands/mcp/remove.test.ts`
- `packages/cli/src/config/config.test.ts`
- `packages/cli/src/config/extensions/extensionEnablement.test.ts`
- `packages/cli/src/config/settings.test.ts`
- `packages/cli/src/config/settings.ts`
- `packages/cli/src/config/trustedFolders.ts`
- `packages/cli/src/services/FileCommandLoader.test.ts`
- `packages/cli/src/ui/commands/restoreCommand.test.ts`
- `packages/cli/src/ui/components/Notifications.tsx`
- `packages/cli/src/ui/hooks/useFlickerDetector.test.ts`
- `packages/cli/src/ui/hooks/useShellHistory.test.ts`
- `packages/cli/src/utils/sandbox.ts`
- `packages/core/src/code_assist/oauth-credential-storage.ts`
- `packages/core/src/code_assist/oauth2.test.ts`
- `packages/core/src/config/config.test.ts`
- `packages/core/src/config/storage.test.ts`
- `packages/core/src/config/storage.ts`
- `packages/core/src/core/logger.test.ts`
- `packages/core/src/core/prompts.test.ts`
- `packages/core/src/core/prompts.ts`
- `packages/core/src/mcp/token-storage/file-token-storage.test.ts`
- `packages/core/src/mcp/token-storage/file-token-storage.ts`
- `packages/core/src/tools/memoryTool.test.ts`
- `packages/core/src/tools/memoryTool.ts`
- `packages/core/src/utils/getFolderStructure.test.ts`
- `packages/core/src/utils/installationManager.test.ts`
- `packages/core/src/utils/userAccountManager.test.ts`
- `scripts/sandbox_command.js`
- `scripts/telemetry.js`
- `scripts/telemetry_utils.js`

**LLXPRT target files:**

- `packages/core/src/utils/paths.ts` (EXISTS)
- `packages/cli/src/services/FileCommandLoader.test.ts` (EXISTS)
- `packages/cli/src/config/config.test.ts` (EXISTS)
- `packages/a2a-server/src/config/config.ts` (EXISTS)
- `packages/a2a-server/src/config/extension.ts` (EXISTS)
- `packages/a2a-server/src/config/settings.ts` (EXISTS)
- (plus any other non-doc file that contains a hardcoded `.gemini` path segment)

**Pre-check (run before starting):**

```bash
test -f packages/core/src/utils/paths.ts || echo "ABORT: missing packages/core/src/utils/paths.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream approach:
   - `git show 518caae6 --name-only`
2. Avoid new “compat shims”:
   1. Prefer existing LLXPRT constants (`LLXPRT_CONFIG_DIR`, `LLXPRT_DIR`) over introducing new aliases.
   2. Only keep `.gemini` in explicit migration code paths (e.g., credential migration read-paths).
3. Find `.gemini` hardcoding in LLXPRT (code/tests only):

   ```bash
   rg -n \"\\.gemini\" packages/cli packages/core packages/a2a-server integration-tests scripts || true
   ```

4. For every match returned by the command above:
   1. IF the file path starts with `docs/` OR `dev-docs/` OR `project-plans/` THEN do not change it in this batch.
   2. ELSE replace hardcoded `.gemini` path segments with the imported LLXPRT constant (prefer `LLXPRT_DIR` / `LLXPRT_CONFIG_DIR`).
5. Update tests to build paths via the constants:
   - Example pattern (use one, do not hardcode):
     - `path.join(process.cwd(), LLXPRT_DIR, 'extensions', ...)`

Commit message template:

```text
reimplement: centralize config dir constant (upstream 518caae6)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `rg -n \"\\.gemini\" packages/cli packages/core packages/a2a-server integration-tests scripts` shows no new `.gemini` usage in code (docs excluded)

On failure:

- If a test is explicitly validating migration from Gemini CLI: keep the `.gemini` string only in that test’s fixture text, but do not use `.gemini` for primary paths.

### Batch 38 — `4a5ef4d9` — Add `expectToolCallSuccess` helper

**Upstream files touched:**

- `integration-tests/file-system-interactive.test.ts`
- `integration-tests/test-helper.ts`

**LLXPRT target files:**

- `integration-tests/test-helper.ts` (EXISTS)
- `integration-tests/file-system-interactive.test.ts` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f integration-tests/test-helper.ts || echo "ABORT: missing integration-tests/test-helper.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diff:
   - `git show 4a5ef4d9 -- integration-tests/test-helper.ts integration-tests/file-system-interactive.test.ts`
2. In `integration-tests/test-helper.ts`:
   1. Ensure `expect` is available in this module (import from `vitest` if needed).
   2. Add `async expectToolCallSuccess(toolNames: string[], timeout?: number)` to `TestRig`:
      - IF `timeout` is undefined THEN set it to `getDefaultTimeout()`.
      - `await this.waitForTelemetryReady()`.
      - `await poll(() => toolLogs contain a matching name with success === true, timeout, 100)`.
      - Assert: `expect(success).toBe(true)` with an error message listing `toolNames`.
3. IF `integration-tests/file-system-interactive.test.ts` exists in LLXPRT THEN:
   1. Port the upstream deflake adjustments (timeouts/readiness only).
4. ELSE (file missing) THEN:
   - Do not create it; proceed with the `test-helper.ts` helper only.

Commit message template:

```text
reimplement: add expectToolCallSuccess helper (upstream 4a5ef4d9)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes

On failure:

- If `poll` / `getDefaultTimeout` do not exist yet: complete Batch 34 first (InteractiveRun introduces them), then retry this batch.

### Batch 39 — `a73b8145` — Rename `waitFor*` to `expect*` in interactive run helper

**Upstream files touched:**

- `integration-tests/context-compress-interactive.test.ts`
- `integration-tests/ctrl-c-exit.test.ts`
- `integration-tests/file-system-interactive.test.ts`
- `integration-tests/test-helper.ts`

**LLXPRT target files:**

- `integration-tests/test-helper.ts` (EXISTS)
- `integration-tests/ctrl-c-exit.test.ts` (EXISTS)
- `integration-tests/context-compress-interactive.test.ts` (SKIP-IF-MISSING)
- `integration-tests/file-system-interactive.test.ts` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f integration-tests/test-helper.ts || echo "ABORT: missing integration-tests/test-helper.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diff:
   - `git show a73b8145 -- integration-tests/test-helper.ts integration-tests/ctrl-c-exit.test.ts`
2. Ensure Batch 34 already landed:
   1. IF `integration-tests/test-helper.ts` does not contain `class InteractiveRun` THEN:
      - ABORT this batch and go back to Batch 34.
3. Rename `InteractiveRun` methods in `integration-tests/test-helper.ts`:
   - `waitForText(...)` → `expectText(...)`
   - `waitForExit(...)` → `expectExit(...)`
4. Update `TestRig.runInteractive()` implementation:
   - Replace `await run.waitForText('Type your message', ...)` with `await run.expectText('Type your message', ...)`.
5. Update call sites in integration tests:
   1. In `integration-tests/ctrl-c-exit.test.ts`, replace:
      - `run.waitForText(...)` → `run.expectText(...)`
      - `run.waitForExit()` → `run.expectExit()`
   2. IF `integration-tests/file-system-interactive.test.ts` exists THEN update its call sites too.
6. Verify no leftovers:

   ```bash
   rg -n \"waitForText\\(|waitForExit\\(\" integration-tests/test-helper.ts integration-tests/*.test.ts || true
   ```

Commit message template:

```text
reimplement: rename InteractiveRun methods to expect* (upstream a73b8145)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes

On failure:

- If renaming breaks other tests: only rename `InteractiveRun` methods (do not change `TestRig.waitForToolCall`, `TestRig.waitForAnyToolCall`, etc.).

### Batch 41 — `c4bd7594` — Settings docs + showInDialog settings

**Upstream files touched:**

- `docs/get-started/configuration.md`
- `packages/cli/src/config/settingsSchema.ts`

**LLXPRT target files:**

- `packages/cli/src/config/settingsSchema.ts` (EXISTS)
- `docs/cli/configuration.md` (EXISTS)
- `docs/get-started/configuration.md` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f packages/cli/src/config/settingsSchema.ts || echo "ABORT: missing packages/cli/src/config/settingsSchema.ts"
test -f docs/cli/configuration.md || echo "ABORT: missing docs/cli/configuration.md"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diffs:
   - `git show c4bd7594 -- packages/cli/src/config/settingsSchema.ts`
   - `git show c4bd7594 -- docs/get-started/configuration.md`
2. In `packages/cli/src/config/settingsSchema.ts`, add the upstream reminder comment, but point it at LLXPRT docs:
   - Replace upstream path `docs/get-started/configuration.md` with `docs/cli/configuration.md`.
3. Enumerate settings that are shown in the UI:

   ```bash
   rg -n \"showInDialog: true\" packages/cli/src/config/settingsSchema.ts
   ```

4. In `docs/cli/configuration.md`, ensure every `showInDialog: true` setting is documented:
   1. For each hit from the grep above, identify its full key path (e.g., `ui.useFullWidth`).
   2. IF the key is already documented THEN do not duplicate it.
   3. ELSE add a bullet entry that includes:
      - Key path
      - Type
      - Description (copy from schema)
      - Default (copy from schema)
5. Ensure `ui.useFullWidth` is documented (it is added in Batch 20).
6. Apply Branding Substitutions (no `Gemini CLI` / `gemini` command examples in the new sections).
7. Format docs (Prettier) for `docs/cli/configuration.md`.

Commit message template:

```text
reimplement: document showInDialog settings (upstream c4bd7594)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `docs/cli/configuration.md` is formatted and includes `ui.useFullWidth`

On failure:

- If settings keys differ from upstream: document only keys that exist in LLXPRT’s `settingsSchema.ts` (do not add Gemini-only keys).

### Batch 42 — `ada179f5` — Sequential tool call execution (port carefully)

**Upstream files touched:**

- `packages/core/src/core/coreToolScheduler.test.ts`
- `packages/core/src/core/coreToolScheduler.ts`
- `packages/core/src/core/geminiChat.test.ts`
- `packages/core/src/core/geminiChat.ts`

**Decision (MANDATORY — do not deviate):**

- DO NOT make tool calls sequential (would regress LLXPRT parallel batching).
- Preserve concurrent execution, but ensure **deterministic ordering** of the resulting tool-call responses.
- Implementation rule: buffer results, then apply/publish them in original call order.

**LLXPRT target files:**

- `packages/core/src/core/coreToolScheduler.ts` (EXISTS)
- `packages/core/src/core/coreToolScheduler.test.ts` (EXISTS)
- `packages/core/src/core/geminiChat.ts` (EXISTS)
- `packages/core/src/core/geminiChat.test.ts` (SKIP-IF-MISSING)

**Pre-check (run before starting):**

```bash
test -f packages/core/src/core/coreToolScheduler.ts || echo "ABORT: missing packages/core/src/core/coreToolScheduler.ts"
test -f packages/core/src/core/coreToolScheduler.test.ts || echo "ABORT: missing packages/core/src/core/coreToolScheduler.test.ts"
test -f packages/core/src/core/geminiChat.ts || echo "ABORT: missing packages/core/src/core/geminiChat.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diffs:
   - `git show ada179f5 -- packages/core/src/core/coreToolScheduler.ts`
   - `git show ada179f5 -- packages/core/src/core/coreToolScheduler.test.ts`
2. Add the regression test **before any scheduler code changes**:
   1. In `packages/core/src/core/coreToolScheduler.test.ts`, add:

      ```ts
      it('should preserve call order in results even with concurrent execution', async () => {
        // Tool A: 100ms delay, Tool B: 10ms delay
        // Results MUST be returned in [A, B] order (original call order), not [B, A].
      });
      ```

   2. Implement the test using two fake tools whose `execute()` resolves after different delays.
   3. Assert the `onAllToolCallsComplete` callback receives `CompletedToolCall[]` in the original request order.
3. Implement the deterministic-order fix in `packages/core/src/core/coreToolScheduler.ts`:
   1. Keep tool execution concurrent.
   2. Buffer completion results for each scheduled tool call in a list that includes the original call index.
   3. After all scheduled calls have completed (e.g., `Promise.allSettled(...)`), apply results in call-index order:
      - For each buffered result, call `setStatusInternal(callId, 'success' | 'error' | 'cancelled', ...)`.
   4. Do not change LLXPRT’s batching behavior or queue semantics.
4. IF the regression test already passes without any scheduler changes THEN:
   1. Keep the test.
   2. Make this batch a “test-only” commit (NO scheduler behavior changes).

Commit message template:

```text
reimplement: deterministic tool-call result order (upstream ada179f5)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test --workspace @vybestack/llxprt-code-core` passes (regression test included)

On failure:

- If the fix makes tool calls sequential: revert that approach and implement buffering + ordered application instead.

### Batch 46 — `7c1a9024` — Retry on specific fetch errors (may be already covered)

**Upstream files touched:**

- `packages/cli/src/config/config.ts`
- `packages/cli/src/config/settings.ts`
- `packages/cli/src/config/settingsSchema.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/core/geminiChat.test.ts`
- `packages/core/src/core/geminiChat.ts`
- `packages/core/src/utils/retry.test.ts`
- `packages/core/src/utils/retry.ts`

**LLXPRT target files:**

- `packages/core/src/utils/retry.ts` (EXISTS)
- `packages/core/src/utils/retry.test.ts` (EXISTS)
- `packages/core/src/config/config.ts` (SKIP; do not add new Google-only retry flags)
- `packages/cli/src/config/*` (SKIP; do not add new settings for this unless tests prove necessary)

**Pre-check (run before starting):**

```bash
test -f packages/core/src/utils/retry.ts || echo "ABORT: missing packages/core/src/utils/retry.ts"
test -f packages/core/src/utils/retry.test.ts || echo "ABORT: missing packages/core/src/utils/retry.test.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream retry change:
   - `git show 7c1a9024 -- packages/core/src/utils/retry.ts packages/core/src/utils/retry.test.ts`
2. Add a focused unit test to `packages/core/src/utils/retry.test.ts`:
   1. Create: `const error = new Error('exception TypeError: fetch failed sending request');`
   2. Assert: `isNetworkTransientError(error) === true`.
3. Run core tests:
   - `npm run test --workspace @vybestack/llxprt-code-core`
4. IF the new test passes without changing `packages/core/src/utils/retry.ts` THEN:
   - Do not change runtime behavior; keep this as a test-only commit.
5. ELSE (test fails) THEN:
   - Extend LLXPRT’s transient-network detection so the message is treated as transient.
   - Do not add new `retryFetchErrors` config plumbing in this batch.

Commit message template:

```text
reimplement: retry fetch failed sending request (upstream 7c1a9024)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run test --workspace @vybestack/llxprt-code-core` passes

On failure:

- If you are tempted to add new settings: don’t; fix the transient-error predicate first.

### Batch 47 — `49b66733` — Disable Ctrl+C test (likely N/A in LLXPRT)

**Upstream files touched:**

- `integration-tests/ctrl-c-exit.test.ts`

**LLXPRT target files:**

- `integration-tests/ctrl-c-exit.test.ts` (EXISTS)

**Pre-check (run before starting):**

```bash
test -f integration-tests/ctrl-c-exit.test.ts || echo "ABORT: missing integration-tests/ctrl-c-exit.test.ts"
```

Steps (numbered, imperative, no ambiguity):

1. Inspect upstream diff:
   - `git show 49b66733 -- integration-tests/ctrl-c-exit.test.ts`
2. Inspect LLXPRT file:
   - IF the file already has `describe.skipIf(process.env.CI === 'true')` (or equivalent CI skip) THEN make this batch a NO-OP commit.
   - ELSE add CI-only skipping (do not use `describe.skip` unconditionally).
3. Do not disable the test entirely in LLXPRT unless it is also skipped outside CI for a documented reason.

Commit message template:

```text
reimplement: keep ctrl-c test CI-skipped (upstream 49b66733)
```

Acceptance criteria (all must pass):

- `npm run typecheck` passes
- `npm run lint` passes

On failure:

- If interactive tests cause instability: keep CI skip, but do not blanket-disable for local runs.

### Batch 48 — `99c7108b` — Integration test harness fixes + real allowlist testing

Upstream files touched:

- `integration-tests/test-helper.ts` (yolo flag; matchArgs; log schema)
- `integration-tests/run_shell_command.test.ts` (actually tests allowlist by setting `yolo:false`)
- plus minor TS-safe env access in `globalSetup.ts`

LLXPRT required port (this is correctness-critical):

- LLXPRT currently passes `args: [...]` inside the options object to `TestRig.run`, but `TestRig.run` ignores that field. This means allowlist tests are not actually passing `--allowed-tools=...`.

Steps:

1. Update `integration-tests/test-helper.ts`:
   - Extend `TestRig.run` options to support:
     - `yolo?: boolean` (default true)
   - Do not use `args: [...]` inside the options object; instead rely on `...args` rest parameter.
2. Change `run_shell_command.test.ts`:
   - Replace all `{ stdin, args: [...] }` usage with:
     - `rig.run({ stdin, yolo: false }, '--allowed-tools=…', …)`
3. Add `matchArgs` support to `waitForToolCall`:
   - `waitForToolCall(toolName, timeout?, matchArgs?)`
4. Ensure allowlist tests truly run without `--yolo` so permissioning is exercised.
5. Fix any TypeScript env-index signature issues by using bracket notation where required.

Acceptance criteria:

- The allowlist tests fail if `--allowed-tools` is not passed (i.e., they now validate the intended behavior).
- Integration tests still run on configured providers in CI/local.

### Batch 49 — `769fe8b1` — Replace test cleanup (upstream deletes a flaky case)

Upstream deletes a flaky replace test and unskips suite.

LLXPRT reality:

- LLXPRT’s replace suite is not fully skipped; we already have a safer “old_string not found” assertion.

Steps:

1. Re-evaluate whether LLXPRT still needs its skipped replace test (`it.skip('should be able to replace content…')`).
2. If we can make it deterministic (after Batch 48 harness fixes), unskip it.
3. If a specific case is unworkable, delete/skip only that case (prefer LLXPRT’s stronger assertion patterns).

### Batch 50 — `6f0107e7` — Robust URL validation for web fetch

Upstream adds `parsePrompt()` which:

- Extracts URLs by tokenizing prompt
- Validates with `new URL()`
- Errors on malformed/unsupported protocols

LLXPRT mapping:

- Port this behavior into:
  - `packages/core/src/tools/google-web-fetch.ts`
  - (optionally) `packages/core/src/tools/direct-web-fetch.ts` for stricter URL validation

Steps:

1. Add `parsePrompt()` to `packages/core/src/tools/google-web-fetch.ts` (export it for testing).
2. Replace `extractUrls()` usage with `parsePrompt().validUrls`.
3. Update `validateToolParamValues` to:
   - return aggregated error messages if malformed URLs exist
   - require at least one valid http/https URL
4. Add/extend tests:
   - Add case: `prompt` contains `https://`-looking but malformed token → validation error
   - Add case: `ftp://…` token → “unsupported protocol” error

Acceptance criteria:

- Tool rejects malformed URLs with a helpful message.
- No regression for existing valid prompt flows.

### Batch 52 — `4f5b3357` — Add cyclic-schema MCP integration test

Upstream adds:

- `integration-tests/mcp_server_cyclic_schema.test.ts` with a small inline MCP server script

LLXPRT plan:

1. Implement/confirm `InteractiveRun` is available (Batch 34 + 39).
2. Add the new test file:
   - Copy upstream test and adjust settings file structure if LLXPRT differs.
   - Ensure it runs `llxprt` bundle, not `gemini`.
3. Ensure MCP server config is written under the correct settings key path and config dir (`.llxprt`).
4. Run the test locally with `npm run test:integration:sandbox:none` (or `npm run test:e2e`) after `npm run bundle`.

Acceptance criteria:

- `/mcp list` shows the cyclic schema tool name.
- Test passes consistently (use deflake script if needed).

---

## End-of-Run Parity Marker (Optional)

If you want an explicit “sync point” marker in git history (per `dev-docs/cherrypicking.md`), create an empty merge commit after finishing all batches:

```bash
# IMPORTANT: merge a specific upstream commit hash, not upstream/main.
# Choose the upstream commit you consider the sync point (e.g. the last commit in v0.10.0 range).
git merge -s ours --no-ff <upstream-sync-sha> -m \"Merge upstream gemini-cli up to <sha> (marker only)\"
```
