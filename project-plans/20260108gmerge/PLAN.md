# Execution Plan: v0.11.3 → v0.12.0 Cherry-Pick

Tracking issue: https://github.com/vybestack/llxprt-code/issues/709

## Overview

This plan uses subagents to execute cherry-picking in batches. Each batch has:
1. **Execution task** - `cherrypicker` subagent performs the cherry-pick and resolves conflicts
2. **Verification task** - `deepthinker` subagent verifies the work was done correctly

If verification fails, a **Remediation task** is launched to fix issues.

---

## Non-Negotiables (From dev-docs/cherrypicking.md)

Subagents MUST preserve:
- **Multi-provider architecture** - `USE_PROVIDER` not `USE_GEMINI`
- **Package names** - `@vybestack/llxprt-code-core` not `@google/gemini-cli-core`
- **LLxprt branding** - Do not overwrite with gemini-cli branding
- **DebugLogger** - LLxprt has superior logging, don't replace with upstream debugLogger
- **No ClearcutLogger** - All Google telemetry removed from LLxprt
- **No FlashFallback** - Removed from LLxprt
- **Parallel tool batching** - LLxprt has superior implementation

---

## Verification Requirements

After EVERY batch, ALL of these must pass with zero failures:

```bash
npm run lint          # Must exit 0 with no errors
npm run typecheck     # Must exit 0 with no errors  
npm run test          # ALL tests must pass - no "pre-existing" failures allowed
npm run format        # Format the code
npm run build         # Must exit 0
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"  # Must generate output
```

Additionally:
- No conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in any file
- All changes must be committed with descriptive message

---

## Batch Schedule

We have 55 PICK commits organized into 11 batches of 5.
We have 13 REIMPLEMENT commits as solo batches (deferred to future - high complexity).

### PICK Batches (Execute in Order)

---

### Batch 01 (PICK #1-5)

**Commits:**
```
ce655436ef97535247daa9d27f572c1ca3ed62ac - fix(test): unskip and fix useToolScheduler tests (#11671)
0bf2a0353d55f4f94119a45519fbde00d806e717 - Add extension alias for extensions command (#11622)
6d75005afc3517cd00d3bea766f0e8ff146a0859 - Add setting to disable YOLO mode (#11609)
b40f67b76ae49049e979592a37dd122e1bcd7d71 - extract console error to util func (#11675)
2ede47d5ee30f815edb1ba41862a8b03c52c7fff - fix(ui): Fix and unskip InputPrompt tests (#11700)
```

**Cherry-pick command:**
```bash
git cherry-pick ce655436 0bf2a035 6d75005a b40f67b7 2ede47d5
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 01

Upstream commits:
- ce655436 fix(test): unskip and fix useToolScheduler tests (#11671)
- 0bf2a035 Add extension alias for extensions command (#11622)
- 6d75005a Add setting to disable YOLO mode (#11609)
- b40f67b7 extract console error to util func (#11675)
- 2ede47d5 fix(ui): Fix and unskip InputPrompt tests (#11700)
```

---

### Batch 02 (PICK #6-10)

**Commits:**
```
a90b9fe977acc8249c98cb6adcb7ded55ad82054 - fix(a2a-server): Fix and unskip GCS persistence test (#11755)
8f8a6897224e341d20c6148675fe199e721af855 - feat(preflight): Use venv for yamllint installation (#11694)
d9f0b9c66844ab9b94c053401ce105f5874a976e - fix(cli): fix race condition and unskip tests in useGitBranchName (#11759)
92d412e542cf04cfa6d50bf15f0cfd95f439582e - refactor: simplify FilterReport and remove unused code (#11681)
047bc44032d5eb33defe4f5a2e9c6da6765602e3 - refactor(core): Clean up exclude description (#11678)
```

