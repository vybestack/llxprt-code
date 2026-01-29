# Phase 01: Domain Analysis

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P01`

## Prerequisites

- Required: Phase 0.5 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P0.5" .`
- Expected files from previous phase:
  - `project-plans/20260126issue1176/architecture.md`
  - `project-plans/20260126issue1176/plan/00a-preflight-verification.md`

## Requirements Implemented (Expanded)

### REQ-SEP-001: Central registry with five categories
**Full Text**: A central settings registry MUST exist with five categories: model-behavior, provider-config, cli-behavior, model-param, and custom-header.
**Behavior**:
- GIVEN: The architecture defines five categories
- WHEN: Settings are cataloged
- THEN: Each setting is assigned exactly one category
**Why This Matters**: A single source of truth prevents leakage and duplication.

### REQ-SEP-002: separateSettings classification
**Full Text**: separateSettings() MUST classify all known settings into the correct category and output separated buckets.
**Behavior**:
- GIVEN: A mixed settings object
- WHEN: separateSettings() is invoked
- THEN: Each key is categorized into the correct bucket
**Why This Matters**: Providers must receive only correct settings.

### REQ-SEP-003: Unknown settings default to cli-behavior
**Full Text**: Unknown settings MUST default to cli-behavior to prevent unsafe API leakage.
**Behavior**:
- GIVEN: A setting key not in registry
- WHEN: separateSettings() is invoked
- THEN: The key is placed in cliSettings only
**Why This Matters**: Safety against unexpected param leakage.

### REQ-SEP-004: RuntimeInvocationContext separated fields
**Full Text**: RuntimeInvocationContext MUST expose separated fields (cliSettings, modelBehavior, modelParams, customHeaders).
**Behavior**:
- GIVEN: A runtime invocation is created
- WHEN: Providers access invocation
- THEN: The separated fields are available as snapshots
**Why This Matters**: Providers stop reading raw ephemerals.

### REQ-SEP-005: Providers read from pre-separated modelParams
**Full Text**: Providers MUST read from pre-separated modelParams instead of filtering raw ephemerals.
**Behavior**:
- GIVEN: provider generateChat uses invocation
- WHEN: model params are needed
- THEN: invocation.modelParams is used directly
**Why This Matters**: Removes duplicated filtering and preserves valid params.

### REQ-SEP-006: CLI settings never appear in API requests
**Full Text**: CLI-only settings MUST never appear in provider API requests.
**Behavior**:
- GIVEN: CLI-only settings are configured
- WHEN: provider request is built
- THEN: those keys are not present in request payload
**Why This Matters**: Prevents API rejection and leakage.

### REQ-SEP-007: Model params pass through unchanged
**Full Text**: Model params MUST pass through unchanged when valid for the provider.
**Behavior**:
- GIVEN: model params in registry
- WHEN: request is built
- THEN: params are forwarded without transformation
**Why This Matters**: Avoids over-filtering.

### REQ-SEP-008: Custom headers extracted correctly
**Full Text**: Custom headers MUST be extracted and merged correctly, including provider overrides.
**Behavior**:
- GIVEN: custom-headers in global and provider overrides
- WHEN: request headers are built
- THEN: provider headers override global headers
**Why This Matters**: Enables per-provider auth/header overrides.

### REQ-SEP-009: Alias normalization
**Full Text**: Alias normalization MUST preserve legacy keys (e.g., max-tokens → max_tokens).
**Behavior**:
- GIVEN: legacy alias keys
- WHEN: settings are processed
- THEN: keys normalize to canonical forms
**Why This Matters**: Backward compatibility with existing profiles.

### REQ-SEP-010: Backward compatibility shim
**Full Text**: Backward compatibility shim MUST preserve ephemerals access with deprecation behavior.
**Behavior**:
- GIVEN: consumer reads invocation.ephemerals
- WHEN: access occurs
- THEN: value is returned from snapshot with warning behavior
**Why This Matters**: Prevents breaking existing integrations.

### REQ-SEP-011: Provider-config keys filtered
**Full Text**: Provider-config keys MUST be filtered from API requests.
**Behavior**:
- GIVEN: apiKey/baseUrl/toolFormat in settings
- WHEN: request is built
- THEN: these keys never appear in payload
**Why This Matters**: Avoids leaking infrastructure settings.

### REQ-SEP-012: Reasoning object sanitization
**Full Text**: Reasoning object MUST be sanitized and internal keys stripped.
**Behavior**:
- GIVEN: reasoning object with internal keys
- WHEN: normalization runs
- THEN: internal keys are removed before pass-through
**Why This Matters**: Prevents internal-only fields from hitting APIs.

### REQ-SEP-013: Profile alias normalization
**Full Text**: Profile alias normalization MUST occur when loading persisted settings.
**Behavior**:
- GIVEN: saved profile contains alias keys
- WHEN: profile is loaded
- THEN: alias keys normalize to canonical keys
**Why This Matters**: Users retain compatibility with old profiles.

## Domain Analysis

### Setting Categories and Ownership
1. Model Behavior
   - Provider-specific translation (reasoning.*)
   - Consumed by providers only
2. Provider Config
   - Infrastructure config (apiKey, baseUrl, model)
   - Consumed by ProviderManager/providers, never sent to API
3. CLI Behavior
   - Runtime and tool controls (streaming, shell-replacement)
   - Consumed by CLI and tools only
4. Model Params
   - Pass-through API parameters (temperature, max_tokens)
   - Consumed by providers directly
5. Custom Headers
   - HTTP headers merged into request
   - Consumed by providers

### Key Code Touchpoints (existing system integration)
- RuntimeInvocationContext: separation snapshot for providers and tools
- ProviderManager: buildEphemeralsSnapshot, provider-scoped overrides
- Providers: getModelParams, request header construction, reasoning translations
- CLI: /set command, profile load/save, ephemeralSettings parsing/validation

### Data Flow (end-to-end)
1. CLI parses /set and profile settings → SettingsService
2. ProviderManager builds snapshot → separateSettings() to buckets
3. RuntimeInvocationContext created with separated fields + ephemerals shim
4. Providers read invocation.modelParams/modelBehavior/customHeaders
5. Request payload built without CLI/provider-config leakage

### Integration Analysis (per PLAN.md)

**Existing code that will use this feature**
- `packages/core/src/providers/ProviderManager.ts` (buildEphemeralsSnapshot, context creation)
- `packages/core/src/runtime/RuntimeInvocationContext.ts` (new separated fields)
- `packages/core/src/providers/*` (OpenAI, Anthropic, Gemini, OpenAI Responses, OpenAI Vercel)
- `packages/cli/src/settings/ephemeralSettings.ts` (parse/validation)
- `packages/cli/src/ui/commands/setCommand.ts` (help/completion)
- `packages/cli/src/runtime/profileApplication.ts` (profile load normalization)

**Existing code to be replaced/removed**
- `packages/core/src/providers/openai/openaiRequestParams.ts` (filterOpenAIRequestParams)
- Provider-specific reservedKeys/allowlists in providers
- Duplicated CLI setting help lists and profile key lists

**User access points**
- CLI `/set` command and profile files
- Provider requests triggered by CLI runtime

**Migration requirements**
- Profile load normalizes aliases
- Deprecation shim for invocation.ephemerals access

## Implementation Scope Boundaries
- No new runtime features beyond settings separation
- No changes to API surface outside specified interfaces

## Output Artifacts
- `project-plans/20260126issue1176/plan/01-analysis.md`
