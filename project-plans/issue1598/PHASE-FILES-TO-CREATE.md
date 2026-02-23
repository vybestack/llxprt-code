# Phase Files to Create for PLAN-20260223-ISSUE1598

This document lists all phase files that need to be created following the PLAN-TEMPLATE.md structure.

---

## Pseudocode Files (analysis/pseudocode/)

These files contain numbered pseudocode that MUST be referenced in implementation phases.

### 1. proactive-renewal.md
**Purpose**: Numbered pseudocode for fixing `scheduleProactiveRenewal()` bug

**Content Requirements**:
- Line-by-line algorithm for checking token lifetime BEFORE expiry
- Correct condition: `remainingSec > 0 AND lifetime >= 300`
- Failure counter increment logic
- Timer cancellation on 3 failures
- Timer rescheduling on success

**Example Structure**:
```
10: FUNCTION scheduleProactiveRenewal(providerName, bucket, token)
11:   SET normalizedBucket = normalizeBucket(bucket)
12:   SET key = getProactiveRenewalKey(providerName, normalizedBucket)
13:   SET nowSec = Math.floor(Date.now() / 1000)
14:   SET remainingSec = token.expiry - nowSec
15:   SET lifetime = remainingSec
16:   SET leadSec = Math.floor(lifetime * 0.2)
17:   IF remainingSec <= 0 THEN
18:     LOG("Token already expired, cannot schedule renewal")
19:     RETURN
20:   ENDIF
21:   IF lifetime < 300 THEN
22:     LOG("Token lifetime too short for proactive renewal")
23:     RETURN
24:   ENDIF
25:   SET jitterSec = Math.floor(Math.random() * 60)
26:   SET refreshAtSec = nowSec + leadSec + jitterSec
27:   SET delayMs = (refreshAtSec - nowSec) * 1000
28:   CALL setProactiveTimer(providerName, normalizedBucket, delayMs, token.expiry)
29: END FUNCTION
```

### 2. bucket-classification.md
**Purpose**: Numbered pseudocode for classification logic (Pass 1 and part of Pass 2)

**Content Requirements**:
- Classification for 429 status
- Classification for expired tokens (with refresh attempt)
- Classification for null tokens
- Classification for token-store read errors
- Classification for already-tried buckets
- Classification for malformed tokens

**Example Structure**:
```
10: FUNCTION classifyBucket(bucket, context, triedSet, lastReasons)
11:   IF bucket IN triedSet THEN
12:     SET lastReasons[bucket] = "skipped"
13:     RETURN "skipped"
14:   ENDIF
15:   IF context.triggeringStatus === 429 THEN
16:     SET lastReasons[bucket] = "quota-exhausted"
17:     RETURN "quota-exhausted"
18:   ENDIF
19:   TRY
20:     SET token = AWAIT getOAuthToken(provider, bucket)
21:   CATCH error
22:     LOG WARN("Token read failed for bucket: " + error)
23:     SET lastReasons[bucket] = "no-token"
24:     RETURN "no-token"
25:   ENDTRY
26:   IF token === null THEN
27:     SET lastReasons[bucket] = "no-token"
28:     RETURN "no-token"
29:   ENDIF
30:   SET nowSec = Math.floor(Date.now() / 1000)
31:   SET remainingSec = token.expiry - nowSec
32:   IF remainingSec <= 0 THEN
33:     TRY
34:       SET refreshed = AWAIT refreshOAuthToken(provider, bucket)
35:       IF refreshed THEN
36:         RETURN "refresh-succeeded"
37:       ENDIF
38:     CATCH error
39:       LOG DEBUG("Refresh failed: " + error)
40:     ENDTRY
41:     SET lastReasons[bucket] = "expired-refresh-failed"
42:     RETURN "expired-refresh-failed"
43:   ENDIF
44:   RETURN "valid-token"
45: END FUNCTION
```

### 3. failover-handler.md
**Purpose**: Numbered pseudocode for `tryFailover()` three-pass algorithm

**Content Requirements**:
- Pass 1: Classify triggering bucket
- Pass 2: Find candidate with valid/refreshable token
- Pass 3: Foreground reauth for expired/missing tokens
- State management (clear lastFailoverReasons, update triedBucketsThisSession)
- setSessionBucket calls with error handling

