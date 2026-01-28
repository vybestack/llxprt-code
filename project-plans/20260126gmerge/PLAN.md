# Batch Execution Plan: v0.13.0 to v0.14.0

**Branch:** `20260126gmerge`  
**Created:** 2026-01-26

---

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said "DO @project-plans/20260126gmerge/PLAN.md", follow these steps:

### Step 1: Check current state
```bash
git branch --show-current  # Should be 20260126gmerge
git status                 # Check for uncommitted changes
```

### Step 2: Check or create the todo list
Call `todo_read()` first. If empty or doesn't exist, call `todo_write()` with the EXACT todo list from the "Todo List Management" section below.

### Step 3: Find where to resume
- Look at the todo list for the first `pending` item
- If an item is `in_progress`, restart that item
- If all items are `completed`, you're done

### Step 4: Execute using subagents
For each batch, you MUST use the `task` tool to invoke subagents:

- **For execution tasks (BN-exec):** Call `task` with `subagent_name: "cherrypicker"` using the prompt from that batch's section
- **For review tasks (BN-review):** Call `task` with `subagent_name: "reviewer"` using the prompt from that batch's section
- **For remediation (if review fails):** Call `task` with `subagent_name: "cherrypicker"` with the remediation prompt

Example invocation:
```
task(
  subagent_name: "cherrypicker",
  goal_prompt: "<copy the exact prompt from the batch section below>"
)
```

- **DO NOT** do the cherry-picks yourself - use the cherrypicker subagent
- **DO NOT** do the reviews yourself - use the reviewer subagent
- **DO NOT** stop to ask questions or report progress
- **DO NOT** skip review steps
- Continue until todo list is empty or you hit a blocker

### Step 5: If blocked
- Call `todo_pause()` with the specific reason
- Wait for human intervention

---

## Subagent Orchestration

Each batch is executed using a **three-phase pattern** with mandatory review:

1. **Execute** (`cherrypicker` subagent) - Cherry-pick or reimplement
2. **Review** (`reviewer` subagent) - Mandatory verification - MUST PASS
3. **Remediate** (`cherrypicker` subagent) - Fix issues if review fails

### Review-Remediate Loop (MANDATORY)

After every batch execution, the `reviewer` subagent MUST verify. If review fails:
- Launch `cherrypicker` to remediate the specific issues
- Re-run `reviewer` to verify the fix
- Loop up to **5 times** maximum
- If still failing after 5 attempts, STOP and escalate to human

```
LOOP (max 5 iterations):
  reviewer -> PASS? -> Continue to next batch
           -> FAIL? -> cherrypicker (remediate) -> back to reviewer
```

### Todo List Management (CRITICAL)

Before starting execution, the coordinator MUST call `todo_write` with the EXACT todo list below. This is the complete plan - execute it sequentially without stopping:

```
todo_write({
  todos: [
    // Batch 1: 5 PICK commits (HIGH RISK - fa93b56243 extension reloading)
    { 
      id: "B1-exec", 
      content: "Batch 1 EXECUTE: cherry-pick f51d74586c 16113647de f5bd474e51 fa93b56243 9787108532 - retryInfo, windows pty, policy spoofing, extension reload, tool ordering", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B1-review", 
      content: "Batch 1 REVIEW: verify 5 commits landed correctly, lint, typecheck, qualitative check each commit", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B1-commit", 
      content: "Batch 1 COMMIT: git add -A && git commit if not already committed by cherry-pick", 
      status: "pending", 
      priority: "high" 
    },
    
    // Batch 2: 5 PICK commits (LOW RISK) + FULL VERIFY
    { 
      id: "B2-exec", 
      content: "Batch 2 EXECUTE: cherry-pick 224a33db2e 0f5dd2229c 5f6453a1e0 9ba1cd0336 c585470a71 - animated components, remove policy TOML, policy tests, shell cwd, InputPrompt tests", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B2-review", 
      content: "Batch 2 REVIEW (FULL): lint, typecheck, test, build, smoke test, qualitative check each commit", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B2-commit", 
      content: "Batch 2 COMMIT: git add -A && git commit if not already committed by cherry-pick", 
      status: "pending", 
      priority: "high" 
    },
    
    // Batch 3: 4 PICK commits (MEDIUM RISK - f05d937f39 param names)
    { 
      id: "B3-exec", 
      content: "Batch 3 EXECUTE: cherry-pick 77614eff5b c13ec85d7d f05d937f39 c81a02f8d2 - multi-replace test, keychain name, consistent params, DiscoveredTool policy", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B3-review", 
      content: "Batch 3 REVIEW: verify 4 commits landed correctly, lint, typecheck, qualitative check each commit", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B3-commit", 
      content: "Batch 3 COMMIT: git add -A && git commit if not already committed by cherry-pick", 
      status: "pending", 
      priority: "high" 
    },
    
    // Batch 4: 1 REIMPLEMENT (b445db3d46 list_directory flaky test) + FULL VERIFY
    { 
      id: "B4-exec", 
      content: "Batch 4 REIMPLEMENT: b445db3d46 - migrate list_directory.test.ts to use expectToolCallSuccess() pattern instead of waitForToolCall()", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B4-review", 
      content: "Batch 4 REVIEW (FULL): lint, typecheck, test, build, smoke test, verify pattern actually changed", 
      status: "pending", 
      priority: "high" 
    },
    { 
      id: "B4-commit", 
      content: "Batch 4 COMMIT: git add -A && git commit -m 'reimplement: make list dir test less flaky (upstream b445db3d46)'", 
      status: "pending", 
      priority: "high" 
    },
    
    // Final documentation updates
    { 
      id: "FINAL-progress", 
      content: "UPDATE PROGRESS.md: mark all batches complete with LLxprt commit hashes", 
      status: "pending", 
      priority: "medium" 
    },
    { 
      id: "FINAL-notes", 
      content: "UPDATE NOTES.md: document any conflicts, deviations, or issues encountered", 
      status: "pending", 
      priority: "medium" 
    },
    { 
      id: "FINAL-audit", 
      content: "UPDATE AUDIT.md: fill in LLxprt commit hashes for all PICKED/REIMPLEMENTED rows", 
      status: "pending", 
      priority: "medium" 
    }
  ]
})
```

