# Phase 09: Integration TDD (Vertical Slice)

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P09`

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P08" .`
- Expected files from previous phase:
  - `packages/core/src/runtime/RuntimeInvocationContext.ts` (with separated fields)
  - `packages/core/src/settings/settingsRegistry.ts` (implemented)

## Vertical Slice Pattern

These integration tests are written BEFORE the provider implementation (Phase 12). They define the expected end-to-end behavior and will initially FAIL (RED). Phase 12 makes them GREEN.

## Requirements Implemented (Expanded)

### REQ-SEP-005: Providers read from pre-separated modelParams
**Full Text**: Providers MUST read from pre-separated modelParams instead of filtering raw ephemerals.
**Behavior**:
- GIVEN: invocation.modelParams populated by separateSettings with { temperature: 0.7 }
- WHEN: provider builds API request
- THEN: request body includes temperature: 0.7
**Why This Matters**: Eliminates duplicated filtering logic in each provider.

### REQ-SEP-006: CLI settings never appear in API requests
**Full Text**: CLI-only settings MUST never appear in provider API requests.
**Behavior**:
- GIVEN: CLI settings { 'shell-replacement': 'none', 'tool-output-max-items': 50 } in snapshot
- WHEN: OpenAI API request is sent
- THEN: request body does NOT contain shell-replacement or tool-output-max-items
**Why This Matters**: Prevents 400/422 API errors from unknown parameters.

### REQ-SEP-007: Model params pass through unchanged
**Full Text**: Model params MUST pass through unchanged when valid for the provider.
**Behavior**:
- GIVEN: { temperature: 0.7, max_tokens: 1000 } in settings
- WHEN: API request built
- THEN: both appear with exact values in request body
**Why This Matters**: Prevents over-filtering that breaks user-specified parameters.

### REQ-SEP-008: Custom headers extracted correctly
**Full Text**: Custom headers MUST be extracted and merged correctly, including provider overrides.
**Behavior**:
- GIVEN: global custom-headers { 'X-Global': 'global-val' } and provider override { 'X-Global': 'provider-val' }
- WHEN: HTTP request sent
- THEN: X-Global header is 'provider-val' (provider wins)
**Why This Matters**: Enables provider-specific auth and routing.

### REQ-SEP-011: Provider-config keys filtered
**Full Text**: Provider-config keys MUST be filtered from API requests.
**Behavior**:
- GIVEN: settings include apiKey, baseUrl, toolFormat
- WHEN: API request body built
- THEN: none of these keys appear in body
**Why This Matters**: Infrastructure config must not leak to API.

### REQ-SEP-012: Reasoning object sanitization
**Full Text**: Reasoning object MUST be sanitized and internal keys stripped.
**Behavior**:
- GIVEN: reasoning object with { enabled: true, includeInResponse: true, effort: 'high' }
- WHEN: OpenAI request built
- THEN: reasoning in body has effort but NOT enabled or includeInResponse
**Why This Matters**: Prevents internal control flags from reaching API.

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/__tests__/settingsSeparation.integration.test.ts`

### MSW Setup Pattern

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
```

### Test Scenarios (single assertion per it())

**CLI settings must NOT leak (REQ-SEP-006)**:
1. shell-replacement absent from OpenAI request body
2. tool-output-max-items absent from OpenAI request body
3. streaming absent from request body
4. emojifilter absent from request body

**Model params MUST pass through (REQ-SEP-007)**:
5. temperature present in request body with correct value
6. max_tokens present in request body (after alias normalization from max-tokens)
7. seed present in request body

**Provider-config keys MUST NOT leak (REQ-SEP-011)**:
8. apiKey absent from request body
9. baseUrl absent from request body
10. model key used correctly (only in model field, not as extra param)

**Custom headers applied (REQ-SEP-008)**:
11. Custom header from settings appears in request headers
12. Provider override header wins over global header

**Reasoning sanitization (REQ-SEP-012)**:
13. reasoning.enabled stripped from forwarded reasoning object
14. reasoning.includeInResponse stripped from forwarded reasoning object
15. reasoning.effort preserved in forwarded reasoning object

### Required Code Markers

```
@plan:PLAN-20260126-SETTINGS-SEPARATION.P09
@requirement:REQ-SEP-005, REQ-SEP-006, REQ-SEP-007, REQ-SEP-008, REQ-SEP-011, REQ-SEP-012
```

## Verification Commands

```bash
npm run typecheck
```

(Tests should compile but FAIL at runtime — that's correct RED behavior for Vertical Slice)

## Success Criteria

- Test file compiles with npm run typecheck
- Uses MSW (setupServer, http.post, HttpResponse)
- Single assertion per it() block
- No mock theater (no vi.spyOn, vi.mock, vi.fn)
- At least 15 test cases covering all 6 requirements
- Tests FAIL (RED) because providers haven't been updated yet

## Deferred Implementation Detection

N/A for TDD phase — tests are expected to fail (RED). However, verify no TODO/FIXME in the test file itself:
```bash
grep -rn "TODO\|FIXME\|HACK\|STUB" packages/core/src/providers/__tests__/settingsSeparation.integration.test.ts
```

## Semantic Verification Checklist

Verify each test captures the correct behavioral contract:
1. CLI leak tests: MSW handler captures request body, test asserts key is absent — this proves the key never reaches the API
2. Model param tests: MSW handler captures request body, test asserts key is present with correct value — this proves pass-through works
3. Custom header tests: MSW handler captures request headers, test asserts header present — this proves header extraction works
4. Provider-config tests: MSW handler captures request body, test asserts infrastructure keys absent

## Holistic Functionality Assessment

Trace captured request for scenario: settings include { temperature: 0.7, 'shell-replacement': 'none', apiKey: 'sk-xxx', 'custom-headers': '{"X-Test": "v"}' }
- Captured request body should have temperature=0.7
- Captured request body should NOT have shell-replacement, apiKey
- Captured request headers should have X-Test=v

## Failure Recovery

- `git checkout -- packages/core/src/providers/__tests__/settingsSeparation.integration.test.ts`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P09.md`
