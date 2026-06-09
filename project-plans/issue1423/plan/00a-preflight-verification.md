# Phase 0.5: Preflight Verification

## Phase ID

`PLAN-20260608-ISSUE1423.P0.5`

## Purpose

Verify all assumptions before renaming files or identifiers.

## Requirements Implemented (Expanded)

### REQ-VERIFY-001: Behavioral and structural verification

**Full Text**: Existing behavior tests for chat sessions, CLI startup, config, and streaming MUST pass after the rename; add verification that old provider-agnostic source files/classes/accessors do not remain; full project verification must pass.

**Behavior**:

- GIVEN: issue #1423 targets provider-agnostic names that currently include Gemini
- WHEN: preflight runs
- THEN: it records actual files, call paths, test infrastructure, and blockers before implementation

**Why This Matters**: Rename plans commonly fail because hidden import paths or generated artifacts are mistaken for source. Preflight establishes the real scope.

## Verification Tasks

Run and paste actual outputs into `project-plans/issue1423/analysis/preflight-results.md`:

```bash
git status --short
test -f packages/core/src/core/geminiChat.ts && echo found
test -f packages/core/src/core/geminiChatTypes.ts && echo found
test -f packages/cli/src/gemini.tsx && echo found
rg -l "GeminiChat|geminiChat|geminiChatTypes|GeminiClient|getGeminiClient|geminiClient|gemini\.tsx|from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml' | sort
find packages/core/src/core packages/core/src/integration-tests packages/cli/src -maxdepth 3 \( -name '*geminiChat*' -o -name '*geminiClient*' -o -name 'gemini.tsx' -o -name 'gemini.*.test.*' \) | sort
grep -n "./core/geminiChat.js" packages/core/package.json
npm run typecheck -- --help >/dev/null 2>&1 || true
```

## Dependency Verification

| Dependency | Command | Expected |
|------------|---------|----------|
| TypeScript/Vitest | `npm run typecheck -- --help >/dev/null 2>&1 || true` | command infrastructure reachable |
| ripgrep | `rg --version` | installed |
| git | `git status --short` | branch is issue1423 and working tree only has intentional plan files |

## Type/Interface Verification

| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| `GeminiChat` | class in `packages/core/src/core/geminiChat.ts` | record from grep/read | YES before implementation |
| `GeminiClient` | class in `packages/core/src/core/client.ts` | record from grep/read | YES before implementation |
| `getGeminiClient` | config accessor in `ConfigBaseCore`/`Config` | record from grep/read | YES before implementation |

## Call Path Verification

| Function | Expected Caller | Evidence |
|----------|-----------------|----------|
| CLI `main` | `packages/cli/index.ts` imports `./src/gemini.js` before rename | paste grep output |
| `new GeminiClient` | `packages/core/src/config/config.ts` and A2A task before rename | paste grep output |
| `startChat` | agent client uses `ChatSessionFactory` and chat session | paste grep output |

## Test Infrastructure Verification

- Confirm existing tests are present for:
  - `packages/core/src/core/geminiChat*.test.ts`
  - `packages/core/src/core/__tests__/geminiClient*.test.ts`
  - `packages/cli/src/gemini*.test.*`
  - config/client tests

## Rename Surface Inventory

Preflight must refresh `project-plans/issue1423/analysis/current-rename-matches.txt` and update `analysis/rename-surface.md` if the file list differs materially from the checked-in plan inventory.

Generated/test-output artifacts such as `**/*.log`, `**/*.xml`, `dist`, and `coverage` are excluded from source remediation and from the regression scan.

## Blocking Issues Found

If any expected source file, package metadata export, or test infrastructure is missing, STOP and update the plan before P03.

## Verification Gate

- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready
- [ ] Out-of-scope Gemini provider files identified
- [ ] Package metadata export surface verified
- [ ] Generated artifact exclusions verified

IF ANY CHECKBOX IS UNCHECKED: STOP and update the plan.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P0.5.md` with actual command outputs and blocker assessment.
