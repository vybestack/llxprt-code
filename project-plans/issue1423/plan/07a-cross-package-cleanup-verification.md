# Phase 07a: Cross-Package Cleanup Verification

## Phase ID

`PLAN-20260608-ISSUE1423.P07a`

## Prerequisites

- Required: Phase 07 completed.
- Verification: `test -f project-plans/issue1423/.completed/P07.md`.

## Verification Scope

Verify no targeted old names remain and any remaining Gemini names are actually provider-specific/out-of-scope.

## Required Checks

```bash
rg "GeminiChat|geminiChat|geminiChatTypes|GeminiClient|getGeminiClient|geminiClient|gemini\.tsx|from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml' --glob '!packages/cli/src/auth/**' --glob '!packages/cli/src/providers/**'
find packages/core/src/core packages/core/src/integration-tests packages/cli/src -maxdepth 3 \( -name '*geminiChat*' -o -name '*geminiClient*' -o -name 'gemini.tsx' -o -name 'gemini.*.test.*' \) | sort
grep -n "geminiChat" packages/core/package.json || true
npm run typecheck
npm run test
```

## Holistic Functionality Assessment

The reviewer must inspect every remaining match from the scan and classify it as PASS-legitimate or FAIL-violation. Also answer:

- Does the regression check pass for the right reason?
- Would an old-name shim be caught?
- Are generated artifacts excluded correctly?
- Is the `geminiStream/` folder name the only remaining allowed match in that area, with targeted core symbols inside it renamed?
- Does behavior remain reachable through CLI/A2A paths?

## PASS Criteria

PASS only if all targeted old names are removed and tests/typecheck pass.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P07a.md` with PASS/FAIL, scan classification, and assessment.
