# Structural Audit Review: issue1385 Implementation Plan

## Scope
Audited plan structure against `dev-docs/PLAN-TEMPLATE.md` requirements and compared overall rigor with `issue1361` reference artifacts.

Checked phase files:
- `project-plans/issue1385/plan/00-overview.md`
- `project-plans/issue1385/plan/00a-preflight-verification.md`
- `project-plans/issue1385/plan/01-analysis.md`
- `project-plans/issue1385/plan/01a-analysis-verification.md`
- `project-plans/issue1385/plan/02-pseudocode.md`
- `project-plans/issue1385/plan/02a-pseudocode-verification.md`
- `project-plans/issue1385/plan/03-relative-time-formatter-stub.md`
- `project-plans/issue1385/plan/03a-relative-time-formatter-stub-verification.md`
- `project-plans/issue1385/plan/04-relative-time-formatter-tdd.md`
- `project-plans/issue1385/plan/04a-relative-time-formatter-tdd-verification.md`
- `project-plans/issue1385/plan/05-relative-time-formatter-impl.md`
- `project-plans/issue1385/plan/05a-relative-time-formatter-impl-verification.md`
- `project-plans/issue1385/plan/06-session-discovery-extensions-stub.md`
- `project-plans/issue1385/plan/06a-session-discovery-extensions-stub-verification.md`
- `project-plans/issue1385/plan/07-session-discovery-extensions-tdd.md`
- `project-plans/issue1385/plan/07a-session-discovery-extensions-tdd-verification.md`
- `project-plans/issue1385/plan/08-session-discovery-extensions-impl.md`
- `project-plans/issue1385/plan/08a-session-discovery-extensions-impl-verification.md`
- `project-plans/issue1385/plan/09-perform-resume-stub.md`
- `project-plans/issue1385/plan/09a-perform-resume-stub-verification.md`
- `project-plans/issue1385/plan/10-perform-resume-tdd.md`
- `project-plans/issue1385/plan/10a-perform-resume-tdd-verification.md`
- `project-plans/issue1385/plan/11-perform-resume-impl.md`
- `project-plans/issue1385/plan/11a-perform-resume-impl-verification.md`
- `project-plans/issue1385/plan/12-use-session-browser-stub.md`
- `project-plans/issue1385/plan/12a-use-session-browser-stub-verification.md`
- `project-plans/issue1385/plan/13-use-session-browser-tdd.md`
- `project-plans/issue1385/plan/13a-use-session-browser-tdd-verification.md`
- `project-plans/issue1385/plan/14-use-session-browser-impl.md`
- `project-plans/issue1385/plan/14a-use-session-browser-impl-verification.md`
- `project-plans/issue1385/plan/15-session-browser-dialog-stub.md`
- `project-plans/issue1385/plan/15a-session-browser-dialog-stub-verification.md`
- `project-plans/issue1385/plan/16-session-browser-dialog-tdd.md`
- `project-plans/issue1385/plan/16a-session-browser-dialog-tdd-verification.md`
- `project-plans/issue1385/plan/17-session-browser-dialog-impl.md`
- `project-plans/issue1385/plan/17a-session-browser-dialog-impl-verification.md`
- `project-plans/issue1385/plan/18-continue-command-stub.md`
- `project-plans/issue1385/plan/18a-continue-command-stub-verification.md`
- `project-plans/issue1385/plan/19-continue-command-tdd.md`
- `project-plans/issue1385/plan/19a-continue-command-tdd-verification.md`
- `project-plans/issue1385/plan/20-continue-command-impl.md`
- `project-plans/issue1385/plan/20a-continue-command-impl-verification.md`
- `project-plans/issue1385/plan/21-integration-wiring-stub.md`
- `project-plans/issue1385/plan/21a-integration-wiring-stub-verification.md`
- `project-plans/issue1385/plan/22-integration-wiring-tdd.md`
- `project-plans/issue1385/plan/22a-integration-wiring-tdd-verification.md`
- `project-plans/issue1385/plan/23-integration-wiring-impl.md`
- `project-plans/issue1385/plan/23a-integration-wiring-impl-verification.md`
- `project-plans/issue1385/plan/24-stats-session-section-stub.md`
- `project-plans/issue1385/plan/24a-stats-session-section-stub-verification.md`
- `project-plans/issue1385/plan/25-stats-session-section-tdd.md`
- `project-plans/issue1385/plan/25a-stats-session-section-tdd-verification.md`
- `project-plans/issue1385/plan/26-stats-session-section-impl.md`
- `project-plans/issue1385/plan/26a-stats-session-section-impl-verification.md`
- `project-plans/issue1385/plan/27-legacy-cleanup-stub.md`
- `project-plans/issue1385/plan/27a-legacy-cleanup-stub-verification.md`
- `project-plans/issue1385/plan/28-legacy-cleanup-tdd.md`
- `project-plans/issue1385/plan/28a-legacy-cleanup-tdd-verification.md`
- `project-plans/issue1385/plan/29-legacy-cleanup-impl.md`
- `project-plans/issue1385/plan/29a-legacy-cleanup-impl-verification.md`
- `project-plans/issue1385/plan/30-e2e-integration-stub.md`
- `project-plans/issue1385/plan/30a-e2e-integration-stub-verification.md`
- `project-plans/issue1385/plan/31-e2e-integration-tdd.md`
- `project-plans/issue1385/plan/31a-e2e-integration-tdd-verification.md`
- `project-plans/issue1385/plan/32-e2e-integration-impl.md`
- `project-plans/issue1385/plan/32a-e2e-integration-impl-verification.md`
- `project-plans/issue1385/plan/33-final-verification.md`

