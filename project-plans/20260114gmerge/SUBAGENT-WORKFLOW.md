# Subagent Workflow: v0.12.0 → v0.13.0 Cherry-Pick

## Overview

This document defines exactly how subagents are used to execute the cherry-pick sync autonomously.

## Subagent Roles

| Subagent | Profile | Role |
|----------|---------|------|
| `cherrypicker` | opusthinkingbucketed | Executes cherry-picks, resolves conflicts, runs verification |
| `reviewer` | opusthinkingbucketed | Audits work, verifies correctness, catches issues |

## Non-Negotiables (Include in ALL Prompts)

```
CRITICAL NON-NEGOTIABLES - You MUST preserve these in ALL conflict resolutions:

1. MULTI-PROVIDER ARCHITECTURE
   - Use `AuthType.USE_PROVIDER` not `AuthType.USE_GEMINI`
   - Preserve LLxprt's provider adapter system
   - Do NOT assume Google-only authentication

2. PACKAGE NAMES
   - Use `@vybestack/llxprt-code-core` not `@google/gemini-cli-core`
   - Use `llxprt` branding not `gemini-cli`

3. REMOVED FEATURES - Do NOT re-add:
   - ClearcutLogger (Google telemetry) - completely removed
   - FlashFallback - disabled/removed
   - NextSpeakerChecker - removed
   - Smart Edit - removed

4. LLXPRT SUPERIORITIES - Keep LLxprt's version:
   - DebugLogger (not upstream's debugLogger)
   - Parallel tool batching (not upstream's serial queue)
   - Ephemeral settings system
   - Todo implementation (completely different)

5. BRANDING SUBSTITUTIONS
   - `.geminiignore` → also accept `.llxprtignore`
   - `GEMINI_` env vars → preserve but also support provider-specific
```

## Verification Commands (Include in ALL Prompts)

```bash
# ALL of these must pass with ZERO failures:
npm run lint          # Must exit 0
npm run typecheck     # Must exit 0
npm run test          # ALL tests must pass
npm run format        # Format code
npm run build         # Must exit 0

# Smoke test
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

# Conflict marker check
grep -r "<<<<<<" . --include="*.ts" --include="*.tsx" --include="*.js" || echo "No conflict markers"
```

---

## PICK Batch Prompt Template

### cherrypicker Execute Prompt

```
TASK: Execute Cherry-Pick Batch {BATCH_NUMBER} for v0.12.0 → v0.13.0 sync

UPSTREAM COMMITS TO CHERRY-PICK:
{LIST_OF_SHAS_AND_SUBJECTS}

CHERRY-PICK COMMAND:
git cherry-pick {SHA1} {SHA2} {SHA3} {SHA4} {SHA5}

COMMIT MESSAGE TEMPLATE:
cherry-pick: upstream v0.12.0..v0.13.0 batch {BATCH_NUMBER}

Upstream commits:
- {SHA1_SHORT} {SUBJECT1}
- {SHA2_SHORT} {SUBJECT2}
- {SHA3_SHORT} {SUBJECT3}
- {SHA4_SHORT} {SUBJECT4}
- {SHA5_SHORT} {SUBJECT5}

{NON_NEGOTIABLES_BLOCK}

EXECUTION STEPS:
1. Run the cherry-pick command
2. If conflicts occur:
   a. Run `git status` to see conflicting files
   b. For each conflict, read the file and resolve following non-negotiables
   c. Use `git add <file>` after resolving each file
   d. Run `git cherry-pick --continue`
3. After all commits applied, run verification:
   {VERIFICATION_COMMANDS}
4. If any verification fails:
   a. Analyze the error
   b. Fix the issue
   c. Re-run verification
   d. Commit fix: "fix: batch {BATCH_NUMBER} verification"
5. Report results:
   - Final commit SHA
   - List of conflicts resolved (if any)
   - Verification results (all must pass)

OUTPUT REQUIRED:
- batch_commit_sha: The SHA of the final cherry-pick commit
- conflicts_resolved: List of files with conflicts and how resolved
- verification_passed: true/false
- verification_details: Output summary of each verification step
- fix_commits: List of any fix commit SHAs (if verification required fixes)
```

