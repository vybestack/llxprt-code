# Playbook: Add Folder Trust Support To Hooks

**Upstream SHA:** `dced409ac42d`
**Upstream Subject:** Add Folder Trust Support To Hooks (#15325)
**Upstream Stats:** 10 files, 188 insertions(+), 19 deletions(-)

## What Upstream Does

Moves `ConfigSource` enum from `hookRegistry.ts` to `types.ts`, adds it as an optional field to `CommandHookConfig`, and implements folder trust security checks in `hookRegistry` and `hookRunner`. When a folder is untrusted, project-level hooks are skipped entirely. `HookRunner` now requires `Config` in its constructor to perform secondary security validation, and `HookSystem` passes `config` to `HookRunner` during instantiation. Tests are updated across the hook system to reflect these changes.

## LLxprt Adaptation Strategy

LLxprt already has a `ConfigSource` enum in `packages/core/src/hooks/types.ts` (checked file reading above), so the first part is already done. The key changes needed are:

1. Add `source?: ConfigSource` to `CommandHookConfig` in `types.ts`
2. Modify `HookRegistry.processHookDefinition` to set `hookConfig.source = source` when creating hooks
3. Add `Config` parameter to `HookRunner` constructor
4. Update `HookRegistry.processHooksFromConfig` to check `config.isTrustedFolder()` before loading project hooks (ConfigSource.Project)
5. Add secondary security check in `HookRunner.executeCommandHook` to block project hooks in untrusted folders
6. Update `HookSystem` to pass `config` to `HookRunner` constructor
7. Update test files to match new signatures

## Files to Create/Modify

- `packages/core/src/hooks/types.ts` - Add `source?: ConfigSource` field to `CommandHookConfig`
- `packages/core/src/hooks/hookRegistry.ts` - Set `source` on hooks, add trust check before loading project hooks
- `packages/core/src/hooks/hookRunner.ts` - Accept `Config` in constructor, add secondary security check
- `packages/core/src/hooks/hookSystem.ts` - Pass `config` to `HookRunner` constructor
- `packages/core/src/hooks/index.ts` - Update exports if needed (check if ConfigSource export location changes)
- `packages/core/src/hooks/__tests__/hookRegistry.test.ts` - Update tests for new behavior
- `packages/core/src/hooks/__tests__/hookRunner.test.ts` - Update tests with Config parameter
- `packages/core/src/hooks/__tests__/hookPlanner.test.ts` - Update if needed
- `packages/cli/src/config/trustedFolders.ts` - Minor whitespace cleanup (optional)

## Implementation Steps

1. **Check current state**: Verify `ConfigSource` enum exists in `types.ts` and is already exported from `index.ts`
2. **Update types.ts**: Add `source?: ConfigSource` to `CommandHookConfig` interface (around line 25-30)
3. **Update hookRegistry.ts**:
   - In `processHookDefinition` method, add `hookConfig.source = source` when creating registry entries
   - In `processHooksFromConfig` method, add trust check before loading project hooks:
     ```typescript
     // Skip project hooks if folder is not trusted
     if (source === ConfigSource.Project && !this.config.isTrustedFolder()) {
       debugLogger.log('Skipping project hooks - folder not trusted');
       return;
     }
     ```
4. **Update hookRunner.ts**:
   - Add `private readonly config: Config` field
   - Modify constructor to accept `config: Config` parameter and store it
   - Add import for `Config` type
   - In `executeCommandHook` method, add security check before executing:
     ```typescript
     // Secondary security check - block project hooks in untrusted folders
     if (hookConfig.source === ConfigSource.Project && !this.config.isTrustedFolder()) {
       const errorMessage = 'Project hook blocked - folder not trusted';
       debugLogger.warn(errorMessage);
       resolve({
         hookConfig,
         eventName,
         success: false,
         error: new Error(errorMessage),
         duration: Date.now() - startTime,
       });
       return;
     }
     ```
5. **Update hookSystem.ts**: Change `HookRunner` instantiation from `new HookRunner()` to `new HookRunner(this.config)`
6. **Update index.ts**: Verify `ConfigSource` is exported from `types.js` (should already be the case)
7. **Update tests**:
   - `hookRegistry.test.ts`: Update test setup to include `isTrustedFolder` mock returning `true` by default
   - `hookRunner.test.ts`: Update `HookRunner` instantiation to pass mock Config, add tests for untrusted folder blocking
   - `hookPlanner.test.ts`: Update if any test setup needs Config parameter changes
8. **Run verification**: `npm run typecheck && npm run test -- packages/core/src/hooks/`

## Execution Notes

- **Batch group:** Hooks (execute after all PICK cherry-picks are done)
- **Dependencies:** None (first in sequence)
- **Verification:** `npm run typecheck && npm run test -- packages/core/src/hooks/`
