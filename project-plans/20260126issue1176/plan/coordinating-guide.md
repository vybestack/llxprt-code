# Coordinating Guide for PLAN-20260126-SETTINGS-SEPARATION

## Coordination Rules

- Execute phases in strict numerical order: 00a → 01 → 01a → 02 → 02a → 03 → 03a → ... → 17 → 17a
- One subagent per phase
- Subagent assignment: **typescriptexpert** for stubs/TDD/impl, **deepthinker** for verification (phases ending in 'a')
- Verification must PASS before proceeding to next phase
- Quantitative gate after every phase: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`
- Qualitative gate (deepthinker review) after implementation phases: 05, 08, 12, 15, 16
- Remediation loop: if verification fails → typescriptexpert fixes → deepthinker re-reviews → max 3 iterations before escalating to human
- Final E2E gate (Phase 17): `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Important: ProviderManager Changes

Phase 12 includes BOTH individual provider changes AND ProviderManager.buildEphemeralsSnapshot() changes. The ProviderManager must call separateSettings() to produce the separated snapshot that providers consume. Phase 12 also includes removing calls to filterOpenAIRequestParams() in OpenAI providers.

---

## Phase 00a: Preflight Verification

**Subagent**: typescriptexpert

**Prompt**:
```
You are executing preflight verification for PLAN-20260126-SETTINGS-SEPARATION.

Read these files:
- project-plans/20260126issue1176/plan/00a-preflight-verification.md
- project-plans/20260126issue1176/architecture.md

Execute these verification commands and report results:

1. DEPENDENCY CHECK:
   grep -r "msw" packages/core/package.json
   grep -r "vitest" packages/core/package.json

2. TYPE CHECK - verify these interfaces exist:
   grep -A 20 "interface RuntimeInvocationContext" packages/core/src/runtime/RuntimeInvocationContext.ts
   grep -A 10 "EphemeralSettings" packages/core/src/types/modelParams.ts

3. CALL PATH CHECK - verify these functions exist:
   grep -n "buildEphemeralsSnapshot" packages/core/src/providers/ProviderManager.ts
   grep -n "filterOpenAIRequestParams" packages/core/src/providers/openai/openaiRequestParams.ts
   grep -n "getModelParams" packages/core/src/providers/anthropic/AnthropicProvider.ts
   grep -n "getModelParams" packages/core/src/providers/openai/OpenAIProvider.ts
   grep -n "getModelParams" packages/core/src/providers/gemini/GeminiProvider.ts
   grep -n "getCustomHeaders" packages/core/src/providers/BaseProvider.ts

4. TEST INFRASTRUCTURE CHECK:
   ls packages/core/src/runtime/__tests__/ 2>/dev/null || echo "No runtime tests dir"
   ls packages/core/src/providers/__tests__/ 2>/dev/null || echo "No providers tests dir"
   find packages/core/src/providers -name "*.test.ts" | head -10

Write results to project-plans/20260126issue1176/plan/00a-preflight-results.md

If ANY dependency is missing or ANY call path does not exist, list it as a BLOCKING ISSUE.
```

---

## Phase 01: Analysis

**Subagent**: typescriptexpert

**Prompt**:
```
You are executing Phase 01 (domain analysis) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (the approved architecture)
- project-plans/20260126issue1176/plan/01-analysis.md (the phase spec)
- packages/core/src/runtime/RuntimeInvocationContext.ts
- packages/core/src/providers/ProviderManager.ts
- packages/core/src/providers/BaseProvider.ts
- packages/core/src/providers/openai/openaiRequestParams.ts
- packages/cli/src/settings/ephemeralSettings.ts
- packages/cli/src/runtime/runtimeSettings.ts

Create: project-plans/20260126issue1176/analysis/domain-model.md

The domain model must document:
1. The 5 setting categories: model-behavior, cli-behavior, model-param, custom-header, provider-config
2. Every code touchpoint where settings are currently read/written (list file + function + line number)
3. Data flow: SettingsService → ProviderManager.buildEphemeralsSnapshot() → RuntimeInvocationContext → Provider.getModelParams()
4. Entity relationships between SettingSpec, SeparatedSettings, RuntimeInvocationContext
5. State transitions: how a setting moves from user input (/set command) through to API request
6. Edge cases: unknown settings, alias resolution, reasoning object, provider-scoped overrides
7. Error scenarios: what happens if registry is incomplete, if alias resolves wrong

Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P01 to the output file header.
```

## Phase 01a: Analysis Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 01 (analysis) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/analysis/domain-model.md
- project-plans/20260126issue1176/architecture.md

Check:
1. All 5 categories documented with clear definitions
2. Code touchpoints list actual files and line numbers (not made up)
3. Data flow traces complete path from SettingsService to API request
4. Edge cases cover: unknown settings, alias resolution, reasoning object, provider overrides
5. @plan marker present
6. No implementation details (this is analysis only)