### reviewer Verify Prompt

```
TASK: Verify Cherry-Pick Batch {BATCH_NUMBER} for v0.12.0 → v0.13.0 sync

EXPECTED STATE:
- Batch commit should exist with message starting "cherry-pick: upstream v0.12.0..v0.13.0 batch {BATCH_NUMBER}"
- These upstream commits should be reflected:
{LIST_OF_SHAS_AND_SUBJECTS}

{NON_NEGOTIABLES_BLOCK}

VERIFICATION STEPS:
1. Check git log for the batch commit:
   git log --oneline -5
   
2. Verify no conflict markers exist:
   grep -r "<<<<<<" . --include="*.ts" --include="*.tsx" --include="*.js"
   (should return nothing)

3. Verify key changes are present by checking modified files:
   git show --stat HEAD

4. Run full verification suite:
   {VERIFICATION_COMMANDS}

5. Spot-check non-negotiables:
   - Search for `@google/gemini-cli-core` imports (should be 0)
   - Search for `ClearcutLogger` (should be 0)
   - Verify AuthType.USE_PROVIDER preserved where applicable

REPORT:
- verification_passed: true/false
- issues_found: List of any problems discovered
- recommendations: What needs to be fixed (if any)
```

---

## REIMPLEMENT Batch Prompt Template

### cherrypicker Reimplement Prompt

```
TASK: Reimplement Upstream Commit {SHA} for v0.12.0 → v0.13.0 sync

UPSTREAM COMMIT:
SHA: {FULL_SHA}
Subject: {SUBJECT}
Files changed: {FILE_LIST}

UPSTREAM DIFF SUMMARY:
{DIFF_SUMMARY_OR_KEY_CHANGES}

WHY REIMPLEMENT (not cherry-pick):
{REASON - e.g., "LLxprt has different architecture", "Conflicts with existing implementation"}

REIMPLEMENT PLAN FILE:
See: project-plans/20260114gmerge/{SHA_PREFIX}-plan.md

{NON_NEGOTIABLES_BLOCK}

EXECUTION STEPS:
1. Read the reimplement plan file for detailed guidance
2. Review the upstream commit diff:
   git show {SHA}
3. Identify what functionality to bring over vs skip
4. Implement changes adapted for LLxprt's architecture
5. Run verification:
   {VERIFICATION_COMMANDS}
6. Commit with message:
   reimplement: {SUBJECT} (upstream {SHA_SHORT})
   
   Adapted for LLxprt's:
   - {ADAPTATION_1}
   - {ADAPTATION_2}

OUTPUT REQUIRED:
- reimplement_commit_sha: The SHA of the reimplement commit
- adaptations_made: List of how changes were adapted for LLxprt
- skipped_parts: List of upstream changes intentionally not brought over
- verification_passed: true/false
- verification_details: Output summary
```

---

## Remediation Prompt Template

```
TASK: Remediate Batch {BATCH_NUMBER} Verification Failures

FAILURE DETAILS:
{FAILURE_OUTPUT}

PREVIOUS ATTEMPT:
- Commit SHA: {PREVIOUS_SHA}
- What was done: {SUMMARY}

{NON_NEGOTIABLES_BLOCK}

REMEDIATION STEPS:
1. Analyze the failure output carefully
2. Identify root cause
3. Implement fix
4. Run verification:
   {VERIFICATION_COMMANDS}
5. If still failing, iterate
6. Commit fix: "fix: remediate batch {BATCH_NUMBER} - {WHAT_WAS_FIXED}"

OUTPUT REQUIRED:
- fix_commit_sha: The SHA of the fix commit
- root_cause: What caused the failure
- fix_applied: What was changed
- verification_passed: true/false (must be true to complete)
```