**Cherry-pick command:**
```bash
git cherry-pick a90b9fe9 8f8a6897 d9f0b9c6 92d412e5 047bc440
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 02

Upstream commits:
- a90b9fe9 fix(a2a-server): Fix and unskip GCS persistence test (#11755)
- 8f8a6897 feat(preflight): Use venv for yamllint installation (#11694)
- d9f0b9c6 fix(cli): fix race condition and unskip tests in useGitBranchName (#11759)
- 92d412e5 refactor: simplify FilterReport and remove unused code (#11681)
- 047bc440 refactor(core): Clean up exclude description (#11678)
```

---

### Batch 03 (PICK #11-15)

**Commits:**
```
1202dced7339ef05e0638442853ee614bab0be03 - Refactor KeypressContext (#11677)
8e9f71b7a34953fca0fd77745d448198556f35f0 - fix(ui): resolve race condition in double-escape handler (#8913)
5ebe40e91982b7210d6c2720d56c32cdce6a8619 - refactor(cli): Parameterize tests in InputPrompt (#11776)
445ef4fbed7701e51a1f0ab3e982b661186ff7cb - Docs: Fix broken link in docs/cli/configuration.md (#11655)
3f38f95b1dde572a05e30e80efa0adb0a98024af - Adds executeCommand endpoint with support for /extensions list (#11515)
```

**Cherry-pick command:**
```bash
git cherry-pick 1202dced 8e9f71b7 5ebe40e9 445ef4fb 3f38f95b
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 03

Upstream commits:
- 1202dced Refactor KeypressContext (#11677)
- 8e9f71b7 fix(ui): resolve race condition in double-escape handler (#8913)
- 5ebe40e9 refactor(cli): Parameterize tests in InputPrompt (#11776)
- 445ef4fb Docs: Fix broken link in docs/cli/configuration.md (#11655)
- 3f38f95b Adds executeCommand endpoint with support for /extensions list (#11515)
```

---

### Batch 04 (PICK #16-20)

**Commits:**
```
5ae9fe69495ea60cd55b25d05b2506862da424fd - Fix broken links in documentation (#11789)
bde5d61812a1aae62d77997f087ebda1209e1f6d - Re-enable test. (#11628)
750c0e366f2074c35975ca192aebb4f87a7bc731 - Add extension settings to be requested on install (#9802)
9e91aafe40591166002af1254a0f2a541c460512 - Fix bug where tool scheduler was repeatedly created. (#11767)
3a501196f0f49f693a531a56e43d56f41bd872b9 - feat(ux): Surface internal errors via unified event system (#11803)
```

**Cherry-pick command:**
```bash
git cherry-pick 5ae9fe69 bde5d618 750c0e36 9e91aafe 3a501196
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 04

Upstream commits:
- 5ae9fe69 Fix broken links in documentation (#11789)
- bde5d618 Re-enable test. (#11628)
- 750c0e36 Add extension settings to be requested on install (#9802)
- 9e91aafe Fix bug where tool scheduler was repeatedly created. (#11767)
- 3a501196 feat(ux): Surface internal errors via unified event system (#11803)
```

---

### Batch 05 (PICK #21-25)

**Commits:**
```
5e70a7dd461d817dcc8e26aecf41c82111752d13 - fix: align shell allowlist handling (#11510) (#11813)
aa6ae954efeab1beb2b1a41ccd5d39c204bd728d - Use raw writes to stdin where possible in tests (#11837)
9814f86a2540096eeec0c7121aff380fe92d0c36 - Added parameterization to base-storage-token.test and prompts.test.ts (#11821)
b77381750cdc4321851d6f0123025978fa8abfde - feat(core) Bump get-ripgrep version. (#11698)
0fe82a2f4e624fd70229be49da4a501f2f401d84 - Use raw writes to stdin in test (#11871)
```

**Cherry-pick command:**
```bash
git cherry-pick 5e70a7dd aa6ae954 9814f86a b7738175 0fe82a2f
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 05

Upstream commits:
- 5e70a7dd fix: align shell allowlist handling (#11510) (#11813)
- aa6ae954 Use raw writes to stdin where possible in tests (#11837)
- 9814f86a Added parameterization to base-storage-token.test and prompts.test.ts (#11821)
- b7738175 feat(core) Bump get-ripgrep version. (#11698)
- 0fe82a2f Use raw writes to stdin in test (#11871)
```

