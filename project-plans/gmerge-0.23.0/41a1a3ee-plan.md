# Reimplement Plan: Hook command injection fix (upstream 41a1a3eed1) WARNING: CRITICAL SECURITY

## Upstream Change
**CRITICAL SECURITY FIX**: Sanitizes hook command expansion to prevent shell injection via environment variables. When `$GEMINI_PROJECT_DIR` contains shell metacharacters (e.g., `; rm -rf /`), they must be properly escaped.

## LLxprt Files to Modify
- packages/core/src/utils/shell-utils.ts — Create new utility with escapeShellArg and getShellConfiguration
- packages/core/src/hooks/hookRunner.ts — Use shell utilities, escape variable expansion, spawn without shell
- packages/core/src/hooks/hookRunner.test.ts — Add injection prevention tests, update existing tests

## Steps

1. **Create shell-utils.ts** (packages/core/src/utils/shell-utils.ts):
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

2. **Update hookRunner.ts** (packages/core/src/hooks/hookRunner.ts):

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

       const shellConfig = getShellConfiguration();
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

       // ... rest of implementation
   ```

   **C. Update expandCommand method** (around line 353):
   ```typescript
   /**
    * Expand command with environment variables and input context
    */
   private expandCommand(
     command: string,
     input: HookInput,
     shellType: ShellType,
   ): string {
     debugLogger.debug(`Expanding hook command: ${command} (cwd: ${input.cwd})`);
     const escapedCwd = escapeShellArg(input.cwd, shellType);
     return command
       .replace(/\$LLXPRT_PROJECT_DIR/g, () => escapedCwd)
       .replace(/\$GEMINI_PROJECT_DIR/g, () => escapedCwd)  // Legacy support
       .replace(/\$CLAUDE_PROJECT_DIR/g, () => escapedCwd); // For compatibility
   }
   ```

3. **Update hookRunner.test.ts** (packages/core/src/hooks/hookRunner.test.ts):

   **A. Update existing tests** to expect bash/powershell invocation:
   - Find tests checking spawn arguments
   - Change expectations from direct command to shell wrapper:
     ```typescript
     expect(spawn).toHaveBeenCalledWith(
       expect.stringMatching(/bash|powershell/),
       expect.arrayContaining([
         expect.stringMatching(/['"]?\/test\/project['"]?\/hooks\/test\.sh/),
       ]),
       expect.objectContaining({
         shell: false,
         env: expect.objectContaining({
           LLXPRT_PROJECT_DIR: '/test/project',
           CLAUDE_PROJECT_DIR: '/test/project',
         }),
       }),
     );
     ```

   **B. Add injection prevention test**:
   ```typescript
   it('should not allow command injection via LLXPRT_PROJECT_DIR', async () => {
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

     // If secure, spawn will be called with the shell executable and escaped command
     expect(spawn).toHaveBeenCalledWith(
       expect.stringMatching(/bash|powershell/),
       expect.arrayContaining([
         expect.stringMatching(/ls (['"]).*echo.*pwned.*\1/),
       ]),
       expect.objectContaining({ shell: false }),
     );
   });
   ```

   **C. Update timing in all tests**:
   - Replace `setTimeout(..., 10)` with `setImmediate(...)`
   - Replace `setTimeout(..., 20)` with `setImmediate(...)`
   - This makes tests more reliable and faster

   **D. Update command extraction in execution order test**:
   ```typescript
   const args = vi.mocked(spawn).mock.calls[executionOrder.length][1] as string[];
   const command = args[args.length - 1];
   executionOrder.push(command);
   ```

4. **Add shell-utils tests** (packages/core/src/utils/shell-utils.test.ts):
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { escapeShellArg, getShellConfiguration } from './shell-utils.js';

   describe('shell-utils', () => {
     describe('escapeShellArg', () => {
       it('should escape single quotes in bash', () => {
         expect(escapeShellArg("test'string", 'bash')).toBe("'test'\\''string'");
       });

       it('should escape shell metacharacters in bash', () => {
         expect(escapeShellArg('test; rm -rf /', 'bash')).toBe("'test; rm -rf /'");
       });

       it('should escape single quotes in powershell', () => {
         expect(escapeShellArg("test'string", 'powershell')).toBe("'test''string'");
       });

       it('should handle empty string', () => {
         expect(escapeShellArg('', 'bash')).toBe("''");
       });
     });

     describe('getShellConfiguration', () => {
       it('should return bash config on unix', () => {
         const config = getShellConfiguration();
         if (process.platform !== 'win32') {
           expect(config.executable).toBe('/bin/bash');
           expect(config.argsPrefix).toEqual(['-c']);
           expect(config.shell).toBe('bash');
         }
       });

       it('should return powershell config on windows', () => {
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

5. **Add security test in integration**:
   - Create integration test that verifies malicious paths don't execute
   - Test with paths containing: `; echo pwned`, `$(whoami)`, `\`ls\``

## Verification
- `cd packages/core && npx vitest run src/utils/shell-utils.test.ts`
- `cd packages/core && npx vitest run src/hooks/hookRunner.test.ts`
- `npm run typecheck`
- `npm run lint`
- **SECURITY VERIFICATION**: Create hook with command `echo $LLXPRT_PROJECT_DIR` and cwd containing `; echo HACKED`. Verify output is escaped, not executed.

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
