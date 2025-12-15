# Plan: 20251215gemerge — gemini-cli v0.9.0 → v0.10.0

This plan executes the `PICK`/`REIMPLEMENT` decisions in `project-plans/20251215gemerge/CHERRIES.md` using:

- **Batches of 5** for `PICK` commits (applied in one `git cherry-pick …` command per batch).
- **Batch size 1** for every `REIMPLEMENT` (and a few intentionally-solo `PICK`s).
- **Chronological order** (upstream commit index order).
- **Verification cadence**:
  - After **every** batch: “quick” verification (**compile + lint**).
  - After **every 2nd** batch: **full verification suite**.

REIMPLEMENT details are maintained as **per-commit playbooks**:

- `project-plans/20251215gemerge/<sha>-plan.md` (canonical per-commit plan)
- `project-plans/20251215gemerge/PLAN-DETAILED.md` (deprecated, inline legacy copy kept for reference)
- Progress + notes while executing:
  - `project-plans/20251215gemerge/PROGRESS.md`
  - `project-plans/20251215gemerge/NOTES.md`

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
- If upstream fixes a real correctness bug in scheduling, **port the fix** but keep LLxprt’s parallel batching model (see `project-plans/20251215gemerge/ada179f5-plan.md`).

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
  test -f "$f" && echo "✓ $f" || echo "✗ $f MISSING"
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
  "$FILE"
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
  "$FILE"
```

---

## Subagent-Based Execution

This merge is executed using a subagent workflow defined in `project-plans/20251215gemerge/SUBAGENT-WORKFLOW.md`.

### Subagent Types and Roles

| Role | Subagent Type | Model | Purpose |
|------|---------------|-------|---------|
| **Picker** | `general-purpose` | sonnet | Select next batch, verify prerequisites |
| **Merger** | `llxprt-cherrypicker` | opus | Cherry-pick and resolve conflicts (PICK batches) |
| **Conflict Resolver** | `llxprt-conflict-merger` | sonnet | Complex merge conflict resolution |
| **Implementer** | `typescript-master-coder` | opus | Manual port following playbook (REIMPLEMENT batches) |
| **Verifier** | `integration-tester` | sonnet | Run verification suite |
| **Remediation** | `typescript-coder` | sonnet | **MANDATORY** - Fix failures when verification fails |
| **Code Reviewer** | `typescript-code-reviewer` | sonnet | Verify feature landed correctly |
| **Researcher** | `general-purpose` or `Explore` | sonnet | Fill missing prerequisite records |

### Execution Flow Per Batch

1. `general-purpose` (Picker) selects batch, verifies prerequisites
2. `llxprt-cherrypicker` (PICK) or `typescript-master-coder` (REIMPLEMENT) executes the batch
3. `integration-tester` (Verifier) runs verification (QUICK or FULL)
4. **IF VERIFICATION FAILS:**
   - `typescript-coder` (Remediation) fixes all failures
   - Re-run verification
   - Loop until ALL PASS (max 3 attempts, then escalate)
5. Records appended to `NOTES.md` (including any remediation records)
6. Commit and push

---

## Verification Commands

### IMPORTANT: Kill vitest before/after tests

```bash
# Before running tests
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

# Run your tests here...

# After tests complete
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
```

### After every batch (Quick: compile + lint)

Run:

```bash
npm run typecheck
npm run lint
```

If either fails: fix the batch issues, then re-run the quick verification before proceeding.

### Docs-only batches (format only; skip verification)

If the batch results in a single commit and that commit only changes docs assets (e.g., `.md`, `.mdx`, `.json`), do **not** run the quick/full verification for that batch. Only format the touched files:

```bash
files="$(git show --name-only --pretty='' HEAD)"
# Use rg if available, otherwise fall back to grep
if command -v rg &>/dev/null; then
  is_code=$(echo "$files" | rg -qv '\\.(md|mdx|json)$' && echo "yes" || echo "no")
else
  is_code=$(echo "$files" | grep -Ev '\\.(md|mdx|json)$' | grep -q . && echo "yes" || echo "no")
fi
if [ "$is_code" = "yes" ]; then
  echo "Not docs-only; run normal verification."
else
  echo "Docs-only batch; formatting only."
  while IFS= read -r f; do
    npx prettier --experimental-cli --write "$f"
  done <<<"$files"
fi
```

### After every 2nd batch (Full suite)

Run the full repository checklist (matches AGENTS.md):

```bash
# Kill any stale vitest first
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

npm run test

# Kill vitest after tests
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

npm run lint
npm run typecheck
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

