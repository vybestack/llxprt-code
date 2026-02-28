# Reimplement Plan: Hook command injection fix (upstream 41a1a3eed1) WARNING: CRITICAL SECURITY

> **TEST BASELINE: There are ZERO pre-existing test failures (809 test files, 12,824 tests, all passing). Any test failure after implementation is caused by your changes and MUST be fixed before the batch is complete. Do not skip, defer, or assume failures are pre-existing.**


## Upstream Change
**CRITICAL SECURITY FIX**: Sanitizes hook command expansion to prevent shell injection via environment variables. When `$GEMINI_PROJECT_DIR` contains shell metacharacters (e.g., `; rm -rf /`), they must be properly escaped.

## LLxprt Files to Modify
- packages/core/src/utils/shell-utils.ts — Create new utility with escapeShellArg and getShellConfiguration
- packages/core/src/utils/shell-utils.test.ts — Test-first: Write failing security tests BEFORE implementing
- packages/core/src/hooks/hookRunner.ts — Use shell utilities, escape variable expansion, spawn without shell
- packages/core/src/hooks/hookRunner.test.ts — Add injection prevention tests, update existing tests

## MANDATORY TDD WORKFLOW

**CRITICAL SECURITY REQUIRES EXPLICIT RED → GREEN CYCLE**

This is a security vulnerability fix. Tests demonstrating the injection vectors MUST be written first and MUST fail (showing the vulnerability exists) before implementing the fix.

### Phase 1: RED - Write Failing Security Tests FIRST

Write tests that DEMONSTRATE the security vulnerability. These tests MUST FAIL initially with NotYetImplemented errors, proving the vulnerability exists and the fix is not yet in place.

**MANDATE**: Run tests after each file creation. Confirm RED (tests fail because injection vectors succeed). Capture failure output as evidence.

### Phase 2: GREEN - Implement Sanitization Fix

Implement the security fix (escapeShellArg, shell configuration, hookRunner integration). Tests from Phase 1 MUST now PASS, proving injection is blocked.

**MANDATE**: Run tests after implementation. Confirm GREEN (injection blocked). Capture success output as evidence.

### Phase 3: Full Verification + Manual Security Testing

Run full test suite, typecheck, lint, format, build, synthetic test, AND manual security verification with REAL malicious payloads in actual hooks.

## Steps

### PHASE 1 (RED): Write Failing Security Tests FIRST

**Objective**: Demonstrate that shell injection is currently possible (vulnerability exists).

#### Step 1a: Create shell-utils stub with NotYetImplemented

Create `packages/core/src/utils/shell-utils.ts`:
   ```typescript
   /**
    * Shell utilities for safe command execution
    */

   class NotYetImplemented extends Error {
     constructor(feature: string) {
       super(`Not yet implemented: ${feature}`);
     }
   }

   export type ShellType = 'bash' | 'powershell';

   export interface ShellConfiguration {
     executable: string;
     argsPrefix: string[];
     shell: ShellType;
   }

   export function escapeShellArg(arg: string, shellType: ShellType): string {
     throw new NotYetImplemented('escapeShellArg');
   }

   export function getShellConfiguration(): ShellConfiguration {
     throw new NotYetImplemented('getShellConfiguration');
   }
   ```

#### Step 1b: Create shell-utils.test.ts with FAILING security tests