**Example Structure**:
```
100: FUNCTION tryFailover(context?: FailoverContext): Promise<boolean>
101:   CLEAR lastFailoverReasons
102:   SET currentBucket = sessionBucket ?? buckets[0]
103:   
104:   // PASS 1: Classify triggering bucket
105:   SET reason = classifyBucket(currentBucket, context, triedBucketsThisSession, lastFailoverReasons)
106:   ADD currentBucket TO triedBucketsThisSession
107:   IF reason === "refresh-succeeded" THEN
108:     RETURN true
109:   ENDIF
110:   
111:   // PASS 2: Find candidate bucket
112:   FOR EACH bucket IN buckets (profile order)
113:     IF bucket IN triedBucketsThisSession THEN
114:       SET lastFailoverReasons[bucket] = "skipped"
115:       CONTINUE
116:     ENDIF
117:     SET reason = classifyBucket(bucket, {}, triedBucketsThisSession, lastFailoverReasons)
118:     IF reason === "valid-token" THEN
119:       SET sessionBucket = bucket
120:       TRY
121:         AWAIT setSessionBucket(provider, bucket)
122:       CATCH error
123:         LOG WARN("setSessionBucket failed: " + error)
124:       ENDTRY
125:       RETURN true
126:     ENDIF
127:     IF reason === "refresh-succeeded" THEN
128:       SET sessionBucket = bucket
129:       TRY
130:         AWAIT setSessionBucket(provider, bucket)
131:       CATCH error
132:         LOG WARN("setSessionBucket failed: " + error)
133:       ENDTRY
134:       RETURN true
135:     ENDIF
136:   ENDFOR
137:   
138:   // PASS 3: Foreground reauth
139:   SET candidateBucket = FIND first bucket WHERE
140:     (lastFailoverReasons[bucket] === "expired-refresh-failed" OR
141:      lastFailoverReasons[bucket] === "no-token") AND
142:     bucket NOT IN triedBucketsThisSession
143:   IF candidateBucket THEN
144:     TRY
145:       LOG INFO("Attempting foreground reauth for: " + candidateBucket)
146:       AWAIT authenticate(provider, candidateBucket)
147:       SET verifyToken = AWAIT getOAuthToken(provider, candidateBucket)
148:       IF verifyToken === null THEN
149:         LOG WARN("Reauth succeeded but token is null")
150:         SET lastFailoverReasons[candidateBucket] = "reauth-failed"
151:         ADD candidateBucket TO triedBucketsThisSession
152:       ELSE
153:         SET sessionBucket = candidateBucket
154:         TRY
155:           AWAIT setSessionBucket(provider, candidateBucket)
156:         CATCH error
157:           LOG WARN("setSessionBucket failed: " + error)
158:         ENDTRY
159:         RETURN true
160:       ENDIF
161:     CATCH error
162:       LOG WARN("Foreground reauth failed: " + error)
163:       SET lastFailoverReasons[candidateBucket] = "reauth-failed"
164:       ADD candidateBucket TO triedBucketsThisSession
165:     ENDTRY
166:   ENDIF
167:   
168:   LOG WARN("All buckets exhausted")
169:   RETURN false
170: END FUNCTION
```

### 4. error-reporting.md
**Purpose**: Numbered pseudocode for error reporting enhancements

**Content Requirements**:
- AllBucketsExhaustedError constructor update
- BucketFailureReason type definition
- RetryOrchestrator error construction

**Example Structure**:
```
10: TYPE BucketFailureReason =
11:   | "quota-exhausted"
12:   | "expired-refresh-failed"
13:   | "reauth-failed"
14:   | "no-token"
15:   | "skipped"
16:
17: CLASS AllBucketsExhaustedError EXTENDS Error
18:   CONSTRUCTOR(
19:     providerName: string,
20:     attemptedBuckets: string[],
21:     lastError: Error,
22:     bucketFailureReasons?: Record<string, BucketFailureReason>
23:   )
24:     SET this.providerName = providerName
25:     SET this.attemptedBuckets = attemptedBuckets
26:     SET this.lastError = lastError
27:     SET this.bucketFailureReasons = bucketFailureReasons ?? {}
28:     SET this.message = `All API key buckets exhausted for ${providerName}: ${attemptedBuckets.join(', ')}`
29:   END CONSTRUCTOR
30: END CLASS
31:
32: // In RetryOrchestrator error handling
33: FUNCTION constructExhaustedError(failoverHandler, lastError)
34:   SET reasons = failoverHandler.getLastFailoverReasons?.() ?? {}
35:   SET buckets = failoverHandler.getBuckets?.() ?? []
36:   SET providerName = getProviderName()
37:   RETURN NEW AllBucketsExhaustedError(providerName, buckets, lastError, reasons)
38: END FUNCTION
```

