# Phase 00a: Preflight Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P00a`

## Prerequisites
- Required: Phase 00 completed
- Verification: `test -f project-plans/issue1385/plan/00-overview.md`
- Preflight verification: This phase is mandatory before any implementation phase (P03+).

## Requirements Implemented (Expanded)

### REQ-EN-001 / REQ-EN-002: Entry-Point Feasibility
**Full Text**: Feature must be reachable from `/continue` command and integrated dialog flow.
**Behavior**:
- GIVEN: current CLI command and dialog architecture
- WHEN: feasibility is verified
- THEN: call paths and required types are proven to exist before coding begins
**Why This Matters**: Prevents planning against non-existent interfaces.

### REQ-SW-001 / REQ-PR-001: Resume Swap Contract Feasibility
**Full Text**: Two-phase swap and centralized `performResume` orchestration must fit current code ownership.
**Behavior**:
- GIVEN: existing recording and lock lifecycle code
- WHEN: signatures and ownership are checked
- THEN: plan assumptions are validated or corrected before downstream phases

## Implementation Tasks

### Dependency Verification
| Dependency | Verification Command | Status |
|------------|---------------------|--------|
| React (Ink) | `npm ls ink --prefix packages/cli` | |
| Vitest | `npm ls vitest --prefix packages/core` | |
| fast-check | `npm ls fast-check --prefix packages/core` | |
| @testing-library/react | `npm ls @testing-library/react --prefix packages/cli` | |
| ink-testing-library | `npm ls ink-testing-library --prefix packages/cli` | |

### Type/Interface Verification
| Type Name | Expected Definition | Verification Command | Match? |
|-----------|---------------------|---------------------|--------|
| SessionSummary | sessionId, filePath, projectHash, provider, model, fileSize | `grep -A 25 "interface SessionSummary" packages/core/src/recording/types.ts` | |
| ResumeResult | ok:true payload includes history/metadata/recording/lockHandle/warnings | `grep -A 40 "interface ResumeResult" packages/core/src/recording/resumeSession.ts` | |
| SessionLockManager.isLocked | `(chatsDir, sessionId)` | `grep -A 10 "static async isLocked" packages/core/src/recording/SessionLockManager.ts` | |
| CommandContext | actual available fields (no assumptions) | `grep -A 80 "interface CommandContext" packages/cli/src/ui/commands/types.ts` | |
| OpenDialogActionReturn | dialog action shape | `grep -A 20 "OpenDialogActionReturn" packages/cli/src/ui/commands/types.ts` | |
| LoadHistoryActionReturn | history action shape | `grep -A 20 "LoadHistoryActionReturn" packages/cli/src/ui/commands/types.ts` | |

### Call-Path Verification
| Function | Expected Caller | Verification Command | Evidence |
|----------|-----------------|----------------------|----------|
| DialogManager renders dialogs | UIState boolean gates | `grep -A 20 "DialogManager" packages/cli/src/ui/components/DialogManager.tsx` | |
| slashCommandProcessor handles dialog actions | `case 'dialog'` branch | `grep -A 30 "case 'dialog'" packages/cli/src/ui/hooks/slashCommandProcessor.ts` | |
| BuiltinCommandLoader registers `/continue` | command registration list | `grep -A 40 "registerBuiltinCommands" packages/cli/src/services/BuiltinCommandLoader.ts` | |
| Recording integration swap feasibility | current owner of recordingIntegration | `grep -n "recordingIntegration" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx` | |

### Test-Infrastructure Verification
| Component | Test Location | Verification Command |
|-----------|--------------|---------------------|
| Session discovery tests | packages/core/src/recording | `find packages/core/src/recording -name "*SessionDiscovery*test*"` |
| CLI command tests | packages/cli/src/ui/commands | `find packages/cli/src/ui/commands -name "*.spec.ts" -o -name "*.spec.ts"` |
| Hook/component tests | packages/cli/src/ui | `find packages/cli/src/ui -name "*session*test*" -o -name "*session*spec*"` |

### Blocking-Issue Capture
- Fill this section with concrete deltas between assumptions and real code signatures.

## Verification Commands
```bash
# Sanity: phase file exists
 test -f project-plans/issue1385/plan/00a-preflight-verification.md

# Signature checks
grep -A 10 "static async isLocked" packages/core/src/recording/SessionLockManager.ts
grep -A 80 "interface CommandContext" packages/cli/src/ui/commands/types.ts
grep -A 30 "case 'dialog'" packages/cli/src/ui/hooks/slashCommandProcessor.ts

# Resume core types
grep -A 80 "export async function resumeSession" packages/core/src/recording/resumeSession.ts
```

## Deferred Implementation Detection
```bash
# Preflight phase should not modify production source code
# (except if explicitly documenting discovered blockers)
git diff --name-only
# Expected: planning/docs files only
```

## Feature Actually Works
For preflight, “works” means assumptions are verified and blockers are explicitly documented.

Manual command:
```bash
git diff --name-only | rg -v "^project-plans/issue1385/"
```
Expected: no non-plan files changed during preflight documentation.

### Semantic Verification Questions (YES required)
1. YES/NO — Did we verify actual `SessionLockManager.isLocked` signature is `(chatsDir, sessionId)`?
2. YES/NO — Did we verify current recording ownership to avoid false React-state swap assumptions?
3. YES/NO — Did we verify actual `CommandContext` fields instead of planned/guessed fields?
4. YES/NO — Did we verify dialog action and load-history action return shapes at usage sites?
5. YES/NO — Are all discovered mismatches captured as blockers or plan corrections?

## Integration Points Verified
- Dialog pipeline: command -> slashCommandProcessor -> DialogManager.
- Resume pipeline: command path -> performResume -> load-history action.
- Recording ownership boundary: gemini/AppContainer integration points.

## Success Criteria
- Dependency, type, call-path, and test-infra checks are completed with evidence.
- Any mismatch is explicitly recorded and propagated into later phases.
- No implementation begins until this gate is passed.

## Failure Recovery
If preflight checks fail:
1. Document concrete blocker(s) in this phase file.
2. Update downstream phase assumptions before proceeding.
3. Re-run verification commands until all semantic questions are YES.

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P00a.md`

Contents:
```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Blocking Issues Found: [list]
Verification Evidence: [commands + findings]
Approved to proceed: YES/NO
```