**Rules:**
- Mark task `in_progress` when starting
- Mark task `completed` only when done (review passed, commit made)
- If remediation needed, add subtask like `B1-remediate-1` and loop until review passes (max 5 times)
- **DO NOT** stop to report progress - continue until todo list is empty
- **DO NOT** ask "what should I do next" - the todo list tells you
- **COMMIT after each batch review passes** - this is tracked as a separate todo item

### Pattern for PICK Batches

```
Task(
  subagent_name: "cherrypicker",
  goal_prompt: "Execute cherry-pick batch N for LLxprt v0.13.0 to v0.14.0 sync.

BRANCH: 20260126gmerge (already checked out)
UPSTREAM COMMITS (in order):
- <sha1> - <subject>
- <sha2> - <subject>
...

COMMAND TO RUN:
git cherry-pick <sha1> <sha2> ...

CONFLICT RESOLUTION RULES:
- Preserve LLxprt branding (@vybestack/llxprt-code-core, not @google/gemini-cli-core)
- Preserve multi-provider architecture (AuthType.USE_PROVIDER, not USE_GEMINI)
- Keep .llxprtignore references (not .geminiignore)
- Keep LLXPRT_ env vars (not GEMINI_)

AFTER CHERRY-PICK:
1. Run: npm run lint && npm run typecheck
2. If errors, fix them and commit as 'fix: post-batch N - <issue>'
3. Report: which commits applied cleanly, which had conflicts, what was resolved

DO NOT proceed to next batch - just complete this one."
)
```

### Pattern for REIMPLEMENT Batches

```
Task(
  subagent_name: "cherrypicker",
  goal_prompt: "Reimplement upstream commit <sha> for LLxprt.

UPSTREAM COMMIT: <sha> - <subject>
UPSTREAM BEHAVIOR: <description of what the commit does>

WHY NOT CHERRY-PICK: <reason from CHERRIES.md>

LLXPRT APPROACH:
<specific instructions from the <sha>-plan.md file>

DELIVERABLES:
- Modified files with the reimplemented behavior
- Tests passing
- Commit with message: 'reimplement: <subject> (upstream <sha>)'

DO NOT cherry-pick directly - implement the equivalent behavior in LLxprt's architecture."
)
```

### Review Pattern (MANDATORY after every batch)

