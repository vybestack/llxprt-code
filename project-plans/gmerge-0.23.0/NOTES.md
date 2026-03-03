# gmerge/0.23.0 Notes

## Post-Batch Work

### B2 deferred: `@typescript-eslint/await-thenable` eslint rule (7f2d33458a)
- Originally skipped in B2 due to 37-file conflict across the entire codebase.
- Applied post-batch in `3ae2ffe6a`: added rule to eslint.config.js and fixed all 59 violations across 29 files.
- The await-thenable fixes changed production code from `await syncFn()` to `syncFn()`, but test mocks still used `mockResolvedValue` (returning Promises). This caused 77 test failures caught in CI.
- Fixed in `5c596e8d4`: changed `mockResolvedValue` → `mockReturnValue` and `mockRejectedValue` → `mockImplementation(() => { throw error })` across 8 test files.

### B9 full parity: 322232e514 (TerminalCapabilityManager)
- Original B9 batch was SELECTIVE: only color-utils detection functions + theme-manager wiring (`3da1b20a8`).
- Full parity implemented post-batch in 6 phases (`ef00d1255`..`9f35a087a`):
  1. TerminalCapabilityManager (replaces kittyProtocolDetector)
  2. Config terminalBackground + setupTerminalAndTheme utility
  3. RadioButtonSelect renderItem + ThemeDialog compatibility labels/sorting
  4. Integration wiring (gemini.tsx, AppContainer.tsx)
  5. Bug command terminal diagnostics
  6. Delete kittyProtocolDetector + migrate all imports
- Additional fixes: raw mode state restoration (`72649ef78`), isDiffingEnabled race (`abac6636d`), CodeRabbit issues (`4096c057b`).

### tokenCalculation.ts deleted
- Upstream's B22 improved token estimation for images (flat 3000-token estimate).
- LLxprt deleted the file as dead code — nothing imported it. Multi-provider architecture doesn't use Gemini's token counting.
- Filed issue #1648 for provider-aware image token estimation.

### Audit fixes
- `useAlternateBuffer.ts` was a stub returning `false` with a TODO comment. Fixed to read `settings.merged.ui?.useAlternateBuffer` (matching the pattern used by AppContainer, DefaultAppLayout, and inkRenderOptions).
- `shades-of-purple.ts` Background color was not updated: `#2d2b57` → `#1e1e3f` (upstream fix for VSCode terminal).
- `test-utils/render.tsx` missing `terminalBackgroundColor: undefined` in baseMockUiState.

### Pre-existing test failure
- `ToolConfirmationMessage > 'for mcp confirmations' > should show "allow always" when folder is trusted` — fails both before and after this PR. Not introduced by gmerge/0.23.0.

## Skipped Upstream Commits

### B2: `26c115a4fb` (tips removal)
- **Reason:** LLxprt already had the tips file deleted — no-op.

### B2: `7f2d33458a` (eslint no-return-await mass change)
- **Reason:** 37-file conflict across the entire codebase. Mass eslint rule change that touches files heavily diverged in LLxprt. Deferred to a separate follow-up task.

## Conflicts Resolved

### B4: `2f8095af5` (Windows clipboard paste)
- Cherry-pick applied cleanly but introduced lint/branding issues. Fix-up commit `387b5b0ae` applied lint fixes and LLxprt branding corrections.

### B9: `322232e5` (background color detection — SELECTIVE)
- Upstream was a 28-file refactor. Per plan, only the core detection functions (`detectTerminalBackgroundColor`, `getThemeTypeFromBackgroundColor`) and theme init wiring were implemented. The broader 28-file refactor was intentionally excluded. Some auto-formatting changes appeared in the diff from prettier; these were formatting-only (no logic changes).

### B15: `2e229d3b` (JIT context memory / ContextManager)
- Required multiple intermediate commits to get tests passing. The `loadJitSubdirectoryMemory` signature differed from upstream. Final commit `7c47188d8` squashed the approach.

### B16: Security cherry-picks (4 commits)
- `433ad174e` fix-up was needed for type errors from missing `useAlternateBuffer` hook and ContextManager mock updates.
- `23455054b` additional test mock updates for ContextManager and B16 security features.

### B17: `41a1a3ee` (hook injection fix — CRITICAL SECURITY)
- Removed `GEMINI_PROJECT_DIR` and `CLAUDE_PROJECT_DIR` legacy compatibility from `hookRunner.ts`. LLxprt only supports `LLXPRT_PROJECT_DIR`.
- `escapeShellArg()` function implemented with proper shell metacharacter sanitization.
- `shell: false` used in spawn to prevent injection.

### B18: `e6414691` (accepting-edits fix)
- Conflict on `smart-edit.ts` which doesn't exist in LLxprt (removed feature). File was `git rm`'d during conflict resolution.
- Fix-up commit `0defba2d4` added `toolName`/`displayName` pass-through to tool invocations.

### B22: `17fb7586` (token calc patch)
- Conflict on `eslint.config.js` (LLxprt uses `eslint-plugin-license-header`, upstream switched to `eslint-plugin-headers`). Kept LLxprt's version.
- Conflict on `client.ts` — upstream added `tokenCalculation` and `chatRecordingService` imports that don't exist in LLxprt. Kept LLxprt's version.
- `tokenCalculation.ts` and `tokenCalculation.test.ts` deleted (don't exist in LLxprt).

## Architecture Decisions

- **LLXPRT_PROJECT_DIR only:** B17 removed all `GEMINI_PROJECT_DIR` / `CLAUDE_PROJECT_DIR` backward compat. Only `LLXPRT_PROJECT_DIR` is supported.
- **No smart-edit.ts:** Confirmed removed feature stays removed (B18 check).
- **Background color detection scope:** Only core functions + theme init wiring from upstream's 28-file refactor (B9).
- **clipboardUtils.windows.test.ts pattern:** Async `vi.mock` factory causes real `spawn` to be captured before mock resolves. Fix: synchronous factory with `vi.hoisted` + `Symbol.for('nodejs.util.promisify.custom')`.
