# gmerge/0.23.0 Notes

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
