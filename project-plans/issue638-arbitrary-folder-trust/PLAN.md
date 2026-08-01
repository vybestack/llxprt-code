# Issue 638 — Allow adding arbitrary folder trusts from `/permissions` dialog

## Problem

`/permissions` (no args) opens `PermissionsModifyTrustDialog`, which is hardwired to
`process.cwd()` / `config.getWorkingDir()`. A user can only change the trust level of the
folder they happen to be sitting in. Managing trust for any other folder requires either the
`/permissions <LEVEL> <path>` argument form or hand-editing `trustedFolders.json`, and there is
no way to see or clean up existing rules.

## Goal

From the `/permissions` dialog, a user can:

1. change trust for the current folder (unchanged default flow),
2. type/paste an arbitrary folder path and assign it a trust level,
3. review all existing trust rules and change or remove them,

performing several edits in one dialog session.

## Existing building blocks (no new subsystems required)

| Concern              | Existing asset                                                                     |
| -------------------- | ---------------------------------------------------------------------------------- |
| Persistence          | `LoadedTrustedFolders` in `packages/cli/src/config/trustedFolders.ts` — already path-agnostic (`setValue` / `deleteValue` / `getValue` / `rules`) |
| Trust resolution     | `resolvePathTrust`, `resolveLocalWorkspaceTrust`                                    |
| Dialog state         | `usePermissionsModifyTrust`                                                          |
| List selection       | `RadioButtonSelect`                                                                  |
| Free-text entry      | `ProfileCreateWizard/TextInput`                                                       |
| Display / error copy | `ui/trustDialogHelpers.ts`                                                            |

## Design decisions

**D1 — Free-text path entry, not a filesystem browser.** Reuses the existing `TextInput`
primitive, mirrors the existing `/permissions <LEVEL> <path>` text workflow, and avoids
introducing a directory-navigation subsystem the issue does not ask for.

**D2 — Live session trust is always resolved for the working directory.** Today
`commitSavedTrustLevel` derives live trust from the same path it persists. Once the persisted
path can be arbitrary, those two must be separated: we persist for `targetPath` but always
recompute the session's live trust from the working directory (a new rule on an ancestor of the
cwd can still legitimately change cwd trust). `permissionsCommand` already behaves this way.

**D3 — Paths are validated before commit.** `LoadedTrustedFolders.setValue` canonicalizes via
`fs.realpathSync` and therefore throws for a non-existent path. The dialog validates that the
entered path exists and is a directory, and reports the problem inline instead of surfacing a
commit failure.

**D4 — Rule removal deletes the stored key.** `deleteValue` canonicalizes first, so a rule whose
folder has since been deleted can never be removed through it. The manage-rules view removes by
the literal stored rule key so stale rules are cleanable.

## Acceptance matrix

### A. Shared path normalization

| ID  | Behavior                                                                             |
| --- | ------------------------------------------------------------------------------------ |
| A1  | Absolute input is normalized (`/a/b/../c` → `/a/c`)                                   |
| A2  | Relative input resolves against the supplied working directory                         |
| A3  | `~` and `~/sub` expand to the home directory; `~user` is left literal (not expanded)   |
| A4  | Empty / whitespace-only input yields an explicit "path required" error, not a throw    |
| A5  | Surrounding whitespace and matched surrounding quotes are stripped (paste-friendly)    |
| A6  | `permissionsCommand` uses the shared helper, so `/permissions TRUST_FOLDER ~/x` works  |

### B. Target-path aware hook

| ID  | Behavior                                                                              |
| --- | ------------------------------------------------------------------------------------- |
| B1  | `targetPath` defaults to the working directory                                          |
| B2  | `setTargetPath` normalizes input through the shared helper                              |
| B3  | `effectiveLocalTrustLevel`, `isParentTrusted`, `parentFolderName` derive from `targetPath` |
| B4  | `commitTrustLevel` persists against `targetPath`                                        |
| B5  | Live trust after any commit is resolved from the working directory, never `targetPath`  |
| B6  | Hook exposes the current rule list, refreshed after every mutation                      |
| B7  | Hook exposes rule removal that works for rules whose folder no longer exists            |
| B8  | Existing rollback-on-failure semantics preserved for persistence and live phases        |
| B9  | IDE trust remains authoritative for display of the working directory only               |

### C. Dialog UI

**D5 — Navigation is added to the existing trust form, not layered above it.** The original plan
sketched a new root menu ("Current folder" / "Add another folder" / "Manage existing rules") as the
dialog's first view. Rejected: it demotes the overwhelmingly common action (trust the folder I am
in) behind an extra keystroke and changes long-established behavior that the existing dialog tests
pin. Instead the trust form stays the entry view and gains navigation entries below the three trust
levels. The default flow — open `/permissions`, press Enter, trust the current folder — is byte-for-byte
unchanged, and the new capabilities are additive.

