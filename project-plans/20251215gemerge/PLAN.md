# Plan: 20251215gemerge — gemini-cli v0.9.0 → v0.10.0

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
- Config dir: **`.llxprt`**, not `.gemini` (except where we intentionally support backward compatibility; prefer `LLXPRT_CONFIG_DIR`/`GEMINI_DIR` constants).
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
| 03 | QUICK | PICK | 6,7,12,13,14 | 1af3fef3, 603ec2b2, b92e3bca, 1962b51d, f2852056 | fix(infra) - Remove auto update from integration tests (#10656) / Add script to deflake integration tests (#10666) / fix(mcp): fix MCP server removal not persisting to settings (#10098) / fix: ensure positional prompt arguments work with extensions flag (#10077) / feat: prevent ansi codes in extension MCP Servers (#10748) |
| 04 | FULL | PICK | 15,16 | 76b1deec, 118aade8 | fix(core): refresh file contents in smart edit given newer edits from user/external process (#10084) / citations documentation (#10742) |
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

# Batch 03 PICK #6 #7 #12 #13 #14 (1af3fef3 603ec2b2 b92e3bca 1962b51d f2852056)
git cherry-pick 1af3fef33a611f17957f8043211b9e1ea3ac15bb 603ec2b21bd95be249f0f0c6d4d6ee267fab436a b92e3bca508036514bd7bb3fb566e93f82edfc18 1962b51d8d3b971d820eef288d9d4f3346d3a1a0 f2852056a11d10cd56045b57ba1deec5822a089e

# Batch 04 PICK #15 #16 (76b1deec 118aade8)
git cherry-pick 76b1deec25c7fa528c42c42a0e1b47c1e0d9f2ec 118aade84cc7e3f6d4680bd17adf73561153050c

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

Implementation convention for reimplement commits:

- Create exactly one local commit per upstream reimplementation, named like:
  - `reimplement: <short subject> (upstream <shortsha>)`
- In the commit body, include:
  - the upstream SHA
  - the key LLXPRT adaptations (branding, tool rename, telemetry removal)

### Batch 02 — `8ac2c684` — Bundle a2a-server

Upstream files touched:

- `esbuild.config.js`

Goal in LLXPRT:

- Ensure `npm run bundle` also produces a **single-file runnable bundle** for the a2a-server (so later `c82c2c2b` bin wiring has a real target).

Steps:

1. Inspect upstream diff: `git show 8ac2c684 -- esbuild.config.js`.
2. Update LLXPRT `esbuild.config.js` to build **two outputs**:
   - CLI bundle (existing): `bundle/llxprt.js`
   - A2A bundle (new): `packages/a2a-server/dist/a2a-server.mjs`
3. Use a shared “base” esbuild config (bundle/platform/format/external/loader) and two per-target configs.
4. Use `Promise.allSettled([ … ])` so CLI bundling failures still fail the build, but a2a bundling can be either:
   - strict (fail the build), or
   - soft (warn only).
   Decide based on whether LLXPRT wants a2a-server to be required for releases.
5. Ensure the a2a output is executable:
   - `fs.chmodSync('packages/a2a-server/dist/a2a-server.mjs', 0o755)`
6. Quick verify: `npm run bundle` (or `node esbuild.config.js`) then ensure file exists:
   - `test -f packages/a2a-server/dist/a2a-server.mjs`

Acceptance criteria:

- `npm run bundle` succeeds and produces `packages/a2a-server/dist/a2a-server.mjs`.
- Batch 02 verification passes (quick + full).

### Batch 05 — `8d8a2ab6` — Deflake docs + default `runs=5`

Upstream files touched:

- `docs/integration-tests.md`
- `scripts/deflake.js` (default runs: 50 → 5)

LLXPRT target files:

- `scripts/deflake.js` (added by `603ec2b2` in Batch 03)
- `dev-docs/integration-tests.md` (LLXPRT docs home for integration test guidance)

Steps:

1. Ensure `scripts/deflake.js` exists (Batch 03 must have landed).
2. Change the default `--runs` value to `5` (not `50`).
3. Add a “Deflaking” section to `dev-docs/integration-tests.md`:
   - When to use `deflake` (new test cases; flaky failures).
   - Example command patterns that match LLXPRT scripts (`npm run test:e2e` / `vitest`).
4. Do **not** copy upstream “gemini” command examples; use LLXPRT equivalents.

Acceptance criteria:

- `node scripts/deflake.js --help` shows default runs=5.
- Docs section exists in `dev-docs/integration-tests.md`.

### Batch 07 — `bcbcaeb8` — Docs: FAQ + extensions tweaks

Upstream files touched:

- `docs/extensions/index.md`
- `docs/faq.md`

LLXPRT mapping:

- LLXPRT has `docs/extension.md` and no `docs/faq.md` (use `docs/troubleshooting.md` or add a small FAQ page if desired).

Steps:

1. Inspect upstream diff: `git show bcbcaeb8`.
2. Port the “fix stray backtick” style cleanup to `docs/extension.md` (ensure command examples don’t have broken markup).
3. Decide where “Not seeing your question?” belongs:
   - If LLXPRT uses GitHub Issues for support, keep issue tracker links.
   - If LLXPRT prefers Discussions, update to Discussions (but point to LLXPRT org/repo, not google-gemini).
4. Make sure any `gemini …` CLI command examples become `llxprt …`.

Acceptance criteria:

- Docs changes are LLXPRT-branded and links point to LLXPRT repo destinations.

### Batch 10 — `0cd490a9` — Support `GOOGLE_CLOUD_PROJECT_ID` fallback

Upstream files touched:

- `packages/core/src/code_assist/setup.ts`
- `packages/core/src/core/contentGenerator.ts`
- `docs/get-started/authentication.md`

LLXPRT target files:

- `packages/core/src/code_assist/setup.ts`
- `packages/core/src/core/contentGenerator.ts`
- `docs/cli/authentication.md` (LLXPRT doc path)

Steps:

1. Inspect upstream diff: `git show 0cd490a9`.
2. In `packages/core/src/code_assist/setup.ts`:
   - Where project ID is read from `process.env.GOOGLE_CLOUD_PROJECT`, change to:
     - `process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || undefined`
   - Update/extend existing tests in `packages/core/src/code_assist/setup.test.ts`:
     - Add test: when `GOOGLE_CLOUD_PROJECT` unset and `GOOGLE_CLOUD_PROJECT_ID` set, it uses `_ID`.
3. In `packages/core/src/core/contentGenerator.ts`:
   - Apply same fallback for reading project ID.
   - Update/extend tests in `packages/core/src/core/contentGenerator.test.ts`.
4. In docs (`docs/cli/authentication.md`):
   - Mention `GOOGLE_CLOUD_PROJECT_ID` as a fallback and explain precedence.
   - Keep LLXPRT branding and existing auth flow text; do not introduce Google-only assumptions beyond GCP env vars.

Acceptance criteria:

- Unit tests cover fallback behavior.
- No behavior regression when `GOOGLE_CLOUD_PROJECT` is set.

### Batch 12 — `bd6bba8d` — Docs: deflake command invocation fix

Upstream file touched:

- `docs/integration-tests.md` (adds extra `--` in example)

LLXPRT target:

- `dev-docs/integration-tests.md`

Steps:

1. Update deflake example(s) in `dev-docs/integration-tests.md` to use correct npm-arg forwarding.
2. Ensure examples match LLXPRT scripts:
   - `npm run test:e2e -- --test-name-pattern "…"`
   - Or if invoking vitest directly, show `vitest run --root ./integration-tests --testNamePattern …`.

### Batch 15 — `5e688b81` — Replace test: “old_string not found”

Upstream change:

- Skips `integration-tests/replace.test.ts` case that was flaky upstream.

LLXPRT reality:

- LLXPRT’s `integration-tests/replace.test.ts` already contains a stronger, less flaky assertion (file content remains unchanged).

Steps:

1. Compare upstream vs LLXPRT `integration-tests/replace.test.ts`.
2. Prefer **keeping** LLXPRT’s stronger test (do not blindly `it.skip`).
3. If the test flakes in LLXPRT:
   - First try to fix determinism via harness changes (Batch 48) and/or tool constraints.
   - Only if still flaky, add a temporary `it.skip` with a LLXPRT issue link (not upstream issue link).

### Batch 16 — `5aab793c` — Interactive test reliability (file-system-interactive)

Upstream file touched:

- `integration-tests/file-system-interactive.test.ts`

LLXPRT reality:

- LLXPRT currently does **not** carry `file-system-interactive.test.ts` (we have `file-system.test.ts`).

Two options (choose one):

1. **Skip-port** (minimal):
   - No code change; record as “not applicable” because file doesn’t exist.
2. **Adopt upstream test** (recommended only if we want this coverage):
   - Add `integration-tests/file-system-interactive.test.ts` from upstream (latest version, after later deflake commits).
   - Ensure `TestRig.runInteractive()` passes provider/model flags and doesn’t hang on auth prompts.
   - Apply upstream timeout adjustments (increase ready + text timeouts).

Acceptance criteria (if adopting):

- Test is `skipIf(process.platform === 'win32')` initially (avoid PTY flake) until stable.

### Batch 17 — `0b6c0200` — Failed-response retry via extra prompt injection

Upstream files touched:

- `packages/core/src/config/config.ts` (+ config flag)
- `packages/core/src/core/client.ts` (invalid stream handling + retry injection)
- `packages/core/src/core/turn.ts` (InvalidStream event)
- `packages/cli/src/ui/hooks/useGeminiStream.ts` (wiring)
- tests in those areas

LLXPRT reality:

- LLXPRT already has `GeminiEventType.InvalidStream` in `packages/core/src/core/turn.ts`, but the client-side retry behavior is not fully implemented.

Steps:

1. Inspect upstream diff: `git show 0b6c0200`.
2. Add `continueOnFailedApiCall?: boolean` to LLXPRT core config:
   - File: `packages/core/src/config/config.ts`
   - Default: `true` (match upstream intent).
3. In `packages/core/src/core/client.ts`:
   - Detect `GeminiEventType.InvalidStream` events coming from `Turn.run()`.
   - If `continueOnFailedApiCall` is true:
     - Inject a single retry by appending a system message like `System: Please continue.` and re-running the stream once.
     - Ensure we do not infinite-loop (retry at most once per prompt_id).
   - Do **not** add or call Clearcut telemetry/loggers.
4. Add/port tests:
   - Add a unit test that simulates an InvalidStream error and asserts we retry once (and then stop).
5. Ensure UI does not crash when InvalidStream happens:
   - If needed, handle/ignore the InvalidStream event in CLI stream hook.

Acceptance criteria:

- InvalidStream does not terminate the session abruptly; it retries once then yields a terminal state.
- No telemetry-to-Google added.

### Batch 19 — `c82c2c2b` — a2a-server bin + main entry + shebang tweaks

Upstream files touched:

- `packages/a2a-server/package.json` (main, bin)
- `packages/a2a-server/src/http/server.ts` (shebang + main-module detection)

LLXPRT target files:

- `packages/a2a-server/package.json`
- `packages/a2a-server/src/http/server.ts`

Steps:

1. Inspect upstream diff: `git show c82c2c2b`.
2. Update `packages/a2a-server/package.json`:
   - Set `"main"` to `"dist/index.js"` (LLXPRT already builds `dist/index.js`).
   - Add a `"bin"` entry, but **rename the binary**:
     - Do NOT use `gemini-cli-a2a-server`.
     - Use something like `llxprt-code-a2a-server` or `llxprt-a2a-server` (pick one and keep it consistent).
   - Point the bin target to the file produced by Batch 02:
     - `"dist/a2a-server.mjs"`
3. Update `packages/a2a-server/src/http/server.ts`:
   - Add shebang `#!/usr/bin/env node` at top (before license comment).
   - Adjust `isMainModule` logic if needed (upstream uses `basename()` compare).
   - Ensure `process.on('uncaughtException', …)` is only registered when running as main module (not when imported).
4. Verify the bin works:
   - After `npm run bundle`, run: `node packages/a2a-server/dist/a2a-server.mjs` (or the bin name if wired).

Acceptance criteria:

- `packages/a2a-server/dist/a2a-server.mjs` exists and is executable.
- Running it starts the server (or prints meaningful errors) without import-side effects.

### Batch 20 — `558be873` — UI margins + `ui.useFullWidth` setting

Upstream files touched (selected):

- `packages/cli/src/config/settingsSchema.ts` (add `ui.useFullWidth`)
- `packages/cli/src/ui/utils/ui-sizing.ts` (new)
- Many UI components and snapshots
- `packages/cli/src/utils/math.ts` (new `lerp`)

LLXPRT plan (port selectively, keep tests green):

1. Inspect upstream diff: `git show 558be873 --name-only` and `git show 558be873 -- <file>`.
2. Add a `ui.useFullWidth` boolean setting to `packages/cli/src/config/settingsSchema.ts` (showInDialog: true).
3. Add new file `packages/cli/src/utils/math.ts` with `export function lerp(a,b,t)`.
4. Add new file `packages/cli/src/ui/utils/ui-sizing.ts` with `calculateMainAreaWidth(terminalWidth, settings)`:
   - If `ui.useFullWidth` is true, return `terminalWidth`.
   - Otherwise, use upstream interpolation logic (80→132 columns mapping).
5. Update `packages/cli/src/ui/AppContainer.tsx` to:
   - Use `calculateMainAreaWidth()` and feed that into `calculatePromptWidths()`.
6. Port the UI spacing changes incrementally:
   - `MainContent.tsx`, `Footer.tsx`, `InputPrompt.tsx`, tool message layout components.
7. Update snapshots and UI tests as needed:
   - Run `npm test` and update snapshots intentionally if output changes are acceptable.

Acceptance criteria:

- New setting exists and is wired (defaults to current behavior).
- Enabling `ui.useFullWidth` visibly expands content width.
- Tests/snapshots updated intentionally (not as accidental churn).

### Batch 24 — `849cd1f9` — Docs: Flutter extension link fix

Upstream file touched:

- `docs/changelogs/index.md`

LLXPRT reality:

- LLXPRT does not carry `docs/changelogs/index.md` (uses `docs/release-notes/`).

Steps:

1. Search LLXPRT docs for “Flutter extension” or the old link target.
2. If present, fix link; if not present, treat as N/A (no-op).

### Batch 25 — `32db4ff6` — Blanket “disable flaky tests” (avoid, port selectively)

Upstream changes:

- Skips interactive file-system test
- Skips entire replace suite

LLXPRT guidance:

- Prefer **targeted deflaking** and harness fixes over blanket `describe.skip`.

Steps:

1. Do not apply upstream `describe.skip('replace')` in LLXPRT.
2. If a specific test is unfixably flaky:
   - `it.skip` only that test, with a LLXPRT issue link and rationale.
3. Apply only generally-useful harness/timeout improvements (if any).

### Batch 27 — `ab3804d8` — Web search tool-name refactor (LLXPRT already renamed)

Upstream files touched:

- `packages/core/src/tools/web-search.ts`
- `packages/core/src/tools/tool-names.ts`
- `packages/core/src/agents/executor.ts`
- `integration-tests/google_web_search.test.ts`

LLXPRT mapping:

- LLXPRT uses `packages/core/src/tools/google-web-search.ts` (tool name `google_web_search`) and optionally `exa-web-search`.

Steps:

1. Inspect upstream diff: `git show ab3804d8`.
2. Determine whether LLXPRT already has the key benefit (centralizing tool name constants):
   - If we already use `GoogleWebSearchTool.Name` everywhere, most of this is NOP.
3. If there is value:
   - Add/extend a “tool name constants” module in LLXPRT (or keep class `.Name` constants).
   - Ensure allowlists use the canonical tool name constants.
4. Ensure integration test `integration-tests/google_web_search.test.ts` still matches the tool name (`google_web_search`).

### Batch 29 — `a6e00d91` — Extension update rough edges (port without telemetry)

Upstream files touched:

- CLI extension install/update/uninstall flows
- Core telemetry files (Clearcut) — DO NOT PORT

LLXPRT target files:

- `packages/cli/src/config/extension.ts`
- `packages/cli/src/commands/extensions/install.ts`
- `packages/cli/src/config/extensions/update.ts`
- relevant tests under `packages/cli/src/config/extension.test.ts`

Key upstream behaviors worth porting:

- Preserve extension enablement state across updates (don’t “remove” on update).
- Ensure `${extensionPath}` substitution refers to the **installed path**, not the temp source path.
- Unify “install vs update” behavior (optional) via `installOrUpdateExtension`.

Steps:

1. Inspect upstream diff: `git show a6e00d91`.
2. Add `installOrUpdateExtension(...)` to `packages/cli/src/config/extension.ts` (or refactor existing `installExtension` to support update mode).
3. Change update flow to avoid wiping enablement:
   - Modify `uninstallExtension` to accept `isUpdate: boolean` (or add a private helper).
   - When updating, delete the extension directory but DO NOT remove enablement state.
4. Fix variable hydration:
   - In `loadExtensionConfig`, parse raw JSON first to get extension name.
   - Compute `installDir = new ExtensionStorage(rawName).getExtensionDir()` and use that as `extensionPath` when hydrating strings.
5. Remove all telemetry additions from upstream (Clearcut logger/events).
6. Update CLI command `extensions install` to call the unified `installOrUpdateExtension` (so install can upgrade if already installed, if desired).
7. Add/adjust tests verifying:
   - Updating does not re-enable a previously disabled extension.
   - `extensionPath` is stable and points at install dir (not temp).

### Batch 30 — `a64bb433` — Simplify auth in interactive tests (adapt to LLXPRT harness)

Upstream touched:

- interactive test helper settings to avoid auth prompt
- makes `waitForText` assert (uses `expect`)

LLXPRT mapping:

- LLXPRT interactive runs should not block on provider/auth prompts; they should use the same provider/model args as non-interactive tests.

Steps:

1. Update `integration-tests/test-helper.ts` so `runInteractive()` uses the same provider/model flags as `run()`.
2. Add helper(s) to wait for “ready” text (`Type your message`) with a generous timeout.
3. If interactive auth dialogs still appear, force a deterministic path:
   - Prefer passing flags/env so the dialog never appears.
   - Avoid brittle “press 2” scripting unless absolutely required.

### Batch 31 — `37678acb` — Docs restructure (deployment → installation)

Upstream touched:

- `docs/get-started/*` + sidebar links

LLXPRT mapping:

- LLXPRT already has `docs/deployment.md` and a different docs structure.

Steps:

1. Read upstream content and identify value-add sections (installation steps, prerequisites, onboarding).
2. Port content selectively into LLXPRT docs:
   - `docs/deployment.md` (or introduce `docs/installation.md` if it matches LLXPRT navigation).
3. Update internal links and keep LLXPRT branding.

### Batch 34 — `5dc7059b` — Introduce `InteractiveRun` wrapper for PTY tests

Upstream adds:

- `InteractiveRun` class with:
  - `expectText()` (originally `waitForText`)
  - `type()`
  - `expectExit()`

LLXPRT target:

- `integration-tests/test-helper.ts`

Steps:

1. Add an `InteractiveRun` class (either inline in `test-helper.ts` or separate module).
2. Change `TestRig.runInteractive()` to return `Promise<InteractiveRun>` and:
   - spawn pty process
   - accumulate output
   - wait for readiness text before returning
3. Update existing PTY tests (e.g., `integration-tests/ctrl-c-exit.test.ts`) to use the wrapper incrementally.

### Batch 36 — `19c1d734` — Docs: integration tests require `npm run bundle`

Upstream adds a docs section “Building the tests”.

LLXPRT target:

- `dev-docs/integration-tests.md`

Steps:

1. Add a section near the top:
   - “Before running integration tests, run `npm run bundle`”
   - Explain when it must be re-run (CLI changes, not test-only changes).

### Batch 37 — `518caae6` — Extract `.gemini` dir constant (LLXPRT uses `.llxprt` + compat)

Upstream touched many files to replace `'.gemini'` literal with `GEMINI_DIR`.

LLXPRT reality:

- LLXPRT already defines:
  - `LLXPRT_CONFIG_DIR = '.llxprt'`
  - `GEMINI_DIR = LLXPRT_CONFIG_DIR` (compat alias) in `packages/core/src/tools/memoryTool.ts`

Steps:

1. Identify remaining hardcoded `.gemini` usage in LLXPRT code that should be `.llxprt`:
   - Especially in `packages/a2a-server/src/config/*` (currently hardcodes `.gemini`).
2. Replace those literals with imported constants:
   - Prefer importing `LLXPRT_CONFIG_DIR`/`GEMINI_DIR` from `@vybestack/llxprt-code-core`.
3. Decide backward-compat behavior:
   - If we must read legacy `.gemini` directories, implement fallback reads (do not switch back the primary dir).
4. Update tests that use `.gemini` paths unless they are explicitly testing backward compatibility.

### Batch 38 — `4a5ef4d9` — Add `expectToolCallSuccess` helper

Upstream adds:

- `TestRig.expectToolCallSuccess(toolNames, timeout?)`

LLXPRT target:

- `integration-tests/test-helper.ts`

Steps:

1. Add `expectToolCallSuccess` to LLXPRT `TestRig`:
   - Wait for telemetry ready
   - Poll until a tool call exists with `success: true` for any of the names
   - Assert using `expect(...)`
2. Use it in flaky integration tests where success is required (especially shell/write tests).

### Batch 39 — `a73b8145` — Rename `waitFor*` to `expect*` in interactive run helper

LLXPRT target:

- `integration-tests/test-helper.ts` (InteractiveRun methods)

Steps:

1. If LLXPRT implemented `InteractiveRun.waitForText` / `waitForExit`, rename to:
   - `expectText`
   - `expectExit`
2. Update any interactive tests accordingly.

### Batch 41 — `c4bd7594` — Settings docs + showInDialog settings

Upstream touched:

- `packages/cli/src/config/settingsSchema.ts` (showInDialog)
- `docs/get-started/configuration.md`

LLXPRT mapping:

- Docs live at `docs/cli/configuration.md`.

Steps:

1. Audit `packages/cli/src/config/settingsSchema.ts`:
   - Ensure user-facing settings have `showInDialog: true`.
   - Do not expose internal-only settings unless intentionally.
2. Port relevant documentation updates into `docs/cli/configuration.md`.

### Batch 42 — `ada179f5` — Sequential tool call execution (port carefully)

Upstream changes:

- `CoreToolScheduler` executes “scheduled” tool calls sequentially (await per tool).

LLXPRT constraint:

- LLXPRT values parallel batching for performance, but must preserve correctness.

Plan (do not blindly make everything sequential):

1. Inspect upstream diff: `git show ada179f5`.
2. Identify the correctness issue it fixes:
   - Is it about ordering of tool responses?
   - Is it about race conditions in scheduler state?
3. Add a regression test in LLXPRT `packages/core/src/core/coreToolScheduler.test.ts`:
   - Create a fake tool registry with two tools.
   - Have tool A be slow and tool B be fast.
   - Ensure the scheduler’s produced history/response ordering remains deterministic and correct.
4. Implement the minimal fix that passes the regression test:
   - Option A (match upstream): make `attemptExecutionOfScheduledCalls` async and process calls sequentially.
   - Option B (preserve concurrency): execute concurrently but buffer results and publish/apply them in original order.
5. Ensure this does not break LLXPRT requestQueue/batching guarantees (per `dev-docs/cherrypicking.md`).

Acceptance criteria:

- Regression test passes.
- No new deadlocks or performance regressions visible in basic smoke.

### Batch 46 — `7c1a9024` — Retry on specific fetch errors (may be already covered)

Upstream adds:

- Optional retry on a specific “fetch failed sending request” message.

LLXPRT reality:

- `packages/core/src/utils/retry.ts` already treats many “fetch failed” variants as transient.

Steps:

1. Add a focused unit test in `packages/core/src/utils/retry.test.ts`:
   - Build an `Error('exception TypeError: fetch failed sending request …')`
   - Assert `isNetworkTransientError(error) === true` or that `retryWithBackoff` retries.
2. If test already passes, treat this as NOP (no behavior change).
3. If not, extend transient-error matching (don’t add Google-only settings unless needed).

### Batch 47 — `49b66733` — Disable Ctrl+C test (likely N/A in LLXPRT)

Upstream disables `integration-tests/ctrl-c-exit.test.ts` due to flake.

LLXPRT reality:

- LLXPRT already `describe.skipIf(process.env.CI === 'true')` for this file.

Steps:

1. If the test still flakes locally:
   - Consider disabling it fully (`describe.skip`) or increasing timeouts.
2. Otherwise treat as NOP.

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

