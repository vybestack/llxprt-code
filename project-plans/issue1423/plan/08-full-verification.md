# Phase 08: Full Verification Suite and Smoke Test

## Phase ID

`PLAN-20260608-ISSUE1423.P08`

## Prerequisites

- Required: Phase 07a PASS.
- Verification: `grep -q "PASS" project-plans/issue1423/.completed/P07a.md`.
- Pseudocode: `analysis/pseudocode/rename-refactor.md` lines 84-92.

## Requirements Implemented (Expanded)

### REQ-VERIFY-001.3: Full verification

**Full Text**: Full verification required by project memory MUST pass before check-in.

**Behavior**:

- GIVEN: the rename has touched core, CLI, tests, and A2A call sites
- WHEN: full verification runs
- THEN: the project passes tests, lint, typecheck, format, build, and smoke startup

**Why This Matters**: Mechanical renames can compile in one package but fail integration/build/smoke behavior elsewhere.

## Implementation Tasks

Run the complete verification suite from repository root:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

If any command fails, remediate only the failure cause and re-run the failed command plus any later commands that could be affected. Do not reintroduce old names.

## Required Final Scans

```bash
rg "GeminiChat|geminiChat|geminiChatTypes|GeminiClient|getGeminiClient|geminiClient|gemini\.tsx|from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml' --glob '!packages/cli/src/auth/**' --glob '!packages/cli/src/providers/**'
test -z "$(grep -n "geminiChat" packages/core/package.json || true)"
git status --short
```

## Semantic Verification Checklist

- [ ] Tests pass.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Format applied.
- [ ] Build passes.
- [ ] Smoke command returns a haiku and exits successfully.
- [ ] Core package metadata has no `geminiChat` export.
- [ ] Git status contains only intentional issue #1423 changes.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P08.md` with actual verification outputs.
