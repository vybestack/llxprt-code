# Phase 05a: CLI Entry Rename Verification

## Phase ID

`PLAN-20260608-ISSUE1423.P05a`

## Prerequisites

- Required: Phase 05 completed.
- Verification: `test -f project-plans/issue1423/.completed/P05.md`.

## Verification Scope

Verify CLI entry rename is complete and user startup remains reachable.

## Required Checks

```bash
test -f packages/cli/src/cli.tsx
test ! -f packages/cli/src/gemini.tsx
grep -n "./src/cli.js" packages/cli/index.ts
rg "gemini\.tsx|from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages/cli/src packages/cli/index.ts --glob '!packages/cli/src/auth/**' --glob '!packages/cli/src/providers/**'
npm run typecheck
```

## Holistic Functionality Assessment

The reviewer must read `packages/cli/index.ts`, `packages/cli/src/cli.tsx`, and one renamed CLI test. Answer:

- How does the binary reach the renamed CLI module?
- Is there a wrapper/alias left behind?
- Are test imports and mocks updated?
- Are remaining Gemini names legitimate provider-specific names?

## PASS Criteria

PASS only if old CLI entry path is removed and startup path points to `cli.js`.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P05a.md` with PASS/FAIL and assessment.