Also reviewed:
- `project-plans/issue1385/analysis/domain-model.md`
- `project-plans/issue1385/analysis/pseudocode/*.md`
- `project-plans/issue1385/execution-tracker.md`
- `project-plans/issue1361/*` reference files listed in request

---

## Template Compliance Matrix (required sections)

Required per phase (10 items):
1. Phase ID
2. Prerequisites with verification command
3. Requirements Implemented (Expanded) with GIVEN/WHEN/THEN
4. Implementation Tasks with file paths + @plan/@requirement/@pseudocode markers
5. Verification Commands (structural + semantic)
6. Deferred Implementation Detection
7. Feature Actually Works (manual test)
8. Integration Points Verified
9. Success Criteria + Failure Recovery
10. Phase Completion Marker

### High-level finding
The issue1385 plan set is **partially compliant** in spirit (broad sequencing, many phase files exist), but **not structurally compliant** with the strict PLAN-TEMPLATE contract on a per-file basis. The most common gaps are:
- Missing explicit **Phase ID** block
- Missing or under-specified **Prerequisites + verification command**
- Missing fully expanded **Requirements Implemented** with complete **GIVEN/WHEN/THEN** in each phase
- Missing explicit **Implementation Tasks** with required marker directives (`@plan`, `@requirement`, `@pseudocode`)
- Missing formal **Deferred Implementation Detection** command block
- Missing explicit **Feature Actually Works** manual command + expected/actual placeholders
- Missing explicit **Integration Points Verified** checklist
- Missing explicit **Success Criteria + Failure Recovery** sections
- Missing explicit **Phase Completion Marker** creation instruction

---

## Per-file structural findings

> Legend: [ERROR] missing, WARNING: partial/implicit, [OK] explicit present

### 00-overview.md
- 1 Phase ID: [ERROR]
- 2 Prerequisites+verify cmd: WARNING:
- 3 Requirements Expanded G/W/T: [ERROR]
- 4 Implementation Tasks + markers: [ERROR]
- 5 Verification commands (structural+semantic): WARNING:
- 6 Deferred impl detection: [ERROR]
- 7 Feature actually works manual test: [ERROR]
- 8 Integration points verified: [ERROR]
- 9 Success criteria + failure recovery: WARNING:
- 10 Phase completion marker: [ERROR]

### 00a-preflight-verification.md
- 1: WARNING:
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: WARNING:
- 10: [ERROR]

