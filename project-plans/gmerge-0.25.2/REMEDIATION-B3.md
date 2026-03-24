# Remediation Plan: B3 - TestRig Enhancements (REVISED)

## Decision: Option B - Verify External Package First

Based on review, we will FIRST verify if `@vybestack/llxprt-code-test-utils` already implements upstream behavior. Only if it doesn't match will we implement Option A.

## Verification Checklist for Option B

### Step 1: Check Package Implementation
```bash
# Check if package exports TestRig with required methods
npm show @vybestack/llxprt-code-test-utils
# Look for: InteractiveRun, TestRig, runWithTimeout, cleanup
```

### Step 2: Required API Parity Matrix
| Feature | Upstream | Package | Match? |
|---------|----------|---------|--------|
| InteractiveRun class | Yes | ? | |
| TestRig class | Yes | ? | |
| runWithTimeout() | Yes | ? | |
| SIGTERM→SIGKILL escalation | Yes | ? | |
| Exit state tracking | Yes | ? | |
| Cleanup method | Yes | ? | |
| Default timeout 30s | Yes | ? | |
| Graceful kill timeout 5s | Yes | ? | |

### Step 3: Behavior Verification Tests
Create tests that verify:
1. Long-running child gets SIGTERM then SIGKILL after graceful timeout
2. Child exits before kill attempt - no error thrown
3. Spawn failure surfaces actionable error
4. Multiple concurrent runs tracked and cleaned
5. Repeated cleanup does not throw
6. Wall-clock timeout works (not inactivity timeout)
7. stdout/stderr preserved on timeout
8. No orphaned processes after test suite

### Step 4: Decision Logic
- If all features match → Option B complete, just document
- If any feature missing → Proceed to Option A implementation

## Option A Implementation (Only if Option B Fails)

### Files to Modify
1. `integration-tests/test-helper.ts` - Add concrete implementation
2. `integration-tests/test-helper.test.ts` - Add tests

### Contract Requirements
```typescript
interface InteractiveRunOptions {
  timeout?: number;  // default 30000ms
  gracefulKillTimeout?: number;  // default 5000ms
}

interface InteractiveRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

class InteractiveRun {
  async run(
    command: string,
    args: string[],
    options?: InteractiveRunOptions
  ): Promise<InteractiveRunResult>;
  
  async kill(gracefulTimeout?: number): Promise<void>;
  
  get pid(): number | undefined;
  get exitCode(): number | null;
  get killed(): boolean;
}

class TestRig {
  private runs: Set<InteractiveRun> = new Set();
  
  async runWithTimeout(
    command: string,
    args: string[],
    options?: InteractiveRunOptions
  ): Promise<InteractiveRunResult>;
  
  async cleanup(): Promise<void>;  // Idempotent
  
  private trackRun(run: InteractiveRun): void;
  private async gracefulKill(pid: number, timeout: number): Promise<void>;
}
```

### Platform Handling
- Darwin/Linux: Standard SIGTERM/SIGKILL
- Windows: Use taskkill with /T flag for process tree

### Error Handling
- ESRCH (no such process): Treat as already exited, no error
- EPERM (permission denied): Throw actionable error
- Spawn failure: Include command and errno in error message

## Acceptance Criteria
- [ ] Option B verification complete with evidence
- [ ] If Option A: All contract methods implemented
- [ ] If Option A: Tests pass demonstrating upstream behavior
- [ ] If Option A: No orphaned processes after tests
- [ ] API surface preserved for existing consumers

## Copyright
New files: Vybestack LLC, 2026