Return PASS or FAIL with specific issues.
```

---

## Phase 02: Pseudocode

**Subagent**: typescriptexpert

**Prompt**:
```
You are executing Phase 02 (pseudocode) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md
- project-plans/20260126issue1176/analysis/domain-model.md
- project-plans/20260126issue1176/plan/02-pseudocode.md (has starter pseudocode - verify and expand if needed)

The pseudocode file at plan/02-pseudocode.md already contains numbered pseudocode. Verify it is complete and matches the architecture. If anything is missing, update the file. Specifically verify:

1. settingsRegistry.ts pseudocode (lines 01-50): resolveAlias, normalizeSetting, separateSettings
2. RuntimeInvocationContext pseudocode (lines 01-11): factory with separated fields + ephemerals Proxy shim
3. ProviderManager pseudocode (lines 01-06): buildSeparatedSnapshot calling separateSettings
4. Provider pseudocode (lines 01-18): getModelParamsFromInvocation, getCustomHeadersFromInvocation, translateReasoningToBehavior
5. CLI pseudocode (lines 01-06): profile alias normalization during load

Each pseudocode section MUST have:
- Interface contracts (inputs/outputs/dependencies)
- Integration points with line references
- Anti-pattern warnings

Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P02 to the file header.
```

## Phase 02a: Pseudocode Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 02 (pseudocode) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/plan/02-pseudocode.md
- project-plans/20260126issue1176/architecture.md

Check:
1. Every pseudocode line is numbered
2. No actual TypeScript code (pseudocode only)
3. All 5 components have pseudocode: registry, context, ProviderManager, providers, CLI
4. Interface contracts present for each component
5. Integration points reference specific line numbers
6. Anti-pattern warnings present
7. Pseudocode covers ALL requirements REQ-SEP-001 through REQ-SEP-013
8. @plan marker present

Return PASS or FAIL with specific issues.
```

---

## Phase 03: Registry Stub

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 03 (registry stub) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "Central Registry", "Settings Categories")
- project-plans/20260126issue1176/plan/02-pseudocode.md (settingsRegistry lines 01-50)
- project-plans/20260126issue1176/plan/03-registry-stub.md

Create these files:
- packages/core/src/settings/settingsRegistry.ts
- packages/core/src/settings/index.ts (re-export)

The settingsRegistry.ts stub must define:
1. SettingCategory type: 'model-behavior' | 'cli-behavior' | 'model-param' | 'custom-header' | 'provider-config'
2. SettingSpec interface: { key: string; category: SettingCategory; aliases?: readonly string[]; providers?: readonly string[]; normalize?: (value: unknown) => unknown }
3. SeparatedSettings interface: { cliSettings: Record<string, unknown>; modelBehavior: Record<string, unknown>; modelParams: Record<string, unknown>; customHeaders: Record<string, string> }
4. SETTINGS_REGISTRY: empty readonly array of SettingSpec (to be populated in Phase 05)
5. Function stubs that throw Error('NotYetImplemented'):
   - resolveAlias(key: string): string
   - getSettingSpec(key: string): SettingSpec | undefined
   - separateSettings(mixed: Record<string, unknown>, providerName?: string): SeparatedSettings
   - isCliSetting(key: string): boolean
   - isPlainObject(value: unknown): value is Record<string, unknown>

Rules:
- No type assertions (use type predicates like isPlainObject)
- No comments in production code
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P03 marker to file header
- Must compile: run npm run typecheck

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: Files compile with strict TypeScript, function signatures exposed for TDD.
```

## Phase 03a: Registry Stub Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 03 (registry stub) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/settings/settingsRegistry.ts
- packages/core/src/settings/index.ts

Check:
1. @plan:PLAN-20260126-SETTINGS-SEPARATION.P03 marker present
2. SettingCategory, SettingSpec, SeparatedSettings types defined
3. Function signatures match pseudocode (resolveAlias, getSettingSpec, separateSettings, isCliSetting, isPlainObject)
4. No TODO/FIXME/HACK in code
5. No type assertions (no 'as' keyword except in type definitions)
6. No comments in production code

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL with specific issues.
```

---

## Phase 04: Registry TDD

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 04 (registry TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "Settings Categories", "Alias and Normalization", "Behavioral Tests")
- project-plans/20260126issue1176/plan/02-pseudocode.md (settingsRegistry lines 01-50)
- packages/core/src/settings/settingsRegistry.ts (the stub from Phase 03)

Create: packages/core/src/settings/__tests__/settingsRegistry.test.ts

Write behavioral tests (single assertion per test) covering these scenarios:

FOR resolveAlias (REQ-SEP-009):
- resolveAlias('max-tokens') returns 'max_tokens'
- resolveAlias('response-format') returns 'response_format'
- resolveAlias('user-agent') returns 'user-agent' (preserved, not converted)
- resolveAlias('temperature') returns 'temperature' (no alias, passthrough)
- resolveAlias('api-key') returns 'apiKey' (provider-config alias)

