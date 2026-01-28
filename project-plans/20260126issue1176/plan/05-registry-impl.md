# Phase 05: Settings Registry Implementation

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P05`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P04" .`
- Expected files from previous phase:
  - `packages/core/src/settings/__tests__/settingsRegistry.test.ts`

## Requirements Implemented (Expanded)

### REQ-SEP-001: Central registry with five categories
**Full Text**: A central settings registry MUST exist with five categories: model-behavior, provider-config, cli-behavior, model-param, and custom-header.
**Behavior**:
- GIVEN: SETTINGS_REGISTRY is implemented
- WHEN: Settings are enumerated
- THEN: Every entry has one of the 5 categories, with at least 5 model-behavior, 15 cli-behavior, 8 model-param, 1 custom-header, 8 provider-config entries
**Why This Matters**: Single source of truth eliminates scattered definitions.

### REQ-SEP-002: separateSettings classification
**Full Text**: separateSettings() MUST classify all known settings into the correct category and output separated buckets.
**Behavior**:
- GIVEN: mixed settings { temperature: 0.7, 'shell-replacement': 'none', 'reasoning.enabled': true, apiKey: 'sk-xxx' }
- WHEN: separateSettings() runs
- THEN: temperature in modelParams, shell-replacement in cliSettings, reasoning.enabled in modelBehavior, apiKey filtered (provider-config)
**Why This Matters**: Providers receive only their relevant settings.

### REQ-SEP-003: Unknown settings default to cli-behavior
**Full Text**: Unknown settings MUST default to cli-behavior to prevent unsafe API leakage.
**Behavior**:
- GIVEN: { 'brand-new-magic-setting': 'value' } not in registry
- WHEN: separateSettings() runs
- THEN: key appears in cliSettings only (NOT modelParams)
**Why This Matters**: Prevents new/unknown keys from accidentally reaching API requests.

### REQ-SEP-008: Custom headers extracted correctly
**Full Text**: Custom headers MUST be extracted and merged correctly, including provider overrides.
**Behavior**:
- GIVEN: { 'custom-headers': '{"X-Global": "g"}', openai: { 'custom-headers': '{"X-Global": "p"}' } }
- WHEN: separateSettings(mixed, 'openai') runs
- THEN: customHeaders['X-Global'] === 'p' (provider wins)
**Why This Matters**: Enables provider-specific authentication headers.

### REQ-SEP-009: Alias normalization
**Full Text**: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
**Behavior**:
- GIVEN: key 'max-tokens'
- WHEN: resolveAlias('max-tokens') runs
- THEN: returns 'max_tokens'
**Why This Matters**: Backward compatibility with existing profiles and settings.

### REQ-SEP-012: Reasoning object sanitization
**Full Text**: Reasoning object MUST be sanitized and internal keys stripped.
**Behavior**:
- GIVEN: reasoning object { enabled: true, includeInResponse: true, effort: 'high' }
- WHEN: normalizeSetting('reasoning', value) runs
- THEN: returns { effort: 'high' } (enabled and includeInResponse removed)
**Why This Matters**: Internal control flags must not leak to API.

## Implementation Tasks

### Files to Modify

- `packages/core/src/settings/settingsRegistry.ts`
  - Implement full SETTINGS_REGISTRY array with all settings classified per architecture
  - Implement ALIAS_NORMALIZATION_RULES map
  - Implement HEADER_PRESERVE_SET
  - Implement resolveAlias() — pseudocode lines 01-09
  - Implement normalizeSetting() — pseudocode lines 10-18
  - Implement separateSettings() — pseudocode lines 19-50
  - Implement getSettingSpec() — lookup by key
  - Implement isCliSetting() — check category
  - Implement isPlainObject() — type predicate

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P05
 * @requirement REQ-SEP-001, REQ-SEP-002, REQ-SEP-003, REQ-SEP-008, REQ-SEP-009, REQ-SEP-012
 * @pseudocode lines 01-50
 */
