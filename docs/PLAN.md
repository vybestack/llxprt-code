# 🗂️ Autonomous Plan-Creation Guide for Claude Workers

This document defines how to create foolproof implementation plans that prevent Claude fraud and ensure valid TDD implementations through autonomous worker execution.

---

## Core Principles

1. **TDD is MANDATORY** - Every line of production code must be written in response to a failing test
2. **Worker Isolation** - Each phase executed by fresh worker instance with clean context
3. **Architect-First** - All plans begin with architect-written specification
4. **Analysis Before Code** - Mandatory analysis/pseudocode phases before implementation
5. **Aggressive Verification** - Multi-layered fraud detection at every step

---

## Plan Structure

```
project-plans/<feature-slug>/
  specification.md           ← Architect-written specification
  analysis/                  ← Analysis artifacts
    domain-model.md
    pseudocode/
      component-001.md
      component-002.md
  plan/
    00-overview.md          ← Generated from specification
    01-analysis.md          ← Domain analysis phase
    01a-analysis-verification.md
    02-pseudocode.md        ← Pseudocode development
    02a-pseudocode-verification.md
    03-<feature>-stub.md    ← Feature implementation phases
    03a-<feature>-stub-verification.md
    04-<feature>-tdd.md
    04a-<feature>-tdd-verification.md
    05-<feature>-impl.md
    05a-<feature>-impl-verification.md
    ...
```

---

## Phase 0: Architect Specification (specification.md)

Written by architect worker BEFORE any implementation planning.

### Required Sections:

```markdown
# Feature Specification: <Name>

## Purpose

Clear statement of why this feature exists and what problem it solves.

## Architectural Decisions

- **Pattern**: (e.g., MVC, Event-Driven, Repository)
- **Technology Stack**: Specific versions and libraries
- **Data Flow**: How data moves through the system
- **Integration Points**: External systems/APIs

## Project Structure
```

src/
<module>/
types.ts # Type definitions
service.ts # Business logic
repository.ts # Data access
test/
<module>/
service.spec.ts
repository.spec.ts

````

## Technical Environment
- **Type**: CLI Tool | Web Service | IDE Extension | Library
- **Runtime**: Node.js 20.x | Browser | Electron
- **Dependencies**: List with exact versions

## Formal Requirements
[REQ-001] User Authentication
  [REQ-001.1] Email/password login with rate limiting
  [REQ-001.2] JWT tokens with 1hr expiry and refresh
  [REQ-001.3] Password reset via email token
  [REQ-001.4] Session tracking with Redis

## Data Schemas
```typescript
// User entity
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  passwordHash: z.string().min(60),
  createdAt: z.date(),
  updatedAt: z.date()
});

// API request/response
const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});
````

## Example Data

```json
{
  "validLogin": {
    "email": "user@example.com",
    "password": "SecurePass123!"
  },
  "invalidLogin": {
    "email": "user@example.com",
    "password": "wrong"
  }
}
```

## Constraints

- No external HTTP calls in unit tests
- All async operations must have timeouts
- Password hashing must use bcrypt with cost 12
- Database transactions for multi-table operations

## Performance Requirements

- Login endpoint: <200ms p95 latency
- Token validation: <10ms
- Concurrent users: 1000

````

---

## Phase 1: Analysis Phase

### Worker Launch:
```bash
claude --dangerously-skip-permissions -p "
Read specification.md and create detailed domain analysis.
Output to analysis/domain-model.md
Include:
- Entity relationships
- State transitions
- Business rules
- Edge cases
- Error scenarios
" &
````

### Verification Must Check:

- All REQ tags addressed
- No implementation details
- Complete edge case coverage
- Clear business rule definitions

---

## Phase 2: Pseudocode Phase

### Worker Launch:

```bash
claude --dangerously-skip-permissions -p "
Based on specification.md and analysis/domain-model.md,
create detailed pseudocode for each component.
Output to analysis/pseudocode/<component>.md
Include:
- Function signatures with types
- Algorithm steps
- Data transformations
- Error handling logic
DO NOT write actual TypeScript, only pseudocode
" &
```

### Verification Must Check:

- Pseudocode covers all requirements
- No actual implementation code
- Clear algorithm documentation
- All error paths defined

---

## Phase 3+: Implementation Cycles