FOR separateSettings (REQ-SEP-002, REQ-SEP-003, REQ-SEP-006, REQ-SEP-011):
- separateSettings({ temperature: 0.7 }).modelParams has 'temperature'
- separateSettings({ 'shell-replacement': 'none' }).cliSettings has 'shell-replacement'
- separateSettings({ 'shell-replacement': 'none' }).modelParams does NOT have 'shell-replacement'
- separateSettings({ 'streaming': 'enabled' }).cliSettings has 'streaming'
- separateSettings({ 'reasoning.enabled': true }).modelBehavior has 'reasoning.enabled'
- separateSettings({ apiKey: 'sk-xxx' }).modelParams does NOT have 'apiKey'
- separateSettings({ baseUrl: 'http://x' }).modelParams does NOT have 'baseUrl'
- separateSettings({ model: 'gpt-4' }).modelParams does NOT have 'model'
- separateSettings({ 'unknown-setting': 'x' }).cliSettings has 'unknown-setting' (REQ-SEP-003)
- separateSettings({ 'unknown-setting': 'x' }).modelParams does NOT have 'unknown-setting'

FOR custom-headers (REQ-SEP-008):
- separateSettings with custom-headers JSON extracts individual headers into customHeaders
- Provider override custom-headers win over global custom-headers

FOR reasoning sanitization (REQ-SEP-012):
- Reasoning object: internal keys (enabled, includeInResponse) stripped
- Reasoning object: effort key preserved

Rules:
- Single assertion per it() block
- No mock theater (no vi.spyOn, vi.mock, vi.fn)
- No reverse testing (no expect(fn).toThrow('NotYetImplemented'))
- Tests should fail naturally (RED) because stubs throw NotYetImplemented
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P04 marker

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build
(Tests are expected to FAIL at this stage — that's correct RED behavior)

Exit criteria: Test file compiles, tests exist and fail due to stub implementations.
```

## Phase 04a: Registry TDD Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 04 (registry TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/settings/__tests__/settingsRegistry.test.ts

Check:
1. @plan:PLAN-20260126-SETTINGS-SEPARATION.P04 marker present
2. Single assertion per it() block (count expect() calls per it() — must be exactly 1)
3. No reverse testing patterns: no toThrow('NotYetImplemented'), no expect().not.toThrow()
4. No mock theater: no vi.spyOn, vi.mock, vi.fn, mockImplementation
5. Tests cover: resolveAlias, separateSettings category classification, unknown settings defaulting to cli-behavior, custom-headers extraction, reasoning sanitization
6. Tests use real function calls with concrete inputs and assert concrete outputs
7. At least 15 test cases

Run: npm run typecheck (tests should compile even if they fail at runtime)

Return PASS or FAIL with specific issues.
```

---

## Phase 05: Registry Implementation

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 05 (registry implementation) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "Central Registry", "Settings Categories", "Category Details", "Alias and Normalization")
- project-plans/20260126issue1176/plan/02-pseudocode.md (settingsRegistry lines 01-50)
- packages/core/src/settings/__tests__/settingsRegistry.test.ts (the RED tests from Phase 04)
- packages/core/src/settings/settingsRegistry.ts (the stub from Phase 03)

Modify: packages/core/src/settings/settingsRegistry.ts

Implement the full registry following pseudocode lines 01-50:

1. SETTINGS_REGISTRY array with ALL settings classified (from architecture.md "Category Details"):
   - model-behavior: reasoning.enabled, reasoning.effort, reasoning.maxTokens, reasoning.format, reasoning.budgetTokens, reasoning.stripFromContext, reasoning.includeInContext, reasoning.includeInResponse, prompt-caching, rate-limit-throttle, rate-limit-throttle-threshold, rate-limit-max-wait
   - cli-behavior: context-limit, compression-threshold, streaming, tool-output-max-items, tool-output-max-tokens, tool-output-item-size-limit, shell-replacement, emojifilter, authOnly, dumponerror, todo-continuation, disabled-tools, tools.disabled, tools.allowed, stream-options, socket-path, socket-reconnect-delay, socket-max-reconnect-attempts
   - model-param: temperature, max_tokens, top_p, top_k, seed, frequency_penalty, presence_penalty, stop, response_format, reasoning (object)
   - custom-header: custom-headers
   - provider-config: apiKey, baseUrl, model, enabled, toolFormat, defaultModel, apiKeyfile, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION

2. ALIAS_NORMALIZATION_RULES: max-tokens→max_tokens, response-format→response_format, api-key→apiKey, base-url→baseUrl, auth-key→apiKey, auth-keyfile→apiKeyfile, tool-format→toolFormat, default-model→defaultModel, disabled-tools→tools.disabled

3. HEADER_PRESERVE_SET: 'user-agent', 'content-type', 'authorization', 'x-api-key' (headers where hyphens should NOT be converted to underscores)