---

### Batch 06 (PICK #26-30)

**Commits:**
```
884d838a1e0e41e67c8614fdb7f6f2eddfe2066c - fix(cli): re-throw errors in non-interactive mode (#11849)
a889c15e389fc747299ecc2784862ea888562ada - Adding Parameterised tests (#11930)
c079084ca454ef3e83261cfeba1b8719d6163931 - chore(core): add token caching in google auth provider (#11946)
978fbcf95ee53c6c2f5e60b5cdfaf0f9043f9224 - run bom test on windows (#11828)
a123a813b25ae9f64a39c2d0033f3a9196106b0a - Fix(cli): Use the correct extensionPath (#11896)
```

**Cherry-pick command:**
```bash
git cherry-pick 884d838a a889c15e c079084c 978fbcf9 a123a813
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 06

Upstream commits:
- 884d838a fix(cli): re-throw errors in non-interactive mode (#11849)
- a889c15e Adding Parameterised tests (#11930)
- c079084c chore(core): add token caching in google auth provider (#11946)
- 978fbcf9 run bom test on windows (#11828)
- a123a813 Fix(cli): Use the correct extensionPath (#11896)
```

---

### Batch 07 (PICK #31-35)

**Commits:**
```
25996ae037c5d05a1cee515ae9f1c187986f6c4d - fix(security) - Use emitFeedback (#11961)
c2104a14fbd0de383a2ecd2e70889252bef36c33 - fix(security) - Use emitFeedback instead of console error (#11948)
31b7c010d028e0548d3b0756a7eeaa100b258368 - Add regression tests for shell command parsing (#11962)
ca94dabd4f84bcf2399a7b90799fe6c89491f6d9 - Fix(cli): Use cross-platform path separators in extension tests (#11970)
63a90836fe6a9a2539dade85f303ab461bf82cf6 - fix linked extension test on windows (#11973)
```

**Cherry-pick command:**
```bash
git cherry-pick 25996ae0 c2104a14 31b7c010 ca94dabd 63a90836
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 07

Upstream commits:
- 25996ae0 fix(security) - Use emitFeedback (#11961)
- c2104a14 fix(security) - Use emitFeedback instead of console error (#11948)
- 31b7c010 Add regression tests for shell command parsing (#11962)
- ca94dabd Fix(cli): Use cross-platform path separators in extension tests (#11970)
- 63a90836 fix linked extension test on windows (#11973)
```

---

### Batch 08 (PICK #36-40)

**Commits:**
```
40057b55f0c725458b4f3291e85985fcf1716bd8 - fix(cli): Use correct defaults for file filtering (#11426)
c20b88cee2ed488ad611878e7c96716fb12ed071 - use coreEvents.emitFeedback in extension enablement (#11985)
d91484eb4dc276e9ccfbeec71e85e1a304f1d950 - Fix tests (#11998)
cdff69b7b255b8ce1df0c4a7fc09a1d5342e2da2 - Support redirects in fetchJson, add tests for it (#11993)
f934f018818f3f66e0a141fe9bbccdd03254f191 - fix(tools): ReadFile no longer shows confirmation when message bus is off (#12003)
```

**Cherry-pick command:**
```bash
git cherry-pick 40057b55 c20b88ce d91484eb cdff69b7 f934f018
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 08

Upstream commits:
- 40057b55 fix(cli): Use correct defaults for file filtering (#11426)
- c20b88ce use coreEvents.emitFeedback in extension enablement (#11985)
- d91484eb Fix tests (#11998)
- cdff69b7 Support redirects in fetchJson, add tests for it (#11993)
- f934f018 fix(tools): ReadFile no longer shows confirmation when message bus is off (#12003)
```

---

### Batch 09 (PICK #41-45)

