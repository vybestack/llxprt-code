# Phase 02: Domain Analysis

## Phase ID

`PLAN-20260211-SECURESTORE.P02`

## Prerequisites

- Required: Phase 01 (Preflight) completed
- Verification: `.completed/P01.md` exists with all checkboxes checked
- Preflight verification: Phase 01 MUST be completed before this phase

## Requirements Implemented (Expanded)

### R7A.1: Behavioral Delta Audit

**Full Text**: Before the four existing store implementations are refactored, the semantic differences between them (naming conventions, serialization, retry/fallback triggers, error handling) shall be audited and documented. Intentional behavioral differences shall be preserved in the thin wrappers; unintentional differences shall be resolved.

**Behavior**:
- GIVEN: Four existing store implementations exist
- WHEN: The analysis phase executes
- THEN: A documented audit of behavioral differences is produced

**Why This Matters**: Without understanding the semantic differences, refactoring to SecureStore could break existing consumers in subtle ways.

## Implementation Tasks

### Files to Create

- `analysis/domain-model.md` — Entity relationships, state transitions, business rules, edge cases, error scenarios
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P02`

### Analysis Work Required

#### 1. Behavioral Delta Audit (R7A.1)

Read each of the four existing implementations and document:

| Aspect | ToolKeyStorage | KeychainTokenStorage | FileTokenStorage | ExtensionSettingsStorage |
|--------|---------------|---------------------|-----------------|------------------------|
| Naming | service/account | sanitizeServerName | N/A | extension display name |
| Serialization | raw strings | JSON.stringify | JSON map | raw strings |
| Fallback trigger | any error | delegates to Hybrid | N/A | none |
| Error handling | swallow + console.warn | throw | throw | silent undefined |
| Probe caching | permanent | permanent | N/A | no probe |
| keytar loading | own copy | own copy + module-level | N/A | own copy + module-level |

**Files to read:**
```bash
cat packages/core/src/tools/tool-key-storage.ts
cat packages/core/src/mcp/token-storage/keychain-token-storage.ts
cat packages/core/src/mcp/token-storage/file-token-storage.ts
cat packages/core/src/mcp/token-storage/hybrid-token-storage.ts
cat packages/cli/src/config/extensions/settingsStorage.ts
```

#### 2. Entity Relationship Analysis

Map relationships between SecureStore, consumers, and external systems.

#### 3. State Transition Analysis

Document keyring availability states, CRUD decision flow, and command parsing states.

#### 4. Edge Case Enumeration

List all edge cases from requirements: concurrent access, mid-session unavailability, disk full, legacy files, etc.

#### 5. Error Scenario Mapping

Map all error conditions to the taxonomy codes defined in R6.1.

### Required Code Markers

All analysis artifacts MUST include:
```markdown
<!-- @plan PLAN-20260211-SECURESTORE.P02 -->
```

## Verification Commands

### Automated Checks

```bash
# Check analysis directory exists
ls analysis/domain-model.md
# Expected: file exists

# Check plan marker
grep -r "PLAN-20260211-SECURESTORE.P02" analysis/
# Expected: 1+ occurrences

# Check behavioral delta audit
grep -i "behavioral.*delta\|delta.*audit\|naming.*serialization\|ToolKeyStorage.*KeychainTokenStorage" analysis/domain-model.md
# Expected: audit section present
```

### Structural Verification Checklist

- [ ] `domain-model.md` exists
- [ ] Entity relationships documented
- [ ] State transitions documented
- [ ] Business rules enumerated
- [ ] Edge cases listed
- [ ] Error scenarios mapped to taxonomy
- [ ] Behavioral delta audit completed (R7A.1)
- [ ] Plan marker present

### Semantic Verification Checklist (MANDATORY)

1. **Does the analysis cover all requirements?**
   - [ ] Read the requirements.md (93 requirements)
   - [ ] Verify each is addressed in domain model or edge cases
2. **Is the behavioral delta audit complete?**
   - [ ] All four implementations compared
   - [ ] Intentional vs unintentional differences classified
3. **Are edge cases comprehensive?**
   - [ ] Concurrent access scenarios
   - [ ] Keyring unavailability scenarios
   - [ ] File corruption scenarios
   - [ ] Legacy data scenarios

## Success Criteria

- Domain model covers all requirement groups (R1-R27)
- Behavioral delta audit classifies all differences
- Edge cases address all error conditions from R6.1

## Failure Recovery

If this phase fails:
1. `rm -rf analysis/domain-model.md`
2. Re-run Phase 02 with corrected analysis

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P02.md`
Contents:
```markdown
Phase: P02
Completed: [timestamp]
Files Created: analysis/domain-model.md
Verification: [paste outputs]
```