---

## Plan Phase Files (plan/)

All phase files follow the PLAN-TEMPLATE.md structure. Each file must include:
- Phase ID with `@plan:PLAN-20260223-ISSUE1598.P##` marker
- Prerequisites
- Requirements Implemented (expanded GIVEN/WHEN/THEN)
- Implementation Tasks (files to create/modify)
- Verification Commands (automated checks)
- Verification Checklist (manual checks)
- Success Criteria
- Failure Recovery

### Analysis Phases

#### 01-analysis.md
**Purpose**: Execute domain analysis, create domain-model.md

**Key Sections**:
- Read specification.md, technical.md, requirements.md
- Create entity definitions
- Define state transitions
- Document error scenarios
- Create invariants and business rules
- Output to `analysis/domain-model.md`

#### 01a-analysis-verification.md
**Purpose**: Verify domain-model.md completeness

**Checklist**:
- All entities documented with properties and states
- All state transitions have diagrams
- All error scenarios covered
- Invariants stated
- Business rules clear

---

### Pseudocode Phases

#### 02-pseudocode.md
**Purpose**: Create numbered pseudocode files for all components

**Key Sections**:
- Create `proactive-renewal.md` with numbered lines
- Create `bucket-classification.md` with numbered lines
- Create `failover-handler.md` with numbered lines
- Create `error-reporting.md` with numbered lines
- All pseudocode uses algorithmic steps (no TypeScript)
- Every line numbered for reference

#### 02a-pseudocode-verification.md
**Purpose**: Verify pseudocode completeness and correctness

**Checklist**:
- All files have numbered lines
- No TypeScript code (only algorithmic pseudocode)
- All error paths defined
- Algorithm covers all requirements
- Pseudocode matches domain model

---

### Classification Phases

#### 03-classification-stub.md
**Purpose**: Create classification method stubs in BucketFailoverHandlerImpl

**Implementation Tasks**:
- Add `lastFailoverReasons: Record<string, BucketFailureReason> = {}`
- Add stub `getLastFailoverReasons(): Record<string, BucketFailureReason> { return {}; }`
- Update `tryFailover()` to clear `lastFailoverReasons` at start
- Methods can throw `new Error('NotYetImplemented')` OR return empty values
- Maximum 50 lines total additions

**Required Markers**:
```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P03
 * @requirement REQ-1598-CL09
 */
private lastFailoverReasons: Record<string, BucketFailureReason> = {};
```

#### 03a-classification-stub-verification.md
**Purpose**: Verify stub compiles and structure correct

**Verification Commands**:
```bash
# Check plan markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P03" packages/cli/src/auth/
# Expected: 2+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: No errors

# No TODO comments
grep -r "TODO" packages/cli/src/auth/BucketFailoverHandlerImpl.ts
# Expected: No matches in production code
```

**Checklist**:
- [ ] `lastFailoverReasons` state variable added
- [ ] `getLastFailoverReasons()` stub method added
- [ ] Plan markers present
- [ ] TypeScript compiles
- [ ] No TODO comments

---

#### 04-classification-tdd.md
**Purpose**: Write comprehensive behavioral tests for classification logic

**Implementation Tasks**:
- Create tests for all 5 classification reasons
- Tests expect REAL behavior (e.g., actual token values)
- NO tests for NotYetImplemented
- NO reverse tests (expect().not.toThrow())
- Tests will fail naturally until implementation

**Required Test Structure**:
```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P04
 * @requirement REQ-1598-CL01
 * @scenario 429 status classification
 * @given Context with triggeringStatus = 429
 * @when tryFailover() is called
 * @then lastFailoverReasons[bucket] equals "quota-exhausted"
 */
it('classifies bucket as quota-exhausted when 429 status', async () => {
  // Arrange
  const context = { triggeringStatus: 429 };
  
  // Act
  await handler.tryFailover(context);
  
  // Assert
  const reasons = handler.getLastFailoverReasons();
  expect(reasons['default']).toBe('quota-exhausted');
});
```

**Test Categories**:
1. 429 status → quota-exhausted
2. Expired token + refresh fails → expired-refresh-failed
3. Expired token + refresh succeeds → immediate return true
4. getOAuthToken returns null → no-token
5. getOAuthToken throws error → no-token (logged)
6. Bucket already tried → skipped
7. Malformed token (missing expiry) → handle gracefully