```
Task(
  subagent_name: "reviewer",
  goal_prompt: "Verify batch N cherry-pick for LLxprt v0.13.0 to v0.14.0 sync.

EXPECTED COMMITS PICKED:
- <sha1> - <subject>
...

PART 1: MECHANICAL VERIFICATION
1. git log --oneline -N shows the expected cherry-picked commits
2. npm run lint passes (exit code 0)
3. npm run typecheck passes (exit code 0)
4. No LLxprt non-negotiables violated:
   - No @google/gemini-cli imports (should be @vybestack/llxprt-code)
   - No AuthType.USE_GEMINI (should be USE_PROVIDER)
   - No .geminiignore references (should be .llxprtignore)
   - No GEMINI_ env vars (should be LLXPRT_)
   - No ClearcutLogger references
   - No NextSpeakerChecker references
   - No Smart Edit references

FOR FULL VERIFY BATCHES (2 and 4), also check:
5. npm run test passes
6. npm run build passes
7. Smoke test: node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'

PART 2: QUALITATIVE VERIFICATION (CRITICAL)
For EACH commit in the batch, you MUST verify:

A. CODE ACTUALLY LANDED - not stubbed, not faked:
   - Read the upstream commit: git show <sha>
   - Read the corresponding LLxprt files that should have changed
   - Verify the actual logic/functionality was applied, not just empty functions or TODO comments
   - Check that imports, types, and implementations match upstream intent

B. BEHAVIORAL EQUIVALENCE:
   - Will this code do what the upstream commit intended?
   - Are there any subtle differences that would change behavior?
   - Were any important parts omitted or simplified incorrectly?

C. INTEGRATION CORRECTNESS:
   - Does the code integrate properly with LLxprt's existing systems?
   - Are there any missing connections (e.g., exports not added, registrations missing)?
   - Would this actually work at runtime or just compile?

OUTPUT FORMAT (REQUIRED):
{
  "result": "PASS" or "FAIL",
  "mechanical": {
    "lint": "PASS/FAIL",
    "typecheck": "PASS/FAIL",
    "branding_check": "PASS/FAIL",
    "test": "PASS/FAIL/SKIPPED",
    "build": "PASS/FAIL/SKIPPED",
    "smoke": "PASS/FAIL/SKIPPED"
  },
  "qualitative": {
    "code_landed": "PASS/FAIL - <details>",
    "behavioral_equivalence": "PASS/FAIL - <details>",
    "integration_correctness": "PASS/FAIL - <details>"
  },
  "per_commit_assessment": [
    {"sha": "<sha1>", "landed": true/false, "equivalent": true/false, "notes": "..."},
    ...
  ],
  "issues": ["list of specific issues if FAIL"]
}"
)
```
Task(
  subagent_name: "reviewer",
  goal_prompt: "Verify batch N cherry-pick for LLxprt v0.13.0 to v0.14.0 sync.

EXPECTED COMMITS PICKED:
- <sha1> - <subject>
...

VERIFICATION CHECKLIST:
1. git log --oneline -N shows the expected cherry-picked commits
2. npm run lint passes (exit code 0)
3. npm run typecheck passes (exit code 0)
4. No LLxprt non-negotiables violated:
   - No @google/gemini-cli imports (should be @vybestack/llxprt-code)
   - No AuthType.USE_GEMINI (should be USE_PROVIDER)
   - No .geminiignore references (should be .llxprtignore)
   - No GEMINI_ env vars (should be LLXPRT_)
   - No ClearcutLogger references
   - No NextSpeakerChecker references
   - No Smart Edit references

FOR FULL VERIFY BATCHES (2 and 4), also check:
5. npm run test passes
6. npm run build passes
7. Smoke test: node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'

OUTPUT FORMAT (REQUIRED):
{
  "result": "PASS" or "FAIL",
  "lint": "PASS/FAIL",
  "typecheck": "PASS/FAIL",
  "branding_check": "PASS/FAIL",
  "test": "PASS/FAIL/SKIPPED",
  "build": "PASS/FAIL/SKIPPED",
  "smoke": "PASS/FAIL/SKIPPED",
  "issues": ["list of specific issues if FAIL"]
}"
)
```

### Remediation Pattern (when review fails)

```
Task(
  subagent_name: "cherrypicker",
  goal_prompt: "Remediate batch N review failure for LLxprt v0.13.0 to v0.14.0 sync.

REVIEW FAILURE DETAILS:
<paste the issues array from reviewer output>

YOUR TASK:
1. Fix each listed issue
2. Run the failing verification step(s) to confirm fix
3. Commit fixes as 'fix: post-batch N remediation - <issue summary>'

DO NOT re-run the full cherry-pick. Only fix the specific issues listed.

Report what was fixed and verification results."
)
```

---

## Non-Negotiables

Per `dev-docs/cherrypicking.md`, the following must NEVER be violated:

1. **Multi-provider architecture** must be preserved
2. **No Google telemetry** (ClearcutLogger completely removed)
3. **LLxprt's parallel tool batching** over upstream's serial queue
4. **LLxprt branding** in all user-facing and import paths
5. **A2A server stays private** (do not make publishable)
6. **NextSpeakerChecker stays disabled** (causes token waste and loops)
7. **No Smart Edit** (LLxprt uses deterministic replace + fuzzy edit)
8. **Emoji-free design** preserved

---

## Branding Substitutions

When resolving conflicts, apply these substitutions:

| Upstream | LLxprt |
|----------|--------|
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |
| `AuthType.USE_GEMINI` | `AuthType.USE_PROVIDER` |
| `gemini-cli` | `llxprt-code` |
| `.geminiignore` | `.llxprtignore` |
| `GEMINI_` env vars | `LLXPRT_` env vars |

---

## File Existence Pre-Check

Before starting, verify these files exist (for conflict resolution awareness):

```bash
# Extension-related files (fa93b56 touches these)
ls -la packages/cli/src/config/extension-manager.ts
ls -la packages/cli/src/config/settings.ts
ls -la packages/cli/src/services/BuiltinCommandLoader.ts
ls -la packages/cli/src/ui/commands/extensionsCommand.ts

# Policy files (0f5dd22 removes these - verify they exist to be removed)
ls -la packages/cli/src/config/policies/

