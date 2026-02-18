# Phase 33: Final Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P33`

## Prerequisites

- Required: ALL previous phases completed (P00a through P32a)
- Verification:
  ```bash
  for phase in P00a P01 P01a P02 P02a P03 P03a P04 P04a P05 P05a P06 P06a P07 P07a P08 P08a P09 P09a P10 P10a P11 P11a P12 P12a P13 P13a P14 P14a P15 P15a P16 P16a P17 P17a P18 P18a P19 P19a P20 P20a P21 P21a P22 P22a P23 P23a P24 P24a P25 P25a P26 P26a P27 P27a P28 P28a P29 P29a P30 P30a P31 P31a P32 P32a; do
    test -f "project-plans/issue1385/.completed/$phase.md" && echo "$phase: OK" || echo "$phase: MISSING"
  done
  ```

## Purpose

This phase does NOT introduce any new code. It is a comprehensive cross-cutting verification that:
1. Every requirement from the specification is implemented
2. Every component is integrated (no isolated code)
3. The full test suite passes
4. Code quality gates pass (lint, typecheck, format, build)
5. The feature actually works end-to-end

## 1. Full Test Suite

```bash
# Run ALL tests
npm run test
# Expected: ALL PASS, 0 failures

# Capture test count
npm run test 2>&1 | grep "Tests:" | tail -1
# Expected: Significant increase over baseline
```

## 2. TypeScript Compilation

```bash
npm run typecheck
# Expected: Pass with no errors
```

## 3. Lint

```bash
npm run lint
# Expected: Clean
```

## 4. Format Check

```bash
npm run format
# Expected: No files modified (all already formatted)
```

## 5. Build

```bash
npm run build
# Expected: Clean build
```

## 6. Smoke Test

```bash
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: Completes successfully, generates a haiku
```

## 7. Requirements Traceability

Verify every requirement has at least one `@requirement` marker in the codebase:

```bash
# Session Browser — Listing & Display
for req in REQ-SB-001 REQ-SB-002 REQ-SB-003 REQ-SB-004 REQ-SB-005 REQ-SB-006 REQ-SB-007 REQ-SB-008 REQ-SB-009 REQ-SB-010 REQ-SB-011 REQ-SB-012 REQ-SB-013 REQ-SB-014 REQ-SB-015 REQ-SB-016 REQ-SB-017 REQ-SB-018 REQ-SB-019 REQ-SB-020 REQ-SB-021 REQ-SB-023 REQ-SB-024 REQ-SB-025 REQ-SB-026; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Preview Loading
for req in REQ-PV-001 REQ-PV-002 REQ-PV-003 REQ-PV-004 REQ-PV-005 REQ-PV-006 REQ-PV-007 REQ-PV-008 REQ-PV-009 REQ-PV-010; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Search
for req in REQ-SR-001 REQ-SR-002 REQ-SR-003 REQ-SR-004 REQ-SR-005 REQ-SR-006 REQ-SR-007 REQ-SR-008 REQ-SR-009 REQ-SR-010 REQ-SR-011 REQ-SR-012 REQ-SR-013 REQ-SR-014; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Sort
for req in REQ-SO-001 REQ-SO-002 REQ-SO-003 REQ-SO-004 REQ-SO-005 REQ-SO-006 REQ-SO-007; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Pagination
for req in REQ-PG-001 REQ-PG-002 REQ-PG-003 REQ-PG-004 REQ-PG-005; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Keyboard Navigation & Modes
for req in REQ-KN-001 REQ-KN-002 REQ-KN-003 REQ-KN-004 REQ-KN-005 REQ-KN-006 REQ-KN-007; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Selection & Detail
for req in REQ-SD-001 REQ-SD-002 REQ-SD-003; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Resume Flow
for req in REQ-RS-001 REQ-RS-002 REQ-RS-003 REQ-RS-004 REQ-RS-005 REQ-RS-006 REQ-RS-007 REQ-RS-008 REQ-RS-009 REQ-RS-010 REQ-RS-011 REQ-RS-012 REQ-RS-013 REQ-RS-014; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Delete Flow
for req in REQ-DL-001 REQ-DL-002 REQ-DL-003 REQ-DL-004 REQ-DL-005 REQ-DL-006 REQ-DL-007 REQ-DL-008 REQ-DL-009 REQ-DL-010 REQ-DL-011 REQ-DL-012 REQ-DL-013 REQ-DL-014; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Escape Key Precedence
for req in REQ-EP-001 REQ-EP-002 REQ-EP-003 REQ-EP-004; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Modal Priority Stack
for req in REQ-MP-001 REQ-MP-002 REQ-MP-003 REQ-MP-004; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Lock Status
for req in REQ-LK-001 REQ-LK-002 REQ-LK-003 REQ-LK-004 REQ-LK-005 REQ-LK-006; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# /continue Slash Command
for req in REQ-RC-001 REQ-RC-002 REQ-RC-003 REQ-RC-004 REQ-RC-005 REQ-RC-006 REQ-RC-007 REQ-RC-008 REQ-RC-009 REQ-RC-010 REQ-RC-011 REQ-RC-012 REQ-RC-013; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Recording Service Swap
for req in REQ-SW-001 REQ-SW-002 REQ-SW-003 REQ-SW-004 REQ-SW-005 REQ-SW-006 REQ-SW-007 REQ-SW-008; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# IContent Conversion
for req in REQ-CV-001 REQ-CV-002; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Stats Session Section
for req in REQ-ST-001 REQ-ST-002 REQ-ST-003 REQ-ST-004 REQ-ST-005 REQ-ST-006; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# --resume Flag Removal
for req in REQ-RR-001 REQ-RR-002 REQ-RR-003 REQ-RR-004 REQ-RR-005 REQ-RR-006 REQ-RR-007 REQ-RR-008; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Responsive — Wide Mode
for req in REQ-RW-001 REQ-RW-002 REQ-RW-003 REQ-RW-004 REQ-RW-005 REQ-RW-006 REQ-RW-007; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Responsive — Narrow Mode
for req in REQ-RN-001 REQ-RN-002 REQ-RN-003 REQ-RN-004 REQ-RN-005 REQ-RN-006 REQ-RN-007 REQ-RN-008 REQ-RN-009 REQ-RN-010 REQ-RN-011 REQ-RN-012 REQ-RN-013; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Relative Time Formatting
for req in REQ-RT-001 REQ-RT-002 REQ-RT-003 REQ-RT-004; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Error Handling
for req in REQ-EH-001 REQ-EH-002 REQ-EH-003 REQ-EH-004 REQ-EH-005; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Dialog Integration
for req in REQ-DI-001 REQ-DI-002 REQ-DI-003 REQ-DI-004 REQ-DI-005 REQ-DI-006; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Entry Points
for req in REQ-EN-001 REQ-EN-002 REQ-EN-003 REQ-EN-004 REQ-EN-005 REQ-EN-006; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# Session Recording Metadata
for req in REQ-SM-001 REQ-SM-002 REQ-SM-003; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# performResume Utility
for req in REQ-PR-001 REQ-PR-002 REQ-PR-003 REQ-PR-004 REQ-PR-005; do
  count=$(grep -r "@requirement:$req" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$req: $count"
done
# Expected: Each ≥ 1
```

## 8. Plan Marker Traceability

```bash
# Every phase should have at least one @plan marker
for phase in P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16 P17 P18 P19 P20 P21 P22 P23 P24 P25 P26 P27 P28 P29 P30 P31 P32; do
  count=$(grep -r "@plan PLAN-20260214-SESSIONBROWSER.$phase" packages/ --include="*.ts" --include="*.tsx" | wc -l)
  echo "$phase: $count"
done
# Expected: Each ≥ 1
```

## 9. Integration Completeness

### No Isolated Code

```bash
# Every new file must be imported/used by at least one other file
for file in \
  packages/cli/src/ui/hooks/useSessionBrowser.ts \
  packages/cli/src/ui/components/SessionBrowserDialog.tsx \
  packages/cli/src/ui/commands/continueCommand.ts \
  packages/cli/src/services/performResume.ts \
  packages/cli/src/utils/formatRelativeTime.ts \
  packages/cli/src/ui/commands/formatSessionSection.ts \
  packages/cli/src/ui/types/SessionRecordingMetadata.ts \
  packages/core/src/recording/SessionDiscovery.ts; do
  base=$(basename "$file" | sed 's/\.[^.]*$//')
  count=$(grep -r "$base" packages/ --include="*.ts" --include="*.tsx" | grep -v "$file" | wc -l)
  echo "$base imported by $count other files"
done
# Expected: Each ≥ 1
```

### Old Code Removed