---

## Batch Details for Prompts

### Batch 1 (PICK #1-5)
```
Commits:
706834ecd3c6449266de412539294f16c68473ce - fix: enhance path handling in handleAtCommand to support relative paths (#9065)
6e026bd9500d0ce5045b2e952daedf8c4af60324 - fix(security) - Use emitFeedback instead of console error (#11954)
c60d8ef5a861685f6f20a4e776aaaefdc1879b63 - fix(infra) - Unskip read many file test (#12181)
3e9701861e9dc10fc6a28470069a63ebf6823c39 - refactor(core): Move getPackageJson utility to core package (#12224)
42a265d2900a250bf75535bdcaba2a35c3eb609b - Fix atprocessor test on windows (#12252)

Command: git cherry-pick 706834ec 6e026bd9 c60d8ef5 3e970186 42a265d2
```

### Batch 2 (PICK #6-10)
```
Commits:
82c10421a06f0e4934f44ce44e37f0a95e693b02 - Fix alt key mappings for mac (#12231)
99f75f32184ecfc85bdef65f9ecb8d423479801f - Fix(noninteractive) - Add message when user uses deprecated flag (#11682)
523274dbf34c6ea31c1060eae759aa06673b2f07 - Standardize error logging with coreEvents.emitFeedback (#12199)
77df6d48e23812e35272c4a21d89077a8cfcd049 - docs: update keyboard shortcuts with missing shortcuts (#12024)
1d9e6870befa21b9d4ca6c7d884c0a21a8549c7a - feat(core): Implement granular memory loaders for JIT architecture (#12195)

Command: git cherry-pick 82c10421 99f75f32 523274db 77df6d48 1d9e6870
```

### Batch 3 (PICK #11-15)
```
Commits:
c583b510e09ddf9d58cca5b6132bf19a8f5a8091 - Refactoring unit tests in packages/cli/src/ui (#12251)
b8330b626ef9a134bee5089669751289a3c025c4 - Fix misreported number of lines being removed by model (#12076)
7d03151cd5b6a8ac208f0b22ad6e1f5fa3471390 - fix output messages for install and link (#12168)
a3370ac86bce6df706d9c57db15533db657ae823 - Add validate command (#12186)
b8969cceffbbba58b228d9c9bf12bfdd236efb0b - fix(docs): remove incorrect extension install method (#11194)

Command: git cherry-pick c583b510 b8330b62 7d03151c a3370ac8 b8969cce
```

### Batch 4 (PICK #16-20)
```
Commits:
d4cad0cdcc9a777e729e97d80a6f129dc267ba60 - fix(test) - Make JSON output error test use canned response (#12250)
cc081337b7207df6640318931301101a846539b6 - Initial support for reloading extensions in the CLI - mcp servers only (#12239)
54fa26ef0e2d77a0fbc2c4d3d110243d886d9b28 - Fix tests to wrap all calls changing the UI with act. (#12268)
b382ae6803ce21ead2a91682fc58126f3786f15b - feat: Prevent self-imports and fix build loop (#12309)
68afb7200e06507056b3321f9f1d9056ba95da45 - Change default compression threshold (#12306)

Command: git cherry-pick d4cad0cd cc081337 54fa26ef b382ae68 68afb720
```

### Batch 5 (PICK #21-25)
```
Commits:
322feaafa62a1630ae1750d32efbb24ea9194463 - refactor(core): decouple GeminiChat from uiTelemetryService via Usage events (#12196)
ab8c24f5eab534697f26cf7da7a4f182c7665f3e - Fixes for Ink 6.4.0 (#12352)
f8ff921c426712232864ecd3fa2675c2c68a4580 - Update mcp-server.md (#12310)
f875911af7d49055d583d86239e6fa2a01bdc471 - Remove testing-library/react dep now that it is unused. (#12355)
01ad74a8700d50356dff60719d761d5550f643dd - docs(cli): user.email attribute is only available for Google auth (#12372)

Command: git cherry-pick 322feaaf ab8c24f5 f8ff921c f875911a 01ad74a8
```

