# Phase 07: Cross-Package Cleanup Implementation

## Phase ID

`PLAN-20260608-ISSUE1423.P07`

## Prerequisites

- Required: Phase 06a PASS.
- Verification: `grep -q "PASS" project-plans/issue1423/.completed/P06a.md`.
- Pseudocode: `analysis/pseudocode/rename-refactor.md` lines 80-83.

## Requirements Implemented (Expanded)

### REQ-NAME-001 through REQ-NAME-003: No old provider-agnostic names remain

**Full Text**: Old chat module paths, CLI entry path, core class names, and config accessor names MUST NOT remain as aliases, compatibility exports, wrappers, or stale callers.

**Behavior**:

- GIVEN: phases 04-06 performed the primary renames
- WHEN: cleanup runs
- THEN: all straggling source/test/docs comments in the implementation surface are updated or documented as legitimate Gemini provider-specific names

**Why This Matters**: Large mechanical renames often leave stale comments, mocks, test utility names, or package references that continue to confuse agents.

## Implementation Tasks

### Files to Modify

- Any remaining source/test files under `packages/` that still reference targeted old provider-agnostic names.
- Package metadata or test snapshots if they refer to renamed test/source files.
- Completion documentation under `project-plans/issue1423/.completed/`.

## Required Scans

```bash
rg "GeminiChat|geminiChat|geminiChatTypes|GeminiClient|getGeminiClient|geminiClient|gemini\.tsx|from ['\"].*gemini\.js['\"]|import\(['\"].*gemini\.js['\"]\)" packages --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml' --glob '!packages/cli/src/auth/**' --glob '!packages/cli/src/providers/**'
find packages/core/src/core packages/core/src/integration-tests packages/cli/src -maxdepth 3 \( -name '*geminiChat*' -o -name '*geminiClient*' -o -name 'gemini.tsx' -o -name 'gemini.*.test.*' \) | sort
grep -n "geminiChat" packages/core/package.json || true
```

For each remaining match, either fix it or record why it is in a deliberately out-of-scope Gemini provider-specific path. The `packages/cli/src/ui/hooks/geminiStream/**` folder name itself is allowed, but targeted provider-agnostic core symbols inside those files are not allowed.

## Verification Commands

```bash
npm run typecheck
npm run test
```

## Semantic Verification Checklist

- [ ] No stale old-name comments in renamed target areas.
- [ ] No old-name test mocks/types remain for the core agent client.
- [ ] No renamed source file has an old provider-agnostic filename.
- [ ] Legitimate Gemini provider-specific names are preserved.
- [ ] Naming regression check now passes.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P07.md` with final scan output, any allowed-match rationale, and verification status.
