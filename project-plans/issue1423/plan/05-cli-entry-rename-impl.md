# Phase 05: CLI Entry Rename Implementation

## Phase ID

`PLAN-20260608-ISSUE1423.P05`

## Prerequisites

- Required: Phase 04a PASS.
- Verification: `grep -q "PASS" project-plans/issue1423/.completed/P04a.md`.
- Pseudocode: `analysis/pseudocode/rename-refactor.md` lines 40-47.

## Requirements Implemented (Expanded)

### REQ-NAME-002: CLI entry module rename

**Full Text**: `packages/cli/src/gemini.tsx` MUST be renamed to `packages/cli/src/cli.tsx`; CLI imports, tests, and comments that refer to the old entry file MUST be updated; old CLI entry module path MUST NOT remain as a source file or exported shim.

**Behavior**:

- GIVEN: users start the CLI through `packages/cli/index.ts`
- WHEN: the entry module is renamed
- THEN: the binary imports `./src/cli.js` and behavior remains unchanged

**Why This Matters**: The old filename misrepresents the provider-agnostic CLI entry point.

## Implementation Tasks

### Files to Rename

- `packages/cli/src/gemini.tsx` → `packages/cli/src/cli.tsx`
- `packages/cli/src/gemini.test.tsx` → `packages/cli/src/cli.test.tsx`
- `packages/cli/src/gemini.startInteractiveUI.test.tsx` → `packages/cli/src/cli.startInteractiveUI.test.tsx`
- `packages/cli/src/gemini.provider-init.test.ts` → `packages/cli/src/cli.provider-init.test.ts`
- `packages/cli/src/gemini.renderOptions.test.tsx` → `packages/cli/src/cli.renderOptions.test.tsx`

### Files to Modify

- `packages/cli/index.ts`: import `main` from `./src/cli.js`.
- `packages/cli/src/commands/skills.tsx`: import listener initialization from `../cli.js`.
- `packages/cli/src/commands/skills.test.tsx`: mock `../cli.js`.
- Renamed CLI tests: update imports/dynamic imports/descriptions from `gemini.js`/`gemini.tsx` to `cli.js`/`cli.tsx`.
- Comments in related files that refer to the entry module.

## Verification Commands

```bash
test -f packages/cli/src/cli.tsx
test ! -f packages/cli/src/gemini.tsx
rg "\.\/src\/gemini\.js|\.\/gemini\.js|\.\.\/gemini\.js|gemini\.tsx" packages/cli/src packages/cli/index.ts --glob '!packages/cli/src/auth/**' --glob '!packages/cli/src/providers/**'
npm run typecheck
```

## Deferred Implementation Detection

```bash
rg "from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages/cli/src packages/cli/index.ts
# Expected: no old CLI entry imports
```

## Semantic Verification Checklist

- [ ] Binary entry point imports the renamed CLI module.
- [ ] No `gemini.tsx` wrapper remains.
- [ ] CLI tests import the renamed module.
- [ ] Provider-specific Gemini auth/provider files are untouched.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P05.md` with moved files, scan output, and typecheck status.
