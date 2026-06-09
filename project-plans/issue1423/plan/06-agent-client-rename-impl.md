# Phase 06: Agent Client and Config Accessor Rename Implementation

## Phase ID

`PLAN-20260608-ISSUE1423.P06`

## Prerequisites

- Required: Phase 05a PASS.
- Verification: `grep -q "PASS" project-plans/issue1423/.completed/P05a.md`.
- Pseudocode: `analysis/pseudocode/rename-refactor.md` lines 60-71.

## Requirements Implemented (Expanded)

### REQ-NAME-003: Agent client rename

**Full Text**: `GeminiClient` MUST be renamed to `AgentClient` in `packages/core/src/core/client.ts`; config storage and accessor MUST be renamed from `geminiClient`/`getGeminiClient()` to `agentClient`/`getAgentClient()`; all production and test callers in core, CLI, A2A, and test utilities MUST use the new names; old client names MUST NOT remain as aliases, compatibility exports, or wrapper types.

**Behavior**:

- GIVEN: existing code obtains and uses the provider-agnostic agent client
- WHEN: the rename is implemented
- THEN: callers use `AgentClient` and `config.getAgentClient()` through the same runtime behavior

**Why This Matters**: `GeminiClient` is the misleading provider-agnostic name specifically called out by issue #1423.

## Implementation Tasks

### Files to Rename

- `packages/core/src/core/__tests__/geminiClient.dispose.test.ts` → `packages/core/src/core/__tests__/agentClient.dispose.test.ts`
- `packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts` → `packages/core/src/core/__tests__/agentClient.runtimeState.test.ts`

### Files to Modify

- `packages/core/src/core/client.ts`
  - Rename exported class `GeminiClient` to `AgentClient`.
  - Update `GeminiChat` type usage to `ChatSession` if not completed in P04.
- `packages/core/src/config/configBaseCore.ts`
  - Import `AgentClient`.
  - Rename protected field `geminiClient` to `agentClient`.
  - Rename method `getGeminiClient()` to `getAgentClient()`.
- `packages/core/src/config/config.ts`
  - Construct `new AgentClient(...)`.
  - Update `this.geminiClient` to `this.agentClient`.
  - Update any internal accessor use.
- `packages/core/src/index.ts`
  - Ensure public export exposes `AgentClient` and does not expose `GeminiClient` alias.
- All callers across `packages/core/src`, `packages/cli/src`, `packages/a2a-server/src`, `packages/providers/src`, and test utilities listed in `analysis/current-rename-matches.txt`:
  - Rename type imports `GeminiClient` to `AgentClient`.
  - Rename calls `getGeminiClient()` to `getAgentClient()`.
  - Rename local variables, helper names, comments, and test stubs/mocks from `geminiClient`/`mockGeminiClient` to agent-client names where they refer to the core agent client.
  - Include CLI hooks/commands/test-utils/Zed integration/non-interactive tests, A2A task/executor/tests/testing_utils, core tools/utilities/telemetry/config tests, provider tests that import core client types, and files inside `packages/cli/src/ui/hooks/geminiStream/**` that contain provider-agnostic client symbols.

## Verification Commands

```bash
rg "GeminiClient|getGeminiClient|geminiClient" packages/core/src packages/cli/src packages/a2a-server/src packages/providers/src --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml'
npm run typecheck
```

Expected: no targeted old client/accessor violations. Remaining lowercase local words are violations unless they are documented legitimate text in provider-specific/out-of-scope comments.

## Deferred Implementation Detection

```bash
rg "export .*GeminiClient|GeminiClient.*=|getGeminiClient\s*\(" packages/core/src packages/cli/src packages/a2a-server/src packages/providers/src --glob '!**/*.test.ts' --glob '!**/*.log' --glob '!**/*.xml'
# Expected: no aliases/shims
```

## Semantic Verification Checklist

- [ ] Config constructs and stores `AgentClient`.
- [ ] Callers use `getAgentClient()` directly.
- [ ] No old method alias exists.
- [ ] A2A and CLI compile against the renamed export.
- [ ] Runtime logic in client methods is unchanged except identifiers/imports.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P06.md` with moved files, scan output, and typecheck status.