```bash
# --resume flag should be gone
grep -rn "\.option('resume'" packages/cli/src/config/config.ts
# Expected: 0 matches

grep -rn "args\.resume" packages/cli/src/
# Expected: 0 matches

grep -rn "RESUME_LATEST" packages/cli/src/utils/sessionUtils.ts
# Expected: 0 matches

grep -rn "class SessionSelector" packages/cli/src/utils/sessionUtils.ts
# Expected: 0 matches

grep -rn "SessionSelectionResult" packages/cli/src/utils/sessionUtils.ts
# Expected: 0 matches
```

### Preserved Code Still Works

```bash
# --continue still defined
grep -n "\.option('continue'" packages/cli/src/config/config.ts
# Expected: 1 match

# --list-sessions still defined
grep -n "list-sessions" packages/cli/src/config/config.ts
# Expected: 1+ matches

# --delete-session still defined
grep -n "delete-session" packages/cli/src/config/config.ts
# Expected: 1+ matches

# SessionInfo still exported
grep -n "export.*SessionInfo" packages/cli/src/utils/sessionUtils.ts
# Expected: 1 match

# getSessionFiles still exported
grep -n "export.*getSessionFiles" packages/cli/src/utils/sessionUtils.ts
# Expected: 1 match

# getAllSessionFiles still exported
grep -n "export.*getAllSessionFiles" packages/cli/src/utils/sessionUtils.ts
# Expected: 1 match
```

## 10. No Deferred Implementation

```bash
# Scan all new/modified files for TODO/FIXME/STUB markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" \
  packages/cli/src/ui/hooks/useSessionBrowser.ts \
  packages/cli/src/ui/components/SessionBrowserDialog.tsx \
  packages/cli/src/ui/commands/continueCommand.ts \
  packages/cli/src/services/performResume.ts \
  packages/cli/src/utils/formatRelativeTime.ts \
  packages/cli/src/ui/commands/formatSessionSection.ts \
  packages/cli/src/ui/types/SessionRecordingMetadata.ts \
  2>/dev/null
# Expected: 0 matches

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" \
  packages/cli/src/ui/hooks/useSessionBrowser.ts \
  packages/cli/src/ui/components/SessionBrowserDialog.tsx \
  packages/cli/src/ui/commands/continueCommand.ts \
  packages/cli/src/services/performResume.ts \
  2>/dev/null
# Expected: 0 matches
```

## 11. Final Feature Walkthrough

### Manual Verification Scenarios

1. **`/continue` opens browser** — User types `/continue`, browser dialog appears with session list
2. **Search works** — User types in search field, list filters in real time
3. **Sort works** — User presses `s` in nav mode, sort cycles (newest → oldest → size)
4. **Pagination works** — With 21+ sessions, PgUp/PgDn navigate pages
5. **Resume from browser works** — User selects session, presses Enter, session is resumed
6. **Delete from browser works** — User presses Delete, confirms with Y, session is deleted
7. **`/continue latest` works** — Directly resumes the most recent unlocked session
8. **`/continue <id>` works** — Directly resumes a specific session by ID
9. **`/stats` shows session info** — Session ID, start time, file size, resumed status
10. **`--resume` flag removed** — `llxprt --help` does not show `--resume`/`-r`
11. **`--continue` still works** — `llxprt --continue` resumes last session at startup

## Success Criteria

- [ ] All automated tests pass (npm run test)
- [ ] TypeScript compiles (npm run typecheck)
- [ ] Lint clean (npm run lint)
- [ ] Format clean (npm run format)
- [ ] Build succeeds (npm run build)
- [ ] Smoke test passes (node scripts/start.js ...)
- [ ] Every requirement has at least one @requirement marker
- [ ] Every phase has at least one @plan marker
- [ ] No isolated code (all new files imported)
- [ ] Old code removed (--resume flag, RESUME_LATEST, SessionSelector)
- [ ] Preserved code intact (--continue, --list-sessions, SessionInfo, getSessionFiles)
- [ ] No deferred implementation markers

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P33.md`
Contents:
```markdown
Phase: P33
Completed: YYYY-MM-DD HH:MM
Total Tests: [count]
Total Requirements Covered: [count]
Build: [PASS/FAIL]
Lint: [PASS/FAIL]
TypeCheck: [PASS/FAIL]
Smoke Test: [PASS/FAIL]
Verification: COMPLETE
```

This marks the completion of `PLAN-20260214-SESSIONBROWSER`.