# Tool files (f05d937 touches these)
ls -la packages/core/src/tools/edit.ts
ls -la packages/core/src/tools/shell.ts
ls -la packages/core/src/tools/read-file.ts
```

---

## Batch Schedule

### Batch 1 (5 PICK commits)

**Commits (chronological):**
1. `f51d74586c` - refactor: parse string for retryInfo
2. `16113647de` - Fix/windows pty crash
3. `f5bd474e51` - fix(core): prevent server name spoofing in policy engine
4. `fa93b56243` - [Extension Reloading]: Update custom commands, add enable/disable command **[HIGH RISK]**
5. `9787108532` - List tools in a consistent order

**Command:**
```bash
git cherry-pick f51d74586c 16113647de f5bd474e51 fa93b56243 9787108532
```

**Expected conflicts:** HIGH - `fa93b56243` touches 24 files

**Conflict resolution notes:**
- `fa93b56243`: Watch for branding in settings.ts, extension-manager.ts
- Preserve LLxprt's multi-provider auth patterns
- Keep `.llxprtignore` references (not `.geminiignore`)

**Subagent Prompt:**
```
Task(
  subagent_name: "cherrypicker",
  goal_prompt: "Execute cherry-pick batch 1 for LLxprt v0.13.0 to v0.14.0 sync.

BRANCH: 20260126gmerge (already checked out)

UPSTREAM COMMITS (in order):
1. f51d74586c - refactor: parse string for retryInfo
2. 16113647de - Fix/windows pty crash  
3. f5bd474e51 - fix(core): prevent server name spoofing in policy engine
4. fa93b56243 - [Extension Reloading]: Update custom commands, add enable/disable command [HIGH RISK - 24 files]
5. 9787108532 - List tools in a consistent order

COMMAND TO RUN:
git cherry-pick f51d74586c 16113647de f5bd474e51 fa93b56243 9787108532

CONFLICT RESOLUTION RULES:
- Preserve LLxprt branding (@vybestack/llxprt-code-core, not @google/gemini-cli-core)
- Preserve multi-provider architecture (AuthType.USE_PROVIDER, not USE_GEMINI)
- Keep .llxprtignore references (not .geminiignore)
- Keep LLXPRT_ env vars (not GEMINI_)
- fa93b56243 is HIGH RISK: watch for branding in settings.ts, extension-manager.ts

AFTER CHERRY-PICK:
1. Run: npm run lint && npm run typecheck
2. If errors, fix them and commit as 'fix: post-batch 1 - <issue>'
3. Report: which commits applied cleanly, which had conflicts, what was resolved

DO NOT proceed to next batch - just complete this one."
)
```

**Verification (Quick):**
```bash
npm run lint
npm run typecheck
```

**Commit message:** `cherry-pick: upstream v0.13.0..v0.14.0 batch 1`

**MANDATORY REVIEW - Subagent Prompt:**
```
Task(
  subagent_name: "reviewer",
  goal_prompt: "Verify batch 1 cherry-pick for LLxprt v0.13.0 to v0.14.0 sync.

EXPECTED COMMITS PICKED (5):
1. f51d74586c - refactor: parse string for retryInfo
2. 16113647de - Fix/windows pty crash
3. f5bd474e51 - fix(core): prevent server name spoofing in policy engine
4. fa93b56243 - [Extension Reloading]: Update custom commands, add enable/disable command
5. 9787108532 - List tools in a consistent order

PART 1: MECHANICAL VERIFICATION
1. git log --oneline -5 shows these commits
2. npm run lint passes (exit code 0)
3. npm run typecheck passes (exit code 0)
4. Branding check - search for violations:
   - grep -r '@google/gemini-cli' packages/ (should be empty or only in comments)
   - grep -r 'AuthType.USE_GEMINI' packages/ (should be empty)

PART 2: QUALITATIVE VERIFICATION (check EACH commit)

For f51d74586c (retryInfo parsing):
- Read: git show f51d74586c
- Verify: packages/core/src/utils/googleQuotaErrors.ts has ms parsing logic
- Check: parseDurationInSeconds handles 'ms' suffix, not just 's'
- Check: fallback regex for 'Please retry in X[s|ms]' is present

For 16113647de (windows pty crash):
- Read: git show 16113647de
- Verify: the actual fix landed in shellExecutionService.ts or related files
- Check: not just test changes - actual crash prevention code exists

For f5bd474e51 (server name spoofing):
- Read: git show f5bd474e51
- Verify: policy-engine.ts has server name validation
- Check: mcp-tool.ts has the security fix
- Check: this actually prevents spoofing, not just a stub

For fa93b56243 (extension reloading) - HIGH RISK:
- Read: git show fa93b56243
- Verify: extension-manager.ts has enable/disable functionality
- Verify: extensionsCommand.ts has new commands
- Verify: settings.ts changes for extension state
- Check: 24 files should have meaningful changes, not stubs

For 9787108532 (tool ordering):
- Read: git show 9787108532
- Verify: tool-registry.ts or config.ts has consistent ordering logic
- Check: tools are actually sorted, not just a comment

OUTPUT FORMAT:
{
  \"result\": \"PASS\" or \"FAIL\",
  \"mechanical\": {
    \"commits_present\": true/false,
    \"lint\": \"PASS/FAIL\",
    \"typecheck\": \"PASS/FAIL\",
    \"branding_check\": \"PASS/FAIL\"
  },
  \"qualitative\": {
    \"f51d74586c_retryInfo\": {\"landed\": true/false, \"functional\": true/false, \"notes\": \"...\"},
    \"16113647de_pty_crash\": {\"landed\": true/false, \"functional\": true/false, \"notes\": \"...\"},
    \"f5bd474e51_spoofing\": {\"landed\": true/false, \"functional\": true/false, \"notes\": \"...\"},
    \"fa93b56243_extension\": {\"landed\": true/false, \"functional\": true/false, \"notes\": \"...\"},
    \"9787108532_tool_order\": {\"landed\": true/false, \"functional\": true/false, \"notes\": \"...\"}
  },
  \"issues\": []
}"
)
```

---

### Batch 2 (5 PICK commits)

**Commits (chronological):**
1. `224a33db2e` - Improve tracking of animated components
2. `0f5dd2229c` - chore: remove unused CLI policy TOML files
3. `5f6453a1e0` - feat(policy): Add comprehensive priority range validation tests
4. `9ba1cd0336` - feat(shell): include cwd in shell command description
5. `c585470a71` - refactor(cli): consolidate repetitive tests in InputPrompt using it.each

**Command:**
```bash
git cherry-pick 224a33db2e 0f5dd2229c 5f6453a1e0 9ba1cd0336 c585470a71
```

**Expected conflicts:** LOW - mostly isolated changes

**Subagent Prompt:**
```
Task(
  subagent_name: "cherrypicker",
  goal_prompt: "Execute cherry-pick batch 2 for LLxprt v0.13.0 to v0.14.0 sync.

BRANCH: 20260126gmerge (batch 1 should already be complete)

PREREQUISITE CHECK:
Run 'git log --oneline -5' and verify batch 1 commits are present.

UPSTREAM COMMITS (in order):
1. 224a33db2e - Improve tracking of animated components
2. 0f5dd2229c - chore: remove unused CLI policy TOML files
3. 5f6453a1e0 - feat(policy): Add comprehensive priority range validation tests
4. 9ba1cd0336 - feat(shell): include cwd in shell command description
5. c585470a71 - refactor(cli): consolidate repetitive tests in InputPrompt using it.each

COMMAND TO RUN:
git cherry-pick 224a33db2e 0f5dd2229c 5f6453a1e0 9ba1cd0336 c585470a71

CONFLICT RESOLUTION RULES:
- Preserve LLxprt branding
- These are low-risk commits, mostly isolated changes

THIS IS A FULL VERIFY BATCH - After cherry-pick:
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'
7. git add -A (stage any format changes)
8. If any step fails, fix and commit as 'fix: post-batch 2 - <issue>'

Report: all verification results."
)
```

**Verification (Full - Batch 2):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
git add -A  # Stage formatted changes if any
```