**Commits:**
```
145e099ca54524fa1198a607bc0b54082f1661c9 - Support paste markers split across writes. (#11977)
b1059f891f18c478c2afa0c44766f36654fd7001 - refactor: Switch over to unified shouldIgnoreFile (#11815)
bcd9735a739e05d4c7b3eebaf658e3b2f32e8a66 - Fix typo in: packages/cli/src/utils/handleAutoUpdate.ts (#11809)
ce26b58f09c2e30daad408cd2f8bac30a5ae298a - docs(contributing): update project structure section with missing packages (#11599)
ef70e6323016f4391aa1f449408c70a381f1711c - Make PASTE_WORKAROUND the default. (#12008)
```

**Cherry-pick command:**
```bash
git cherry-pick 145e099c b1059f89 bcd9735a ce26b58f ef70e632
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 09

Upstream commits:
- 145e099c Support paste markers split across writes. (#11977)
- b1059f89 refactor: Switch over to unified shouldIgnoreFile (#11815)
- bcd9735a Fix typo in: packages/cli/src/utils/handleAutoUpdate.ts (#11809)
- ce26b58f docs(contributing): update project structure section with missing packages (#11599)
- ef70e632 Make PASTE_WORKAROUND the default. (#12008)
```

---

### Batch 10 (PICK #46-50)

**Commits:**
```
51578397a5f0e48ac0e73b2dec42b97a2ad4febc - refactor(cli): replace custom wait with vi.waitFor in InputPrompt tests (#12005)
73570f1c86e7f5e4b027a5879fa2a705be4be6a3 - Fix the shortenPath function to correctly insert ellipsis. (#12004)
a2d7f82b499f8d9ed44b732056267ec8e181ebeb - fix(core): Prepend user message to loop detection history if it starts with a function call (#11860)
8352980f014743625f5058cd73d5c3abdd69a518 - Remove non-existent parallel flag. (#12018)
ee66732ad258f097455ca0664b7084a88a4586d1 - First batch of fixing tests to use best practices. (#11964)
```

**Cherry-pick command:**
```bash
git cherry-pick 51578397 73570f1c a2d7f82b 8352980f ee66732a
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 10

Upstream commits:
- 51578397 refactor(cli): replace custom wait with vi.waitFor in InputPrompt tests (#12005)
- 73570f1c Fix the shortenPath function to correctly insert ellipsis. (#12004)
- a2d7f82b fix(core): Prepend user message to loop detection history if it starts with a function call (#11860)
- 8352980f Remove non-existent parallel flag. (#12018)
- ee66732a First batch of fixing tests to use best practices. (#11964)
```

---

### Batch 11 (PICK #51-55)

**Commits:**
```
2fa13420aeb67adcbba0ca0fa8c4827be34b8f0d - add absolute file path description for windows (#12007)
c7817aee305712c74a139ecb08333fec81a633b9 - fix(cli): Add delimiter before printing tool response in non-interactive mode (#11351)
23c906b0855e4553cc47321c040e4b28e6c60b15 - fix: user configured oauth scopes should take precedence over discovered scopes (#12088)
5ded674ad6071fbfade3a56f75894c613b24b580 - Refactor vim.test.ts: Use Parameterized Tests (#11969)
4ef3c09332d8a272db40028e99b646999c1088e6 - fix(core): update loop detection LLM schema fields (#12091)
```

**Cherry-pick command:**
```bash
git cherry-pick 2fa13420 c7817aee 23c906b0 5ded674a 4ef3c093
```

**Commit message template:**
```
cherry-pick: upstream v0.11.3..v0.12.0 batch 11

Upstream commits:
- 2fa13420 add absolute file path description for windows (#12007)
- c7817aee fix(cli): Add delimiter before printing tool response in non-interactive mode (#11351)
- 23c906b0 fix: user configured oauth scopes should take precedence over discovered scopes (#12088)
- 5ded674a Refactor vim.test.ts: Use Parameterized Tests (#11969)
- 4ef3c093 fix(core): update loop detection LLM schema fields (#12091)
```

---

## REIMPLEMENT Batches (Deferred)

The following 13 commits require reimplementation due to architectural divergence.
These are deferred to a separate planning phase after PICK batches complete:

