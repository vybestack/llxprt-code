# Playbook: Add instructions to the extensions update info notification

**Upstream SHA:** `ec79fe1ab269`
**Upstream Subject:** Add instructions to the extensions update info notification
**Upstream Stats:** 2 files, 7 insertions

## What Upstream Does

Improves the user experience of extension update notifications by providing actionable command instead of generic "run /extensions list" message. Changes notification from "You have N extension(s) with an update available, run '/extensions list' for more information" to "You have N extension(s) with an update available. Run '/extensions update <name1> <name2>'." Collects extension names of pending updates and includes them in the notification message.

## LLxprt Adaptation Strategy

Direct mapping - LLxprt has parallel extension update notification system. Changes are isolated to:
- `packages/cli/src/ui/hooks/useExtensionUpdates.ts` - Update notification message
- `packages/cli/src/ui/hooks/useExtensionUpdates.test.ts` - Update test expectations

Need to verify LLxprt has:
- useExtensionUpdates hook with update notification logic
- Similar state management for extension update status

## Files to Create/Modify

**Modify:**
- `packages/cli/src/ui/hooks/useExtensionUpdates.ts` - Change notification message
- `packages/cli/src/ui/hooks/useExtensionUpdates.test.ts` - Update test expectations

## Implementation Steps

1. **Update useExtensionUpdates notification logic**:
   - Open `packages/cli/src/ui/hooks/useExtensionUpdates.ts`
   - Find the section that builds update notifications (around the loop processing extensions)
   - Change tracking from `extensionsWithUpdatesCount` counter to `pendingUpdates` array
   - Replace:
     ```typescript
     let extensionsWithUpdatesCount = 0;
     let shouldNotifyOfUpdates = false;
     ```
   - With:
     ```typescript
     const pendingUpdates = [];
     ```
   - In the loop where updates are detected:
     - Replace `extensionsWithUpdatesCount++` with `pendingUpdates.push(extension.name)`
     - Replace `shouldNotifyOfUpdates = true` with nothing (check array length instead)
   - Update notification condition from `if (shouldNotifyOfUpdates)` to `if (pendingUpdates.length > 0)`
   - Update count variable from `extensionsWithUpdatesCount` to `pendingUpdates.length`
   - Update message:
     ```typescript
     text: `You have ${pendingUpdates.length} extension${s} with an update available. Run "/extensions update ${pendingUpdates.join(' ')}".`
     ```

2. **Update test expectations**:
   - Open `packages/cli/src/ui/hooks/useExtensionUpdates.test.ts`
   - Find tests that verify update notification messages
   - Update expected text for single extension:
     ```typescript
     text: 'You have 1 extension with an update available. Run "/extensions update test-extension".'
     ```
   - Update expected text for multiple extensions:
     ```typescript
     text: 'You have 2 extensions with an update available. Run "/extensions update test-extension-1 test-extension-2".'
     ```

3. **Verify notification triggering logic**:
   - Ensure the logic for when to show notifications hasn't changed
   - Should still only notify for unprocessed extensions in UPDATE_AVAILABLE state
   - Verify notified flag is still set after notification

## Execution Notes

- **Batch group:** Extensions (execute after 563d81e)
- **Dependencies:** 563d81e (adds /extensions update command that this references)
- **Verification:** `npm run test -- packages/cli/src/ui/hooks/useExtensionUpdates.test.ts`
- **Note:** Small UX improvement - low risk change
