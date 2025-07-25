# Web-Fetch ServerToolsProvider Refactoring Plan

## Overview

This plan refactors the web-fetch tool to use the ServerToolsProvider pattern, enabling it to work with any active provider (OpenAI, Anthropic, or Gemini) while delegating URL fetching to Gemini.

## Plan Structure

```
project-plans/webfetch/
  REQUIREMENTS.md           ← Already created
  PLAN.md                  ← This document
  specification.md         ← Detailed technical specification
  analysis/
    provider-pattern.md    ← Analysis of ServerToolsProvider pattern
    type-definitions.md    ← Required TypeScript interfaces
  plan/
    00-overview.md
    01-analysis.md
    01a-analysis-verification.md
    02-gemini-provider-update.md
    02a-gemini-provider-verification.md
    03-webfetch-refactor.md
    03a-webfetch-refactor-verification.md
    04-integration-tests.md
    04a-integration-verification.md
```

---

## Phase 0: Architect Specification

### Worker Launch:
```bash
claude --dangerously-skip-permissions -p "
Create detailed specification for web-fetch ServerToolsProvider refactoring.
Read:
- project-plans/webfetch/REQUIREMENTS.md
- packages/core/src/tools/web-search.ts (for pattern reference)
- packages/core/src/tools/web-fetch.ts (current implementation)
- packages/core/src/providers/gemini/GeminiProvider.ts

Output to project-plans/webfetch/specification.md

Include:
1. Technical architecture decisions
2. Provider abstraction pattern details
3. Type definitions for all interfaces
4. Migration strategy from current implementation
5. Test scenarios for all three providers
" > /tmp/spec-worker.log 2>&1 &
```

---

## Phase 1: Analysis

### Task 01: Provider Pattern Analysis

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p "
Analyze the ServerToolsProvider pattern implementation.

Read these files:
- packages/core/src/tools/web-search.ts
- packages/core/src/providers/IProvider.ts
- packages/core/src/providers/ProviderManager.ts
- packages/core/src/providers/gemini/GeminiProvider.ts (getServerTools and invokeServerTool methods)

Create detailed analysis in project-plans/webfetch/analysis/provider-pattern.md

Document:
1. How web-search uses providerManager.getServerToolsProvider()
2. The flow from tool → provider manager → server tools provider → response
3. Error handling patterns for missing providers
4. Authentication requirements and how they work
5. The separation between active provider and server tools provider

Include code snippets showing the exact pattern to follow.
" > /tmp/analysis-worker.log 2>&1 &
```

### Task 01a: Analysis Verification

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p "
Verify the provider pattern analysis is complete and accurate.

Check project-plans/webfetch/analysis/provider-pattern.md contains:
- Complete flow diagram of ServerToolsProvider pattern
- All error scenarios documented
- Authentication flow explained
- Code snippets from web-search.ts showing the pattern

Output verification status to project-plans/webfetch/workers/phase-01a.json
Format: { 'status': 'pass|fail', 'issues': [...] }
"
```

---

## Phase 2: Type Definitions

### Task 02: Type Definition Analysis

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p "
Create TypeScript interface definitions for web-fetch refactoring.

Based on:
- packages/core/src/tools/web-fetch.ts (current grounding metadata types)
- packages/core/src/providers/gemini/GeminiProvider.ts (invokeServerTool response types)

Output to project-plans/webfetch/analysis/type-definitions.md

Define interfaces for:
1. WebFetchServerToolResponse
2. UrlContextMetadata
3. GroundingMetadata structures
4. All intermediate types needed

REQUIREMENTS:
- NO 'any' types
- All properties properly typed
- Optional properties marked with ?
- Include JSDoc comments explaining each type

Example format:
\`\`\`typescript
/**
 * Response from Gemini's web_fetch server tool
 */
interface WebFetchServerToolResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: GroundingMetadata;
    urlContextMetadata?: UrlContextMetadata;
  }>;
}
\`\`\`
" > /tmp/types-worker.log 2>&1 &
```

---

## Phase 3: Implementation - GeminiProvider Update

### Task 03: Update GeminiProvider

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p "
Update GeminiProvider to support web_fetch server tool.