| # | SHA | Subject |
|---|-----|---------|
| 1 | `c4c0c0d1` | Create ExtensionManager class (#11667) |
| 2 | `b188a51c` | Introduce message bus for tool execution confirmation (#11544) |
| 3 | `541eeb7a` | Implement sequential approval (#11593) |
| 4 | `29efebe3` | Recitations events in A2A responses (#12067) |
| 5 | `2a87d663` | Extract ChatCompressionService (#12001) |
| 6 | `2dfb813c` | AppContainer polling and footer currentModel (#11923) |
| 7 | `a9cb8f49` | OTEL trace instrumentation (#11690) |
| 8 | `1b302dee` | ExtensionLoader interface on Config (#12116) |
| 9 | `064edc52` | Config-based policy engine with TOML (#11992) |
| 10 | `5d61adf8` | Message bus setting guard for tool confirmation (#12169) |
| 11 | `c2d60d61` | Extension explore subcommand (#11846) |
| 12 | `7e987113` | Sensitive keychain-stored per-extension settings (#11953) |
| 13 | `44bdd3ad` | Record model responses for testing (#11894) |

---

## Subagent Workflow

For each batch:

### Step 1: Execute (cherrypicker subagent)

```
Goal: Execute Batch NN cherry-pick for v0.11.3..v0.12.0 sync

Context to provide:
- Batch number: NN
- Cherry-pick command (from this plan)
- Commit message template (from this plan)
- Non-negotiables (from this plan)
- Verification commands (from this plan)

Instructions:
1. Run the cherry-pick command
2. If conflicts occur, resolve them following non-negotiables
3. Run ALL verification commands - ALL must pass with zero failures
4. If any verification fails, fix the issue
5. Stage all changes with git add -A
6. Commit with the provided message template
7. Report: commit SHA, what conflicts were resolved, verification results
```

### Step 2: Verify (deepthinker subagent)

```
Goal: Verify Batch NN cherry-pick was executed correctly

Context to provide:
- Batch number: NN
- Expected commits (SHAs and subjects from this plan)
- Verification commands (from this plan)

Instructions:
1. Check git log to confirm the batch commit exists
2. Search for conflict markers: grep -r "<<<<<<" . --include="*.ts" --include="*.tsx" --include="*.js"
3. Verify the expected functionality is present (check key files modified)
4. Run ALL verification commands:
   - npm run lint (must exit 0)
   - npm run typecheck (must exit 0)
   - npm run test (ALL tests must pass)
   - npm run format
   - npm run build (must exit 0)
   - node scripts/start.js --profile-load synthetic --prompt "write me a haiku" (must generate output)
5. Report: PASS or FAIL with details
```

### Step 3: Remediate (if verification fails)

```
Goal: Remediate Batch NN verification failures

Context to provide:
- Batch number: NN
- Verification failure details (from Step 2)
- Non-negotiables (from this plan)

Instructions:
1. Analyze the failure
2. Fix the issue
3. Run ALL verification commands again
4. Stage and commit the fix: "fix: remediate batch NN verification failures"
5. Report: what was fixed, new verification results
```

---

## Progress Tracking

Update PROGRESS.md after each batch with:

| Batch | Status | Execute SHA | Verify Result | Remediate SHA | Notes |
|-------|--------|-------------|---------------|---------------|-------|
| 01 | TODO | - | - | - | - |
| 02 | TODO | - | - | - | - |
| ... | | | | | |
| 11 | TODO | - | - | - | - |

---

## Failure Recovery

If a cherry-pick fails mid-batch:
```bash
git cherry-pick --abort
```

If verification repeatedly fails:
1. Document the issue in NOTES.md
2. Consider skipping the problematic commit
3. Create a follow-up issue for manual handling

---

## Completion Criteria

All batches complete when:
1. All 11 PICK batches executed and verified
2. No conflict markers in codebase
3. All verification commands pass
4. PROGRESS.md shows all batches as DONE
5. PR created referencing issue #709