### 01-analysis.md
- 1: [ERROR]
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 01a-analysis-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 02-pseudocode.md
- 1: [ERROR]
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 02a-pseudocode-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 03-relative-time-formatter-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING: (marker requirements not consistently explicit)
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 03a-relative-time-formatter-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 04-relative-time-formatter-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 04a-relative-time-formatter-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 05-relative-time-formatter-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 05a-relative-time-formatter-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 06-session-discovery-extensions-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 06a-session-discovery-extensions-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 07-session-discovery-extensions-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 07a-session-discovery-extensions-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 08-session-discovery-extensions-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 08a-session-discovery-extensions-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 09-perform-resume-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 09a-perform-resume-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 10-perform-resume-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 10a-perform-resume-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 11-perform-resume-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 11a-perform-resume-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 12-use-session-browser-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 12a-use-session-browser-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 13-use-session-browser-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 13a-use-session-browser-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 14-use-session-browser-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 14a-use-session-browser-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 15-session-browser-dialog-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 15a-session-browser-dialog-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 16-session-browser-dialog-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 16a-session-browser-dialog-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 17-session-browser-dialog-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 17a-session-browser-dialog-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 18-continue-command-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 18a-continue-command-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 19-continue-command-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 19a-continue-command-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 20-continue-command-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 20a-continue-command-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 21-integration-wiring-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 21a-integration-wiring-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 22-integration-wiring-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 22a-integration-wiring-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 23-integration-wiring-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 23a-integration-wiring-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 24-stats-session-section-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 24a-stats-session-section-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 25-stats-session-section-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 25a-stats-session-section-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 26-stats-session-section-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 26a-stats-session-section-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 27-legacy-cleanup-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 27a-legacy-cleanup-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 28-legacy-cleanup-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 28a-legacy-cleanup-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 29-legacy-cleanup-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 29a-legacy-cleanup-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 30-e2e-integration-stub.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 30a-e2e-integration-stub-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 31-e2e-integration-tdd.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 31a-e2e-integration-tdd-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: [ERROR]
- 7: [ERROR]
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 32-e2e-integration-impl.md
- 1: WARNING:
- 2: WARNING:
- 3: WARNING:
- 4: WARNING:
- 5: WARNING:
- 6: [ERROR]
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 32a-e2e-integration-impl-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: [ERROR]
- 10: [ERROR]

### 33-final-verification.md
- 1: [ERROR]
- 2: WARNING:
- 3: [ERROR]
- 4: [ERROR]
- 5: WARNING:
- 6: WARNING:
- 7: WARNING:
- 8: WARNING:
- 9: WARNING:
- 10: [ERROR]

---

## Aggregate missing-section report

Across all phase files in issue1385 plan:

- Missing explicit **Phase ID** blocks: widespread (majority of files)
- Missing explicit **Prerequisites with grep verification command**: widespread
- Missing fully expanded requirement sections with consistent **GIVEN/WHEN/THEN**: widespread
- Missing explicit implementation task section with mandatory marker instructions (`@plan`, `@requirement`, `@pseudocode`): widespread
- Missing dedicated **Deferred Implementation Detection** command set: nearly universal
- Missing explicit **Feature Actually Works** manual test block (with command + expected + actual placeholders): nearly universal
- Missing explicit **Integration Points Verified** checklist: widespread
- Missing explicit **Success Criteria** and **Failure Recovery** per phase: widespread
- Missing explicit **Phase Completion Marker** instructions (`.completed/Pxx.md`): nearly universal

---

## Comparison to issue1361 reference quality

Relative to issue1361 examples, issue1385 plan appears:
- Comparable in having many phase documents and a tracker
- Weaker in strict template conformance and enforceable verification scaffolding
- Less explicit in semantic-proof requirements (manual test evidence, integration boundary checks)
- Less operationally safe due to weak failure-recovery and completion-marker discipline

In short: **issue1385 is materially below template-grade rigor required by `PLAN-TEMPLATE.md` and below issue1361’s stronger structural consistency.**

---

## Recommended remediation (structural only)

1. Normalize every phase file to template headings exactly.
2. Add explicit `Phase ID` for each phase and subphase.
3. Add prerequisite verification grep command to every phase.
4. Expand each requirement inline with full text and G/W/T.
5. For each implementation phase, include concrete file paths and required marker tags.
6. Add mandatory deferred-implementation grep checks to all impl and verification phases.
7. Add manual “Feature Actually Works” command with expected/actual capture fields.
8. Add integration-point checklist and lifecycle/edge-case checklist per template.
9. Add per-phase success criteria and rollback/failure-recovery commands.
10. Add explicit `.completed/Pxx.md` creation instruction for each phase.

---

## Final verdict

**FAIL (structural):** The current issue1385 plan corpus does not meet the mandatory per-phase structure defined in `dev-docs/PLAN-TEMPLATE.md`.

This is a structural audit only; no semantic implementation correctness judgment is implied beyond plan-document quality.