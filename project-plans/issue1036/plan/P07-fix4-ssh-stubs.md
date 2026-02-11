# Phase 07: Fix 4 SSH Helper Function Stubs

## Phase ID
`PLAN-20260211-SANDBOX1036.P07`

## Prerequisites
- Required: Phase P06 completed (Fix 3 implemented and passing)
- Verification: `grep -r "@plan:PLAN-20260211-SANDBOX1036.P06" packages/cli/src/utils/sandbox.ts`

## Requirements Addressed
- R4, R5, R6, R7 (stubs only — no implementation)

## Purpose
Create minimal function signatures for the SSH agent forwarding helpers.
These stubs compile but throw `Error('NotYetImplemented')`. This establishes
the function contracts for TDD in P08.

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sandbox.ts`

### New Exported Types and Functions

#### SshAgentResult type
```typescript
export interface SshAgentResult {
  tunnelProcess?: ChildProcess;
  cleanup?: () => void;
}
```

#### setupSshAgentForwarding (router)
```typescript
/**
 * @plan:PLAN-20260211-SANDBOX1036.P07
 * @requirement:R4.1, R4.2, R4.3, R4.4
 */
export async function setupSshAgentForwarding(
  config: { command: 'docker' | 'podman' | 'sandbox-exec' },
  args: string[],
): Promise<SshAgentResult> {
  throw new Error('NotYetImplemented');
}
```

#### setupSshAgentLinux
```typescript
/**
 * @plan:PLAN-20260211-SANDBOX1036.P07
 * @requirement:R5.1, R5.2
 */
export function setupSshAgentLinux(
  config: { command: 'docker' | 'podman' | 'sandbox-exec' },
  args: string[],
  sshAuthSock: string,
): void {
  throw new Error('NotYetImplemented');
}
```

#### setupSshAgentDockerMacOS
```typescript
/**
 * @plan:PLAN-20260211-SANDBOX1036.P07
 * @requirement:R6.1, R6.2
 */
export function setupSshAgentDockerMacOS(
  args: string[],
): void {
  throw new Error('NotYetImplemented');
}
```

#### setupSshAgentPodmanMacOS
```typescript
/**
 * @plan:PLAN-20260211-SANDBOX1036.P07
 * @requirement:R7.1, R7.2, R7.3, R7.4, R7.5, R7.6, R7.7, R7.8, R7.9, R7.10, R7.11
 */
export async function setupSshAgentPodmanMacOS(
  args: string[],
  sshAuthSock: string,
): Promise<SshAgentResult> {
  throw new Error('NotYetImplemented');
}
```

#### getPodmanMachineConnection
```typescript
/**
 * @plan:PLAN-20260211-SANDBOX1036.P07
 * @requirement:R7.2, R7.6
 */
export function getPodmanMachineConnection(): {
  host: string;
  port: number;
  user: string;
  identityPath: string;
} {
  throw new Error('NotYetImplemented');
}
```

### Placement
All new functions go AFTER the existing `buildSandboxEnvArgs` and
`mountGitConfigFiles` functions, BEFORE `start_sandbox`. Group them under a
comment block:

```typescript
// --- SSH Agent Forwarding Helpers ---
```

## Verification Commands
```bash
# All stubs exist and are exported
grep "export.*function setup\|export.*function getPodman\|export interface SshAgent" packages/cli/src/utils/sandbox.ts
# Expected: 5+ matches

# File compiles
npm run typecheck
# Expected: Pass

# Existing tests still pass (stubs not called yet)
npm run test --workspace=packages/cli -- --run sandbox.test
# Expected: All pass

# No TODO/FIXME in stubs (NotYetImplemented is acceptable in stubs)
grep -n "TODO\|FIXME" packages/cli/src/utils/sandbox.ts | grep -i ssh
# Expected: No matches
```

## Success Criteria
- All 5 functions exported with correct signatures
- `SshAgentResult` interface exported
- File compiles with strict TypeScript
- Existing tests unaffected

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sandbox.ts
```