Each feature follows strict 3-phase TDD cycle:

### A. Stub Phase

**Goal**: Create minimal skeleton that compiles

**Worker Prompt**:

```bash
claude --dangerously-skip-permissions -p "
Implement stub for <feature> based on:
- specification.md section <X>
- analysis/pseudocode/<component>.md

Requirements:
1. All methods throw new Error('NotYetImplemented')
2. Include all TypeScript interfaces from spec
3. Maximum 100 lines total
4. Must compile with strict TypeScript

Output status to workers/phase-03.json
"
```

**Verification MUST**:

- Grep for any logic beyond `throw new Error('NotYetImplemented')`
- Verify TypeScript compiles
- Check all exports match specification
- Fail if any actual implementation found

### B. TDD Phase

**CRITICAL**: This phase determines success/failure of implementation

**Worker Prompt**:

```bash
claude --dangerously-skip-permissions -p "
Write comprehensive BEHAVIORAL tests for <feature> based on:
- specification.md requirements [REQ-X]
- analysis/pseudocode/<component>.md
- Example data from specification

MANDATORY RULES:
1. Test ACTUAL BEHAVIOR with real data flows
2. NEVER test mock calls or internal implementation
3. Each test must transform INPUT → OUTPUT based on requirements
4. NO tests that just verify mocks were called
5. NO tests that only check object structure exists
6. Each test must have Behavior-Driven comment:
   /**
    * @requirement REQ-001.1
    * @scenario Valid user login
    * @given { email: 'user@example.com', password: 'Valid123!' }
    * @when loginUser() is called
    * @then Returns { success: true, token: JWT }
    * @and Token contains correct claims and expiry
    */

FORBIDDEN PATTERNS:
- expect(mockService.method).toHaveBeenCalled()
- expect(result).toHaveProperty('field')
- expect(() => fn()).not.toThrow()
- Tests that pass with empty implementations

Create 15-20 BEHAVIORAL tests covering:
- Input → Output transformations for each requirement
- State changes and side effects
- Error conditions with specific error types/messages
- Integration between components (real, not mocked)
- Performance assertions if specified

Output status to workers/phase-04.json
"
```

**Verification MUST**:

```bash
# Check for mock theater (sophisticated fraud)
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" test/ && echo "FAIL: Mock verification found"
grep -r "mockResolvedValue\|mockReturnValue" test/ | \
  xargs -I {} sh -c 'grep -l "expect.*toBe\|expect.*toEqual" {} && echo "FAIL: Circular mock test in {}"'

# Check for structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" test/ | \
  grep -v "with specific value" && echo "FAIL: Structure-only test found"

# Check for no-op verification
grep -r "not\.toThrow\|not\.toReject" test/ | \
  grep -v "specific error" && echo "FAIL: No-op error test found"

# Verify behavioral assertions
for test in $(find test -name "*.spec.ts"); do
  # Must have actual value assertions, not just structure
  grep -E "toBe\(|toEqual\(|toMatch\(|toContain\(" $test > /dev/null || \
    echo "FAIL: $test has no behavioral assertions"
done

# Verify requirement coverage with behavioral tests
for req in $(grep -o "REQ-[0-9.]*" specification.md); do
  # Check test has @requirement tag AND behavioral assertion
  grep -A 20 "@requirement $req" test/**/*.spec.ts | \
    grep -E "toBe\(|toEqual\(" > /dev/null || echo "MISSING BEHAVIOR: $req"
done

# Run behavioral verification tool
npm test -- --run | grep -E "(✓|×)" | wc -l  # Must have 15+ tests
npm test -- --run  # All must fail with NotYetImplemented

# Advanced: Check for test-implementation coupling
# Tests should test behavior, not implementation details
grep -r "private\|_internal\|#private" test/ && echo "FAIL: Testing private members"
```

### C. Implementation Phase

**Worker Prompt**:

```bash
claude --dangerously-skip-permissions -p "
Implement <feature> to make ALL tests pass.
Based on:
- Failing tests in test/<feature>
- analysis/pseudocode/<component>.md
- specification.md schemas and requirements

MANDATORY RULES:
1. Do NOT modify any existing tests
2. Implement EXACTLY what tests expect
3. Follow pseudocode algorithms precisely
4. Use schemas from specification.md
5. All tests must pass
6. No console.log or debug code
7. No TODO comments

Run 'npm test test/<feature>' and ensure all pass.
Output status to workers/phase-05.json
"
```