**Commit message:** `cherry-pick: upstream v0.13.0..v0.14.0 batch 2`

**MANDATORY REVIEW - Subagent Prompt:**
```
Task(
  subagent_name: "reviewer",
  goal_prompt: "Verify batch 2 cherry-pick for LLxprt v0.13.0 to v0.14.0 sync.

EXPECTED COMMITS PICKED (5):
1. 224a33db2e - Improve tracking of animated components
2. 0f5dd2229c - chore: remove unused CLI policy TOML files
3. 5f6453a1e0 - feat(policy): Add comprehensive priority range validation tests
4. 9ba1cd0336 - feat(shell): include cwd in shell command description
5. c585470a71 - refactor(cli): consolidate repetitive tests in InputPrompt using it.each

PART 1: MECHANICAL VERIFICATION (Full Verify)
1. git log --oneline -10 shows batch 1 and batch 2 commits
2. npm run lint passes (exit code 0)
3. npm run typecheck passes (exit code 0)
4. npm run test passes
5. npm run build passes
6. Smoke test: node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'
7. Branding check - no violations

PART 2: QUALITATIVE VERIFICATION (check EACH commit)

For 224a33db2e (animated components tracking):
- Read: git show 224a33db2e
- Verify: CliSpinner.tsx or DebugProfiler.tsx has tracking improvements
- Check: useAnimatedScrollbar.ts has the changes
- Check: actual tracking logic exists, not just imports

For 0f5dd2229c (remove unused policy TOML):
- Read: git show 0f5dd2229c
- Verify: packages/cli/src/config/policies/ files were DELETED
- Check: read-only.toml, write.toml, yolo.toml should NOT exist
- Check: ls packages/cli/src/config/policies/ returns empty or dir not found

For 5f6453a1e0 (policy priority tests):
- Read: git show 5f6453a1e0
- Verify: toml-loader.test.ts has new/refactored tests
- Check: runLoadPoliciesFromToml helper function exists
- Check: tests actually validate priority ranges

For 9ba1cd0336 (shell cwd in description):
- Read: git show 9ba1cd0336
- Verify: packages/core/src/tools/shell.ts includes cwd in description
- Check: the description string actually shows working directory

For c585470a71 (InputPrompt it.each):
- Read: git show c585470a71
- Verify: InputPrompt.test.tsx uses it.each pattern
- Verify: fileUtils.test.ts uses it.each pattern
- Check: repetitive tests were actually consolidated

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": {
    "commits_present": true/false,
    "lint": "PASS/FAIL",
    "typecheck": "PASS/FAIL",
    "test": "PASS/FAIL",
    "build": "PASS/FAIL",
    "smoke": "PASS/FAIL",
    "branding_check": "PASS/FAIL"
  },
  "qualitative": {
    "224a33db2e_animated": {"landed": true/false, "functional": true/false, "notes": "..."},
    "0f5dd2229c_remove_toml": {"landed": true/false, "functional": true/false, "notes": "..."},
    "5f6453a1e0_policy_tests": {"landed": true/false, "functional": true/false, "notes": "..."},
    "9ba1cd0336_shell_cwd": {"landed": true/false, "functional": true/false, "notes": "..."},
    "c585470a71_it_each": {"landed": true/false, "functional": true/false, "notes": "..."}
  },
  "issues": []
}"
)
```

---

### Batch 3 (4 PICK commits)