Create `packages/core/src/utils/shell-utils.test.ts` that tests EXPECTED secure behavior (which doesn't exist yet):
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { escapeShellArg, getShellConfiguration } from './shell-utils.js';

   describe('shell-utils - SECURITY TESTS (RED phase - expect failures)', () => {
     describe('escapeShellArg', () => {
       /**
        * SECURITY TEST: Shell metacharacters must be escaped
        * GIVEN: Input contains shell command injection sequence "; rm -rf /"
        * WHEN: escapeShellArg is called for bash
        * THEN: Result must wrap entire input in single quotes, preventing execution
        * @requirement: Prevent shell injection via metacharacters
        */
       it('should escape shell metacharacters in bash (SECURITY)', () => {
         const malicious = 'test; rm -rf /';
         const result = escapeShellArg(malicious, 'bash');
         
         // SECURITY: Must be wrapped in single quotes to prevent "; rm -rf /" from executing
         expect(result).toBe("'test; rm -rf /'");
         
         // Verify metacharacters are neutralized (not interpreted as commands)
         expect(result).not.toContain('; rm');
         expect(result.startsWith("'")).toBe(true);
         expect(result.endsWith("'")).toBe(true);
       });

       /**
        * SECURITY TEST: Single quotes must be escaped to prevent quote breaking
        * GIVEN: Input contains single quote that could break out of quote wrapping
        * WHEN: escapeShellArg is called for bash
        * THEN: Single quote must be escaped as ''' to prevent breakout
        * @requirement: Prevent quote-breakout injection
        */
       it('should escape single quotes in bash (SECURITY)', () => {
         const quoteBreakin = "test'string";
         const result = escapeShellArg(quoteBreakin, 'bash');
         
         // SECURITY: Bash escapes single quotes as '''
         expect(result).toBe("'test'\''string'");
         
         // Original single quote must not appear unescaped
         expect(result).not.toBe("'test'string'");
       });

       /**
        * SECURITY TEST: Command substitution must be neutralized
        * GIVEN: Input contains $(whoami) command substitution
        * WHEN: escapeShellArg is called for bash
        * THEN: Command substitution must be treated as literal string
        * @requirement: Prevent command substitution injection
        */
       it('should neutralize command substitution in bash (SECURITY)', () => {
         const cmdSub = 'test$(whoami)path';
         const result = escapeShellArg(cmdSub, 'bash');
         
         // SECURITY: Must wrap in quotes, preventing substitution
         expect(result).toBe("'test$(whoami)path'");
         expect(result.startsWith("'")).toBe(true);
       });

       /**
        * SECURITY TEST: Backtick command execution must be neutralized
        * GIVEN: Input contains `ls` backtick command execution
        * WHEN: escapeShellArg is called for bash
        * THEN: Backticks must be treated as literal string
        * @requirement: Prevent backtick command injection
        */
       it('should neutralize backtick execution in bash (SECURITY)', () => {
         const backtick = 'test`ls`path';
         const result = escapeShellArg(backtick, 'bash');
         
         // SECURITY: Must wrap in quotes, preventing execution
         expect(result).toBe("'test`ls`path'");
       });

       /**
        * SECURITY TEST: PowerShell single quotes must be escaped differently
        * GIVEN: Input contains single quote for PowerShell
        * WHEN: escapeShellArg is called for powershell
        * THEN: Single quote must be escaped as '' (doubled)
        * @requirement: PowerShell-specific quote escaping
        */
       it('should escape single quotes in powershell (SECURITY)', () => {
         const quoteBreakin = "test'string";
         const result = escapeShellArg(quoteBreakin, 'powershell');
         
         // SECURITY: PowerShell escapes single quotes by doubling them
         expect(result).toBe("'test''string'");
       });

       /**
        * SECURITY TEST: Empty string must be safely handled
        * GIVEN: Empty string input
        * WHEN: escapeShellArg is called
        * THEN: Must return empty quotes to prevent command injection via concatenation
        * @requirement: Safe handling of edge cases
        */
       it('should handle empty string (SECURITY)', () => {
         const result = escapeShellArg('', 'bash');
         expect(result).toBe("''");
       });
     });

     describe('getShellConfiguration', () => {
       /**
        * SECURITY TEST: Must return valid shell configuration
        * WHEN: getShellConfiguration is called
        * THEN: Must return executable, argsPrefix, and shell type
        * @requirement: Platform-specific shell configuration
        */
       it('should return bash config on unix (SECURITY)', () => {
         const config = getShellConfiguration();
         if (process.platform !== 'win32') {
           expect(config.executable).toBe('/bin/bash');
           expect(config.argsPrefix).toEqual(['-c']);
           expect(config.shell).toBe('bash');
         }
       });

       it('should return powershell config on windows (SECURITY)', () => {
         const config = getShellConfiguration();
         if (process.platform === 'win32') {
           expect(config.executable).toBe('powershell.exe');
           expect(config.argsPrefix).toEqual(['-Command']);
           expect(config.shell).toBe('powershell');
         }
       });
     });
   });
   ```

#### Step 1c: Add injection prevention test to hookRunner.test.ts

Add to `packages/core/src/hooks/hookRunner.test.ts` (WILL FAIL initially):
   ```typescript
   /**
    * SECURITY TEST: Command injection via LLXPRT_PROJECT_DIR
    * GIVEN: HookInput.cwd contains shell injection payload "; echo pwned"
    * WHEN: Hook command uses $LLXPRT_PROJECT_DIR variable
    * THEN: Injection payload must be escaped, not executed
    * @requirement: Prevent shell injection via environment variable expansion
    */
   it('should not allow command injection via LLXPRT_PROJECT_DIR (SECURITY - RED phase)', async () => {
     const maliciousCwd = '/test/project; echo "pwned" > /tmp/pwned';
     const mockMaliciousInput: HookInput = {
       ...mockInput,
       cwd: maliciousCwd,
     };

     const config: HookConfig = {
       type: HookType.Command,
       command: 'ls $LLXPRT_PROJECT_DIR',
     };

     mockSpawn.mockProcessOn.mockImplementation(
       (event: string, callback: (code: number) => void) => {
         if (event === 'close') {
           setImmediate(() => callback(0));
         }
       },
     );

     await hookRunner.executeHook(
       config,
       HookEventName.BeforeTool,
       mockMaliciousInput,
     );

     // SECURITY: If secure, spawn will be called with escaped command
     // The malicious "; echo pwned" must appear as LITERAL TEXT, not executed
     expect(spawn).toHaveBeenCalledWith(
       expect.stringMatching(/bash|powershell/),
       expect.arrayContaining([
         // Command must contain escaped version of malicious path
         expect.stringMatching(/ls ['"].*echo.*pwned.*/),
       ]),
       expect.objectContaining({ 
         shell: false,  // CRITICAL: shell must be false
       }),
     );
   });
   ```

#### Step 1d: RUN TESTS - CONFIRM RED (Tests MUST fail)

**CRITICAL**: This step PROVES the vulnerability exists. Tests MUST fail with NotYetImplemented errors.

```bash
# Run shell-utils tests - EXPECT FAILURES
cd packages/core && npx vitest run src/utils/shell-utils.test.ts 2>&1 | tee /tmp/shell-utils-red-evidence.txt

# Run hookRunner injection test - EXPECT FAILURE
cd packages/core && npx vitest run src/hooks/hookRunner.test.ts -t "should not allow command injection" 2>&1 | tee /tmp/hookrunner-red-evidence.txt

# Verify failures
echo "=== SHELL-UTILS RED EVIDENCE ==="
grep -E "FAIL|●|expected|received|NotYetImplemented" /tmp/shell-utils-red-evidence.txt | head -30

echo "=== HOOKRUNNER RED EVIDENCE ==="
grep -E "FAIL|●|expected|received|NotYetImplemented" /tmp/hookrunner-red-evidence.txt | head -30
```

**MANDATORY VERIFICATION**:
- [ ] Tests executed
- [ ] All tests FAILED
- [ ] Failure messages show NotYetImplemented errors
- [ ] Evidence captured in /tmp/*-red-evidence.txt files
- [ ] Red evidence proves injection vectors currently succeed (vulnerability exists)

**DO NOT PROCEED TO PHASE 2 UNTIL ALL ABOVE VERIFIED. This is RED phase - FAILURES ARE REQUIRED.**

---

### PHASE 2 (GREEN): Implement Security Fix

**Objective**: Make the RED tests pass by implementing proper sanitization.

Replace stub implementation in `packages/core/src/utils/shell-utils.ts`:

   ```typescript
   /**
    * Shell utilities for safe command execution
    */

   export type ShellType = 'bash' | 'powershell';

   export interface ShellConfiguration {
     executable: string;
     argsPrefix: string[];
     shell: ShellType;
   }

   /**
    * Escapes a shell argument to prevent injection
    * 
    * SECURITY: Uses single-quote wrapping to prevent metacharacter interpretation.
    * - Bash: Single quotes prevent all expansion. Escape embedded quotes as '\''
    * - PowerShell: Single quotes prevent expansion. Escape embedded quotes by doubling ''
    */
   export function escapeShellArg(arg: string, shellType: ShellType): string {
     if (shellType === 'powershell') {
       // PowerShell: use single quotes and escape single quotes within
       return `'${arg.replace(/'/g, "''")}'`;
     } else {
       // Bash/sh: use single quotes and escape single quotes as '\''
       return `'${arg.replace(/'/g, "'\\''")}'`;
     }
   }

   /**
    * Gets shell configuration for current platform
    * 
    * SECURITY: Returns explicit shell executable and args to use with shell: false
    */
   export function getShellConfiguration(): ShellConfiguration {
     const isWindows = process.platform === 'win32';
     
     if (isWindows) {
       return {
         executable: 'powershell.exe',
         argsPrefix: ['-Command'],
         shell: 'powershell',
       };
     } else {
       return {
         executable: '/bin/bash',
         argsPrefix: ['-c'],
         shell: 'bash',
       };
     }
   }
   ```

**A. Add imports**:
```typescript
import {
  escapeShellArg,
  getShellConfiguration,
  type ShellType,
} from '../utils/shell-utils.js';
```

**B. Update executeCommandHook** (around line 201):
```typescript
private async executeCommandHook(
  hookConfig: HookConfig,
  eventName: HookEventName,
  input: HookInput,
  signal: AbortSignal,
): Promise<HookExecutionResult> {
  const startTime = Date.now();

  try {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // SECURITY: Get platform-specific shell configuration
    const shellConfig = getShellConfiguration();
    
    // SECURITY: Expand command with escaped variables
    const command = this.expandCommand(
      hookConfig.command,
      input,
      shellConfig.shell,
    );

    // Set up environment variables
    const env = {
      ...process.env,
      LLXPRT_PROJECT_DIR: input.cwd,
      CLAUDE_PROJECT_DIR: input.cwd, // For compatibility
    };

    // SECURITY: Use explicit shell executable with shell: false
    // This prevents Node's shell interpretation layer
    const child = spawn(
      shellConfig.executable,
      [...shellConfig.argsPrefix, command],
      {
        env,
        cwd: input.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,  // CRITICAL: must be false to prevent injection
      },
    );

    // ... rest of implementation (keep existing stream handling)
```

**C. Update expandCommand method** (around line 353):
```typescript
/**
 * Expand command with environment variables and input context
 * 
 * SECURITY: All variable values are escaped before substitution to prevent injection
 */
private expandCommand(
  command: string,
  input: HookInput,
  shellType: ShellType,
): string {
  debugLogger.debug(`Expanding hook command: ${command} (cwd: ${input.cwd})`);
  
  // SECURITY: Escape the cwd value to prevent shell injection
  const escapedCwd = escapeShellArg(input.cwd, shellType);
  
  return command
    .replace(/\$LLXPRT_PROJECT_DIR/g, () => escapedCwd)
    .replace(/\$GEMINI_PROJECT_DIR/g, () => escapedCwd)  // Legacy support
    .replace(/\$CLAUDE_PROJECT_DIR/g, () => escapedCwd); // For compatibility
}
```

**A. Update existing tests** to expect bash/powershell invocation:
Find tests checking spawn arguments and update expectations:
```typescript
// OLD (direct command execution):
expect(spawn).toHaveBeenCalledWith(
  '/test/project/hooks/test.sh',
  [],
  expect.any(Object)
);

// NEW (shell wrapper execution):
expect(spawn).toHaveBeenCalledWith(
  expect.stringMatching(/\/bin\/bash|powershell\.exe/),
  expect.arrayContaining([
    expect.stringMatching(/-c|-Command/),
    expect.stringContaining('/test/project/hooks/test.sh'),
  ]),
  expect.objectContaining({
    shell: false,  // CRITICAL: verify shell is false
    env: expect.objectContaining({
      LLXPRT_PROJECT_DIR: '/test/project',
      CLAUDE_PROJECT_DIR: '/test/project',
    }),
  }),
);
```

**B. Update timing in all tests** (makes tests faster and more reliable):
- Replace `setTimeout(..., 10)` with `setImmediate(...)`
- Replace `setTimeout(..., 20)` with `setImmediate(...)`

**C. Update command extraction in execution order test**:
```typescript
// Extract command from shell args instead of command directly
const args = vi.mocked(spawn).mock.calls[executionOrder.length][1] as string[];
const command = args[args.length - 1];  // Last arg is the command string
executionOrder.push(command);
```

#### Step 2d: RUN TESTS - CONFIRM GREEN (Tests MUST pass now)

**CRITICAL**: This step PROVES the fix works. All RED tests from Phase 1 MUST now be GREEN.

```bash
# Run shell-utils tests - EXPECT SUCCESS
cd packages/core && npx vitest run src/utils/shell-utils.test.ts 2>&1 | tee /tmp/shell-utils-green-evidence.txt

# Run hookRunner tests - EXPECT SUCCESS
cd packages/core && npx vitest run src/hooks/hookRunner.test.ts 2>&1 | tee /tmp/hookrunner-green-evidence.txt

# Verify all tests pass
echo "=== SHELL-UTILS GREEN EVIDENCE ==="
grep -E "PASS|Test Files.*passed|passed|[OK]" /tmp/shell-utils-green-evidence.txt

echo "=== HOOKRUNNER GREEN EVIDENCE ==="
grep -E "PASS|Test Files.*passed|passed|[OK]" /tmp/hookrunner-green-evidence.txt
```

**MANDATORY VERIFICATION**:
- [ ] Tests executed
- [ ] ALL tests PASSED (shell-utils and hookRunner)
- [ ] No NotYetImplemented errors
- [ ] Evidence captured in /tmp/*-green-evidence.txt files
- [ ] Green evidence proves injection vectors are now blocked (fix works)
- [ ] Specifically: "should not allow command injection" test now PASSES

**This is GREEN phase - ALL TESTS MUST PASS. If any fail, fix implementation and re-run until green.**

---

### PHASE 3: Full Verification & Manual Security Testing

**Objective**: Prove the fix works in isolation AND in the full system, including real-world attack scenarios.

#### Step 3a: Run full core package test suite

```bash
cd packages/core && npx vitest run
```

**MANDATORY**: All tests must pass. Zero failures.

#### Step 3b: TypeScript type checking

```bash
npm run typecheck
```

**MANDATORY**: Zero TypeScript errors. Strict mode compliance verified.

#### Step 3c: Linting

```bash
npm run lint
```

**MANDATORY**: Zero linting warnings or errors.

#### Step 3d: Code formatting

```bash
npm run format
```

**MANDATORY**: Code auto-formatted to project standards.

#### Step 3e: Full project test suite

```bash
npm run test
```

**MANDATORY**: All tests across all packages pass.

#### Step 3f: Build verification

```bash
npm run build
```

**MANDATORY**: Clean build with no errors.

#### Step 3g: Synthetic runtime test

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

**MANDATORY**: Application starts and executes successfully.

#### Step 3h: MANUAL SECURITY VERIFICATION (CRITICAL)

**WARNING**: This is the FINAL and MOST IMPORTANT verification. Real malicious payloads must be tested.

**Setup**: Create test directory with malicious name and hook configuration:

```bash
# Create test directory with command injection payload
TEST_DIR="/tmp/llxprt-security-test; echo HACKED > /tmp/security-breach"
mkdir -p "$TEST_DIR"

# Create test project in malicious directory
mkdir -p "$TEST_DIR/.llxprt"

# Create hook that uses LLXPRT_PROJECT_DIR variable
cat > "$TEST_DIR/.llxprt/hooks.json" << 'EOF'
{
  "hooks": [
    {
      "event": "beforeTool",
      "command": "echo "Project dir is: $LLXPRT_PROJECT_DIR""
    }
  ]
}
EOF

# Run llxprt from the malicious directory
cd "$TEST_DIR"
node /Users/acoliver/projects/llxprt/branch-1/llxprt-code/scripts/start.js --profile-load synthetic "test" 2>&1 | tee /tmp/security-test-output.txt
```

**Expected Behavior (SECURE)**:
1. Hook executes successfully
2. Output shows ESCAPED path: `'/tmp/llxprt-security-test; echo HACKED > /tmp/security-breach'`
3. File `/tmp/security-breach` does NOT exist (injection was blocked)
4. The malicious `; echo HACKED` is treated as literal directory name, not executed

**Verification**:

```bash
# Check if injection was blocked
if [ -f "/tmp/security-breach" ]; then
  echo "[CRITICAL ERROR] SECURITY FAILURE: Command injection succeeded!"
  echo "The fix is INEFFECTIVE. Do NOT commit."
  exit 1
else
  echo "[OK] SECURITY SUCCESS: Injection blocked!"
fi

# Verify escaped output
if grep -q "'/tmp/llxprt-security-test.*HACKED.*'" /tmp/security-test-output.txt; then
  echo "[OK] Path was properly escaped with single quotes"
else
  echo "[WARNING] Output format unexpected - verify manually"
  cat /tmp/security-test-output.txt
fi

# Cleanup
rm -rf "$TEST_DIR"
rm -f /tmp/security-breach /tmp/security-test-output.txt
```

#### Step 3i: Test additional injection vectors

**CRITICAL**: Test ALL common injection vectors to ensure comprehensive protection.

Create temporary test script:

```bash
cat > /tmp/test-all-vectors.sh << 'EOF'
#!/bin/bash
set -e

VECTORS=(
  "; echo pwned"
  "$(whoami)"
  "`ls`"
  "| cat /etc/passwd"
  "&& rm file"
  "|| echo fail"
  "> /tmp/breach"
  "< /etc/passwd"
  "$HOME"
  "${PWD}"
)

echo "Testing injection vectors..."
for vector in "${VECTORS[@]}"; do
  TEST_DIR="/tmp/test$vector"
  mkdir -p "$TEST_DIR/.llxprt"
  
  cat > "$TEST_DIR/.llxprt/hooks.json" << HOOK_EOF
{
  "hooks": [
    {
      "event": "beforeTool",
      "command": "echo $LLXPRT_PROJECT_DIR"
    }
  ]
}
HOOK_EOF

  cd "$TEST_DIR"
  node /Users/acoliver/projects/llxprt/branch-1/llxprt-code/scripts/start.js --profile-load synthetic "test" > /dev/null 2>&1 || true
  
  # Check for any breach files
  if find /tmp -name "*breach*" -o -name "*pwned*" 2>/dev/null | grep -q .; then
    echo "[FAIL] Vector blocked: $vector - BREACH DETECTED"
    exit 1
  else
    echo "[OK] Vector blocked: $vector"
  fi
  
  rm -rf "$TEST_DIR"
done

echo "All injection vectors successfully blocked!"
EOF

chmod +x /tmp/test-all-vectors.sh
/tmp/test-all-vectors.sh
rm /tmp/test-all-vectors.sh
```

**MANDATORY**: All vectors must be neutralized (treated as literal text in directory path, not executed as commands).

**Must Complete ALL Checks** (MANDATORY - DO NOT SKIP ANY):

### PHASE 1: RED Evidence
- [ ] Step 1a: shell-utils.ts stub created with NotYetImplemented
- [ ] Step 1b: shell-utils.test.ts created with security tests
- [ ] Step 1c: hookRunner.test.ts injection test added
- [ ] Step 1d: Tests executed - ALL FAILED with NotYetImplemented
- [ ] Step 1d: RED evidence captured in /tmp/*-red-evidence.txt
- [ ] Step 1d: Verified tests fail because vulnerability exists

### PHASE 2: GREEN Evidence
- [ ] Step 2a: shell-utils.ts implementation complete (escapeShellArg + getShellConfiguration)
- [ ] Step 2b: hookRunner.ts updated (imports, executeCommandHook, expandCommand)
- [ ] Step 2c: hookRunner.test.ts existing tests updated
- [ ] Step 2d: Tests executed - ALL PASSED
- [ ] Step 2d: GREEN evidence captured in /tmp/*-green-evidence.txt
- [ ] Step 2d: Verified "should not allow command injection" test PASSES

### PHASE 3: Full Verification
- [ ] Step 3a: cd packages/core && npx vitest run - ALL PASS
- [ ] Step 3b: npm run typecheck - ZERO errors
- [ ] Step 3c: npm run lint - ZERO warnings
- [ ] Step 3d: npm run format - Code formatted
- [ ] Step 3e: npm run test - ALL tests pass (all packages)
- [ ] Step 3f: npm run build - Clean build SUCCESS
- [ ] Step 3g: node scripts/start.js --profile-load synthetic "write me a haiku and nothing else" - SUCCESS
- [ ] Step 3h: Manual security test - Malicious directory payload BLOCKED
- [ ] Step 3h: Verified /tmp/security-breach does NOT exist
- [ ] Step 3i: All injection vectors tested (;, $(), `, |, &&, ||, >, <, $VAR) - ALL BLOCKED

**CRITICAL**: Every checkbox must be checked with EVIDENCE before considering this fix complete. This is a SECURITY vulnerability - shortcuts = compromised systems.

## Branding Adaptations
- `GEMINI_PROJECT_DIR` → `LLXPRT_PROJECT_DIR` (primary variable)
- Keep `GEMINI_PROJECT_DIR` as legacy support (map to same value)
- Keep `CLAUDE_PROJECT_DIR` for compatibility
- Environment variable names in tests and code

## Security Notes
WARNING: **This is a critical security fix**. The vulnerability allows arbitrary command execution via crafted project directory paths. Do NOT skip this implementation.

Key security measures:
1. Single-quote wrapping of variable values
2. Escaping single quotes within values (`'\'\'` for bash, `''` for PowerShell)
3. `shell: false` in spawn (prevents shell interpretation)
4. Shell executable explicitly specified (`/bin/bash` or `powershell.exe`)

Test with malicious paths before considering complete.