### Batch 6 (PICK #26-30)
```
Commits:
f4ee245bf9c2383add94a76a12fbae9fb9225e5d - Switch to ink@. version 6.4.0 (#12381)
c158923b278685d99d340623dc2412b492721e58 - docs: Add policy engine documentation and update sidebar (#12240)
adddafe6d07eea74561bd71e88aef0ce2a546b4a - Handle untrusted folders on extension install and link (#12322)
6ee7165e39bd4ee2ce68781c5a735a262cd160a1 - feat(infra) - Add logging for slow rendering (#11147)
d72f8453cbe4ebd2b0facc5dca9d87894ac214f4 - Remove unused jsdom dep (#12394)

Command: git cherry-pick f4ee245b c158923b adddafe6 6ee7165e d72f8453
```

### Batch 7 (PICK #31-35)
```
Commits:
4b53b3a6e6e4e994195d569dc5a342f808382de5 - Update telemetry.md to remove references to flags. (#12397)
9478bca67db3e7966d6ab21f8ad1694695f20037 - Adding the Policy Engine docs to indexes. (#12404)
8b93a5f27d7c703f420001988f4cbd9beba7508b - I think the package lock was added in error to .gitignore. (#12405)
f9df4153921034f276d3059f08af9849b3918798 - feat(core): Introduce release channel detection (#12257)
61207fc2cbaa9a2e13845272f7edf0f15970d5fb - further incremental steps. Update the string width version to align with upstream ink (#12411)

Command: git cherry-pick 4b53b3a6 9478bca6 8b93a5f2 f9df4153 61207fc2
```

### Batch 8 (PICK #36-40)
```
Commits:
f8ce3585eb60be197874f7d0641ee80f1e900b24 - Jacob314/jrichman ink (#12414)
caf2ca1438c1a413ee978c97a41ce4e9f818fa9f - Add kitty support for function keys. (#12415)
e3262f8766d73a281fbc913c7a7f6d876c7cb136 - fix(core): combine .gitignore and .geminiignore logic for correct precedence (#11587)
d7243fb81f749ff32b9d37bfe2eb61068b0b2af3 - Add DarkGray to the ColorTheme. (#12420)
02518d2927d16513dfa05257e1a2025d9123f3d1 - docs: update command-line flag documentation (#12452)

Command: git cherry-pick f8ce3585 caf2ca14 e3262f87 d7243fb8 02518d29
```

### Batch 9 (PICK #41-45)
```
Commits:
9187f6f6d1b96c36d4d2321af46f1deedab60aa3 - fix: preserve path components in OAuth issuer URLs (#12448)
462c7d350257d45981e69c39a38a087c812fa019 - feat(ui): add response semantic color (#12450)
1ef34261e09a6b28177c2a46384b19cfa0b5bea0 - chore: bump tar to 7.5.2 (#12466)
93f14ce626f68a7bf962e7ac8423bfb70a62c6f2 - refactor: split core system prompt into multiple parts (#12461)
19ea68b838e10fe16950ac0193f3de49f067e669 - Refactoring packages/cli/src/ui tests (#12482)

Command: git cherry-pick 9187f6f6 462c7d35 1ef34261 93f14ce6 19ea68b8
```