**Verification MUST**:

```bash
# All tests pass
npm test test/<feature> || exit 1

# No test modifications
git diff test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# No debug code
grep -r "console\.\|TODO\|FIXME\|XXX" src/

# Coverage check
npm test -- --coverage test/<feature>
# Parse coverage/coverage-summary.json for >90% line coverage

# Verify no mock/fake implementations
grep -r "mock\|fake\|stub\|\\[\\]\s*;\\|return\s*\[\]" src/ | \
  grep -v "test" && echo "WARNING: Possible fake implementation"
```

---

## Advanced Verification Patterns

### 1. Semantic Analysis

```bash
# Verify implementation matches pseudocode
claude --dangerously-skip-permissions -p "
Compare src/<feature> with analysis/pseudocode/<component>.md
Report any algorithmic differences to verification-report.txt
Check:
1. Function signatures match
2. Algorithm steps followed
3. Error handling implemented as designed
4. No shortcuts or simplifications
"
```

### 2. Integration Coherence

```bash
# Verify components work together
claude --dangerously-skip-permissions -p "
Analyze integration between implemented components.
Check:
1. Data flows correctly between modules
2. Error propagation works
3. Transaction boundaries respected
4. No resource leaks
Report to integration-analysis.txt
"
```

### 3. Sophisticated Fraud Pattern Detection

**Basic Fraud Patterns** (Easy to Detect):

```typescript
// FRAUD: Fake implementation
function processData(items: Item[]): Result[] {
  return []; // Returns empty instead of processing
}

// FRAUD: Test expecting stubs
it('should throw NotYetImplemented', () => {
  expect(() => service.method()).toThrow('NotYetImplemented');
});
```

**Sophisticated Fraud Patterns** (Harder to Detect):

```typescript
// FRAUD: Mock Theater - Test verifies mock configuration
it('should fetch user data', async () => {
  mockDb.getUser.mockResolvedValue({ id: '123', name: 'Test' });
  const result = await service.getUser('123');
  expect(result.name).toBe('Test'); // Just testing the mock!
});

// FRAUD: Structure Theater - Only verifies shape, not values
it('should return user profile', async () => {
  const result = await service.getUserProfile('123');
  expect(result).toHaveProperty('id');
  expect(result).toHaveProperty('name');
  expect(result).toHaveProperty('email');
  // Could return { id: null, name: null, email: null }
});

// FRAUD: No-Op Verification - Tests that don't test
it('should handle errors gracefully', async () => {
  const result = await service.processData([]);
  expect(() => result).not.toThrow();
  // Empty function would pass
});

// FRAUD: Implementation Testing - Tests internals not behavior
it('should process items correctly', () => {
  const spy = jest.spyOn(service, '_transformData');
  service.processItems([1, 2, 3]);
  expect(spy).toHaveBeenCalledWith([1, 2, 3]);
  expect(spy).toHaveReturnedWith(expect.any(Array));
});

// FRAUD: Mock-Only Integration - No real integration
it('should integrate with payment system', async () => {
  mockPayment.charge.mockResolvedValue({ success: true });
  mockEmail.send.mockResolvedValue({ sent: true });

  const result = await service.processOrder(order);

  expect(mockPayment.charge).toHaveBeenCalled();
  expect(mockEmail.send).toHaveBeenCalled();
  expect(result.success).toBe(true);
  // Never tests actual integration!
});
```

### 4. Behavioral Contract Verification

**Required**: TypeScript-based verification tools in `verification/` directory:

