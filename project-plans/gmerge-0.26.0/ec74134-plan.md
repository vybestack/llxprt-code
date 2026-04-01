# REIMPLEMENT Playbook: ec74134 — feat(core): shell redirection transparency and security

## Upstream Change Summary

Upstream improved shell redirection handling for better transparency and security:

1. **Added `CheckResult` type** in `policy/types.ts`
2. **Added `hasRedirection` function usage** in `ToolConfirmationMessage.tsx`
3. **Added redirection warnings** in UI with notes and tips
4. **Added `REDIRECTION_WARNING_*` constants** in `textConstants.ts`
5. **Policy engine improvements**: Checks for redirection on compound commands
6. **Test additions**: For redirection scenarios in policy engine and UI

## LLxprt Current State

**`packages/core/src/policy/policy-engine.ts`**

LLxprt's `PolicyEngine` already handles redirection internally:
- Uses `evaluate(toolName, args, serverName?): PolicyDecision` — synchronous, plain enum return
- **No** `check()` or `checkShellCommand()` methods
- **No** `CheckResult` type or `ApprovalMode` on the engine (ApprovalMode exists in `types.ts` but is NOT used by the engine)
- Redirection downgrade is done inline: `if (!matchingRule.allowRedirection && /[>&|]/.test(command))` → returns `ASK_USER`
- The `nonInteractive` flag handles all non-interactive mode decisions

**`packages/core/src/utils/shell-utils.ts`**

No `hasRedirection` function currently exists. The file has `detectCommandSubstitution`, `splitCommands`, `getCommandRoot`, and `checkCommandPermissions`. A robust `hasRedirection` helper needs to be added here as a prerequisite.

**`packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`**

The `exec` case uses `executionProps.command` (single string). There is **no** `commands[]` array. Redirection detection must operate on `executionProps.command` directly.

**`packages/cli/src/ui/textConstants.ts`**

Currently only contains screen-reader constants. Redirection warning constants need to be added.

**`packages/core/src/policy/types.ts`**

Has `PolicyDecision`, `ApprovalMode`, `PolicyRule`, `PolicyEngineConfig`. Skip adding `CheckResult` — the engine returns plain `PolicyDecision` and should stay that way.

## Adaptation Plan

### Step 0 (Prerequisite): Add `hasRedirection` to `packages/core/src/utils/shell-utils.ts`

Add a robust helper that detects shell redirection operators while respecting quoting rules. This is needed by both the UI component and can be used in tests. The existing inline redirection check in `policy-engine.ts` (`/[>&|]/.test(command)`) uses a simple regex; `hasRedirection` should be quote-aware to avoid false positives on strings like `echo "use > to redirect"`.

```typescript
/**
 * Detects whether a shell command contains redirection operators (>, >>, <, 2>, &>)
 * or pipe operators (|), respecting shell quoting rules.
 * Single-quoted content is treated as fully literal.
 * @param command The shell command string to check
 * @returns true if the command contains redirection or pipe operators outside quotes
 */
export function hasRedirection(command: string): boolean {
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    // Handle escaping outside single quotes
    if (char === '\\' && !inSingleQuotes && i < command.length - 1) {
      i += 2;
      continue;
    }

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    }

    if (!inSingleQuotes && !inDoubleQuotes) {
      // Redirection: >, >>, <, 2>, &>, >&
      if (char === '>' || char === '<') {
        return true;
      }
      // Pipe: single | (not ||, which is a logical operator)
      if (char === '|' && command[i + 1] !== '|') {
        return true;
      }
    }

    i++;
  }

  return false;
}
```

Also export `hasRedirection` from `packages/core/src/index.ts` (or wherever `shell-utils` exports are aggregated) so the CLI package can import it.

### File-by-File Changes

#### 1. `packages/core/src/utils/shell-utils.ts`

Add `hasRedirection` function (see Step 0 above). Export it alongside existing exports.

Also update the existing inline redirection check in `packages/core/src/policy/policy-engine.ts` to use `hasRedirection` for consistency (optional but preferred for DRY):

```typescript
// policy-engine.ts existing inline check (already functional):
if (!matchingRule.allowRedirection && /[>&|]/.test(command)) {
  // Can optionally become:
  if (!matchingRule.allowRedirection && hasRedirection(command)) {
```