4. resolveAlias() — follows pseudocode lines 01-09
5. normalizeSetting() — follows pseudocode lines 10-18
6. separateSettings() — follows pseudocode lines 19-50
7. getSettingSpec() — lookup by key in registry
8. isCliSetting() — check category
9. isPlainObject() — type predicate

Rules:
- No type assertions (use isPlainObject type predicate)
- No comments in production code
- Immutable patterns (Object.freeze on exported arrays, spread for new objects)
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P05 and @pseudocode lines 01-50 markers

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: ALL Phase 04 tests pass (GREEN). No TODO/FIXME/HACK in implementation.
```

## Phase 05a: Registry Implementation Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 05 (registry implementation) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/settings/settingsRegistry.ts
- packages/core/src/settings/__tests__/settingsRegistry.test.ts
- project-plans/20260126issue1176/plan/02-pseudocode.md (lines 01-50)

Structural checks:
1. @plan:PLAN-20260126-SETTINGS-SEPARATION.P05 marker present
2. @pseudocode reference present

Deferred implementation detection (MANDATORY):
grep -rn "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP" packages/core/src/settings/settingsRegistry.ts
grep -rn "in a real|in production|ideally|for now|placeholder|not yet|will be|should be" packages/core/src/settings/settingsRegistry.ts
grep -rn "return \[\]|return \{\}|return null|return undefined" packages/core/src/settings/settingsRegistry.ts

Semantic verification (MANDATORY):
1. Read the implementation and trace: given input { 'shell-replacement': 'none', temperature: 0.7 }, walk through separateSettings() and verify shell-replacement ends in cliSettings and temperature in modelParams
2. Verify SETTINGS_REGISTRY contains entries for ALL categories (at least 5 model-behavior, 15 cli-behavior, 8 model-param, 1 custom-header, 8 provider-config)
3. Verify resolveAlias handles all aliases listed in architecture
4. Verify reasoning sanitization removes enabled/includeInResponse but keeps effort

Holistic Functionality Assessment:
Write a brief assessment: What does this code do? Does it satisfy REQ-SEP-001 through REQ-SEP-003, REQ-SEP-008, REQ-SEP-009, REQ-SEP-012? Trace one complete data flow.

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL with specific issues.
```

---

## Phase 06: RuntimeInvocationContext Stub

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 06 (context stub) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (section: "Updated RuntimeInvocationContext")
- project-plans/20260126issue1176/plan/02-pseudocode.md (RuntimeInvocationContext lines 01-11)
- packages/core/src/runtime/RuntimeInvocationContext.ts (current implementation)
- packages/core/src/settings/settingsRegistry.ts (the registry from Phase 05)

Modify: packages/core/src/runtime/RuntimeInvocationContext.ts

Add these new fields to the RuntimeInvocationContext interface:
- readonly cliSettings: Readonly<Record<string, unknown>>
- readonly modelBehavior: Readonly<Record<string, unknown>>
- readonly modelParams: Readonly<Record<string, unknown>>
- readonly customHeaders: Readonly<Record<string, string>>
- getCliSetting<T = unknown>(key: string): T | undefined
- getModelBehavior<T = unknown>(key: string): T | undefined
- getModelParam<T = unknown>(key: string): T | undefined

Keep the existing ephemerals field (backward compat).

Update the createRuntimeInvocationContext factory to accept optional separated fields. For now, populate them with empty objects as stubs (they will be wired to separateSettings in Phase 08).

