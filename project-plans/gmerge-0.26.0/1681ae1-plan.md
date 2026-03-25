# REIMPLEMENT Playbook: 1681ae1 — refactor(cli): unify shell confirmation dialogs

## Upstream Change Summary

Upstream unified the shell command confirmation dialogs into a single `ToolConfirmationMessage` component:

1. **Removed `ShellConfirmationDialog`** component entirely
2. **Removed `shellConfirmationRequest`** from UI state and contexts
3. **Enhanced `ToolConfirmationMessage`** to handle multiple commands via `commands` array
4. **Updated `slashCommandProcessor`** to return `confirm_shell_commands` action that uses the unified confirmation flow
5. **Simplified `AppContainer`** by removing shell confirmation handling

## LLxprt Current State

**File**: `packages/cli/src/ui/hooks/slashCommandProcessor.ts`

LLxprt has `shellConfirmationRequest` state:
```typescript
const [shellConfirmationRequest, setShellConfirmationRequest] = useState<null | {
  commands: string[];
  onConfirm: (outcome: ToolConfirmationOutcome, approvedCommands?: string[]) => void;
}>(null);
```

And `confirmationRequest` state for general confirmations.

LLxprt handles `confirm_shell_commands` action result with a promise-based dialog.

**File**: `packages/cli/src/ui/AppContainer.tsx` (or equivalent)

Need to verify if `ShellConfirmationDialog` is used.

**File**: `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`

Need to check if it supports multiple commands.

## Adaptation Plan

### File-by-File Changes

#### 1. Delete legacy `ShellConfirmationDialog` files

Delete the following files (if they exist — verify with `ls` before deleting):
- `packages/cli/src/ui/components/ShellConfirmationDialog.tsx`
- `packages/cli/src/ui/components/ShellConfirmationDialog.test.tsx`
- `packages/cli/src/ui/components/__snapshots__/ShellConfirmationDialog.test.tsx.snap`

#### 2. `packages/cli/src/ui/contexts/UIStateContext.tsx`

Remove `shellConfirmationRequest` from the `UIState` type and all related state initialization:
```typescript
// REMOVE from UIState interface:
shellConfirmationRequest: ShellConfirmationRequest | null;

// REMOVE from initial state:
shellConfirmationRequest: null,

// REMOVE from setters/updaters referencing shellConfirmationRequest
```

#### 3. `packages/cli/src/ui/components/DialogManager.tsx`

Remove the `ShellConfirmationDialog` import and rendering block:
```typescript
// REMOVE import:
import { ShellConfirmationDialog } from './ShellConfirmationDialog.js';

// REMOVE rendering block:
if (uiState.shellConfirmationRequest) {
  return (
    <ShellConfirmationDialog request={uiState.shellConfirmationRequest} />
  );
}
```

#### 4. `packages/cli/src/ui/AppContainer.tsx`

Remove all `shellConfirmationRequest` references:
- Remove from `uiState` destructuring
- Remove from `isConfirming` boolean calculation (e.g. `|| !!shellConfirmationRequest`)
- Remove from any props passed down to child components

#### 5. `packages/cli/src/ui/hooks/slashCommandProcessor.ts`

Update the `confirm_shell_commands` action branch to route through the unified tool confirmation display. Instead of setting `shellConfirmationRequest`, create a confirmation request that flows through `ToolConfirmationMessage`:

```typescript
// Replace shellConfirmationRequest-based path with:
// Route confirm_shell_commands through the unified confirmationRequest state,
// passing commands[] so ToolConfirmationMessage can display them.
```

Read the file in full first to understand the existing `confirm_shell_commands` branch before modifying it.

#### 6. `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`

Add multi-command display support to the `exec` branch:

1. Add `commands?: string[]` to the exec confirmation details type (in the core package type — see step 7 below). Then in the component, detect multiple commands:
   ```typescript
   } else if (confirmationDetails.type === 'exec') {
     const executionProps = confirmationDetails;
     const commandsToDisplay =
       executionProps.commands && executionProps.commands.length > 1
         ? executionProps.commands
         : [executionProps.command];

     const question =
       executionProps.commands && executionProps.commands.length > 1
         ? `Allow execution of ${executionProps.commands.length} commands?`
         : `Allow execution of: '${executionProps.rootCommand}'?`;
     // ... rest of options
   }
   ```

2. Render all commands in the display area:
   ```typescript
   <Box flexDirection="column">
     {commandsToDisplay.map((cmd, idx) => (
       <Text key={idx} color={theme.text.link}>
         {cmd}
       </Text>
     ))}
   </Box>
   ```

#### 7. Core package — exec confirmation details type

Add `commands?: string[]` to the exec confirmation details type in the core package. Read the current type definition first to find the exact location:

```typescript
// In the exec confirmation details type:
commands?: string[];   // list of commands for multi-command exec
```

#### 8. Tests

- **`ToolConfirmationMessage.test.tsx`**: Add test for multi-command case — pass `commands: ['cmd1', 'cmd2']` and assert both commands are rendered and the question shows the count.
- **`slashCommandProcessor.test.tsx`**: Verify that `confirm_shell_commands` no longer sets `shellConfirmationRequest`; verify it routes through the unified confirmation path instead.
- Confirm `ShellConfirmationDialog` is no longer rendered anywhere (grep for it after deletion).

## Files to Read

- `packages/cli/src/ui/hooks/slashCommandProcessor.ts` (read in full — understand the `confirm_shell_commands` branch)
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` (read in full — understand exec branch and type structure)
- `packages/cli/src/ui/contexts/UIStateContext.tsx` (locate `shellConfirmationRequest` type and state)
- `packages/cli/src/ui/components/DialogManager.tsx` (locate `ShellConfirmationDialog` render block)
- `packages/cli/src/ui/AppContainer.tsx` (locate `shellConfirmationRequest` usage)
- Core package exec confirmation type file (find via grep for `exec` + `confirmationDetails`)

## Files to Modify

- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts`
- `packages/cli/src/ui/contexts/UIStateContext.tsx`
- `packages/cli/src/ui/components/DialogManager.tsx`
- `packages/cli/src/ui/AppContainer.tsx`
- Core package exec confirmation type (add `commands?: string[]`)

## Files to Delete (if exist — verify first)

- `packages/cli/src/ui/components/ShellConfirmationDialog.tsx`
- `packages/cli/src/ui/components/ShellConfirmationDialog.test.tsx`
- `packages/cli/src/ui/components/__snapshots__/ShellConfirmationDialog.test.tsx.snap`

## Specific Verification

1. Run tests: `npm run test -- packages/cli/src/ui/components/messages/ToolConfirmationMessage.test.tsx`
2. Run tests: `npm run test -- packages/cli/src/ui/hooks/slashCommandProcessor.test.tsx`
3. Grep for `ShellConfirmationDialog` — must return zero results after deletion
4. Grep for `shellConfirmationRequest` — must return zero results after removal
5. Manual: Test shell command confirmation with single command
6. Manual: Test shell command confirmation with multiple commands