Files to modify:
- packages/core/src/providers/gemini/GeminiProvider.ts

Requirements:
1. Add 'web_fetch' to the getServerTools() return array
2. Implement web_fetch case in invokeServerTool() method
3. Follow the exact pattern used for web_search case
4. Extract URLs from prompt parameter
5. Use urlContext tool instead of googleSearch tool
6. Handle all three auth modes (oauth, gemini-api-key, vertex-ai)
7. Return properly typed response (no 'any' types)

The implementation should:
- Pass the entire prompt directly to Gemini without any URL extraction
- NO URL transformations or special handling for any domains
- Create appropriate request structure for each auth mode
- Use { tools: [{ urlContext: {} }] } configuration
- Return the full response for processing by web-fetch tool

FORBIDDEN:
- NO regex patterns to extract URLs
- NO GitHub-specific or any domain-specific handling
- NO URL transformations of any kind
- NO test fitting to specific URLs

IMPORTANT:
- Do NOT implement fallback logic here (that stays in web-fetch.ts for now)
- Do NOT process grounding metadata (web-fetch.ts will handle it)
- Just return the raw response from generateContent

Run npm run lint and npm run typecheck to ensure no errors.
Output status to project-plans/webfetch/workers/phase-03.json
" > /tmp/gemini-worker.log 2>&1 &
```

### Task 03a: GeminiProvider Verification

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p --model claude-3-5-haiku-20241022 "
Verify GeminiProvider changes using typescript-code-reviewer agent.

Check packages/core/src/providers/gemini/GeminiProvider.ts:
1. web_fetch is in getServerTools() array
2. invokeServerTool handles 'web_fetch' case
3. NO 'any' types used
4. All three auth modes implemented
5. urlContext tool configuration correct
6. Proper error handling
7. npm run lint passes
8. npm run typecheck passes

Use grep to verify:
- grep 'web_fetch' in getServerTools return
- grep for 'any' type usage (should find none in new code)
- Check urlContext tool usage pattern

Output verification to project-plans/webfetch/workers/phase-03a.json
"
```

---

## Phase 4: Implementation - WebFetch Tool Refactor

### Task 04: Refactor WebFetch Tool

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p "
Refactor web-fetch.ts to use ServerToolsProvider pattern.

File to modify:
- packages/core/src/tools/web-fetch.ts

Requirements:
1. Remove ALL direct usage of this.config.getGeminiClient()
2. Follow the EXACT pattern from web-search.ts:
   - Get contentGenConfig from this.config
   - Get providerManager from contentGenConfig
   - Get serverToolsProvider from providerManager
   - Check if provider supports 'web_fetch'
   - Call invokeServerTool('web_fetch', { prompt: params.prompt }, { signal })

3. Keep the existing fallback mechanism (including GitHub URL transformation)
4. Process the response with proper types (use interfaces from type-definitions.md)
5. Maintain all existing functionality for grounding metadata processing
6. Use the same error messages as web-search for consistency

NOTE: Any URL transformations (like GitHub) should remain in web-fetch.ts, NOT in the provider

Key changes:
- Replace geminiClient.generateContent() with serverToolsProvider.invokeServerTool()
- Cast response to WebFetchServerToolResponse interface
- Keep all citation insertion and source formatting logic
- Keep private IP detection and fallback execution

IMPORTANT:
- Do NOT change the tool's external interface
- Do NOT modify the fallback mechanism logic
- Just change HOW we get the Gemini response

Run npm run lint and npm run typecheck after changes.
Output status to project-plans/webfetch/workers/phase-04.json
" > /tmp/webfetch-worker.log 2>&1 &
```

### Task 04a: WebFetch Verification

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p --model claude-3-5-haiku-20241022 "
Verify web-fetch.ts refactoring using typescript-code-reviewer agent.

Check packages/core/src/tools/web-fetch.ts:
1. NO direct geminiClient usage (grep for getGeminiClient)
2. Uses serverToolsProvider pattern
3. Proper type casting (no 'any')
4. Error messages match web-search.ts
5. Fallback mechanism unchanged
6. npm run lint passes
7. npm run typecheck passes

Compare pattern with web-search.ts to ensure consistency.

Output verification to project-plans/webfetch/workers/phase-04a.json
"
```

