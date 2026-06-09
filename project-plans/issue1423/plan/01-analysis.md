# Phase 01: Analysis Validation

## Phase ID

`PLAN-20260608-ISSUE1423.P01`

## Prerequisites

- Required: Phase 0.5 completed.
- Verification: `test -f project-plans/issue1423/.completed/P0.5.md`.
- Expected files: `specification.md`, `analysis/domain-model.md`, `analysis/integration-contract.md`.

## Requirements Implemented (Expanded)

### REQ-NAME-001: Chat session module rename

**Full Text**: Rename `geminiChat.ts`, `GeminiChat`, and `geminiChatTypes.ts` to provider-agnostic chat session names and remove old source paths/exports.

**Behavior**:

- GIVEN: provider-agnostic chat session code currently has Gemini names
- WHEN: analysis is validated
- THEN: all chat-session files/callers to rename are enumerated and out-of-scope Gemini provider files are excluded

**Why This Matters**: The implementation must be broad enough to update callers but narrow enough not to rename actual Gemini provider code.

### REQ-NAME-002: CLI entry module rename

**Full Text**: Rename `packages/cli/src/gemini.tsx` to `cli.tsx` and update imports, tests, and comments.

**Behavior**:

- GIVEN: CLI startup imports `gemini.js`
- WHEN: analysis is validated
- THEN: every entry-module import/test/comment target is listed

**Why This Matters**: Missing the binary import breaks user startup.

### REQ-NAME-003: Agent client rename

**Full Text**: Rename `GeminiClient`, `geminiClient`, and `getGeminiClient()` to agent-client names everywhere without aliases.

**Behavior**:

- GIVEN: core/CLI/A2A code calls the current accessor and class
- WHEN: analysis is validated
- THEN: all source packages that must migrate are identified

**Why This Matters**: The rename is only complete if all callers move to the new API.

## Implementation Tasks

### Files to Modify

- `project-plans/issue1423/analysis/domain-model.md`
  - Validate and enrich affected files and out-of-scope list based on preflight.
- `project-plans/issue1423/analysis/integration-contract.md`
  - Validate lifecycle and interface boundaries.

## Verification Commands

```bash
test -f project-plans/issue1423/analysis/preflight-results.md
test -f project-plans/issue1423/analysis/domain-model.md
test -f project-plans/issue1423/analysis/integration-contract.md
```

## Semantic Verification Checklist

- [ ] Analysis distinguishes provider-agnostic old names from actual Gemini provider names.
- [ ] Analysis lists core, CLI, A2A, and test utility consumers.
- [ ] Analysis identifies no-alias/no-shim policy.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P01.md` with files reviewed, changes made, and analysis verdict.