**Property-based tests** (30% of tests):
```typescript
test.prop([fc.integer()])('handles any valid expiry timestamp', async (expiry) => {
  // Property: classification always returns valid BucketFailureReason
});
```

#### 04a-classification-tdd-verification.md
**Purpose**: Verify tests are behavioral and fail naturally

**Verification Commands**:
```bash
# No mock theater
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/auth/__tests__/
# Expected: No matches in classification tests

# No reverse testing
grep -r "toThrow('NotYetImplemented')\|expect.*not\.toThrow()" packages/cli/src/auth/__tests__/
# Expected: No matches

# Tests naturally fail
npm test -- packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts
# Expected: Tests fail with real errors (e.g., "Cannot read property...")
```

**Checklist**:
- [ ] 15-20 behavioral tests created
- [ ] 30%+ property-based tests
- [ ] No mock verification tests
- [ ] No reverse tests
- [ ] Tests fail naturally (not with NotYetImplemented message)
- [ ] All tests have plan markers and requirements

---

#### 05-classification-impl.md
**Purpose**: Implement classification logic following pseudocode

**Implementation Tasks**:
- Implement Pass 1 classification in `tryFailover()` (lines 10-42 from `bucket-classification.md`)
- Implement classification helpers (if needed)
- Reference pseudocode line numbers in comments:
  ```typescript
  // pseudocode lines 19-25: Attempt token read with error handling
  try {
    token = await this.oauthManager.getOAuthToken(this.provider, bucket);
  } catch (err) {
    logger.warn(`Token read failed for ${this.provider}/${bucket}:`, err);
    this.lastFailoverReasons[bucket] = 'no-token'; // pseudocode line 23
    return 'no-token';
  }
  ```
- All tests must pass
- No test modifications allowed

**Required Markers**:
```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P05
 * @requirement REQ-1598-CL01, REQ-1598-CL02, REQ-1598-CL03, REQ-1598-CL04
 * @pseudocode bucket-classification.md lines 10-44
 */
async tryFailover(context?: FailoverContext): Promise<boolean> {
  // Implementation...
}
```

#### 05a-classification-impl-verification.md
**Purpose**: Verify implementation works correctly

**Verification Commands**:
```bash
# All tests pass
npm test -- packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts
# Expected: All pass

# No test modifications
git diff packages/cli/src/auth/__tests__/
# Expected: No changes to test files

# Pseudocode followed
grep -r "pseudocode line" packages/cli/src/auth/BucketFailoverHandlerImpl.ts
# Expected: 5+ references to pseudocode lines

# Mutation testing
npx stryker run --mutate packages/cli/src/auth/BucketFailoverHandlerImpl.ts
# Expected: 80%+ mutation score
```

**Semantic Verification**:
- [ ] Feature actually works (manual test):
  - [ ] 429 status classified correctly
  - [ ] Expired tokens classified correctly
  - [ ] Missing tokens classified correctly
  - [ ] Token-store errors handled
- [ ] Integration with existing code (no breaks)
- [ ] All tests pass
- [ ] Mutation score >= 80%

---

### Error Reporting Phases (06-08a)

Similar structure to Classification phases:
- **06**: Stub (update AllBucketsExhaustedError, add BucketFailureReason type)
- **06a**: Stub verification
- **07**: TDD (test error construction with reasons)
- **07a**: TDD verification
- **08**: Implementation (add optional parameter, export type)
- **08a**: Implementation verification

---

### Foreground Reauth Phases (09-11a)

Similar structure:
- **09**: Stub (Pass 3 skeleton)
- **09a**: Stub verification
- **10**: TDD (reauth flow tests)
- **10a**: TDD verification
- **11**: Implementation (Pass 3 complete)
- **11a**: Implementation verification

---

### Proactive Renewal Phases (12-14a)

Similar structure:
- **12**: Stub (scheduleProactiveRenewal skeleton)
- **12a**: Stub verification
- **13**: TDD (renewal scheduling tests)
- **13a**: TDD verification
- **14**: Implementation (fix bug, add failure tracking)
- **14a**: Implementation verification

---

### Integration Phases (15-17a)

Similar structure:
- **15**: Stub (RetryOrchestrator wiring skeleton)
- **15a**: Stub verification
- **16**: TDD (end-to-end scenarios)
- **16a**: TDD verification
- **17**: Implementation (connect all components)
- **17a**: Implementation verification (full system test)

---

### Deprecation Phase (18-18a)

