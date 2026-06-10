# Phase 04: Core Chat Session Rename Implementation

## Phase ID

`PLAN-20260608-ISSUE1423.P04`

## Prerequisites

- Required: Phase 03a PASS.
- Verification: `grep -q "PASS" project-plans/issue1423/.completed/P03a.md`.
- Pseudocode: `analysis/pseudocode/rename-refactor.md` lines 20-30.

## Requirements Implemented (Expanded)

### REQ-NAME-001: Chat session module rename

**Full Text**: `packages/core/src/core/geminiChat.ts` MUST be renamed to `packages/core/src/core/chatSession.ts`; `GeminiChat` MUST be renamed to `ChatSession`; `packages/core/src/core/geminiChatTypes.ts` MUST be renamed to `packages/core/src/core/chatSessionTypes.ts`; old chat module paths MUST NOT remain as source files or exported shims.

**Behavior**:

- GIVEN: callers import and use the provider-agnostic chat session
- WHEN: the rename is implemented
- THEN: callers import `chatSession.js` / `chatSessionTypes.js` and type `ChatSession`
- AND: existing chat behavior is unchanged

**Why This Matters**: These names are a major source of LLM confusion in the core agent runtime.

## Implementation Tasks

### Files to Rename

- `packages/core/src/core/geminiChat.ts` → `packages/core/src/core/chatSession.ts`
- `packages/core/src/core/geminiChatTypes.ts` → `packages/core/src/core/chatSessionTypes.ts`
- `packages/core/src/core/geminiChat*.test.ts` → `packages/core/src/core/chatSession*.test.ts`
- `packages/core/src/core/__tests__/geminiChat*.test.ts` → `packages/core/src/core/__tests__/chatSession*.test.ts`
- `packages/core/src/integration-tests/geminiChat-isolation.integration.test.ts` → `packages/core/src/integration-tests/chatSession-isolation.integration.test.ts`

### Files to Modify

- `packages/core/src/core/chatSession.ts`
  - Rename class `GeminiChat` to `ChatSession`.
  - Update re-exports/imports from `./geminiChatTypes.js` to `./chatSessionTypes.js`.
- `packages/core/src/index.ts`
  - Update chat session re-export path to `./core/chatSession.js`.
- `packages/core/package.json`
  - Replace export subpath `./core/geminiChat.js` with `./core/chatSession.js` and `./dist/src/core/chatSession.js` target.
- Representative non-core callers/tests from `analysis/current-rename-matches.txt`, including `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` if it imports chat session types, plus A2A/CLI/core tests that import `geminiChat.js` or `geminiChatTypes.js`.
- All source/tests importing `geminiChat.js` or `geminiChatTypes.js`.
- All direct type references and local/test helper names from `GeminiChat` to `ChatSession` where they refer to the provider-agnostic chat session.

## Required Code Markers

No marker is required inside broadly renamed production code if it would add noise. Completion marker must cite pseudocode lines 20-30.

## Verification Commands

```bash
test -f packages/core/src/core/chatSession.ts
test -f packages/core/src/core/chatSessionTypes.ts
test ! -f packages/core/src/core/geminiChat.ts
test ! -f packages/core/src/core/geminiChatTypes.ts
grep -n "./core/chatSession.js" packages/core/package.json
test -z "$(grep -n "./core/geminiChat.js" packages/core/package.json || true)"
rg "geminiChat\.js|geminiChatTypes\.js|GeminiChat" packages --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml' --glob '!packages/cli/src/auth/**' --glob '!packages/cli/src/providers/**'
npm run typecheck
```

Expected: targeted scan returns no violations except documented out-of-scope provider-specific matches.

## Deferred Implementation Detection

```bash
rg "export .*GeminiChat|GeminiChat.*=|geminiChat\.ts" packages/core/src --glob '!**/*.test.ts'
# Expected: no shim/alias matches
```

## Semantic Verification Checklist

- [ ] Existing chat/session behavior code is unchanged except names/imports.
- [ ] No old chat module wrapper file remains.
- [ ] All callers compile against `ChatSession`.
- [ ] Renamed tests still execute.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P04.md` with moved files, scan output, and typecheck status.
