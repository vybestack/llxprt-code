# Phase 11: Final Verification and Smoke Test

## Phase ID
`PLAN-20260211-SANDBOX1036.P11`

## Prerequisites
- Required: Phase P10 completed (all fixes integrated)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P10" packages/cli/src/utils/sandbox.ts`

## Purpose
Run the full verification cycle, smoke test, and confirm all requirements
from R1–R7 are satisfied end-to-end.

## Verification Tasks

### 1. Full Test Suite
```bash
npm run test
```
Expected: All tests pass across all packages.

### 2. Lint
```bash
npm run lint
```
Expected: No errors.

### 3. Typecheck
```bash
npm run typecheck
```
Expected: No errors.

### 4. Format
```bash
npm run format
```
Expected: No formatting changes needed (or auto-formatted).

### 5. Build
```bash
npm run build
```
Expected: Successful build.

### 6. Smoke Test
```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```
Expected: Exits successfully with haiku output.

### 7. Source Code Audit

#### R1: Error Message
```bash
grep "gemini-cli-dev@google.com" packages/cli/src/utils/sandbox.ts
# Expected: No matches

grep "vybestack/llxprt-code/discussions" packages/cli/src/utils/sandbox.ts
# Expected: One match
```

#### R2: Git Discovery
```bash
grep "GIT_DISCOVERY_ACROSS_FILESYSTEM" packages/cli/src/utils/sandbox.ts
# Expected: One match with =1
```

#### R3: Git Config Mounts
```bash
grep "mountGitConfigFiles" packages/cli/src/utils/sandbox.ts
# Expected: Function definition + call site
```

#### R4-R7: SSH Agent
```bash
grep "setupSshAgentForwarding\|setupSshAgentLinux\|setupSshAgentDockerMacOS\|setupSshAgentPodmanMacOS\|getPodmanMachineConnection" packages/cli/src/utils/sandbox.ts
# Expected: Function definitions + call site for router

# Old inline SSH code gone
grep "Podman on macOS may not access launchd" packages/cli/src/utils/sandbox.ts
# Expected: No matches
```

#### No Deferred Work
```bash
grep -n "TODO\|FIXME\|HACK\|STUB\|NotYetImplemented\|for now\|placeholder" packages/cli/src/utils/sandbox.ts
# Expected: No new matches from this change
```

### 8. Requirements Traceability Matrix

| Requirement | Pseudocode | Test(s) | Implementation | Verified |
|-------------|-----------|---------|----------------|----------|
| R1.1 | Section A | P03 | P04 | [ ] |
| R1.2 | Section A | P03 | P04 | [ ] |
| R2.1 | Section B | P03 | P04 | [ ] |
| R3.1 | Section C | P05 | P06 | [ ] |
| R3.2 | Section C | P05 | P06 | [ ] |
| R3.3 | Section C | P05 | P06 | [ ] |
| R3.4 | Section C | P05 | P06 | [ ] |
| R3.5 | Section C | P05 | P06 | [ ] |
| R3.6 | Section C | P05 | P06 | [ ] |
| R3.7 | Section C | P05 | P06 | [ ] |
| R4.1 | Section D.1 | P08 | P09+P10 | [ ] |
| R4.2 | Section D.1 | P08 | P09+P10 | [ ] |
| R4.3 | Section D.1 | P08 | P09+P10 | [ ] |
| R4.4 | Section D.1 | P08 | P09+P10 | [ ] |
| R5.1 | Section D.2 | P08 | P09 | [ ] |
| R5.2 | Section D.2 | P08 | P09 | [ ] |
| R6.1 | Section D.3 | P08 | P09 | [ ] |
| R6.2 | Section D.3 | P08 | P09 | [ ] |
| R7.1 | Section D.4 | P08 | P09+P10 | [ ] |
| R7.2 | Section D.4 | P08 | P09 | [ ] |
| R7.3 | Section D.4 | P08 | P09 | [ ] |
| R7.4 | Section D.4 | P08 | P09 | [ ] |
| R7.5 | Section D.4 | P08 | P09 | [ ] |
| R7.6 | Section D.4 | P08 | P09 | [ ] |
| R7.7 | Section D.4 | P08 | P09 | [ ] |
| R7.8 | Section D.4 | P08 | P09 | [ ] |
| R7.9 | Section D.4 | P08 | P09+P10 | [ ] |
| R7.10 | Section D.4 | P08 | P09+P10 | [ ] |
| R7.11 | Section D.4 | P08 | P09 | [ ] |

### 9. Holistic Functionality Assessment
The verifier must write a documented assessment answering:
- What was implemented? (describe in own words)
- Does it satisfy the requirements? (cite specific code)
- What is the data flow? (trace one complete path)
- What could go wrong? (identify remaining risks)
- Verdict: PASS/FAIL with explanation

## Success Criteria
- Full test suite passes
- Lint, typecheck, format, build all pass
- Smoke test passes
- All requirements traceable to tests and implementation
- No deferred work patterns
- Holistic assessment written and verdict is PASS

## Phase Completion Marker
Create: `project-plans/issue1036/.completed/P11.md` with verification output.
