# Plan: Issue #3238 — Footer branch indicator shows `(main*)` even when clean

## Problem

`BranchDisplay` in `packages/cli/src/ui/components/Footer.tsx` hardcodes the trailing `*` on both render paths. The star is literal UI chrome, not derived from git dirty state. `useGitBranchName` only reads the branch name via `git rev-parse --abbrev-ref HEAD`; nothing computes dirty state and nothing watches the working tree.

## Boundary

- Dirty = `git status --porcelain` from `cwd` is non-empty. Untracked files count as dirty (shell-prompt convention, per issue fix direction). Outside a git repo or on error: not dirty → no star.
- The hook return must be renamed to carry both `branchName` and `isGitDirty`. `useAppLayout` propagates both → buildUIState → UIState → buildMainControlsProps → FooterSection → Footer → FooterFirstLine → BranchDisplay.

## Changes

### 1. `packages/cli/src/ui/hooks/useGitBranchName.ts`
- Rename export to `useGitBranchInfo(cwd)` returning `{ branchName: string | undefined; isDirty: boolean }`.
- Add `git status --porcelain` exec in the same fetch call as the branch fetch (single exec per poll tick, token-guarded like today).
- Extend refresh: keep `fs.watchFile` on `.git/logs/HEAD` (reflog → branch switches/commits) AND `.git/index` (stages/commits). Plain edits to tracked files and untracked file creation/removal touch neither file, so a `GIT_WATCH_POLL_MS` (3000) periodic poll drives those transitions; the poll and the watchers share the same `FETCH_DEBOUNCE_MS` (200) debounce. Fetches for one refresh tick are aggregated into one result tuple and never overlap: a refresh requested while one is in flight is queued and runs after, so a slow `git status` cannot be dropped. A branch failure hides the branch; a status failure is never dirty. Cleanup clears the pending debounce, the poll interval, and both watchers.
- Keeping the `useGitBranchName` export name would be fewer call sites, but tests + mock hygiene (no self-mocking in Footer tests) drive a rename. The production call site is exactly one: `useAppLayout` (import + usage + return). Update the one real call site and the 3 AppContainer mock files (`AppContainer.mount.test.tsx`, `AppContainer.keybindings.test.tsx`, `AppContainer.render-budget.test.tsx`) that provide the fake.

### 2. `packages/cli/src/ui/containers/AppContainer/hooks/useAppLayout.ts`
- Replace `const branchName = useGitBranchName(getTargetDir())` with `const { branchName, isDirty } = useGitBranchInfo(getTargetDir())`; return both from `useLayoutContext` and the `useAppLayout` result.

### 3. `packages/cli/src/ui/containers/AppContainer/builders/buildUIState.ts`
- Add `branchName: string | undefined` + `branchIsDirty: boolean` to both `UIStateParams` and the `UIState`-facing `buildDisplayAndContext`. Note: `UIState` itself is declared in `UIStateContext.tsx` and is built here via `buildDisplayAndContext`; the `UIState` interface already carries `branchName` and gains `branchIsDirty`. Both `buildUIState.test.ts` and `DefaultAppLayout.test.tsx` compile-time object literal fixtures must include `branchIsDirty`. (DefaultAppLayout.test tweaks are type-level fixture maintenance, not behavior changes.)

### 4. `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` + `DefaultAppLayoutHelpers.tsx`
- Thread `branchIsDirty: boolean` through `MainControlsProps` and `FooterProps` → `<Footer branchIsDirty={...}>`.
- `FooterSection` and `buildMainControlsProps` pass it through untouched; `FooterFirstLine` passes it to `BranchDisplay`.

### 5. `packages/cli/src/ui/components/Footer.tsx`
- `BranchDisplay` gains `isDirty: boolean`; append `*` inside the parens only when `isDirty`. Both nightly and non-nightly paths. Clean → `(main)`, dirty → `(main*)`.
- `FooterProps`, `FooterFirstLineProps`, plumbing.

### 6. Tests — TDD-first
- `useGitBranchName.test.tsx` (RENAME file to `useGitBranchInfo.test.tsx`): command-routing tests branch on the git command arg. Cases: clean → `{ branchName, isDirty: false }`; `git status --porcelain` returns lines → `isDirty: true`; error → not dirty; detached-HEAD short SHA still works; `.git/logs/HEAD` change still refetches; dirty flip via `.git/index` watcher; untracked-file flip via the periodic poll; coalescing (a refresh during an in-flight fetch is queued, not started); one-sided branch/status failures; unmount clears a pending debounce; unmount disposes watchers that resolve later; detached HEAD waits for the short SHA; a stale old-`cwd` completion cannot clear a newer fetch. Cleanup/unwatch still uses the same listener refs.

## Follow-ups / deliberate decisions (review rounds)
- `git` command failure is treated as "not dirty" (status error → no star; branch failure → hides branch). This is the issue's error contract. All git commands run with a 20 MiB `maxBuffer` (porcelain output on very large trees cannot overflow the 1 MiB default and be misread as clean) and a 10 s `timeout` so a hung command settles and never wedges the in-flight refresh guard; we kept `exec` (not `execFile`) because the options fully address the failure modes and the mocks route on the command string.
- `fs.watchFile` registration is wrapped in try/catch; a synchronous throw (invalid path, exhausted watcher resources) falls back to the periodic poll instead of surfacing as an unhandled rejection.
- A transient `stepfun-37` smoke failure on this machine flips to exit 0 on re-run; treat machine-specific (see root verification notes for the unrelated ripgrep/agents failures).
- `ui/components/Footer.test.tsx`: update `20250808-gmerge*` → `(20250808-gmerge*)` exact (no space), change the not-have `*` test to assert on a clean `branchIsDirty: false` fixture, add a dirty test, cover both nightly and non-nightly render paths, and a nightly clean case → no star.
- `ui/__tests__/AppContainer.*.test.tsx` (3 files): update the `useGitBranchName` mock to `useGitBranchInfo: vi.fn(() => ({ branchName: null, isDirty: false }))`.
- `useGitBranchName` name must NOT exist as a spurious leftover anywhere.

## Conventions
- Copyright 2026. No new .js files. bun:test only. No `execSync`. No new files unless listed. Run: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`; `bun scripts/start.ts --help` or repo start to sanity-check footer render.

## Verification cycle
Full verification cycle after implementation and after any remediation. Format/lint/typecheck/test/build all green before commit/push.

## Non-goals
- No rename refactor beyond preserving correctness. Keep same debounce/cancellation semantics. Do not touch unrelated plan files.