- **18**: Remove old code (if any), update docs
- **18a**: Final verification and smoke test

---

## Template Usage

Each phase file should follow this structure (from PLAN-TEMPLATE.md):

```markdown
# Phase [NN]: [Phase Title]

## Phase ID
`PLAN-20260223-ISSUE1598.P[NN]`

## Prerequisites
- Required: Phase [NN-1] completed
- Verification: `grep -r "@plan:PLAN-20260223-ISSUE1598.P[NN-1]" .`
- Expected files from previous phase: [list]
- Preflight verification (Phase 00a) completed

## Requirements Implemented (Expanded)

### REQ-1598-XXXX: [Requirement Title]
**Full Text**: [Copy requirement text from requirements.md]
**Behavior**:
- GIVEN: [precondition]
- WHEN: [action]
- THEN: [expected outcome]
**Why This Matters**: [user value explanation]

## Implementation Tasks

### Files to Create
- `path/to/file.ts` — [description]
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P[NN]`
  - MUST include: `@requirement:REQ-1598-XXXX`

### Files to Modify
- `path/to/existing.ts`
  - Line [N]: [change description]
  - ADD comment: `@plan:PLAN-20260223-ISSUE1598.P[NN]`
  - Implements: `@requirement:REQ-1598-XXXX`

### Required Code Markers
Every function/class/test created in this phase MUST include:
```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P[NN]
 * @requirement REQ-1598-XXXX
 * @pseudocode lines X-Y (if applicable)
 */
```

## Verification Commands

### Automated Checks
```bash
# [verification commands specific to this phase]
```

### Manual Verification Checklist
- [ ] [checklist item 1]
- [ ] [checklist item 2]
- ...

### Semantic Verification
- [ ] Feature actually works (tested manually)
- [ ] Integration with existing code successful
- [ ] No regressions

## Success Criteria
[Specific criteria for this phase]

## Failure Recovery
If this phase fails:
1. [recovery step 1]
2. [recovery step 2]
3. Do NOT proceed to Phase [NN+1] until fixed

## Phase Completion Marker
Create: `project-plans/issue1598/.completed/P[NN].md`
Contents: [completion details template]
```

---

## File Creation Priority

**Create in this order**:

1. **Pseudocode files** (analysis/pseudocode/*.md) — BEFORE any implementation
2. **Phase 03-05a** (Classification) — Foundation for failover logic
3. **Phase 06-08a** (Error Reporting) — Required for classification output
4. **Phase 09-11a** (Foreground Reauth) — Depends on classification
5. **Phase 12-14a** (Proactive Renewal) — Can be parallel with reauth
6. **Phase 15-17a** (Integration) — Connects everything
7. **Phase 18-18a** (Deprecation) — Final cleanup

---

## Automation Script (Optional)

To generate all phase files with templates:

```bash
#!/bin/bash
# generate-phases.sh

PLAN_ID="PLAN-20260223-ISSUE1598"
BASE_DIR="project-plans/issue1598/plan"

# Function to create a phase file with template
create_phase() {
  local phase_num=$1
  local phase_name=$2
  local file="${BASE_DIR}/${phase_num}-${phase_name}.md"
  
  cat > "$file" << EOF
# Phase ${phase_num}: ${phase_name}

## Phase ID
\`${PLAN_ID}.P${phase_num}\`

## Prerequisites
- Required: Phase [previous] completed
- Preflight verification (Phase 00a) completed

## Requirements Implemented
[List requirements with expanded GIVEN/WHEN/THEN]

## Implementation Tasks
[List files to create/modify with plan markers]

## Verification Commands
[Automated checks]

## Verification Checklist
- [ ] Plan markers present
- [ ] Requirements traced
- [ ] Tests pass / Feature works

## Success Criteria
[Phase-specific criteria]

## Failure Recovery
[Recovery steps]
EOF
  
  echo "Created: $file"
}

# Generate all phases
# (add calls for each phase)
create_phase "03" "classification-stub"
create_phase "03a" "classification-stub-verification"
# ... etc
```

---

## Notes

- **Total files to create**: ~46 (4 pseudocode + 38 phase files + 4 completion markers)
- **Estimated effort**: 3-5 days for experienced developer following TDD
- **Critical path**: Pseudocode → Classification → Error Reporting → Integration
- **Parallel work possible**: Proactive Renewal can be developed in parallel with Foreground Reauth

---

**Last Updated**: 2026-02-23  
**Status**: Ready for file generation