```typescript
// verification/behavioral-contract.ts
interface BehaviorProof {
  requirement: string; // REQ-001.1
  scenario: string; // "Valid user login"
  given: Record<string, any>; // Input data
  when: () => Promise<any>; // Action to execute
  then: {
    // Expected outcomes
    output?: any;
    stateChanges?: Record<string, any>;
    sideEffects?: string[];
  };
}

export async function verifyBehavior(
  test: TestCase,
  implementation: Function,
): Promise<ValidationResult> {
  // Extract behavior proof from test
  const proof = extractBehaviorProof(test);

  // Run implementation with real data
  const actualOutput = await implementation(proof.given);

  // Verify behavior matches specification
  if (!deepEqual(actualOutput, proof.then.output)) {
    return {
      valid: false,
      reason: `Output mismatch: expected ${proof.then.output}, got ${actualOutput}`,
    };
  }

  // Verify no mocks involved
  if (detectMockUsage(test)) {
    return {
      valid: false,
      reason: 'Test relies on mocks instead of real behavior',
    };
  }

  return { valid: true };
}

// verification/mock-theater-detector.ts
export function detectMockTheater(testFile: string): string[] {
  const violations: string[] = [];
  const ast = parseTypeScript(testFile);

  // Find mock setups
  const mockSetups = findMockSetups(ast);

  // Find assertions
  const assertions = findAssertions(ast);

  // Detect circular dependencies
  for (const assertion of assertions) {
    const mockValue = findMockValue(assertion, mockSetups);
    if (mockValue && assertionTestsMockValue(assertion, mockValue)) {
      violations.push(`Mock theater: test only verifies mock return value`);
    }
  }

  return violations;
}
```

### 5. Integration Test Requirements

**Mandatory for features with external dependencies**:

```bash
# verification/integration-validator.ts
export function validateIntegrationTests(testDir: string): ValidationResult {
  const integrationTests = glob.sync(`${testDir}/integration/**/*.spec.ts`);

  for (const testFile of integrationTests) {
    const content = fs.readFileSync(testFile, 'utf8');

    // Fail if mocks found in integration tests
    if (content.includes('jest.mock') || content.includes('mockImplementation')) {
      return {
        valid: false,
        reason: `Integration test ${testFile} contains mocks`
      };
    }

    // Verify real database/service usage
    if (!content.includes('TEST_DATABASE_URL') &&
        !content.includes('TEST_SERVICE_URL')) {
      return {
        valid: false,
        reason: `Integration test ${testFile} doesn't use real services`
      };
    }
  }

  return { valid: true };
}
```

### 6. Mutation Testing Requirements

```bash
# Add to verification phase
npm install --save-dev @stryker-mutator/core @stryker-mutator/typescript-checker

# stryker.conf.js must specify:
module.exports = {
  mutate: ['src/**/*.ts', '!src/**/*.spec.ts'],
  testRunner: 'vitest',
  thresholds: { high: 80, low: 60, break: 50 },
  reporters: ['json', 'html'],
  disableTypeChecks: false
};

# Verification must check mutation score
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
if (( $(echo "$MUTATION_SCORE < 80" | bc -l) )); then
  echo "FAIL: Mutation score $MUTATION_SCORE% is below 80%"
  exit 1
