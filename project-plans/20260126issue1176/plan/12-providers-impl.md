# Phase 12: Providers Implementation

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P12`

## Prerequisites

- Required: Phase 11 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P11" .`
- Expected files from previous phase:
  - Provider test files from Phase 11
  - `packages/core/src/providers/__tests__/settingsSeparation.integration.test.ts` (Phase 09)

## Requirements Implemented (Expanded)

### REQ-SEP-005: Providers read from pre-separated modelParams
**Full Text**: Providers MUST read from pre-separated modelParams instead of filtering raw ephemerals.
**Behavior**:
- GIVEN: invocation.modelParams contains { temperature: 0.7 }
- WHEN: provider builds API request
- THEN: request body includes temperature: 0.7, read from modelParams not ephemerals
**Why This Matters**: Eliminates duplicated allowlists/blocklists across providers.

### REQ-SEP-006: CLI settings never appear in API requests
**Full Text**: CLI-only settings MUST never appear in provider API requests.
**Behavior**:
- GIVEN: cliSettings contains { 'shell-replacement': 'none', streaming: 'enabled' }
- WHEN: any provider builds API request
- THEN: request body does NOT contain shell-replacement or streaming keys
**Why This Matters**: Prevents unknown parameters from causing API errors.

### REQ-SEP-007: Model params pass through unchanged
**Full Text**: Model params MUST pass through unchanged when valid for the provider.
**Behavior**:
- GIVEN: modelParams contains { temperature: 0.7, max_tokens: 1000, seed: 42 }
- WHEN: OpenAI provider builds request
- THEN: all three appear in request body with exact values
**Why This Matters**: Prevents over-filtering that strips valid API params.

### REQ-SEP-008: Custom headers extracted correctly
**Full Text**: Custom headers MUST be extracted and merged correctly, including provider overrides.
**Behavior**:
- GIVEN: invocation.customHeaders contains { 'X-Custom': 'val' }
- WHEN: request sent
- THEN: HTTP headers include X-Custom: val
**Why This Matters**: Enables authentication and proxy configurations.

### REQ-SEP-011: Provider-config keys filtered
**Full Text**: Provider-config keys MUST be filtered from API requests.
**Behavior**:
- GIVEN: original settings included apiKey, baseUrl, model, toolFormat
- WHEN: request built
- THEN: none of these appear in request body (they are infrastructure config, not API params)
**Why This Matters**: Prevents infrastructure settings from leaking into API payloads.

### REQ-SEP-012: Reasoning object sanitization
**Full Text**: Reasoning object MUST be sanitized and internal keys stripped.
**Behavior**:
- GIVEN: reasoning object with { enabled: true, includeInResponse: true, effort: 'high' }
- WHEN: OpenAI request built
- THEN: request reasoning has effort but NOT enabled or includeInResponse
**Why This Matters**: Prevents internal control flags from leaking to API.

## Implementation Tasks

### Files to Modify

1. `packages/core/src/providers/ProviderManager.ts`
   - Update `buildEphemeralsSnapshot()` to call `separateSettings()` from settingsRegistry
   - Pass separated result into RuntimeInvocationContext creation
   - Follow ProviderManager pseudocode lines 01-06

2. `packages/core/src/providers/BaseProvider.ts`
   - Add `getCustomHeadersFromInvocation()` merging base headers with invocation.customHeaders
   - Follow Provider pseudocode lines 03-06

3. `packages/core/src/providers/openai/OpenAIProvider.ts`
   - Change `getModelParams()` to read from `options.invocation.modelParams`
   - **REMOVE** calls to `filterOpenAIRequestParams()` — separation is now upstream
   - Use `invocation.modelBehavior` for reasoning settings
   - Follow Provider pseudocode lines 01-02, 10-18

4. `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
   - Same pattern: read from invocation.modelParams
   - Remove filterOpenAIRequestParams calls

5. `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts`
   - Same pattern: read from invocation.modelParams
   - Remove filterOpenAIRequestParams calls

6. `packages/core/src/providers/anthropic/AnthropicProvider.ts`
   - Change `getModelParams()` to read from `options.invocation.modelParams`
   - **REMOVE** reservedKeys Set (no longer needed)
   - Use `invocation.modelBehavior` for reasoning.enabled → thinking config

7. `packages/core/src/providers/gemini/GeminiProvider.ts`
   - Change `getModelParams()` to read from `options.invocation.modelParams`
   - **REMOVE** reservedKeys Set

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P12
 * @requirement REQ-SEP-005, REQ-SEP-006, REQ-SEP-007, REQ-SEP-008, REQ-SEP-011, REQ-SEP-012
 * @pseudocode ProviderManager lines 01-06, Provider lines 01-18
 */
```

### Key Removals

- `filterOpenAIRequestParams()` calls in OpenAI, OpenAI Vercel, OpenAI Responses providers
- `reservedKeys` Set in Anthropic and Gemini providers
- Any per-provider allowlist/blocklist filtering that is now handled by separateSettings()

## Verification Commands

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
```

## Success Criteria

- Phase 11 provider unit tests pass (GREEN)
- Phase 09 integration tests pass (GREEN)
- ALL existing provider tests still pass
- No calls to filterOpenAIRequestParams remain in provider invocation code
- No reservedKeys Sets remain in Anthropic/Gemini

## Deferred Implementation Detection

After implementation, verify:
```bash
grep -rn "TODO\|FIXME\|HACK\|STUB\|XXX\|TEMPORARY\|WIP" packages/core/src/providers/
grep -rn "filterOpenAIRequestParams" packages/core/src/providers/openai/OpenAIProvider.ts
grep -rn "filterOpenAIRequestParams" packages/core/src/providers/openai-vercel/
grep -rn "filterOpenAIRequestParams" packages/core/src/providers/openai-responses/
grep -rn "reservedKeys" packages/core/src/providers/anthropic/
grep -rn "reservedKeys" packages/core/src/providers/gemini/
```

## Semantic Verification Checklist

Trace data flow for scenario: User sets temperature=0.7, shell-replacement=none, custom-headers={"X-Test":"v"}, apiKey=sk-xxx

1. **SettingsService** → stores all settings
2. **ProviderManager.buildEphemeralsSnapshot()** → calls separateSettings(merged, 'openai')
3. **separateSettings** → temperature in modelParams, shell-replacement in cliSettings, X-Test in customHeaders, apiKey filtered (provider-config)
4. **RuntimeInvocationContext** → created with separated fields, frozen
5. **OpenAIProvider.getModelParams()** → reads invocation.modelParams → gets { temperature: 0.7 }
6. **OpenAIProvider** → builds request with temperature in body, shell-replacement absent, apiKey absent
7. **BaseProvider.getCustomHeadersFromInvocation()** → merges base + invocation.customHeaders → X-Test in headers

Verify: grep for filterOpenAIRequestParams calls in OpenAI provider — should be ZERO. Grep for reservedKeys in Anthropic — should be ZERO.

## Holistic Functionality Assessment

After implementation, answer:
- Does ProviderManager call separateSettings? (check import + call site)
- Do ALL 5 providers read from invocation.modelParams? (check each getModelParams)
- Are filterOpenAIRequestParams calls removed from all 3 OpenAI-family providers?
- Is reservedKeys Set removed from Anthropic and Gemini?
- Does the Anthropic provider translate reasoning.enabled from modelBehavior to thinking config?
- Do Phase 09 integration tests and Phase 11 unit tests both pass?

## Failure Recovery

- `git checkout -- packages/core/src/providers/`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P12.md`
