# Interactive Shell Feature Plan

**Branch:** `20260129gmerge`
**Source Commit:** `181898cb` - feat(shell): enable interactive commands with virtual terminal (#6694)
**Date Added:** 2025-09-11 (upstream)
**Priority:** HIGH - User requested feature

---

## Overview

This feature enables fully interactive shell commands (vim, less, htop, git rebase -i, etc.) to run within the CLI by using a virtual terminal emulator. When a shell command runs, its output is captured via xterm.js headless terminal and rendered with proper ANSI styling.

---

## What LLxprt Already Has

LLxprt has **partial PTY infrastructure** already in place:

| Component | Status | Location |
|-----------|--------|----------|
| `@lydell/node-pty` dependency | YES | packages/core |
| `@xterm/headless` dependency | YES | packages/core |
| `getPty.ts` utility | YES | packages/core/src/utils/getPty.ts |
| `shouldUseNodePtyShell` setting | YES | packages/cli/src/config/settingsSchema.ts |
| PTY spawn in ShellExecutionService | YES | packages/core/src/services/shellExecutionService.ts |
| `headlessTerminal` in ShellExecutionService | YES | Already imports and uses Terminal from @xterm/headless |
| `terminalSerializer.ts` | **NO** | Need to add |
| `AnsiOutput.tsx` | **NO** | Need to add |
| `ShellInputPrompt.tsx` | **NO** | Need to add |
| `keyToAnsi.ts` | **NO** | Need to add |
| Shell focus/input handling in UI | **NO** | Need to add |
| `ptyId` tracking in tool calls | **NO** | Need to add |

---

## Components to Add

### 1. Core Package (`packages/core`)

#### `packages/core/src/utils/terminalSerializer.ts` (NEW - ~480 lines)
Serializes xterm.js Terminal buffer to structured ANSI tokens for rendering.

```typescript
export interface AnsiToken {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
  fg: string;
  bg: string;
}

export type AnsiLine = AnsiToken[];
export type AnsiOutput = AnsiLine[];

export function serializeTerminal(terminal: Terminal): AnsiOutput;
```

#### Update `packages/core/src/index.ts`
Export the new types and function.

### 2. CLI Package (`packages/cli`)

#### `packages/cli/src/ui/components/AnsiOutput.tsx` (NEW - ~46 lines)
React component to render AnsiOutput with proper styling.

```typescript
export const AnsiOutputText: React.FC<{
  data: AnsiOutput;
  availableTerminalHeight?: number;
  width: number;
}>;
```

#### `packages/cli/src/ui/components/ShellInputPrompt.tsx` (NEW - ~57 lines)
Input prompt shown when a shell command is focused for interactive input.

#### `packages/cli/src/ui/hooks/keyToAnsi.ts` (NEW - ~77 lines)
Converts Ink keypress events to ANSI escape sequences for sending to PTY.

#### Updates to Existing Files

| File | Changes |
|------|---------|
| `ToolMessage.tsx` | Add `ptyId`, `activeShellPtyId`, `embeddedShellFocused` props; render AnsiOutputText for ANSI output; show ShellInputPrompt when focused |
| `ToolGroupMessage.tsx` | Pass through shell focus props to ToolMessage |
| `AppContainer.tsx` | Track `activeShellPtyId` and `embeddedShellFocused` state |
| `UIStateContext.tsx` | Add shell focus state |
| `useGeminiStream.ts` | Handle PTY ID from tool execution |
| `types.ts` | Add `ptyId` to IndividualToolCallDisplay |

---

## Implementation Steps

### Phase 1: Core Terminal Serialization - DONE (commit 6df7e5f99)
1. [x] Copy `terminalSerializer.ts` from upstream (adapt imports)
2. [x] Add `terminalSerializer.test.ts` - 17 tests passing
3. [x] Export from `packages/core/src/index.ts`
4. [x] Verify existing ShellExecutionService can use it

### Phase 2: UI Components - DONE (commit 6df7e5f99)
1. [x] Add `AnsiOutput.tsx` component
2. [x] Add `AnsiOutput.test.tsx`
3. [x] Add `keyToAnsi.ts` hook
4. [x] Add `ShellInputPrompt.tsx` component

### Phase 3: Integration - DONE (commit 6df7e5f99)
1. [x] Update `ToolMessage.tsx` to render ANSI output
2. [x] Update `ToolGroupMessage.tsx` to pass props
3. [x] Update `AppContainer.tsx` with shell focus state (placeholders)
4. [x] Update `UIStateContext.tsx`
5. [x] Add `ptyId` to types

### Phase 4: Polish - TODO
1. [ ] Add ctrl+f focus keybinding
2. [ ] Wire up activeShellPtyId and embeddedShellFocused in AppContainer
3. [ ] Add Config.getEnableInteractiveShell() method
4. [ ] Test with vim, less, htop, git rebase -i
5. [ ] Update documentation

---

## Testing Checklist

- [ ] `echo "hello"` shows styled output
- [ ] `ls --color` shows colored output
- [ ] `vim test.txt` opens and is interactive
- [ ] `less README.md` works with scrolling
- [ ] `htop` renders and updates
- [ ] `git rebase -i` opens editor
- [ ] ctrl+f focuses shell
- [ ] ESC or ctrl+c unfocuses
- [ ] Multiple concurrent shell commands work

---

## Dependencies

Already present in LLxprt:
- `@lydell/node-pty` 
- `@xterm/headless`

No new dependencies needed.

---

## Estimated Effort

- **Phase 1:** 2-3 hours (terminalSerializer + tests)
- **Phase 2:** 2-3 hours (UI components)
- **Phase 3:** 3-4 hours (integration)
- **Phase 4:** 1-2 hours (polish)

**Total:** ~8-12 hours

---

## Related Upstream Commits

| SHA | Description | Relevance |
|-----|-------------|-----------|
| `181898cb` | feat(shell): enable interactive commands with virtual terminal (#6694) | Primary commit |
| `467a305f` | chore(shell): Enable interactive shell by default (#10661) | Default setting |
| `84f521b1` | fix(shell): cursor visibility when using interactive mode (#14095) | Bug fix |
| `558be873` | Re-land bbiggs changes to reduce margin on narrow screens (#10522) | UI polish |

---

## Notes

- LLxprt already has the PTY execution path working - this adds the UI rendering layer
- The `headlessTerminal` in ShellExecutionService already captures output, we just need to serialize and render it
- This feature is orthogonal to StickyHeaders - can be done in parallel