---

## Phase 5: Integration Testing

### Task 05: Create Integration Tests

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p "
Create integration tests for web-fetch with different providers.

Create test file:
- packages/core/src/tools/web-fetch.integration.test.ts

Test scenarios:
1. Web-fetch with Gemini as active provider
2. Web-fetch with OpenAI as active provider  
3. Web-fetch with Anthropic as active provider
4. Missing Gemini authentication error handling
5. Fallback to direct fetch for private IPs

For each provider test:
- Mock the provider manager to return appropriate providers
- Ensure serverToolsProvider is always Gemini
- Test that web-fetch works regardless of active provider
- Verify proper error messages

Use the test patterns from web-search tests as reference.

IMPORTANT: These are BEHAVIORAL tests that verify the tool works correctly with different provider configurations.

Output status to project-plans/webfetch/workers/phase-05.json
"
```

### Task 05a: Integration Test Verification

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p --model claude-3-5-haiku-20241022 "
Verify integration tests are comprehensive and correct.

Check packages/core/src/tools/web-fetch.integration.test.ts:
1. Tests all three provider scenarios
2. Tests authentication error cases
3. Tests actually verify behavior, not just mocks
4. No 'any' types in tests
5. Tests can run with npm test

Run: npm test packages/core/src/tools/web-fetch.integration.test.ts

Output verification to project-plans/webfetch/workers/phase-05a.json
"
```

---

## Phase 6: End-to-End Verification

### Task 06: Test Command Verification

**Worker Prompt:**
```bash
claude --dangerously-skip-permissions -p "
Test the three required command scenarios.

Execute and verify these commands work:

1. Gemini provider:
node scripts/start.js --provider gemini --model gemini-2.5-pro --keyfile ~/.google_key --prompt 'do a web-fetch of https://vybestack.dev/blog/rendered/2025-07-21-llxpt-code-12.html and summarize'

2. OpenAI provider:
node scripts/start.js --provider openai --model gpt-4.1 --keyfile ~/.openai_key --prompt 'do a web-fetch of https://vybestack.dev/blog/rendered/2025-07-21-llxpt-code-12.html and summarize'

3. Anthropic provider:
node scripts/start.js --provider anthropic --keyfile ~/.anthropic_key --model claude-sonnet-4-latest --prompt 'do a web-fetch of https://vybestack.dev/blog/rendered/2025-07-21-llxpt-code-12.html and summarize'

Document:
- Whether each command executes without errors
- If web-fetch tool is invoked correctly
- If content is fetched and summarized
- Any error messages encountered

Output results to project-plans/webfetch/workers/phase-06.json
"
```

---

## Success Criteria

1. **No direct Gemini client usage** - web-fetch uses ServerToolsProvider
2. **Provider agnostic** - works with OpenAI, Anthropic, and Gemini active
3. **Type safety** - no 'any' types, all properly typed
4. **Clean code** - passes lint and typecheck
5. **Behavioral correctness** - all three test commands work
6. **Error handling** - appropriate messages for missing auth
7. **Backward compatibility** - external interface unchanged
8. **No test fitting** - no special handling for specific URLs or domains in provider
9. **Generic implementation** - works for any valid URL without hardcoded patterns

## Execution Order

1. Phase 0: Create specification (if not exists)
2. Phase 1: Analysis tasks (can run in parallel)
3. Phase 2: Type definitions
4. Phase 3: GeminiProvider update (must complete before Phase 4)
5. Phase 4: WebFetch refactor  
6. Phase 5: Integration tests
7. Phase 6: End-to-end verification

## Verification Checklist

- [ ] ServerToolsProvider pattern correctly implemented
- [ ] GeminiProvider supports web_fetch server tool
- [ ] WebFetch uses provider abstraction
- [ ] No 'any' types in implementation
- [ ] All lint rules pass
- [ ] Type checking passes
- [ ] Integration tests cover all providers
- [ ] Three test commands work exactly as specified