```

### Settings Categories (from architecture)

**model-behavior**: reasoning.enabled, reasoning.effort, reasoning.maxTokens, reasoning.format, reasoning.budgetTokens, reasoning.stripFromContext, reasoning.includeInContext, reasoning.includeInResponse, prompt-caching, rate-limit-throttle, rate-limit-throttle-threshold, rate-limit-max-wait

**cli-behavior**: context-limit, compression-threshold, streaming, tool-output-max-items, tool-output-max-tokens, tool-output-item-size-limit, shell-replacement, emojifilter, authOnly, dumponerror, todo-continuation, disabled-tools, tools.disabled, tools.allowed, stream-options, socket-path, socket-reconnect-delay, socket-max-reconnect-attempts

**model-param**: temperature, max_tokens, top_p, top_k, seed, frequency_penalty, presence_penalty, stop, response_format, reasoning (object)

**custom-header**: custom-headers

**provider-config**: apiKey, baseUrl, model, enabled, toolFormat, defaultModel, apiKeyfile, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION

### Alias Normalization Rules

max-tokens→max_tokens, response-format→response_format, api-key→apiKey, base-url→baseUrl, auth-key→apiKey, auth-keyfile→apiKeyfile, tool-format→toolFormat, default-model→defaultModel, disabled-tools→tools.disabled

### Header Preserve Set

user-agent, content-type, authorization, x-api-key (hyphens NOT converted to underscores)

## Verification Commands

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
```

## Success Criteria

- ALL Phase 04 tests pass (GREEN)
- No TODO/FIXME/HACK in implementation
- Pseudocode steps 01-50 traceable in implementation
- SETTINGS_REGISTRY has entries for all categories

## Deferred Implementation Detection

```bash
grep -rn "TODO\|FIXME\|HACK\|STUB\|XXX\|TEMPORARY\|WIP" packages/core/src/settings/settingsRegistry.ts
grep -rn "return \[\]\|return {}\|return null\|return undefined" packages/core/src/settings/settingsRegistry.ts
grep -rn "in a real\|in production\|ideally\|for now\|placeholder\|not yet\|will be\|should be" packages/core/src/settings/settingsRegistry.ts
```

## Semantic Verification Checklist

After implementation, manually trace this scenario:

**Input**: `separateSettings({ temperature: 0.7, 'shell-replacement': 'none', 'reasoning.enabled': true, apiKey: 'sk-xxx', 'custom-headers': '{"X-Test": "val"}', 'unknown-future-setting': 'hello' }, 'openai')`

**Expected trace**:
1. `temperature` → getSettingSpec finds model-param → modelParams.temperature = 0.7
2. `shell-replacement` → getSettingSpec finds cli-behavior → cliSettings['shell-replacement'] = 'none'
3. `reasoning.enabled` → getSettingSpec finds model-behavior → modelBehavior['reasoning.enabled'] = true
4. `apiKey` → getSettingSpec finds provider-config → IGNORED (not in any output bucket)
5. `custom-headers` → SKIPPED in main loop (extracted separately into customHeaders)
6. `unknown-future-setting` → getSettingSpec returns undefined → cliSettings['unknown-future-setting'] = 'hello' (REQ-SEP-003 safe default)
7. customHeaders has { 'X-Test': 'val' }

**Verify**: temperature NOT in cliSettings. shell-replacement NOT in modelParams. apiKey NOT in modelParams. unknown-future-setting NOT in modelParams.

## Holistic Functionality Assessment

Write a brief assessment answering:
- Does SETTINGS_REGISTRY contain entries for all 5 categories? (count per category)
- Does separateSettings correctly route the trace scenario above?
- Does resolveAlias handle all 9 alias rules?
- Does reasoning sanitization strip enabled/includeInResponse but keep effort?
- Are REQ-SEP-001, REQ-SEP-002, REQ-SEP-003, REQ-SEP-008, REQ-SEP-009, REQ-SEP-012 satisfied?

## Failure Recovery

- `git checkout -- packages/core/src/settings/settingsRegistry.ts`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P05.md`