| ID  | Behavior                                                                                       |
| --- | ---------------------------------------------------------------------------------------------- |
| C1  | The trust form remains the entry view and still targets the cwd; pressing Enter still commits `TRUST_FOLDER` |
| C2  | The option list additionally offers "Add another folder" and "Manage existing rules"             |
| C3  | "Add another folder" opens a text input; submitting a valid directory retargets the form to that path |
| C4  | A non-existent path, or a path that is a file rather than a directory, shows an inline error and keeps focus in the input |
| C5  | Empty/whitespace submission shows an inline error and keeps focus in the input                    |
| C6  | "Manage existing rules" lists every rule's path and trust level                                   |
| C7  | Selecting a listed rule retargets the trust form to that rule's path                              |
| C8  | The trust form offers "Remove this rule" when the active target has a direct rule; removing it updates the list without exiting |
| C9  | After committing a change for a non-cwd target, the dialog returns to the rules list so several folders can be edited in one session |
| C10 | After committing a change for the cwd, the existing "Trust level updated" prompt is shown          |
| C11 | Escape steps back one view; Escape on the cwd trust form exits the dialog                          |
| C12 | The form header, current-level line, and IDE/parent warnings reflect the active target path        |
| C13 | Commit and removal failures surface the existing error copy and keep the dialog open               |

## Non-goals (explicit)

- No filesystem browser / directory quick-picker (D1).
- No glob or wildcard trust rules.
- No change to the `trustedFolders.json` on-disk format.
- No change to trust *resolution* semantics (specificity ordering, deny-wins, IDE precedence).
- No change to the `/permissions <LEVEL> <path>` argument contract beyond gaining `~` support.
- No batch/multi-select operations.
- No restart-prompt mechanism (this codebase uses the existing `UpdatedPrompt`, not the upstream
  `showRestartPrompt`/`onRestart` flow).

## Bounded vertical slices

**Slice 1 — Normalization helper.** New `normalizeTrustPathInput` (A1–A5) plus adoption in
`permissionsCommand` (A6). Tests first.

**Slice 2 — Hook generalization.** `targetPath` state, cwd-scoped live trust, rules list and
removal (B1–B9). Tests first.

**Slice 3 — Dialog UI.** View modes, path entry, rules management, navigation (C1–C13). Tests
first.

**Slice 4 — Docs.** `/permissions` entry in `docs/cli/commands.md`.

## Expected paths

Production:

- `packages/cli/src/config/trustPaths.ts` (new)
- `packages/cli/src/ui/commands/permissionsCommand.ts`
- `packages/cli/src/ui/hooks/usePermissionsModifyTrust.ts`
- `packages/cli/src/ui/components/PermissionsModifyTrustDialog.tsx`
- `packages/cli/src/ui/trustDialogHelpers.ts`
- `packages/cli/src/config/trustedFolders.ts` (literal-key rule removal only)
- `docs/cli/commands.md`

Tests:

- `packages/cli/src/config/trustPaths.test.ts` (new)
- `packages/cli/src/ui/commands/permissionsCommand.test.ts`
- `packages/cli/src/ui/hooks/permissionsModifyTrustDialog.behavior.test.tsx`
- `packages/cli/src/ui/components/PermissionsModifyTrustDialog.test.tsx`
- `packages/cli/src/ui/trustDialogHelpers.test.ts`
- `packages/cli/src/config/trustedFolders.test.ts`

Anything outside this list is a scope-ledger entry requiring justification.

## Scope ledger

| # | Change | Status | Justification |
| - | ------ | ------ | ------------- |
| 1 | Literal-key rule removal on `LoadedTrustedFolders` | Planned | D4 — required for C8; canonicalizing removal cannot delete stale rules |
| 2 | Split persistence path from live-trust path in the hook | Planned | D2 — required for correctness of B4/B5 once the target path is arbitrary |
| 3 | `~` expansion in the shared helper | Planned | A3 — the existing `permissionsCommand` comment claims it but never implemented it |
| 4 | Reject the proposed root menu; extend the existing trust form instead | Accepted | D5 — preserves the one-keystroke default flow and the behavior pinned by existing dialog tests |
| 5 | Suppress IDE trust and live session trust for non-cwd targets | Accepted | B9 — IDE/session trust describe the IDE workspace; without this an unrelated folder is displayed as trusted purely because the current session is |
| 6 | Extract the path-entry and rules-list views into sibling components | Accepted | Keeps `PermissionsModifyTrustDialog.tsx` under the 800-line / 80-line-per-function lint budget without loosening any rule |

## Stop-for-approval triggers

Adding an unplanned subsystem or public abstraction; workflow / agent-memory / quality-tool /
dependency changes; unrelated refactors or test moves; behavior outside this acceptance matrix;
exceeding the hard scope budget.
