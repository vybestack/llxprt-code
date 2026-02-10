# REIMPLEMENT Playbook: 9786c4dcf

## Commit and feature
- Upstream commit: `9786c4dcf`
- Feature intent: `check folder trust before allowing /add directory`
- Dependency: **depends on outcomes of `472e775a1`**
- Strategy in LLxprt: **REIMPLEMENT** (not cherry-pick)

## Why cherry-pick failed / why REIMPLEMENT is required
Cherry-pick is unsafe because LLxprt command and trust wiring differs:
- `/directory add` currently lives in `packages/cli/src/ui/commands/directoryCommand.tsx` and performs add/memory-refresh/provider-context operations with no trust gate.
- Trust state logic is centralized through trusted folders and hooks (`useFolderTrust.ts`, `usePermissionsModifyTrust.ts`) rather than upstream’s presumed integration points.
- Slash command processor location/shape in LLxprt is `packages/cli/src/ui/hooks/slashCommandProcessor.ts`, indicating divergence in command orchestration.

Given these differences, direct cherry-pick could break existing `directory add` side effects (memory loading, provider context updates, restrictive sandbox checks). REIMPLEMENT is required to insert a trust gate in LLxprt-native flow.

## Explicit dependency on 472e775a1
This plan assumes `472e775a1` has already delivered a reliable way to modify trust for arbitrary directories via `/permissions`.

Expected dependency outcomes:
1. Users can trust a non-CWD directory using `/permissions` command path.
2. Trust-level changes are persisted through existing trusted-folder store.
3. Error/success messaging for trust changes exists and is test-covered.

### Fallback strategy if implemented independently
If `472e775a1` is not yet available:
- Implement trust gate for `/directory add` anyway.
- When blocked due to untrusted target, message must instruct user to use existing trust workflow:
  - at minimum: use `/permissions` for current workspace trust controls
  - optionally include manual config guidance if target-specific trust command is unavailable
- Add TODO/reference in plan/PR notes: upgrade blocked-flow guidance once `472e775a1` lands to include explicit target-directory trust command syntax.

## Files to inspect/modify (current expected existence)
### Must inspect (confirmed present)
- `packages/cli/src/ui/commands/directoryCommand.tsx`
- `packages/cli/src/ui/commands/permissionsCommand.ts`
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts`
- `packages/cli/src/ui/hooks/useFolderTrust.ts`
- `packages/cli/src/ui/hooks/usePermissionsModifyTrust.ts`

### Tests to inspect/modify/add (confirmed present)
- `packages/cli/src/ui/commands/directoryCommand.test.tsx`
- `packages/cli/src/ui/commands/permissionsCommand.test.ts`
- `packages/cli/src/ui/hooks/useFolderTrust.test.ts`
- `packages/cli/src/ui/hooks/slashCommandProcessor.test.ts`

## Behavior requirements
Add folder-trust validation before mutating workspace context in `/directory add`.

Required behavior:
1. Before `workspaceContext.addDirectory(...)`, evaluate trust for each candidate directory.
2. If target directory is not trusted, do not add it; collect a clear error per path.
3. If trusted, preserve existing add flow (add directory, memory reload logic, provider context update).
4. For mixed input lists, allow trusted paths and reject untrusted ones in same command execution.
5. Keep existing restrictive sandbox check behavior as highest-priority early return.
6. Error messaging should guide user toward trust modification path (dependent on `472e775a1` outcome).

Edge cases:
- Relative path inputs resolved against current workspace/working directory before trust check.
- Home-expanded paths (`~`, `%userprofile%`) are checked after normalization.
- Duplicate paths in input should not produce inconsistent mixed trust results.
- Trust-check API failures (if any) should fail closed for safety and surface explicit error.
- Existing behavior for empty args and addDirectory exceptions remains intact.

## Negative checks (what NOT to change)
- Do **not** remove memory reload behavior and `addDirectoryContext()` follow-up for successfully added directories.
- Do **not** alter restrictive sandbox guard semantics.
- Do **not** alter unrelated slash command completion/loader behavior.
- Do **not** add Google/Gemini-specific branding changes in user messaging.
- Do **not** change trust semantics globally; only gate `/directory add` path admission.

## TDD workflow (project mandate)

### RED (tests first)
1. Extend `directoryCommand.test.tsx` with failing behavioral tests:
   - rejects untrusted target directory before `addDirectory` call
   - allows trusted directory and keeps existing success flow
   - mixed trusted/untrusted list partially succeeds with both info+error outputs
   - preserves restrictive sandbox early-return behavior
2. Add/adjust supporting tests in trust-related modules if new trust-check utility/helper is introduced.
3. If message contract changes due to dependency on `472e775a1`, add explicit assertions in relevant command tests.

Run targeted tests and confirm failures before code changes.

### GREEN (minimal implementation)
1. Implement trust gate in `directoryCommand.tsx` as near as possible to existing per-path processing loop.
2. Reuse existing trusted-folders APIs/utilities; avoid new persistence paths.
3. Keep successful-path side effects unchanged.
4. Add concise blocked-path guidance message.

Run targeted tests until green.

### REFACTOR
1. Extract trust-check helper for clarity if needed (pure function preferred).
2. Deduplicate normalization/trust-check logic across path handling code.
3. Ensure message text consistency and reduce repetition in errors.

Re-run targeted tests after cleanup.

## Verification commands
Minimum required during implementation:
- `npm run lint`
- `npm run typecheck`
- Targeted tests:
  - `npm run test -- packages/cli/src/ui/commands/directoryCommand.test.tsx`
  - `npm run test -- packages/cli/src/ui/commands/permissionsCommand.test.ts`
  - `npm run test -- packages/cli/src/ui/hooks/useFolderTrust.test.ts`

Full verify before declaring task complete (per repo mandate):
- `npm run format`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`

## Implementation notes for LLxprt compatibility
- Keep trust checks provider-agnostic and CLI-generic.
- Do not introduce model/provider assumptions into command logic.
- Ensure interoperability with existing workspace context and settings mechanisms.
