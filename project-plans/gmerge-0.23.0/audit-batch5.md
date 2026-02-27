# Audit Report: Batch 5 of 7 (Commits 21-25)

## 2e229d3bb6 — "feat(core): Implement JIT context memory loading and UI sync (#14469)"
**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Upstream adds `ContextManager` class in `packages/core/src/services/contextManager.ts`
- LLxprt does NOT have `packages/core/src/services/contextManager.ts`
- Upstream adds `experimental.jitContext` setting to enable lazy-loading of `.gemini/GEMINI.md` files
- Changes affect: `config.ts`, `client.ts`, `memoryCommand.ts`, `environmentContext.ts`, `events.ts`
- Introduces `CoreEvent.MemoryChanged` event with reduced payload

**Rationale:**
This commit implements "Just-In-Time" context memory loading, where `.gemini/GEMINI.md` files are loaded on demand rather than at startup. The feature is controlled by `experimental.jitContext` setting (default: false).

**Key changes:**
1. New `ContextManager` service to handle memory loading separately from Config
2. When `experimentalJitContext=true`: skip loading memory at startup, create ContextManager, load via `refresh()`
3. Split memory into "global" (system instruction) and "environment" (context) parts
4. `getUserMemory()` now delegates to ContextManager when JIT enabled
5. MemoryChanged event payload simplified to `{fileCount}` instead of full response

**Why SKIP:**
- LLxprt has fundamentally different memory system (`.llxprt/LLXPRT.md` not `.gemini/GEMINI.md`)
- We load memory at startup and don't have performance issues requiring JIT
- This is experimental feature (off by default) in upstream
- Would require significant refactoring to introduce ContextManager service
- No user-reported performance issues with current memory loading
- The separation of global/environment memory doesn't align with our simpler model

**Conflicts expected:** N/A (skipping)

---

## 419464a8c2 — "feat(ui): Put 'Allow for all future sessions' behind a setting off by default (#15322)"
**Verdict:** NO_OP
**Confidence:** HIGH
**Evidence:**
- Upstream file: `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`
- LLxprt file: Same path exists
- Searched LLxprt codebase for "Allow for all future sessions" → **NO MATCHES**
- Checked LLxprt's `ToolConfirmationMessage.tsx` lines 1-50 → imports from `@vybestack/llxprt-code-core`, no UseSettings import

**Rationale:**
Upstream adds `security.enablePermanentToolApproval` setting (default: false) to control whether users see the "Allow for all future sessions" option in tool confirmation dialogs. This prevents users from accidentally approving tools permanently across sessions.

**Changes:**
1. Adds `security.enablePermanentToolApproval` to `settingsSchema.ts`
2. Adds `useSettings()` hook to `ToolConfirmationMessage.tsx`
3. Conditionally renders "Allow for all future sessions" option based on setting
4. Updates tests to verify behavior with setting on/off
5. All snapshots updated to reflect default (hidden) state

**Why NO_OP:**
LLxprt never implemented the "Allow for all future sessions" feature in the first place. Our tool confirmation UI doesn't have this option, so there's nothing to gate behind a setting. This is evidenced by:
- Zero matches for "Allow for all future sessions" in our codebase
- Our `ToolConfirmationMessage.tsx` is simpler (no SettingsContext usage)
- We already diverged from upstream's auto-approval persistence strategy

**Conflicts expected:** NO

---

## 181da07dd9 — "fix(cli):change the placeholder of input during the shell mode (#15135)"
**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Upstream file: `packages/cli/src/ui/components/Composer.tsx` line 173-177
- LLxprt file: Same path exists but only 76 lines total
- Upstream adds conditional placeholder text for shell mode

**Rationale:**
Simple UI improvement: when in shell mode, show "Type your shell command" instead of generic "Type your message or @path/to/file" placeholder.

**Changes:**
```typescript
placeholder={
  vimEnabled
    ? "  Press 'i' for INSERT mode and 'Esc' for NORMAL mode."
    : uiState.shellModeActive
      ? '  Type your shell command'
      : '  Type your message or @path/to/file'
}
```

**Why PICK:**
- Small, self-contained UX improvement
- LLxprt has shell mode functionality
- Makes the UI more helpful/clear
- No conflicts expected (just updating placeholder logic)
- Low risk, high value

**Conflicts expected:** NO - Direct application should work, though need to verify our Composer structure matches

---

## db67bb106a — "more robust command parsing logs (#15339)"
**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Upstream file: `packages/core/src/utils/shell-utils.ts` around line 305-340
- LLxprt file: Same path exists, same general structure
- Checked LLxprt's `shell-utils.ts` lines 300-350 → has `detectCommandSubstitution` and related logic
- Upstream adds debugLogger to `parseBashCommandDetails()` function

**Rationale:**
Adds detailed error logging when bash command parsing fails. When tree-sitter detects syntax errors, it now logs:
1. The problematic command
2. Specific syntax errors with line/column positions
3. Error type (Missing vs Error nodes)