### Batch 10 (PICK #46-50)
```
Commits:
9d642f3bb1dcf8380822b025adabb06262364ef2 - refactor(core): improve error handling for setGlobalProxy (#12437)
c4377c1b1af84086f888915a93b56b5910396049 - fix(settings): persist restart-required changes when exiting with ESC (#12443)
1c044ba8afa9e51ba5485394541c8739ba6be110 - (fix): Respect ctrl+c signal for aborting execution in NonInteractive mode (#11478)
2144d25885b408bb88531fbc2ad44a98aeb1481d - fix(auth): Return empty map if token file does not exits, and refacto… (#12332)
ad33c22374fd88656f0785d1f9ad728bdac9075d - Modify navigation and completion keyboard shortcuts to not use scroll. (#12502)

Command: git cherry-pick 9d642f3b c4377c1b 1c044ba8 2144d258 ad33c223
```

### Batch 11 (PICK #51-55)
```
Commits:
bd06e5b161f72add52958f5cdc336c78ba401134 - chore: bump vite to 7.1.12 (#12512)
fc42c4613f05d9ffc17fa403d0b8e87737f2269d - Only show screen reader notice once (#12247)
f0c3c81e94f04720daf0661b28369e8699a1266a - fix(core): Improve loop detection for longer repeating patterns (#12505)
b5315bfc208c754eea1204260bdbe0d10c14819b - Fix alt+left on ghostty (#12503)
ab73051298b53d7748e93b88d439e775b08a7bac - fix(mcp): replace hardcoded port 7777 with dynamic port allocation for OAuth (#12520)

Command: git cherry-pick bd06e5b1 fc42c461 f0c3c81e b5315bfc ab730512
```

### Batch 12 (PICK #56-60)
```
Commits:
6ab1b239ca8d89d689e2b863181a9d041159728c - refactor(core): Refactored and removed redundant test lines in telemetry (#12356)
96d7eb296601e3da583f8c2da6bcac3745fbef68 - fix(infra) - Use canned response for flicker test (#12377)
b8b6620365ba494780c4172fcd21782e25796d77 - Tighten bash shell option handling (#12532)
460c3debf5ec73f0652a496254ad9b5b3622caf7 - Fix flicker in screen reader nudge (#12541)
f79665012231a7979c3c6c5b652614d0f928ab33 - Fix shift+tab keybinding when not in kitty mode (#12552)

Command: git cherry-pick 6ab1b239 96d7eb29 b8b66203 460c3deb f7966501
```

### Batch 13 (PICK #61-63)
```
Commits:
75c2769b322dfd2834a4b0379ae0c6002eebbc33 - Ss/fix ext (#12540)
fd885a3e50e3c88bba6b5b2ee03a76b7c514ff29 - fix(patch): cherry-pick f51d745 - googleQuotaErrors fix
ece06155cc49776839a137bef87f05c3909312be - fix(patch): cherry-pick 1611364 - shell execution fixes

Command: git cherry-pick 75c2769b fd885a3e ece06155
```

### Batch 14 (REIMPLEMENT - Hook Config c0495ce2)
```
See: project-plans/20260114gmerge/c0495ce2-plan.md
```

### Batch 15 (REIMPLEMENT - Settings Autogen 5062fadf)
```
See: project-plans/20260114gmerge/5062fadf-plan.md
```

### Batch 16 (REIMPLEMENT - Hook Translator 80673a0c)
```
See: project-plans/20260114gmerge/80673a0c-plan.md
```

### Batch 17 (REIMPLEMENT - Alt Buffer 4fc9b1cd)
```
See: project-plans/20260114gmerge/4fc9b1cd-plan.md
```

### Batch 18 (REIMPLEMENT - Hook I/O b2591534)
```
See: project-plans/20260114gmerge/b2591534-plan.md
```

### Batch 19 (REIMPLEMENT - Hook Planner cb2880cb)
```
See: project-plans/20260114gmerge/cb2880cb-plan.md
```

### Batch 20 (REIMPLEMENT - Extensions MCP da4fa5ad)
```
See: project-plans/20260114gmerge/da4fa5ad-plan.md
```

### Batch 21 (REIMPLEMENT - PolicyEngine ffc5e4d0)
```
See: project-plans/20260114gmerge/ffc5e4d0-plan.md
```