Import `hasRedirection` from `'../utils/shell-utils.js'` in `policy-engine.ts`.

> **NOTE**: Do NOT add `CheckResult`, `check()`, or `checkShellCommand()`. Do NOT add `ApprovalMode` usage to the engine. The `PolicyEngine.evaluate()` API returns `PolicyDecision` directly and must stay that way. The upstream `ApprovalMode.AUTO_EDIT` bypass concept does NOT apply — LLxprt's engine uses `nonInteractive` + `allowRedirection` on rules instead.

#### 2. `packages/cli/src/ui/textConstants.ts`

Add redirection warning constants:

```typescript
export const REDIRECTION_WARNING_NOTE_LABEL = 'Note: ';
export const REDIRECTION_WARNING_NOTE_TEXT =
  'Command contains redirection which can be undesirable.';
export const REDIRECTION_WARNING_TIP_LABEL = 'Tip:  '; // Padded to align with "Note: "
export const REDIRECTION_WARNING_TIP_TEXT =
  'Use the allowRedirection policy rule to permit redirections without confirmation.';
```

> **NOTE**: The tip text references LLxprt's policy mechanism (`allowRedirection` rule), NOT the upstream `AUTO_EDIT` mode. Adapt the tip to match LLxprt's actual UI affordances if there is a toggle that affects this.

#### 3. `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`

In the `exec` branch of the `useMemo`, detect redirection from the single `executionProps.command` string and add warning body content:

1. Import `hasRedirection` from `@vybestack/llxprt-code-core`
2. Import redirection constants from `'../../textConstants.js'`
3. In the exec `useMemo` body section where `bodyContent` is set:

```typescript
} else if (confirmationDetails.type === 'exec') {
  const executionProps = confirmationDetails;
  let bodyContentHeight = availableBodyContentHeight();
  if (bodyContentHeight !== undefined) {
    bodyContentHeight = Math.max(bodyContentHeight - 2, 1);
  }

  const containsRedirection = hasRedirection(executionProps.command);

  const commandBox = (
    <Box>
      <Text color={theme.text.link}>{executionProps.command}</Text>
    </Box>
  );

  const warningBox = containsRedirection ? (
    <>
      <Box height={1} />
      <Box>
        <Text color={theme.text.primary}>
          <Text bold>{REDIRECTION_WARNING_NOTE_LABEL}</Text>
          {REDIRECTION_WARNING_NOTE_TEXT}
        </Text>
      </Box>
      <Box>
        <Text color={theme.border.default}>
          <Text bold>{REDIRECTION_WARNING_TIP_LABEL}</Text>
          {REDIRECTION_WARNING_TIP_TEXT}
        </Text>
      </Box>
    </>
  ) : null;

  const content = (
    <Box flexDirection="column">
      {commandBox}
      {warningBox}
    </Box>
  );

  bodyContent = isAlternateBuffer ? (
    content
  ) : (
    <MaxSizedBox
      maxHeight={bodyContentHeight}
      maxWidth={Math.max(terminalWidth, 1)}
    >
      {content}
    </MaxSizedBox>
  );
}
```

> **NOTE**: `executionProps.command` is the single full command string. There is no `commands[]` array in `ToolCallConfirmationDetails` for exec type. Do NOT reference `executionProps.commands`.

#### 4. `packages/core/src/policy/policy-engine.test.ts`

Add tests for redirection handling that reflect the actual `evaluate()` API:

```typescript
describe('redirection handling', () => {
  it('should downgrade ALLOW to ASK_USER for command with redirection when allowRedirection is false', () => {
    const engine = new PolicyEngine({
      rules: [{ toolName: 'run_shell_command', decision: PolicyDecision.ALLOW }],
    });
    const result = engine.evaluate('run_shell_command', { command: 'echo hello > out.txt' });
    expect(result).toBe(PolicyDecision.ASK_USER);
  });

  it('should allow redirection when allowRedirection is true on the rule', () => {
    const engine = new PolicyEngine({
      rules: [{
        toolName: 'run_shell_command',
        decision: PolicyDecision.ALLOW,
        allowRedirection: true,
      }],
    });
    const result = engine.evaluate('run_shell_command', { command: 'echo hello > out.txt' });
    expect(result).toBe(PolicyDecision.ALLOW);
  });

  it('should downgrade compound command with redirection to ASK_USER even if base commands are allowed', () => {
    const engine = new PolicyEngine({
      rules: [{ toolName: 'run_shell_command', decision: PolicyDecision.ALLOW }],
    });
    const result = engine.evaluate('run_shell_command', { command: 'git log && cat file.txt > out.txt' });
    expect(result).toBe(PolicyDecision.ASK_USER);
  });

  it('should return DENY for redirection in non-interactive mode', () => {
    const engine = new PolicyEngine({
      rules: [{ toolName: 'run_shell_command', decision: PolicyDecision.ALLOW }],
      nonInteractive: true,
    });
    const result = engine.evaluate('run_shell_command', { command: 'echo hello > out.txt' });
    expect(result).toBe(PolicyDecision.DENY);
  });

  it('should allow compound command without redirection if base commands are allowed', () => {
    const engine = new PolicyEngine({
      rules: [{ toolName: 'run_shell_command', decision: PolicyDecision.ALLOW }],
    });
    const result = engine.evaluate('run_shell_command', { command: 'git status && npm test' });
    expect(result).toBe(PolicyDecision.ALLOW);
  });
});
```

#### 5. `packages/cli/src/ui/components/messages/RedirectionConfirmation.test.tsx` (new file)

```typescript
describe('ToolConfirmationMessage redirection warning', () => {
  it('should display redirection warning for command with > operator', () => {
    const confirmationDetails = {
      type: 'exec' as const,
      command: 'echo "hello" > test.txt',
      rootCommand: 'echo',
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={100}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('echo "hello" > test.txt');
    expect(output).toContain('Command contains redirection');
  });

  it('should NOT display redirection warning for command without redirection', () => {
    const confirmationDetails = {
      type: 'exec' as const,
      command: 'git status',
      rootCommand: 'git',
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={100}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('git status');
    expect(output).not.toContain('Command contains redirection');
  });

  it('should display redirection warning for compound command with redirection', () => {
    const confirmationDetails = {
      type: 'exec' as const,
      command: 'git log && cat file.txt > out.txt',
      rootCommand: 'git',
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={100}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('Command contains redirection');
  });
});
```

## Files to Read

- `packages/core/src/policy/types.ts` [OK]
- `packages/core/src/policy/policy-engine.ts` [OK]
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` [OK]
- `packages/cli/src/ui/textConstants.ts` [OK]
- `packages/core/src/utils/shell-utils.ts` [OK] (no `hasRedirection` exists — must add)

## Files to Modify

- `packages/core/src/utils/shell-utils.ts` — add `hasRedirection`
- `packages/core/src/policy/policy-engine.ts` — optionally use `hasRedirection` instead of inline regex
- `packages/cli/src/ui/textConstants.ts` — add redirection warning constants
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` — add redirection warning UI
- `packages/core/src/policy/policy-engine.test.ts` — add redirection tests

## Files to Create

- `packages/cli/src/ui/components/messages/RedirectionConfirmation.test.tsx`

## Key Architectural Constraints

1. **`PolicyEngine.evaluate()` returns `PolicyDecision` directly** — never add `CheckResult`, `check()`, or `checkShellCommand()`.
2. **No `ApprovalMode` in the engine** — LLxprt uses `nonInteractive` + `allowRedirection` rule flags. The upstream `AUTO_EDIT` bypass does not exist in LLxprt.
3. **Single command string in UI** — `executionProps.command` is a single string. There is no `commands[]` array.
4. **`hasRedirection` must be quote-aware** — use proper state-machine parsing, not a bare regex like `/[>&|]/` which false-positives on quoted content.

## Specific Verification

1. `npm run test -- packages/core/src/policy/policy-engine.test.ts`
2. `npm run test -- packages/cli/src/ui/components/messages/ToolConfirmationMessage.test.tsx`
3. `npm run test -- packages/cli/src/ui/components/messages/RedirectionConfirmation.test.tsx`
4. Manual: Test shell command with `echo hello > test.txt` — confirm warning appears in confirmation dialog
5. Manual: Test shell command with `git status` — confirm no warning
6. Manual: Test compound command with redirection — confirm warning appears
