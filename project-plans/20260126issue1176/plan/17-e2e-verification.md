# Phase 17: End-to-End Verification

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P17`

## Prerequisites

- Required: Phase 16 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P16" .`
- Expected: All phases 03-16 completed and verified

## Full Verification Suite

### Quantitative Verification (all must pass)

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### Removal Verification

```bash
# filterOpenAIRequestParams should have ZERO usage calls in provider files
grep -rn "filterOpenAIRequestParams" packages/core/src/providers/openai/OpenAIProvider.ts
grep -rn "filterOpenAIRequestParams" packages/core/src/providers/openai-vercel/
grep -rn "filterOpenAIRequestParams" packages/core/src/providers/openai-responses/

# reservedKeys should have ZERO matches in these providers
grep -rn "reservedKeys" packages/core/src/providers/anthropic/
grep -rn "reservedKeys" packages/core/src/providers/gemini/

# Plan markers should be 15+
grep -rc "@plan:PLAN-20260126-SETTINGS-SEPARATION" packages/ | grep -v ":0$" | wc -l
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn "TODO\|FIXME\|HACK\|STUB\|XXX\|TEMPORARY\|WIP" packages/core/src/settings/ packages/core/src/runtime/RuntimeInvocationContext.ts packages/core/src/providers/
grep -rn "NotYetImplemented" packages/core/src/settings/ packages/core/src/runtime/
```

### Semantic Verification

Trace complete data flow:
1. User runs `/set temperature 0.7` and `/set shell-replacement none`
2. Settings stored in SettingsService
3. On next LLM call, ProviderManager.buildEphemeralsSnapshot() creates merged settings
4. separateSettings() classifies: temperature → modelParams, shell-replacement → cliSettings
5. RuntimeInvocationContext created with separated fields
6. Provider reads invocation.modelParams → temperature in API request
7. shell-replacement never reaches API request body
8. Custom headers merged and applied

### Holistic Functionality Assessment

For each requirement, verify coverage:
- REQ-SEP-001: Registry exists with 5 categories → check settingsRegistry.ts
- REQ-SEP-002: separateSettings classifies correctly → check registry tests pass
- REQ-SEP-003: Unknown settings in cliSettings → check registry tests
- REQ-SEP-004: Context has separated fields → check RuntimeInvocationContext
- REQ-SEP-005: Providers use modelParams → check provider code
- REQ-SEP-006: CLI settings not in API → check integration tests
- REQ-SEP-007: Model params pass through → check integration tests
- REQ-SEP-008: Custom headers work → check integration tests
- REQ-SEP-009: Aliases resolve → check registry tests
- REQ-SEP-010: Backward compat shim → check context tests
- REQ-SEP-011: Provider-config filtered → check integration tests
- REQ-SEP-012: Reasoning sanitized → check integration tests
- REQ-SEP-013: Profile alias normalization → check CLI tests

## Success Criteria

- All 6 verification commands succeed
- filterOpenAIRequestParams removed from provider invocation code
- reservedKeys removed from Anthropic/Gemini
- 15+ plan markers across codebase
- Zero TODO/FIXME/HACK/STUB in modified files
- Haiku test produces actual output (not error)

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P17.md`
Update: `project-plans/20260126issue1176/plan/execution-tracker.md` with final status