If anything fails: fix, then re-run the full suite (don't proceed with a red batch).

---

## MANDATORY REMEDIATION ON VERIFICATION FAILURE

**THIS IS NOT OPTIONAL. Verification failures MUST trigger automatic remediation.**

### When Verification Fails

1. **STOP** - Do NOT proceed to next batch
2. **INVOKE REMEDIATION** - Launch `typescript-coder` subagent with exact failure output
3. **FIX ALL FAILURES** - Not "some" or "most" - ALL
4. **RE-VERIFY** - Run full verification after fixes
5. **LOOP IF NEEDED** - Repeat up to 3 times
6. **ESCALATE** - After 3 failed remediation attempts, stop and request human review

### Remediation Subagent Invocation

```
Task(
  subagent_type="typescript-coder",
  description="Remediate batch NN failures",
  prompt="Fix the following verification failures from batch NN:

FAILURES:
<paste exact failure output>

REQUIREMENTS:
1. Root-cause each failure
2. Fix ALL failures
3. Run verification after each fix to confirm
4. Do NOT declare done until ALL checks pass
5. Commit fixes with message: 'fix: <description> addresses #707'

OUTPUT: Full verification output showing ALL PASS."
)
```

### Critical Rules

- ❌ **NEVER** skip verification steps
- ❌ **NEVER** declare partial success ("5 of 6 pass" = FAILURE)
- ❌ **NEVER** proceed to next batch with failures
- ❌ **NEVER** commit with failing tests
- ❌ **NEVER** summarize failure output - include actual terminal output
- ✅ **ALWAYS** run ALL verification (test, lint, typecheck, build, synthetic)
- ✅ **ALWAYS** invoke remediation on ANY failure
- ✅ **ALWAYS** re-verify after remediation
- ✅ **ALWAYS** include full command output in records

---

## Feature Landing Verification (REQUIRED)

Every batch MUST verify that the actual feature landed, not just that tests pass.

### For PICK batches

1. Identify the key changes from upstream commit:
   ```bash
   git show <upstream-sha> --stat
   git show <upstream-sha> -- <key-file>
   ```

2. Verify those changes exist in LLXPRT:
   ```bash
   git show HEAD -- <same-key-file>
   # Or for specific code:
   grep -n "<expected-code-pattern>" <file>
   ```

3. Document the evidence in the batch record.

### For REIMPLEMENT batches

1. Read the playbook to understand what should be implemented
2. After implementation, verify each item:
   - If adding a new function: `grep -n "function functionName" <file>`
   - If modifying behavior: Show the before/after or the new code
   - If adding a file: `ls -la <file>` and `head -20 <file>`

3. Document upstream diff vs LLXPRT changes.

### Evidence Format

```
FEATURE LANDING VERIFICATION:
Upstream Commit: <sha>
Feature: <description>

Upstream Change:
```diff
+ export function newFeature() {
+   // ...
+ }
```

LLXPRT Evidence:
```bash
$ grep -n "newFeature" packages/core/src/file.ts
42:export function newFeature() {
```

VERIFIED: YES
```

---

## Commit/Push After Each Batch

After verification passes, commit and push:

```bash
# Update tracking files
git add project-plans/20251215gemerge/PROGRESS.md
git add project-plans/20251215gemerge/NOTES.md

# Commit with signing
git commit -S -m "docs: batch NN execution record"

# Push
git push
```

**IMPORTANT**: Never proceed to the next batch without committing/pushing the current batch's records.

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
| 23 | QUICK | PICK | 56,57 | affd3cae, 249ea559 | fix: Prevent garbled input during "Login With Google" OAuth prompt on… (#10888) / fix(test): Fix flaky shell command test using date command (#10863) |
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
   - `REIMPLEMENT`: follow the per-commit playbook referenced below; make **one local commit**.
4. Run verification:
   - If docs-only: format only (see “Docs-only batches” in `project-plans/20251215gemerge/PLAN.md`)
   - Otherwise: quick verification (`npm run typecheck && npm run lint`)
   - If batch is even-numbered: run full suite.
5. Update execution tracking:
   - Check off the batch in `project-plans/20251215gemerge/PROGRESS.md`.
   - Append a batch entry in `project-plans/20251215gemerge/NOTES.md` (conflicts, decisions, follow-ups, verification).
6. If you had to make extra fixes that are *not* part of a conflict resolution:
   - Create a fix commit: `git commit -am "fix: batch NN follow-ups"`
7. Do not proceed to next batch until the required verification is green.

---

## Reimplementation Playbooks (Per-Commit Files)

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

Notes:

- The per-commit playbooks are canonical: `project-plans/20251215gemerge/<sha>-plan.md`
- Some per-commit playbooks may include absolute paths from the author’s machine; treat those as `<repo-root>/...`.
- If a per-commit playbook conflicts with `Non-Negotiables (LLxprt Invariants)`, follow `Non-Negotiables`.

### Playbook Index

| Batch | Upstream | Playbook | Dependency Notes |
|---:|:---:|:---|:---|
| 02 | `8ac2c684` | `project-plans/20251215gemerge/8ac2c684-plan.md` | Required before Batch 19 |
| 05 | `8d8a2ab6` | `project-plans/20251215gemerge/8d8a2ab6-plan.md` | Requires Batch 03 (`603ec2b2`) to add `scripts/deflake.js` |
| 07 | `bcbcaeb8` | `project-plans/20251215gemerge/bcbcaeb8-plan.md` | — |
| 10 | `0cd490a9` | `project-plans/20251215gemerge/0cd490a9-plan.md` | — |
| 12 | `bd6bba8d` | `project-plans/20251215gemerge/bd6bba8d-plan.md` | Requires Batch 03 (`603ec2b2`) to add `scripts/deflake.js` |
| 15 | `5e688b81` | `project-plans/20251215gemerge/5e688b81-plan.md` | — |
| 16 | `5aab793c` | `project-plans/20251215gemerge/5aab793c-plan.md` | — |
| 17 | `0b6c0200` | `project-plans/20251215gemerge/0b6c0200-plan.md` | — |
| 19 | `c82c2c2b` | `project-plans/20251215gemerge/c82c2c2b-plan.md` | Requires Batch 02 (`8ac2c684`) |
| 20 | `558be873` | `project-plans/20251215gemerge/558be873-plan.md` | — |
| 24 | `849cd1f9` | `project-plans/20251215gemerge/849cd1f9-plan.md` | — |
| 25 | `32db4ff6` | `project-plans/20251215gemerge/32db4ff6-plan.md` | — |
| 27 | `ab3804d8` | `project-plans/20251215gemerge/ab3804d8-plan.md` | — |
| 29 | `a6e00d91` | `project-plans/20251215gemerge/a6e00d91-plan.md` | — |
| 30 | `a64bb433` | `project-plans/20251215gemerge/a64bb433-plan.md` | — |
| 31 | `37678acb` | `project-plans/20251215gemerge/37678acb-plan.md` | — |
| 34 | `5dc7059b` | `project-plans/20251215gemerge/5dc7059b-plan.md` | Required before Batch 52; incorporates Batch 39 |
| 36 | `19c1d734` | `project-plans/20251215gemerge/19c1d734-plan.md` | — |
| 37 | `518caae6` | `project-plans/20251215gemerge/518caae6-plan.md` | — |
| 38 | `4a5ef4d9` | `project-plans/20251215gemerge/4a5ef4d9-plan.md` | — |
| 39 | `a73b8145` | `project-plans/20251215gemerge/a73b8145-plan.md` | NO-OP (folded into Batch 34) |
| 41 | `c4bd7594` | `project-plans/20251215gemerge/c4bd7594-plan.md` | — |
| 42 | `ada179f5` | `project-plans/20251215gemerge/ada179f5-plan.md` | Must preserve parallel batching (buffered publish ordering) |
| 46 | `7c1a9024` | `project-plans/20251215gemerge/7c1a9024-plan.md` | NO-OP (already covered) |
| 47 | `49b66733` | `project-plans/20251215gemerge/49b66733-plan.md` | — |
| 48 | `99c7108b` | `project-plans/20251215gemerge/99c7108b-plan.md` | — |
| 49 | `769fe8b1` | `project-plans/20251215gemerge/769fe8b1-plan.md` | — |
| 50 | `6f0107e7` | `project-plans/20251215gemerge/6f0107e7-plan.md` | — |
| 52 | `4f5b3357` | `project-plans/20251215gemerge/4f5b3357-plan.md` | Requires Batch 34 (`5dc7059b`) |

---

## End-of-Run Parity Marker (Optional)

If you want an explicit “sync point” marker in git history (per `dev-docs/cherrypicking.md`), create an empty merge commit after finishing all batches:

```bash
# IMPORTANT: merge a specific upstream commit hash, not upstream/main.
# Choose the upstream commit you consider the sync point (e.g. the last commit in v0.10.0 range).
git merge -s ours --no-ff <upstream-sync-sha> -m "Merge upstream gemini-cli up to <sha> (marker only)"
```