Rules:
- No type assertions
- Keep existing tests passing (don't break current RuntimeInvocationContext behavior)
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P06 marker

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: File compiles, existing tests still pass, new fields exist on interface.
```

## Phase 06a: Context Stub Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 06 (context stub) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/runtime/RuntimeInvocationContext.ts

Check:
1. @plan marker present
2. New fields (cliSettings, modelBehavior, modelParams, customHeaders) on interface
3. New accessor methods (getCliSetting, getModelBehavior, getModelParam) on interface
4. Existing ephemerals field preserved
5. No type assertions

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL.
```

---

## Phase 07: RuntimeInvocationContext TDD

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 07 (context TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (section: "Ephemerals Snapshot Semantics")
- project-plans/20260126issue1176/plan/02-pseudocode.md (RuntimeInvocationContext lines 01-11)
- packages/core/src/runtime/RuntimeInvocationContext.ts

Create or modify test file for RuntimeInvocationContext (find existing test file first with: find packages/core/src/runtime -name "*.test.ts" -o -name "*.failfast.test.ts")

Write behavioral tests (single assertion per test):

FOR REQ-SEP-004 (separated fields):
- Context created with temperature=0.7 has getModelParam('temperature') returning 0.7
- Context created with shell-replacement='none' has getCliSetting('shell-replacement') returning 'none'
- Context created with reasoning.enabled=true has getModelBehavior('reasoning.enabled') returning true

FOR REQ-SEP-010 (backward compat):
- Context.ephemerals still accessible (not undefined)
- Context.ephemerals contains settings from snapshot

FOR frozen snapshots:
- modelParams is frozen (Object.isFrozen)
- cliSettings is frozen (Object.isFrozen)

Rules:
- Single assertion per it() block
- No mock theater
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P07

Verification: npm run typecheck (tests should compile)

Exit criteria: Tests compile and fail (RED) because stub returns empty objects.
```

## Phase 07a: Context TDD Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 07 (context TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read the RuntimeInvocationContext test file.

Check:
1. @plan marker present
2. Single assertion per it() block
3. Tests cover: getModelParam, getCliSetting, getModelBehavior, ephemerals backward compat, frozen snapshots
4. No reverse testing
5. No mock theater

Return PASS or FAIL.
```

---

## Phase 08: RuntimeInvocationContext Implementation

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 08 (context implementation) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (section: "Updated RuntimeInvocationContext", "Backward Compatibility Strategy")
- project-plans/20260126issue1176/plan/02-pseudocode.md (RuntimeInvocationContext lines 01-11)
- RuntimeInvocationContext test file from Phase 07
- packages/core/src/runtime/RuntimeInvocationContext.ts
- packages/core/src/settings/settingsRegistry.ts (for separateSettings import)

Modify: packages/core/src/runtime/RuntimeInvocationContext.ts

Wire the factory to call separateSettings():
1. In createRuntimeInvocationContext, take the ephemerals snapshot and call separateSettings(snapshot, providerName)
2. Populate cliSettings, modelBehavior, modelParams, customHeaders from the separated result
3. Freeze all separated fields with Object.freeze()
4. Implement getCliSetting, getModelBehavior, getModelParam as lookups into the separated fields
5. Keep ephemerals field populated with the original snapshot for backward compatibility

Follow pseudocode lines 01-11.

Rules:
- No type assertions
- Immutable patterns only
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P08 and @pseudocode lines 01-11

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: ALL Phase 07 tests pass (GREEN). Existing tests still pass.
```

## Phase 08a: Context Implementation Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 08 (context implementation) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/runtime/RuntimeInvocationContext.ts
- RuntimeInvocationContext test file
- project-plans/20260126issue1176/plan/02-pseudocode.md lines 01-11

Deferred implementation detection:
grep for TODO/FIXME/HACK/return []/return {} in RuntimeInvocationContext.ts

Semantic verification:
1. Trace: if ephemerals snapshot has { temperature: 0.7, 'shell-replacement': 'none' }, does separateSettings get called and results frozen?
2. Verify getModelParam('temperature') returns 0.7
3. Verify ephemerals backward compat field still works

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL.
```

---

## Phase 09: Integration TDD (Vertical Slice)

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 09 (integration TDD) for PLAN-20260126-SETTINGS-SEPARATION.

This is a VERTICAL SLICE phase: write integration tests BEFORE provider implementation (Phase 12).

Read:
- project-plans/20260126issue1176/architecture.md (sections: "Issue 3: Request Capture Method", "Example Behavioral Test Using MSW")
- project-plans/20260126issue1176/plan/02-pseudocode.md (Provider lines 01-18)
- packages/core/src/providers/openai/OpenAIProvider.ts (understand current API)
- packages/core/src/providers/anthropic/AnthropicProvider.ts

Create: packages/core/src/providers/__tests__/settingsSeparation.integration.test.ts

This test file uses MSW (Mock Service Worker) to intercept real HTTP requests and verify what gets sent to provider APIs.

MSW Setup Pattern:
```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let captured: CapturedRequest | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const json: unknown = await request.json();
  if (isPlainObject(json)) return json;
  return {};
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); captured = null; });
afterAll(() => server.close());

async function captureProviderRequest(action: () => Promise<void>): Promise<CapturedRequest> {
  server.use(
    http.post('*/chat/completions', async ({ request }) => {
      captured = { url: request.url, method: request.method, headers: Object.fromEntries(request.headers.entries()), body: await parseJsonBody(request) };
      return HttpResponse.json({ id: 'test', object: 'chat.completion', created: Date.now(), model: 'gpt-4', choices: [{ index: 0, message: { role: 'assistant', content: 'test' }, finish_reason: 'stop' }] });
    }),
    http.post('*/messages', async ({ request }) => {
      captured = { url: request.url, method: request.method, headers: Object.fromEntries(request.headers.entries()), body: await parseJsonBody(request) };
      return HttpResponse.json({ id: 'msg_test', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'test' }], model: 'claude-3-5-sonnet', stop_reason: 'end_turn' });
    })
  );
  await action();
  if (!captured) throw new Error('No request captured');
  return captured;
}
```

Write tests (single assertion per it()):

CLI settings must NOT leak (REQ-SEP-006):
- shell-replacement absent from OpenAI request body
- tool-output-max-items absent from OpenAI request body
- streaming absent from request body

Model params MUST pass through (REQ-SEP-007):
- temperature present in request body
- max_tokens present after alias normalization (REQ-SEP-009)

Provider-config keys MUST NOT leak (REQ-SEP-011):
- apiKey absent from request body
- baseUrl absent from request body

Custom headers applied (REQ-SEP-008):
- Custom header from settings appears in request headers
- Provider override header wins over global

These tests will FAIL (RED) because providers haven't been updated yet. That's expected.

Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P09

Verification: npm run typecheck (tests should compile; runtime failures expected)

Exit criteria: Test file compiles, uses MSW, tests are behavioral with single assertions.
```

## Phase 09a: Integration TDD Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 09 (integration TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/providers/__tests__/settingsSeparation.integration.test.ts

Check:
1. Uses MSW (setupServer, http.post, HttpResponse)
2. Single assertion per it() block
3. No mock theater (no vi.spyOn, vi.mock)
4. Tests cover: CLI settings not leaking, model params passing through, provider-config filtered, custom headers applied
5. Uses isPlainObject type predicate (no type assertions)
6. @plan marker present

Return PASS or FAIL.
```

---

## Phase 10: Providers Stub

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 10 (providers stub) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "Provider Changes", "ProviderManager Changes")
- project-plans/20260126issue1176/plan/02-pseudocode.md (ProviderManager lines 01-06, Provider lines 01-18)
- packages/core/src/providers/ProviderManager.ts
- packages/core/src/providers/BaseProvider.ts
- packages/core/src/providers/openai/OpenAIProvider.ts
- packages/core/src/providers/anthropic/AnthropicProvider.ts
- packages/core/src/providers/gemini/GeminiProvider.ts
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
- packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts

Stub changes (DO NOT fully implement yet):
1. ProviderManager: Add stub for buildSeparatedSnapshot() that calls separateSettings
2. BaseProvider: Add stub for getCustomHeadersFromInvocation() that merges invocation.customHeaders
3. Each provider: Add comment/marker for where getModelParams will change to use invocation.modelParams

Rules:
- Stubs must compile
- Don't break existing behavior
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P10

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: All existing tests still pass. New stub methods exist.
```

## Phase 10a: Providers Stub Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 10 (providers stub) for PLAN-20260126-SETTINGS-SEPARATION.

Read provider files modified in Phase 10.

Check:
1. @plan markers present
2. Stub methods added to ProviderManager and BaseProvider
3. Existing tests still pass
4. No type assertions in new code

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL.
```

---

## Phase 11: Providers TDD

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 11 (providers TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "Provider Changes", "ProviderManager Changes", "Provider-Specific Model Behavior Translation")
- project-plans/20260126issue1176/plan/02-pseudocode.md (ProviderManager lines 01-06, Provider lines 01-18)
- packages/core/src/providers/ProviderManager.ts (current implementation)
- packages/core/src/settings/settingsRegistry.ts (implemented registry)

Create: packages/core/src/providers/__tests__/ProviderManager.settingsSeparation.test.ts

Write unit tests for ProviderManager separation logic (single assertion per test):

FOR buildSeparatedSnapshot / separateSettings integration:
- Given global settings { temperature: 0.7, 'shell-replacement': 'none' }, separated modelParams has temperature
- Given global settings { temperature: 0.7, 'shell-replacement': 'none' }, separated cliSettings has shell-replacement
- Given global settings { temperature: 0.7, 'shell-replacement': 'none' }, separated modelParams does NOT have shell-replacement
- Given provider-scoped custom-headers in settings, customHeaders bucket contains those headers
- Given global custom-headers and provider override, provider header wins
- Given reasoning.enabled=true in settings, modelBehavior has reasoning.enabled
- Given apiKey in settings, modelParams does NOT contain apiKey
- Given unknown key 'magic-future-key', it goes to cliSettings (not modelParams)

Rules:
- Single assertion per it() block
- No mock theater (no vi.spyOn, vi.mock, vi.fn)
- No reverse testing
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P11

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build
(Tests expected to FAIL — RED — because ProviderManager hasn't been updated yet)

Exit criteria: Test file compiles, at least 8 test cases, tests fail due to missing implementation.
```

## Phase 11a: Providers TDD Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 11 (providers TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/providers/__tests__/ProviderManager.settingsSeparation.test.ts

Check:
1. @plan:PLAN-20260126-SETTINGS-SEPARATION.P11 marker present
2. Single assertion per it() block
3. No mock theater (no vi.spyOn, vi.mock, vi.fn)
4. Tests cover: modelParams separation, cliSettings separation, custom-headers merging, reasoning in modelBehavior, provider-config filtering, unknown key default
5. At least 8 test cases
6. Tests use concrete inputs and assert concrete outputs

Run: npm run typecheck

Return PASS or FAIL with specific issues.
```

---

## Phase 12: Providers Implementation

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 12 (providers implementation) for PLAN-20260126-SETTINGS-SEPARATION.

This is the largest phase. Read carefully:
- project-plans/20260126issue1176/architecture.md (sections: "Provider Changes", "ProviderManager Changes", "Provider-Specific Model Behavior Translation")
- project-plans/20260126issue1176/plan/02-pseudocode.md (ProviderManager lines 01-06, Provider lines 01-18)
- Provider tests from Phase 11
- Integration tests from Phase 09

Modify these files:

1. packages/core/src/providers/ProviderManager.ts
   - Update buildEphemeralsSnapshot() (or add buildSeparatedSnapshot) to call separateSettings() from settingsRegistry
   - Pass separated result into RuntimeInvocationContext creation
   - Follow ProviderManager pseudocode lines 01-06

2. packages/core/src/providers/BaseProvider.ts
   - Add getCustomHeadersFromInvocation() that merges base custom headers with invocation.customHeaders
   - Follow Provider pseudocode lines 03-06

3. packages/core/src/providers/openai/OpenAIProvider.ts
   - Change getModelParams() to read from options.invocation.modelParams instead of filtering ephemerals
   - REMOVE calls to filterOpenAIRequestParams() — the separation is now upstream
   - Use invocation.modelBehavior for reasoning settings
   - Follow Provider pseudocode lines 01-02, 10-18

4. packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
   - Same pattern as OpenAI: read from invocation.modelParams
   - Remove filterOpenAIRequestParams calls

5. packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts
   - Same pattern as OpenAI: read from invocation.modelParams
   - Remove filterOpenAIRequestParams calls

6. packages/core/src/providers/anthropic/AnthropicProvider.ts
   - Change getModelParams() to read from options.invocation.modelParams
   - Remove reservedKeys Set (no longer needed — separation is upstream)
   - Use invocation.modelBehavior for reasoning.enabled → thinking config translation

7. packages/core/src/providers/gemini/GeminiProvider.ts
   - Change getModelParams() to read from options.invocation.modelParams
   - Remove reservedKeys Set

Rules:
- No type assertions
- No comments in production code
- Don't break existing provider behavior — the separated fields should produce the same API requests as before
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P12 and @pseudocode lines 01-18

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: Phase 11 provider tests pass. Phase 09 integration tests pass. ALL existing tests still pass.
```

## Phase 12a: Providers Implementation Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 12 (providers implementation) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- packages/core/src/providers/ProviderManager.ts
- packages/core/src/providers/BaseProvider.ts
- packages/core/src/providers/openai/OpenAIProvider.ts
- packages/core/src/providers/anthropic/AnthropicProvider.ts
- packages/core/src/providers/gemini/GeminiProvider.ts
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
- packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts
- packages/core/src/providers/openai/openaiRequestParams.ts

Deferred implementation detection:
Run grep for TODO/FIXME/HACK/STUB/return []/return {} in all modified files.

Semantic verification:
1. ProviderManager: Does buildEphemeralsSnapshot (or buildSeparatedSnapshot) call separateSettings?
2. OpenAI providers: Are calls to filterOpenAIRequestParams REMOVED?
3. All providers: Do getModelParams() methods read from invocation.modelParams (not ephemerals)?
4. Anthropic: Is reservedKeys Set removed?
5. Custom headers: Does BaseProvider merge invocation.customHeaders?

Holistic assessment:
Trace: User sets temperature=0.7 and shell-replacement=none → ProviderManager calls separateSettings → temperature in modelParams, shell-replacement in cliSettings → OpenAI reads modelParams → API request has temperature but NOT shell-replacement.

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL with specific issues.
```

---

## Phase 13: CLI Stub

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 13 (CLI stub) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "CLI Changes")
- project-plans/20260126issue1176/plan/02-pseudocode.md (CLI lines 01-06)
- packages/cli/src/settings/ephemeralSettings.ts
- packages/cli/src/ui/commands/setCommand.ts
- packages/cli/src/runtime/runtimeSettings.ts
- packages/cli/src/runtime/profileApplication.ts

Stub changes:
1. ephemeralSettings.ts: Import getSettingSpec/resolveAlias from @vybestack/llxprt-code-core (or the core package name — check package.json)
2. setCommand.ts: Stub for using registry-based validation
3. runtimeSettings.ts: Stub for using registry-based PROFILE_EPHEMERAL_KEYS
4. profileApplication.ts: Stub for alias normalization during profile load

Don't fully implement — just add imports and marker stubs.

Rules:
- Must compile
- Don't break existing CLI behavior
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P13

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: Stubs compile, existing CLI tests pass.
```

## Phase 13a: CLI Stub Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 13 (CLI stub) for PLAN-20260126-SETTINGS-SEPARATION.

Check markers present, stubs compile, existing tests pass.

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL.
```

---

## Phase 14: CLI TDD

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 14 (CLI TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "CLI Changes", "Profile Alias Normalization")
- project-plans/20260126issue1176/plan/02-pseudocode.md (CLI lines 01-06)
- packages/cli/src/runtime/profileApplication.ts

Write tests for:
- REQ-SEP-009: setCommand validates using registry (resolveAlias resolves max-tokens to max_tokens)
- REQ-SEP-013: Profile load normalizes aliases (loading profile with max-tokens key stores as max_tokens)
- PROFILE_EPHEMERAL_KEYS derived from registry (not hardcoded)

Rules:
- Single assertion per test
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P14

Verification: npm run typecheck

Exit criteria: Tests compile and fail (RED).
```

## Phase 14a: CLI TDD Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 14 (CLI TDD) for PLAN-20260126-SETTINGS-SEPARATION.

Check: single assertion, covers alias normalization and profile load, no mock theater.

Return PASS or FAIL.
```

---

## Phase 15: CLI Implementation

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 15 (CLI implementation) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (sections: "CLI Changes")
- project-plans/20260126issue1176/plan/02-pseudocode.md (CLI lines 01-06)
- CLI tests from Phase 14
- packages/cli/src/settings/ephemeralSettings.ts
- packages/cli/src/ui/commands/setCommand.ts
- packages/cli/src/runtime/runtimeSettings.ts
- packages/cli/src/runtime/profileApplication.ts

Implement:
1. ephemeralSettings.ts: Derive help text and validation from core registry
2. setCommand.ts: Use registry for validation and autocomplete
3. runtimeSettings.ts: Replace PROFILE_EPHEMERAL_KEYS with registry-derived list
4. profileApplication.ts: Call resolveAlias() during profile load for key normalization

Follow pseudocode lines 01-06.

Rules:
- No type assertions
- No comments
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P15 and @pseudocode lines 01-06

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: Phase 14 CLI tests pass. All existing tests pass.
```

## Phase 15a: CLI Implementation Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 15 (CLI implementation) for PLAN-20260126-SETTINGS-SEPARATION.

Deferred implementation detection on all modified CLI files.
Semantic verification: Does profile load call resolveAlias? Is PROFILE_EPHEMERAL_KEYS from registry?

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL.
```

---

## Phase 16: Backward Compatibility Shim

**Subagent**: typescriptexpert

**Prompt**:
```
You are implementing Phase 16 (backward compat) for PLAN-20260126-SETTINGS-SEPARATION.

Read:
- project-plans/20260126issue1176/architecture.md (section: "Backward Compatibility Strategy", "Compatibility Shim Implementation")
- packages/core/src/runtime/RuntimeInvocationContext.ts

Modify: packages/core/src/runtime/RuntimeInvocationContext.ts

Add Proxy-based deprecation warning on ephemerals field access:
- When code reads context.ephemerals[key], log a one-time deprecation warning suggesting use of getModelParam/getCliSetting/getModelBehavior instead
- The Proxy should still return the correct value from the original snapshot
- Use a Set to track which keys have already warned (warn once per key)

Rules:
- No type assertions
- Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P16 and @requirement:REQ-SEP-010

Verification: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Exit criteria: All tests pass. Deprecation warnings fire on ephemerals access.
```

## Phase 16a: Compatibility Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 16 (backward compat) for PLAN-20260126-SETTINGS-SEPARATION.

Read: packages/core/src/runtime/RuntimeInvocationContext.ts

Check:
1. Proxy-based deprecation on ephemerals access
2. Still returns correct values
3. No type assertions

Run: npm run test && npm run lint && npm run typecheck && npm run format && npm run build

Return PASS or FAIL.
```

---

## Phase 17: End-to-End Verification

**Subagent**: typescriptexpert

**Prompt**:
```
You are executing Phase 17 (E2E verification) for PLAN-20260126-SETTINGS-SEPARATION.

Run ALL verification commands in order:

1. npm run test
2. npm run lint
3. npm run typecheck
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

If ANY command fails, report the exact error output.

Also verify:
- grep -r "filterOpenAIRequestParams" packages/core/src/providers/openai/ — should show ZERO usage calls (only the definition file itself if not deleted)
- grep -r "reservedKeys" packages/core/src/providers/anthropic/ — should show ZERO matches
- grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION" . | wc -l — should be 15+ markers

Add @plan:PLAN-20260126-SETTINGS-SEPARATION.P17 to execution-tracker.md

Exit criteria: All 6 commands succeed. filterOpenAIRequestParams removed from providers. reservedKeys removed from Anthropic.
```

## Phase 17a: E2E Verification Verification

**Subagent**: deepthinker

**Prompt**:
```
Verify Phase 17 (E2E verification) for PLAN-20260126-SETTINGS-SEPARATION.

Check:
1. All 6 verification commands succeeded (read output/logs)
2. filterOpenAIRequestParams usage removed from providers
3. reservedKeys removed from Anthropic
4. Plan markers present across codebase (15+)
5. The haiku test produced actual output (not an error)

Final holistic assessment:
- Does the separation work end-to-end?
- Can a user set temperature and shell-replacement, and temperature reaches the API while shell-replacement doesn't?
- Are all 13 requirements (REQ-SEP-001 through REQ-SEP-013) covered?

Return PASS or FAIL.
```