**Changes:**
```typescript
const hasError = tree.rootNode.hasError || details.length === 0 || hasPromptCommandTransform(tree.rootNode);

if (hasError) {
  let query = null;
  try {
    query = new Query(bashLanguage, '(ERROR) @error (MISSING) @missing');
    const captures = query.captures(tree.rootNode);
    const syntaxErrors = captures.map((capture) => {
      const { node, name } = capture;
      const type = name === 'missing' ? 'Missing' : 'Error';
      return `${type} node: "${node.text}" at ${node.startPosition.row}:${node.startPosition.column}`;
    });
    
    debugLogger.log(
      'Bash command parsing error detected for command:',
      command,
      'Syntax Errors:',
      syntaxErrors,
    );
  } catch (_e) {
    // Ignore query errors
  } finally {
    query?.delete();
  }
}
```

**Why PICK:**
- Helps debug shell command parsing issues
- We use tree-sitter for bash parsing
- Uses debugLogger (not telemetry) - safe for LLxprt
- Will help troubleshoot user-reported shell command issues
- Low risk addition (logging only)

**Conflicts expected:** NO - LLxprt has same `parseBashCommandDetails` function, should apply cleanly

---

## 41a1a3eed1 — "fix(core): sanitize hook command expansion and prevent injection (#15343)"
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Upstream file: `packages/core/src/hooks/hookRunner.ts`
- LLxprt file: `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/hooks/hookRunner.ts`
- LLxprt `expandCommand()` at lines 340-345 → **VULNERABLE** (no escaping)
- LLxprt `spawn()` at line 221 → uses `shell: true` (**VULNERABLE**)
- Upstream adds `escapeShellArg()` and `getShellConfiguration()` imports from `shell-utils.ts`

**Rationale:**
**CRITICAL SECURITY FIX**: Prevents command injection via `$GEMINI_PROJECT_DIR` environment variable expansion in hooks.

**Vulnerability in LLxprt:**
```typescript
// Current LLxprt code (VULNERABLE):
private expandCommand(command: string, input: HookInput): string {
  return command
    .replace(/\$LLXPRT_PROJECT_DIR/g, input.cwd)  // ← NO ESCAPING!
    .replace(/\$GEMINI_PROJECT_DIR/g, input.cwd)
    .replace(/\$CLAUDE_PROJECT_DIR/g, input.cwd);
}

const child = spawn(command, {
  shell: true,  // ← ENABLES INJECTION!
});
```

If `input.cwd = "/test/project; echo 'pwned' > /tmp/pwned"` and hook command is `ls $GEMINI_PROJECT_DIR`, the expanded command becomes:
```bash
ls /test/project; echo 'pwned' > /tmp/pwned
```
This executes **both** commands due to `;` injection.

**Upstream fix:**
1. Import `escapeShellArg()` and `getShellConfiguration()` from `shell-utils.ts`
2. Get shell config (bash/powershell executable and args)
3. Escape `input.cwd` before replacement
4. Use `shell: false` and pass command as argument to shell executable

```typescript
// Fixed code:
const shellConfig = getShellConfiguration();
const command = this.expandCommand(hookConfig.command, input, shellConfig.shell);

const child = spawn(
  shellConfig.executable,
  [...shellConfig.argsPrefix, command],
  { shell: false }  // ← PREVENTS INJECTION!
);

private expandCommand(command: string, input: HookInput, shellType: ShellType): string {
  const escapedCwd = escapeShellArg(input.cwd, shellType);
  return command
    .replace(/\$GEMINI_PROJECT_DIR/g, () => escapedCwd)
    .replace(/\$CLAUDE_PROJECT_DIR/g, () => escapedCwd);
}
```

**Why REIMPLEMENT:**
- **CRITICAL SECURITY VULNERABILITY** in LLxprt's current hook system
- We reimplemented hooks from scratch, so exact patch won't apply
- Need to verify `escapeShellArg()` and `getShellConfiguration()` exist in LLxprt's `shell-utils.ts`
- Must adapt to LLxprt's `$LLXPRT_PROJECT_DIR` variable
- Test changes also important (verify injection prevention)

**Implementation plan:**
1. Verify `escapeShellArg()` and `getShellConfiguration()` exist in LLxprt's `shell-utils.ts`
2. Update `hookRunner.ts`:
   - Import shell utilities
   - Modify `expandCommand()` signature to accept `shellType`
   - Escape `input.cwd` before replacement
   - Get shell config in `executeHook()`
   - Change `spawn()` to use `shell: false` with explicit shell executable
3. Adapt test expectations (spawn called with shell executable, not raw command)
4. Add injection prevention test case

**Conflicts expected:** YES - Need to adapt to LLxprt's variable names and hook structure

---

## Summary

| Commit | Verdict | Priority | Security |
|--------|---------|----------|----------|
| 2e229d3bb6 | SKIP | N/A | No |
| 419464a8c2 | NO_OP | N/A | No |
| 181da07dd9 | PICK | Low | No |
| db67bb106a | PICK | Medium | No |
| 41a1a3eed1 | **REIMPLEMENT** | **CRITICAL** | **YES** |

**Action items:**
1. WARNING: **URGENT**: Fix hook command injection vulnerability (41a1a3eed1)
2. Apply shell mode placeholder improvement (181da07dd9)
3. Apply command parsing debug logging (db67bb106a)