**Commits (chronological):**
1. `77614eff5b` - fix(#11707): should replace multiple instances of a string test
2. `c13ec85d7d` - Update keychain storage name to be more user-friendly
3. `f05d937f39` - Use consistent param names **[MEDIUM RISK]**
4. `c81a02f8d2` - fix: integrate DiscoveredTool with Policy Engine

**Command:**
```bash
git cherry-pick 77614eff5b c13ec85d7d f05d937f39 c81a02f8d2
```

**Expected conflicts:** MEDIUM - `f05d937f39` touches many tool files

**Subagent Prompt:**
```
Task(
  subagent_name: "cherrypicker",
  goal_prompt: "Execute cherry-pick batch 3 for LLxprt v0.13.0 to v0.14.0 sync.

BRANCH: 20260126gmerge (batches 1-2 should already be complete)

PREREQUISITE CHECK:
Run 'git log --oneline -10' and verify batch 1 and 2 commits are present.

UPSTREAM COMMITS (in order):
1. 77614eff5b - fix(#11707): should replace multiple instances of a string test
2. c13ec85d7d - Update keychain storage name to be more user-friendly
3. f05d937f39 - Use consistent param names [MEDIUM RISK - touches many tool files]
4. c81a02f8d2 - fix: integrate DiscoveredTool with Policy Engine

COMMAND TO RUN:
git cherry-pick 77614eff5b c13ec85d7d f05d937f39 c81a02f8d2

CONFLICT RESOLUTION RULES:
- Preserve LLxprt branding (@vybestack/llxprt-code-core)
- f05d937f39 is MEDIUM RISK: touches edit.ts, shell.ts, read-file.ts, etc.
  - Watch for file_path vs absolute_path parameter naming
  - Preserve LLxprt tool names (llxprt_ prefixes if applicable)
  - Keep existing parameter validation patterns

AFTER CHERRY-PICK:
1. Run: npm run lint && npm run typecheck
2. If errors, fix them and commit as 'fix: post-batch 3 - <issue>'
3. Report: which commits applied cleanly, which had conflicts, what was resolved

DO NOT proceed to next batch - just complete this one."
)
```

**Conflict resolution notes:**
- `f05d937f39`: Watch for `file_path` vs `absolute_path` parameter naming
- Preserve LLxprt tool names (`llxprt_` prefixes if applicable)
- Keep existing parameter validation patterns

**Verification (Quick):**
```bash
npm run lint
npm run typecheck
```

**Commit message:** `cherry-pick: upstream v0.13.0..v0.14.0 batch 3`

**MANDATORY REVIEW - Subagent Prompt:**
```
Task(
  subagent_name: "reviewer",
  goal_prompt: "Verify batch 3 cherry-pick for LLxprt v0.13.0 to v0.14.0 sync.

EXPECTED COMMITS PICKED (4):
1. 77614eff5b - fix(#11707): should replace multiple instances of a string test
2. c13ec85d7d - Update keychain storage name to be more user-friendly
3. f05d937f39 - Use consistent param names
4. c81a02f8d2 - fix: integrate DiscoveredTool with Policy Engine

PART 1: MECHANICAL VERIFICATION (Quick Verify)
1. git log --oneline -15 shows batch 1, 2, and 3 commits
2. npm run lint passes (exit code 0)
3. npm run typecheck passes (exit code 0)
4. Branding check - no violations

PART 2: QUALITATIVE VERIFICATION (check EACH commit)

For 77614eff5b (multiple string replacement test):
- Read: git show 77614eff5b
- Verify: integration-tests/file-system.test.ts has the new test
- Check: test actually validates multiple instance replacement

For c13ec85d7d (keychain storage name):
- Read: git show c13ec85d7d
- Verify: extensionSettings.ts has user-friendly name
- Check: the name is actually more user-friendly (not generic)

For f05d937f39 (consistent param names) - MEDIUM RISK:
- Read: git show f05d937f39
- Verify MULTIPLE files changed:
  - edit.ts: parameter naming consistent
  - shell.ts: parameter naming consistent
  - read-file.ts: parameter naming consistent
  - glob.ts, grep.ts, ls.ts, write-file.ts: all consistent
- Check: file_path vs absolute_path usage is consistent across tools
- Check: prompts.ts snapshot updated if applicable

For c81a02f8d2 (DiscoveredTool policy):
- Read: git show c81a02f8d2
- Verify: tool-registry.ts integrates with policy engine
- Verify: policies/discovered.toml exists or is referenced
- Check: DiscoveredTool actually goes through policy, not bypassed

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": {
    "commits_present": true/false,
    "lint": "PASS/FAIL",
    "typecheck": "PASS/FAIL",
    "branding_check": "PASS/FAIL"
  },
  "qualitative": {
    "77614eff5b_multi_replace": {"landed": true/false, "functional": true/false, "notes": "..."},
    "c13ec85d7d_keychain": {"landed": true/false, "functional": true/false, "notes": "..."},
    "f05d937f39_param_names": {"landed": true/false, "functional": true/false, "notes": "..."},
    "c81a02f8d2_discovered_tool": {"landed": true/false, "functional": true/false, "notes": "..."}
  },
  "issues": []
}"
)
```

---

### Batch 4 (1 REIMPLEMENT - Full Verify)

**Upstream commit:** `b445db3d46` - fix(infra) - Make list dir less flaky

**Playbook:** See `project-plans/20260126gmerge/b445db3d46-plan.md`

**Summary:** Migrate `integration-tests/list_directory.test.ts` to use LLxprt's existing `expectToolCallSuccess()` helper with try-catch error handling.

**Subagent Prompt:**
```
Task(
  subagent_name: "cherrypicker",
  goal_prompt: "Reimplement upstream commit b445db3d46 for LLxprt - make list_directory test less flaky.

BRANCH: 20260126gmerge (batches 1-3 should already be complete)

PREREQUISITE CHECK:
Run 'git log --oneline -15' and verify batches 1-3 commits are present.

UPSTREAM COMMIT: b445db3d46 - fix(infra) - Make list dir less flaky (#12554)

WHY NOT CHERRY-PICK:
- LLxprt's rig.setup() is async and awaited; upstream made it synchronous
- Signature differences in expectToolCallSuccess
- Test structure uses old waitForToolCall pattern

LLXPRT ALREADY HAS: expectToolCallSuccess() helper (commit 10df51916)

YOUR TASK:
1. Read integration-tests/list_directory.test.ts
2. Replace waitForToolCall() + expect().toBeTruthy() pattern with expectToolCallSuccess()
3. Optionally add try-catch for better diagnostics on failure

PATTERN TO APPLY:
OLD (flaky):
  const result = await rig.waitForToolCall('list_directory');
  expect(result).toBeTruthy();

NEW (stable):
  try {
    const result = await rig.expectToolCallSuccess('list_directory');
    // assertions on result
  } catch (error) {
    console.error('list_directory test failed');
    throw error;
  }

THIS IS A FULL VERIFY BATCH - After implementation:
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'
7. git add -A
8. git commit -m 'reimplement: make list dir test less flaky (upstream b445db3d46)'

Report: what was changed and all verification results."
)
```

**Verification (Full - Batch 4):**
```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
git add -A
```

**Commit message:** `reimplement: make list dir test less flaky (upstream b445db3d46)`

**MANDATORY REVIEW - Subagent Prompt:**
```
Task(
  subagent_name: "reviewer",
  goal_prompt: "Verify batch 4 reimplementation for LLxprt v0.13.0 to v0.14.0 sync.

EXPECTED: Reimplementation of b445db3d46 - make list_directory test less flaky

PART 1: MECHANICAL VERIFICATION (Full Verify)
1. npm run lint passes (exit code 0)
2. npm run typecheck passes (exit code 0)
3. npm run test passes (specifically list_directory tests)
4. npm run build passes
5. Smoke test: node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'

PART 2: QUALITATIVE VERIFICATION (CRITICAL for reimplementation)

Read the upstream commit to understand intent:
- git show b445db3d46

Then verify the reimplementation achieves the SAME GOAL:

A. PATTERN ACTUALLY CHANGED:
- Read: integration-tests/list_directory.test.ts
- Search for: waitForToolCall (should be GONE or reduced)
- Search for: expectToolCallSuccess (should be PRESENT)
- Count: how many test cases use the new pattern vs old pattern
- If old pattern still exists extensively: FAIL

B. ANTI-FLAKINESS ACHIEVED:
- The point was to make tests less flaky by:
  1. Using expectToolCallSuccess() which verifies success, not just call detection
  2. Optionally adding try-catch for better diagnostics
- Check: does the new code actually achieve this?
- Check: is it a real fix or just renaming things?

C. NOT STUBBED OR FAKED:
- The tests should still test real functionality
- expectToolCallSuccess should be a real helper that exists
- Verify: grep -r 'expectToolCallSuccess' integration-tests/ shows it's defined/imported

D. COMMIT MESSAGE:
- Should reference upstream b445db3d46
- git log -1 --oneline should show the reference

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": {
    "lint": "PASS/FAIL",
    "typecheck": "PASS/FAIL",
    "test": "PASS/FAIL",
    "build": "PASS/FAIL",
    "smoke": "PASS/FAIL"
  },
  "qualitative": {
    "pattern_changed": {
      "old_pattern_count": N,
      "new_pattern_count": N,
      "assessment": "PASS/FAIL - <details>"
    },
    "anti_flakiness_achieved": "PASS/FAIL - <explanation of why this reduces flakiness>",
    "not_stubbed": "PASS/FAIL - <verification that expectToolCallSuccess is real>",
    "commit_message_correct": true/false
  },
  "issues": []
}"
)
```

---

## Verification Cadence Summary

| Batch | Type | Quick Verify | Full Verify | Review Required |
|-------|------|--------------|-------------|-----------------|
| 1 | PICK x5 | Yes | No | **MANDATORY** |
| 2 | PICK x5 | Yes | **Yes** | **MANDATORY** |
| 3 | PICK x4 | Yes | No | **MANDATORY** |
| 4 | REIMPLEMENT x1 | Yes | **Yes** | **MANDATORY** |

## Coordinator Execution Flow

The coordinating agent (you) must follow this exact flow, using the `task` tool to invoke subagents:

```
1. Call todo_write with the EXACT todo list from "Todo List Management" section above

2. For each batch (1, 2, 3, 4) in order:
   
   EXECUTE PHASE (use cherrypicker subagent):
   a. Update todo: Mark "BN-exec" as in_progress
   b. Call task(subagent_name="cherrypicker", goal_prompt=<copy from batch N section>)
   c. Wait for subagent to complete
   d. Update todo: Mark "BN-exec" as completed
   
   REVIEW PHASE (use reviewer subagent, with remediation loop):
   e. Update todo: Mark "BN-review" as in_progress
   f. Call task(subagent_name="reviewer", goal_prompt=<copy from batch N MANDATORY REVIEW section>)
   g. Parse the reviewer output JSON
   h. If result == "PASS":
      - Update todo: Mark "BN-review" as completed
      - Go to COMMIT PHASE
   i. If result == "FAIL":
      - Add subtask "BN-remediate-1" to todo list
      - Call task(subagent_name="cherrypicker", goal_prompt=<remediation prompt with issues from reviewer>)
      - Call task(subagent_name="reviewer", goal_prompt=<same review prompt>) again
      - If still FAIL, add "BN-remediate-2" and repeat
      - Loop up to 5 times maximum
      - If still failing after 5 attempts: call todo_pause("Batch N failed review 5 times: <issues>"), STOP
   
   COMMIT PHASE (you do this directly, not subagent):
   j. Update todo: Mark "BN-commit" as in_progress
   k. Run: git status (check if changes need committing)
   l. If uncommitted changes: git add -A && git commit -m "<appropriate message>"
   m. Update todo: Mark "BN-commit" as completed
   n. Continue to next batch

3. After all 4 batches complete (you do this directly, not subagent):
   a. Update todo: Mark "FINAL-progress" as in_progress
   b. Update PROGRESS.md with all batch completion info and LLxprt commit hashes
   c. Update todo: Mark "FINAL-progress" as completed
   
   d. Update todo: Mark "FINAL-notes" as in_progress
   e. Update NOTES.md with any conflicts or deviations
   f. Update todo: Mark "FINAL-notes" as completed
   
   g. Update todo: Mark "FINAL-audit" as in_progress
   h. Update AUDIT.md with LLxprt commit hashes for all PICKED/REIMPLEMENTED
   i. Update todo: Mark "FINAL-audit" as completed

4. Verify todo list is empty (all items completed)
5. Report: "Cherry-pick sync complete. All batches executed and verified."
```

**SUBAGENT USAGE:**
- **cherrypicker** subagent: for BN-exec tasks (cherry-picking) and remediation
- **reviewer** subagent: for BN-review tasks (verification)
- **You (coordinator)**: for BN-commit tasks, FINAL-* tasks, and todo management

**CRITICAL RULES:**
- Do NOT do cherry-picks yourself - use cherrypicker subagent via task()
- Do NOT do reviews yourself - use reviewer subagent via task()
- Do NOT pause to ask what to do next
- Do NOT give progress reports between batches  
- Do NOT skip the review step - it is MANDATORY
- Do NOT skip the commit step - changes must be committed after each batch
- Continue autonomously until blocked or todo list empty
- If context is wiped, read this PLAN.md and the todo list to resume

---

## Failure Recovery

### If cherry-pick fails mid-batch:
```bash
# Abort the current cherry-pick
git cherry-pick --abort

# Check current state
git status
git log --oneline -5

# Restart the batch from the beginning, or pick commits individually
git cherry-pick <sha1>
# resolve conflicts
git add -A
git cherry-pick --continue
```

### If verification fails:
1. Identify the failing test/lint/type error
2. Create a fix commit:
   ```bash
   # Make fixes
   git add -A
   git commit -m "fix: post-batch N verification - <specific issue>"
   ```
3. Re-run verification
4. Continue to next batch only after verification passes

### If build fails after cherry-pick:
```bash
# Rebuild core first (types may be stale)
npm run build --workspace @vybestack/llxprt-code-core

# Then retry full build
npm run build
```

---

## Note-Taking Requirement

After each batch:
1. Update `PROGRESS.md` with status and LLxprt commit hash
2. Append to `NOTES.md` with any conflicts, deviations, or follow-ups
3. Update `AUDIT.md` with upstream SHA -> outcome mapping

---

## Estimated Timeline

| Phase | Estimated Time |
|-------|---------------|
| Batch 1 (high conflict risk) | 30-60 min |
| Batch 2 (low conflict + full verify) | 20-30 min |
| Batch 3 (medium conflict) | 20-30 min |
| Batch 4 (reimplement + full verify) | 20-30 min |
| **Total** | **1.5-2.5 hours** |

---

## Context Recovery (If Agent Context is Wiped)

If you are reading this after a context wipe, here's how to resume:

### Step 1: Understand the situation
```bash
# What branch are we on?
git branch --show-current
# Should be: 20260126gmerge

# What's the git log look like?
git log --oneline -20

# Check for uncommitted changes
git status
```

### Step 2: Read the todo list
```bash
# The todo list should already exist - call todo_read to see current state
```
Call `todo_read()` to see which tasks are completed vs pending.

### Step 3: Determine where to resume
- Find the first `pending` task in the todo list
- That's where you resume
- If a task is `in_progress`, it was interrupted - restart that task

### Step 4: Resume execution
- Follow the Coordinator Execution Flow section above
- Use the specific subagent prompts defined for each batch
- Continue until todo list is empty

### Key Files to Read
- `project-plans/20260126gmerge/PLAN.md` (this file) - execution instructions
- `project-plans/20260126gmerge/CHERRIES.md` - what to pick/skip/reimplement
- `project-plans/20260126gmerge/PROGRESS.md` - batch completion status
- `project-plans/20260126gmerge/NOTES.md` - any issues encountered
- `project-plans/20260126gmerge/AUDIT.md` - per-commit tracking

### What This Sync Is Doing
- **Branch:** 20260126gmerge
- **Upstream range:** v0.13.0 to v0.14.0
- **Total PICK:** 14 commits in 3 batches
- **Total REIMPLEMENT:** 1 commit (b445db3d46 list_directory flaky test)
- **Total SKIP:** 18 commits (documented in CHERRIES.md)
