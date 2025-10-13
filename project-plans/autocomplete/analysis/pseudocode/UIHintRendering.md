# UI Hint Rendering Pseudocode

<!-- @plan:PLAN-20251013-AUTOCOMPLETE.P02 @requirement:REQ-002 @requirement:REQ-003 @requirement:REQ-005 @requirement:REQ-006 -->

**Lines 1-10**: Hook updates
1. Extend `useSlashCompletion` state with `activeHint`.
2. When completion handler returns `{ suggestions, hint }`, store hint alongside suggestions.
3. Prevent stale hints by comparing tokens/timestamps (handle async completions).

**Lines 11-20**: Component updates
4. Modify `SuggestionsDisplay` to accept `activeHint?: string` prop.
5. Render hint in a dedicated line above suggestion list.
6. Ensure hint line maintains consistent height to avoid layout shift.
7. Preserve existing loading/scroll behavior.

**Lines 21-30**: Tests
8. Add integration test verifying hint line updates as user advances arguments.
9. Include property-based test generating random token sequences to validate hint stability.
10. Mutation test ensures hint rendering fails if `activeHint` not passed.
