# Playbook: Add visual indicators for hook execution

**Upstream SHA:** `61dbab03e0d5`
**Upstream Subject:** feat(ui): add visual indicators for hook execution (#15408)
**Upstream Stats:** 27 files, 1117 insertions(+), 118 deletions(-)

## What Upstream Does

Adds real-time visual feedback for executing hooks in the interactive UI. Introduces `hooks.notifications` setting (default: true), `useHookDisplayState` hook to track active hooks, `HookStatusDisplay` component to show "Executing Hook: {name}" status, and `StatusDisplay` component to coordinate hook status, warnings, and context summary. The UI prioritizes messages: system md indicator → Ctrl+C → warnings → Ctrl+D → Escape → queue errors → hook status → context summary. Snapshots added for UI tests.

## LLxprt Adaptation Strategy

LLxprt has an Ink-based UI in `packages/cli/src/ui/`. This commit is **mostly compatible** but needs adaptation:

1. **SKIP** all upstream `HooksList.tsx` and hooks list command changes (LLxprt doesn't have this UI)
2. **Setting**: Add `hooks.notifications` to settingsSchema.ts
3. **Hook state tracking**: Create `useHookDisplayState.ts` hook (subscribe to MessageBus or poll HookSystem)
4. **UI components**: Create `HookStatusDisplay.tsx` and `StatusDisplay.tsx`
5. **Composer**: Modify `Composer.tsx` to use `StatusDisplay` instead of inline `ContextSummaryDisplay`
6. **AppContainer**: Add `activeHooks` from `useHookDisplayState` to UIState
7. **Types**: Add `ActiveHook` interface to UI types
8. **Constants**: Add `WARNING_PROMPT_DURATION_MS` and `QUEUE_ERROR_DISPLAY_DURATION_MS` constants
9. **Tests**: Add snapshot tests for new components

**Decision**: Implement core visual indicator functionality but SKIP hooks list command (not relevant to LLxprt).

## Files to Create/Modify

- **MODIFY** `packages/cli/src/config/settingsSchema.ts` - Add hooks.notifications setting
- **CREATE** `packages/cli/src/ui/hooks/useHookDisplayState.ts` - Hook to track active hooks
- **CREATE** `packages/cli/src/ui/components/HookStatusDisplay.tsx` - Visual indicator component
- **CREATE** `packages/cli/src/ui/components/StatusDisplay.tsx` - Coordinating status component
- **MODIFY** `packages/cli/src/ui/components/Composer.tsx` - Use StatusDisplay instead of inline display
- **MODIFY** `packages/cli/src/ui/AppContainer.tsx` - Add activeHooks to UIState
- **MODIFY** `packages/cli/src/ui/types.ts` - Add ActiveHook interface
- **CREATE** `packages/cli/src/ui/constants.ts` - Export timing constants
- **CREATE** `packages/cli/src/ui/components/HookStatusDisplay.test.tsx` - Snapshot tests
- **CREATE** `packages/cli/src/ui/components/StatusDisplay.test.tsx` - Snapshot tests
- **MODIFY** `packages/cli/src/ui/components/Composer.test.tsx` - Update for StatusDisplay
- **MODIFY** `packages/cli/src/ui/AppContainer.test.tsx` - Mock useHookDisplayState
- **MODIFY** `packages/cli/src/ui/components/ContextSummaryDisplay.test.tsx` - Add snapshots
- **SKIP** All HooksList.tsx and hooks list command files

## Implementation Steps

1. **Add hooks.notifications setting**:
   - In `settingsSchema.ts`, add to `hooks` properties: `{ type: 'boolean', label: 'Hook Notifications', default: true, description: 'Show visual indicators when hooks are executing.' }`

2. **Create `useHookDisplayState.ts`**:
   - Return `ActiveHook[]` by subscribing to MessageBus for HOOK_EXECUTION_REQUEST/RESPONSE events
   - Track start/end of hook execution, maintain list of currently executing hooks
   - Include hook name, eventName, optional index/total for sequential execution

3. **Create `ActiveHook` interface in `types.ts`**:
   ```typescript
   export interface ActiveHook {
     name: string;
     eventName: string;
     index?: number;
     total?: number;
   }
   ```

4. **Create `HookStatusDisplay.tsx`**:
   - Accept `activeHooks: ActiveHook[]` prop
   - Return null if empty
   - Display "Executing Hook: {name}" or "Executing Hooks: {name1}, {name2}" for multiple
   - Show "(1/3)" progress if sequential with index/total
   - Use `theme.status.warning` color

5. **Create `StatusDisplay.tsx`**:
   - Accept `hideContextSummary: boolean` prop
   - Get `uiState`, `settings`, `config` from contexts
   - Implement priority cascade:
     - GEMINI_SYSTEM_MD indicator
     - ctrlCPressedOnce → "Press Ctrl+C again to exit"
     - warningMessage → display warning
     - ctrlDPressedOnce → "Press Ctrl+D again to exit"
     - showEscapePrompt → "Press Esc again to clear"
     - queueErrorMessage → display error
     - activeHooks (if notifications enabled) → HookStatusDisplay
     - else → ContextSummaryDisplay (if not hidden)

6. **Modify `Composer.tsx`**:
   - Replace inline status rendering with `<StatusDisplay hideContextSummary={hideContextSummary} />`

7. **Modify `AppContainer.tsx`**:
   - Call `const activeHooks = useHookDisplayState()`
   - Add `activeHooks` to UIState object

8. **Create `constants.ts`**:
   ```typescript
   export const WARNING_PROMPT_DURATION_MS = 1000;
   export const QUEUE_ERROR_DISPLAY_DURATION_MS = 3000;
   ```

9. **Add tests**:
   - `HookStatusDisplay.test.tsx`: snapshot tests for single/multiple/sequential hooks
   - `StatusDisplay.test.tsx`: snapshot tests for priority cascade
   - Mock `useHookDisplayState` in `AppContainer.test.tsx`
   - Update `Composer.test.tsx` to verify StatusDisplay renders

10. **Update documentation** (if LLxprt has a configuration.md):
    - Document `hooks.notifications` setting

11. **Verify**: `npm run typecheck && npm run test -- packages/cli/src/ui/ packages/cli/src/config/`

## Execution Notes

- **Batch group:** Hooks (execute after 6d1e27633a32 - SessionStart context injection)
- **Dependencies:** 6d1e27633a32 (SessionStart context), MessageBus infrastructure
- **Verification:** `npm run typecheck && npm run test -- packages/cli/src/ui/ packages/cli/src/config/`
- **Important**: SKIP all hooks list command files — LLxprt doesn't have this UI
- **UI Framework**: Use Ink components (Text, Box) from existing LLxprt UI patterns