fi
```

### 7. Property-Based Testing Enforcement

```typescript
// At least 30% of tests must use property-based testing
// verification/property-test-validator.ts
export function validatePropertyTests(testDir: string): ValidationResult {
  const allTests = glob.sync(`${testDir}/**/*.spec.ts`);
  let totalTests = 0;
  let propertyTests = 0;

  for (const testFile of allTests) {
    const content = fs.readFileSync(testFile, 'utf8');
    const testCount = (content.match(/it\(/g) || []).length;
    const propertyTestCount = (content.match(/fc\.assert|fc\.property/g) || [])
      .length;

    totalTests += testCount;
    propertyTests += propertyTestCount;
  }

  const percentage = (propertyTests / totalTests) * 100;
  if (percentage < 30) {
    return {
      valid: false,
      reason: `Only ${percentage.toFixed(1)}% property-based tests (minimum 30%)`,
    };
  }

  return { valid: true };
}
```

---

## Worker Execution Protocol

### 1. Parallel Analysis

```bash
# Launch analysis workers in parallel
claude --dangerously-skip-permissions -p "Analyze domain..." &
claude --dangerously-skip-permissions -p "Create pseudocode for auth..." &
claude --dangerously-skip-permissions -p "Create pseudocode for user..." &
sleep 600
```

### 2. Sequential Implementation

```bash
# Each 3-phase cycle must complete before next
./execute-phase.sh 03 03a  # auth-stub + verification
./execute-phase.sh 04 04a  # auth-tdd + verification
./execute-phase.sh 05 05a  # auth-impl + verification

# Only then move to next feature
./execute-phase.sh 06 06a  # user-stub + verification
```

### 3. Enhanced Verification Gates

```bash
#!/bin/bash
# execute-phase.sh
PHASE=$1
VERIFICATION=$2

# Execute implementation
claude --dangerously-skip-permissions \
  -p "Execute plan/${PHASE}-*.md" &
WORKER_PID=$!
sleep 300

# Check completion
if ! wait $WORKER_PID; then
  echo "Implementation failed"
  exit 1
fi

# For TDD phase, run behavioral verification
if [[ "$PHASE" == *"-tdd"* ]]; then
  echo "Running behavioral test verification..."

  # Check for mock theater
  npx tsx verification/mock-theater-detector.ts test/
  [ $? -eq 0 ] || { echo "Mock theater detected"; exit 1; }

  # Validate behavioral contracts
  npx tsx verification/behavioral-contract.ts test/
  [ $? -eq 0 ] || { echo "Behavioral contracts invalid"; exit 1; }

  # Check integration tests if applicable
  if [ -d "test/integration" ]; then
    npx tsx verification/integration-validator.ts test/
    [ $? -eq 0 ] || { echo "Integration tests invalid"; exit 1; }
  fi

  # Run mutation testing
  npx stryker run
  MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
  if (( $(echo "$MUTATION_SCORE < 80" | bc -l) )); then
    echo "FAIL: Mutation score $MUTATION_SCORE% is below 80%"
    exit 1
  fi
fi

# Execute standard verification
claude --dangerously-skip-permissions \
  -p "Execute plan/${VERIFICATION}-*.md"

# Check verification passed
STATUS=$(jq -r .status workers/phase-${VERIFICATION}.json)
if [ "$STATUS" != "pass" ]; then
  echo "Verification failed"
  exit 1
fi
```

---

## Plan Creation Checklist

- [ ] Architect creates specification.md with all requirements
- [ ] Specification includes complete schemas and examples
- [ ] Analysis phase creates domain model and relationships
- [ ] Pseudocode phase details all algorithms
- [ ] Each feature broken into <5 file changes per phase
- [ ] TDD phase instructions emphasize REAL tests, not stubs
- [ ] Verification includes fraud detection patterns
- [ ] Verification checks all REQ tags covered
- [ ] Implementation phase references pseudocode
- [ ] No STOP phases - using async workers instead

---

## Example: Authentication Feature Plan

### Phase 03-05: Login Endpoint

```
03-auth-login-stub.md
03a-auth-login-stub-verification.md
04-auth-login-tdd.md      # 20 tests for login behavior
04a-auth-login-tdd-verification.md
05-auth-login-impl.md
05a-auth-login-impl-verification.md
```

### Phase 06-08: Token Management

```
06-auth-token-stub.md
06a-auth-token-stub-verification.md
07-auth-token-tdd.md      # 15 tests for JWT handling
07a-auth-token-tdd-verification.md
08-auth-token-impl.md
08a-auth-token-impl-verification.md
```

### Phase 09-11: Password Reset

```
09-auth-reset-stub.md
09a-auth-reset-stub-verification.md
10-auth-reset-tdd.md      # 18 tests for reset flow
10a-auth-reset-tdd-verification.md
11-auth-reset-impl.md
11a-auth-reset-impl-verification.md
```

---

## Success Metrics

A well-executed plan will have:

1. **Zero test modifications** between TDD and implementation phases
2. **>90% code coverage** from behavioral tests
3. **>80% mutation score** - tests kill most code mutations
4. **All REQ tags** covered by behavioral tests with actual assertions
5. **No mock theater** - tests verify real behavior, not mock returns
6. **No structure-only tests** - all tests assert actual values
7. **Integration tests use real services** - no mocks in integration layer
8. **30%+ property-based tests** - generative testing for edge cases
9. **Pseudocode match** between design and implementation
10. **Clean worker execution** with no context overflow

**Red Flags of Fraudulent Implementation**:

- Tests that only verify mocks were called
- Tests that only check properties exist
- Tests that pass with empty implementations
- Circular mock dependencies (mock returns X, test verifies X)
- No integration tests with real dependencies
- Low mutation score despite high coverage

Remember: The TDD phase is the most critical. Tests must prove behavior through actual data transformation, not mock verification. Time invested in comprehensive behavioral tests prevents all downstream issues.
