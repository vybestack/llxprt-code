# Plan: OpenAI Vercel Provider Implementation

Plan ID: PLAN-20251127-OPENAIVERCEL
Generated: 2025-11-27
Total Phases: 16
Requirements: REQ-OAV-001 through REQ-OAV-012

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed

## Requirements Summary

| ID | Title | Description |
|----|-------|-------------|
| REQ-OAV-001 | Provider Registration | Provider must be selectable via `/provider openaivercel` |
| REQ-OAV-002 | Standard Authentication | Must support `/key` and `/keyfile` commands |
| REQ-OAV-003 | BaseURL Configuration | Must support `/baseurl` for custom endpoints |
| REQ-OAV-004 | Model Selection | Must support `/model` command for model switching |
| REQ-OAV-005 | IContent Conversion | Must convert IContent ↔ Vercel SDK messages |
| REQ-OAV-006 | Tool Format Conversion | Must convert Gemini tools → OpenAI format via ToolFormatter |
| REQ-OAV-007 | Tool Call ID Normalization | Must normalize hist_tool_ ↔ call_ IDs correctly |
| REQ-OAV-008 | Streaming Support | Must support streaming responses |
| REQ-OAV-009 | Non-Streaming Support | Must support non-streaming responses |
| REQ-OAV-010 | Tool Call Handling | Must yield tool_call blocks for Core layer execution |
| REQ-OAV-011 | Usage Metadata | Must report token usage in metadata |
| REQ-OAV-012 | Error Handling | Must handle API errors gracefully |

---

# Execution Tracker

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | ⬜ | - | - | - | N/A | Preflight verification |
| 01 | P01 | ⬜ | - | - | - | N/A | Dependency installation |
| 02 | P02 | ⬜ | - | - | - | N/A | Provider stub creation |
| 03 | P03 | ⬜ | - | - | - | ⬜ | Tool ID normalization TDD tests |
| 04 | P04 | ⬜ | - | - | - | ⬜ | Tool ID normalization impl |
| 05 | P05 | ⬜ | - | - | - | ⬜ | Message conversion TDD tests |
| 06 | P06 | ⬜ | - | - | - | ⬜ | Message conversion impl |
| 07 | P07 | ⬜ | - | - | - | ⬜ | Tool format conversion TDD tests |
| 08 | P08 | ⬜ | - | - | - | ⬜ | Tool format conversion impl |
| 09 | P09 | ⬜ | - | - | - | ⬜ | Non-streaming generation TDD tests |
| 10 | P10 | ⬜ | - | - | - | ⬜ | Non-streaming generation impl |
| 11 | P11 | ⬜ | - | - | - | ⬜ | Streaming generation TDD tests |
| 12 | P12 | ⬜ | - | - | - | ⬜ | Streaming generation impl |
| 13 | P13 | ⬜ | - | - | - | ⬜ | Provider registration TDD tests |
| 14 | P14 | ⬜ | - | - | - | ⬜ | Provider registration impl |
| 15 | P15 | ⬜ | - | - | - | ⬜ | Integration tests |
| 16 | P16 | ⬜ | - | - | - | ⬜ | E2E validation |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] Verification script passes
- [ ] No phases skipped

---

# Phase 0.5: Preflight Verification

## Purpose

Verify ALL assumptions before writing any code.

## Dependency Verification

| Dependency | npm ls Output | Status |
|------------|---------------|--------|
| ai (Vercel AI SDK) | [pending] | VERIFY |
| @ai-sdk/openai | [pending] | VERIFY |

**Action Required**: Run these commands and record output:
```bash
npm ls ai 2>/dev/null || echo "NOT INSTALLED"
npm ls @ai-sdk/openai 2>/dev/null || echo "NOT INSTALLED"
```

## Type/Interface Verification

| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| IProvider | Interface with generateChatCompletion | See IProvider.ts | VERIFY |
| BaseProvider | Abstract class with auth precedence | See BaseProvider.ts | VERIFY |
| IContent | speaker, blocks, metadata | See IContent.ts | VERIFY |
| ToolFormatter | convertGeminiToFormat method | See ToolFormatter.ts | VERIFY |
| ProviderToolset | Array of functionDeclarations | See IProvider.ts | VERIFY |

**Action Required**: Verify each type exists as expected:
```bash
grep -n "export interface IProvider" packages/core/src/providers/IProvider.ts
grep -n "export abstract class BaseProvider" packages/core/src/providers/BaseProvider.ts
grep -n "export interface IContent" packages/core/src/services/history/IContent.ts
grep -n "export class ToolFormatter" packages/core/src/tools/ToolFormatter.ts
grep -n "ProviderToolset" packages/core/src/providers/IProvider.ts
```

## Call Path Verification

| Function | Expected Caller | Actual Caller | Evidence |
|----------|-----------------|---------------|----------|
| generateChatCompletion | geminiChat.ts | [verify] | [file:line] |
| ProviderManager.registerProvider | Core initialization | [verify] | [file:line] |
| ToolFormatter.convertGeminiToFormat | Provider implementation | [verify] | [file:line] |

**Action Required**:
```bash
grep -rn "generateChatCompletion" packages/core/src/core/geminiChat.ts | head -5
grep -rn "registerProvider" packages/core/src/ | head -5
grep -rn "convertGeminiToFormat\|convertToFormat" packages/core/src/providers/ | head -5
```

## Test Infrastructure Verification

| Component | Test File Exists? | Test Patterns Work? |
|-----------|-------------------|---------------------|
| OpenAIProvider tests | YES | [verify] |
| BaseProvider tests | YES | [verify] |
| ToolFormatter tests | [verify] | [verify] |

**Action Required**:
```bash
ls -la packages/core/src/providers/openai/__tests__/*.test.ts 2>/dev/null | head -5
npm run test -- --reporter=verbose packages/core/src/providers/BaseProvider.test.ts 2>&1 | head -20
```

## Blocking Issues Found

[List any issues that MUST be resolved before proceeding]

## Verification Gate

- [ ] All dependencies verified (or identified for installation)
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready
- [ ] Vercel AI SDK dependencies identified for Phase 01

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.

---

# Phase 01: Dependency Installation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P01`

## Prerequisites

- Required: Phase 0.5 completed with all verification gates passed
- Verification: Phase 0.5 completion marker exists

## Requirements Implemented (Expanded)

### REQ-OAV-INFRA: Vercel AI SDK Dependencies

**Full Text**: Install Vercel AI SDK packages (`ai` and `@ai-sdk/openai`) as project dependencies
**Behavior**:
- GIVEN: The project needs Vercel AI SDK integration
- WHEN: Dependencies are installed
- THEN: `import { streamText, generateText } from 'ai'` and `import { createOpenAI } from '@ai-sdk/openai'` resolve correctly
**Why This Matters**: Without these dependencies, the provider cannot function

## Implementation Tasks

### Commands to Execute

```bash
cd packages/core
npm install ai @ai-sdk/openai
```

### Files to Modify

- `packages/core/package.json`
  - ADD dependencies: `"ai": "^4.0.0"`, `"@ai-sdk/openai": "^1.0.0"`

## Verification Commands

### Automated Checks

```bash
# Verify dependencies installed
npm ls ai @ai-sdk/openai

# Verify imports resolve
cat > /tmp/test-import.mjs << 'EOF'
import { streamText, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
console.log('Imports OK');
EOF
node /tmp/test-import.mjs
```

### Structural Verification Checklist

- [ ] `ai` package appears in package.json dependencies
- [ ] `@ai-sdk/openai` package appears in package.json dependencies
- [ ] `npm ls ai` shows installed version
- [ ] TypeScript can resolve imports (run typecheck)

## Success Criteria

- Dependencies installed in package.json
- TypeScript recognizes Vercel AI SDK types
- No conflicts with existing dependencies

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/package.json packages/core/package-lock.json`
2. Investigate dependency conflicts
3. Consider alternative version constraints

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P01.md`

---

# Phase 02: Provider Stub Creation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P02`

## Prerequisites

- Required: Phase 01 completed
- Verification: `npm ls ai @ai-sdk/openai` shows both packages installed

## Requirements Implemented (Expanded)

### REQ-OAV-001: Provider Registration (Stub)

**Full Text**: Provider must be structurally correct to be registered with ProviderManager
**Behavior**:
- GIVEN: OpenAIVercelProvider class exists
- WHEN: It is imported
- THEN: It compiles without errors and can be instantiated
**Why This Matters**: Establishes the class skeleton that will be filled in by subsequent phases

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P02`
  - MUST include: `@requirement:REQ-OAV-001`
  - Stub implementation extending BaseProvider
  - All IProvider methods stubbed with `throw new Error('Not implemented')`

- `packages/core/src/providers/openai-vercel/index.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P02`
  - Export OpenAIVercelProvider

### Required Code Structure

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P02
 * @requirement REQ-OAV-001
 * 
 * OpenAI Vercel Provider - uses Vercel AI SDK for OpenAI-compatible APIs
 * This is a STANDALONE provider alongside the existing openai provider.
 */

import { BaseProvider } from '../BaseProvider.js';
import { IProvider, GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import { IModel } from '../IModel.js';
import { IContent } from '../../services/history/IContent.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { DebugLogger } from '../../debug/index.js';

export class OpenAIVercelProvider extends BaseProvider implements IProvider {
  private logger = new DebugLogger('llxprt:provider:openaivercel');
  
  readonly name = 'openaivercel';

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
  ) {
    super(
      {
        name: 'openaivercel',
        apiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'],
        // NO OAuth - keep it simple
      },
      config,
    );
  }

  async getModels(): Promise<IModel[]> {
    throw new Error('Not implemented: getModels');
  }

  getDefaultModel(): string {
    return 'gpt-4o';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(): Promise<unknown> {
    throw new Error('Server tools not supported');
  }

  async *generateChatCompletion(
    _options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    throw new Error('Not implemented: generateChatCompletion');
  }
}
```

## Verification Commands

### Automated Checks

```bash
# Check file exists
ls -la packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Check plan marker
grep -r "@plan:PLAN-20251127-OPENAIVERCEL.P02" packages/core/src/providers/openai-vercel/

# Check requirement marker
grep -r "@requirement:REQ-OAV-001" packages/core/src/providers/openai-vercel/

# TypeScript compiles
npm run typecheck
```

### Structural Verification Checklist

- [ ] OpenAIVercelProvider.ts created
- [ ] index.ts exports the provider
- [ ] TypeScript compiles without errors
- [ ] Plan and requirement markers present
- [ ] Class extends BaseProvider
- [ ] Class implements IProvider

## Success Criteria

- Provider stub exists and compiles
- Can import provider without runtime errors
- All IProvider methods are present (stubbed)

## Failure Recovery

If this phase fails:
1. `rm -rf packages/core/src/providers/openai-vercel/`
2. Review BaseProvider interface
3. Re-attempt with corrected structure

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P02.md`

---

# Phase 03: Tool ID Normalization TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P03`

## Prerequisites

- Required: Phase 02 completed
- Verification: `grep -r "@plan:PLAN-20251127-OPENAIVERCEL.P02" packages/core/src/providers/openai-vercel/`

## Requirements Implemented (Expanded)

### REQ-OAV-007: Tool Call ID Normalization

**Full Text**: Must normalize tool call IDs between history format (hist_tool_xxx) and OpenAI format (call_xxx)
**Behavior**:
- GIVEN: A tool call ID in hist_tool_ format
- WHEN: Converting to OpenAI API format
- THEN: ID becomes call_ format with same UUID
- GIVEN: A tool call ID in call_ format
- WHEN: Converting to history format
- THEN: ID becomes hist_tool_ format with same UUID
**Why This Matters**: Tool responses MUST match tool call IDs exactly or the conversation breaks

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P03`
  - MUST include: `@requirement:REQ-OAV-007`
  - Tests for normalizeToOpenAIToolId
  - Tests for normalizeToHistoryToolId
  - Tests for edge cases (unknown prefixes, empty strings)

### Required Test Cases

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P03
 * @requirement REQ-OAV-007
 */

describe('OpenAIVercelProvider Tool ID Normalization', () => {
  describe('normalizeToOpenAIToolId', () => {
    it('should return call_ IDs unchanged', () => {
      // call_abc123 → call_abc123
    });

    it('should convert hist_tool_ to call_ format', () => {
      // hist_tool_abc123 → call_abc123
    });

    it('should convert toolu_ (Anthropic) to call_ format', () => {
      // toolu_abc123 → call_abc123
    });

    it('should prefix unknown formats with call_', () => {
      // abc123 → call_abc123
    });

    it('should handle empty string gracefully', () => {
      // '' → call_
    });
  });

  describe('normalizeToHistoryToolId', () => {
    it('should return hist_tool_ IDs unchanged', () => {
      // hist_tool_abc123 → hist_tool_abc123
    });

    it('should convert call_ to hist_tool_ format', () => {
      // call_abc123 → hist_tool_abc123
    });

    it('should convert toolu_ (Anthropic) to hist_tool_ format', () => {
      // toolu_abc123 → hist_tool_abc123
    });

    it('should prefix unknown formats with hist_tool_', () => {
      // abc123 → hist_tool_abc123
    });

    it('should handle empty string gracefully', () => {
      // '' → hist_tool_
    });
  });

  describe('Round-trip conversion', () => {
    it('should preserve UUID through hist_tool_ → call_ → hist_tool_', () => {
      const original = 'hist_tool_550e8400-e29b-41d4-a716-446655440000';
      // Convert to OpenAI, then back to history
      // Should equal original
    });

    it('should preserve UUID through call_ → hist_tool_ → call_', () => {
      const original = 'call_550e8400-e29b-41d4-a716-446655440000';
      // Convert to history, then back to OpenAI
      // Should equal original
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts

# Check plan markers
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P03" packages/core/src/providers/openai-vercel/__tests__/

# Run tests (expect failures - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests cover both directions of normalization
- [ ] Tests cover edge cases
- [ ] Tests FAIL (because implementation doesn't exist yet)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because normalizeToOpenAIToolId/normalizeToHistoryToolId don't exist
- Test names clearly describe expected behavior

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts`
2. Review test patterns from OpenAIProvider tests
3. Re-attempt with corrected test structure

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P03.md`

---

# Phase 04: Tool ID Normalization Implementation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P04`

## Prerequisites

- Required: Phase 03 completed
- Verification: Test file exists and tests fail appropriately

## Requirements Implemented (Expanded)

### REQ-OAV-007: Tool Call ID Normalization (Implementation)

**Full Text**: Must normalize tool call IDs between history format (hist_tool_xxx) and OpenAI format (call_xxx)
**Behavior**: See Phase 03 for behavior specification
**Why This Matters**: Tool responses MUST match tool call IDs exactly or the conversation breaks

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
  - ADD comment: `@plan:PLAN-20251127-OPENAIVERCEL.P04`
  - Implements: `@requirement:REQ-OAV-007`
  - Add private normalizeToOpenAIToolId method
  - Add private normalizeToHistoryToolId method

### Required Implementation

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P04
 * @requirement REQ-OAV-007
 * 
 * Normalize tool ID to OpenAI API format (call_xxx)
 */
private normalizeToOpenAIToolId(id: string): string {
  if (id.startsWith('call_')) return id;
  if (id.startsWith('hist_tool_')) {
    const uuid = id.substring('hist_tool_'.length);
    return 'call_' + uuid;
  }
  if (id.startsWith('toolu_')) {
    const uuid = id.substring('toolu_'.length);
    return 'call_' + uuid;
  }
  return 'call_' + id;
}

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P04
 * @requirement REQ-OAV-007
 * 
 * Normalize tool ID to history format (hist_tool_xxx)
 */
private normalizeToHistoryToolId(id: string): string {
  if (id.startsWith('hist_tool_')) return id;
  if (id.startsWith('call_')) {
    const uuid = id.substring('call_'.length);
    return 'hist_tool_' + uuid;
  }
  if (id.startsWith('toolu_')) {
    const uuid = id.substring('toolu_'.length);
    return 'hist_tool_' + uuid;
  }
  return 'hist_tool_' + id;
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P04" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Check requirement markers exist  
grep -c "@requirement:REQ-OAV-007" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
# Expected: No matches
```

### Semantic Verification Checklist

- [ ] normalizeToOpenAIToolId method exists
- [ ] normalizeToHistoryToolId method exists
- [ ] All P03 tests pass
- [ ] Round-trip conversion preserves UUIDs
- [ ] Edge cases handled (empty strings, unknown prefixes)

## Success Criteria

- All tests from Phase 03 PASS
- No TODO/placeholder code
- TypeScript compiles without errors

## Failure Recovery

If this phase fails:
1. Review test failures to understand expected vs actual
2. Fix implementation to match expected behavior
3. Re-run tests until GREEN

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P04.md`

---

# Phase 05: Message Conversion TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P05`

## Prerequisites

- Required: Phase 04 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts` passes

## Requirements Implemented (Expanded)

### REQ-OAV-005: IContent Conversion

**Full Text**: Must convert IContent[] ↔ Vercel SDK CoreMessage[] format
**Behavior**:
- GIVEN: An array of IContent objects from HistoryService
- WHEN: Converting to Vercel SDK format
- THEN: CoreMessage[] has correct roles (user/assistant/tool) and content
- GIVEN: Tool call IDs in hist_tool_ format
- WHEN: Converting to CoreMessage[]
- THEN: Tool call IDs are normalized to call_ format
- GIVEN: Tool response callId in hist_tool_ format
- WHEN: Converting to CoreMessage[]
- THEN: Tool response references correct call_ format ID
**Why This Matters**: Vercel SDK expects specific message structure; incorrect conversion breaks API calls

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P05`
  - MUST include: `@requirement:REQ-OAV-005`

### Required Test Cases

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P05
 * @requirement REQ-OAV-005
 */

describe('OpenAIVercelProvider Message Conversion', () => {
  describe('convertToVercelMessages', () => {
    describe('Human messages', () => {
      it('should convert human text content to user message', () => {
        const content: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello world' }],
        };
        // Should produce { role: 'user', content: 'Hello world' }
      });

      it('should concatenate multiple text blocks', () => {
        const content: IContent = {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'First' },
            { type: 'text', text: 'Second' },
          ],
        };
        // Should produce { role: 'user', content: 'First\nSecond' }
      });
    });

    describe('AI messages', () => {
      it('should convert AI text content to assistant message', () => {
        const content: IContent = {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello human' }],
        };
        // Should produce { role: 'assistant', content: 'Hello human' }
      });

      it('should convert AI tool_call to assistant message with tool_calls', () => {
        const content: IContent = {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_abc123',
              name: 'read_file',
              parameters: { path: '/tmp/test.txt' },
            },
          ],
        };
        // Should produce assistant message with tool_calls array
        // Tool call ID should be normalized to call_abc123
      });

      it('should handle mixed text and tool_call blocks', () => {
        const content: IContent = {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: "I'll read that file" },
            {
              type: 'tool_call',
              id: 'hist_tool_abc123',
              name: 'read_file',
              parameters: { path: '/tmp/test.txt' },
            },
          ],
        };
        // Should produce assistant message with both text and tool_calls
      });

      it('should handle multiple tool calls in one turn', () => {
        const content: IContent = {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'hist_tool_1', name: 'read_file', parameters: { path: 'a.txt' } },
            { type: 'tool_call', id: 'hist_tool_2', name: 'read_file', parameters: { path: 'b.txt' } },
          ],
        };
        // Should produce assistant message with two tool_calls
      });
    });

    describe('Tool response messages', () => {
      it('should convert tool_response to tool message', () => {
        const content: IContent = {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_abc123',
              toolName: 'read_file',
              result: 'file contents here',
              status: 'success',
            },
          ],
        };
        // Should produce { role: 'tool', tool_call_id: 'call_abc123', content: 'file contents here' }
      });

      it('should handle tool error responses', () => {
        const content: IContent = {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_abc123',
              toolName: 'read_file',
              error: 'File not found',
              status: 'error',
            },
          ],
        };
        // Should produce tool message with error content
      });

      it('should convert multiple tool responses to multiple messages', () => {
        const content: IContent = {
          speaker: 'tool',
          blocks: [
            { type: 'tool_response', callId: 'hist_tool_1', toolName: 'read_file', result: 'content1' },
            { type: 'tool_response', callId: 'hist_tool_2', toolName: 'read_file', result: 'content2' },
          ],
        };
        // Should produce two separate tool messages
      });
    });

    describe('Multi-turn conversation', () => {
      it('should convert full conversation with tool calls correctly', () => {
        const contents: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Read test.txt' }] },
          {
            speaker: 'ai',
            blocks: [
              { type: 'text', text: "I'll read that" },
              { type: 'tool_call', id: 'hist_tool_abc', name: 'read_file', parameters: { path: 'test.txt' } },
            ],
          },
          {
            speaker: 'tool',
            blocks: [{ type: 'tool_response', callId: 'hist_tool_abc', toolName: 'read_file', result: 'content' }],
          },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'The file contains: content' }] },
        ];
        // Should produce array of 4 messages with correct roles and IDs
      });
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts

# Check plan markers
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P05" packages/core/src/providers/openai-vercel/__tests__/

# Run tests (expect failures - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Tests cover human, AI, and tool speaker types
- [ ] Tests cover tool call ID normalization
- [ ] Tests cover multi-turn conversations
- [ ] Tests FAIL (because implementation doesn't exist yet)

## Success Criteria

- Tests exist and properly structure expectations
- Tests FAIL appropriately (method doesn't exist)
- All IContent speaker types covered

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts`
2. Review IContent.ts for correct type definitions
3. Re-attempt with corrected test structure

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P05.md`

---

# Phase 06: Message Conversion Implementation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P06`

## Prerequisites

- Required: Phase 05 completed
- Verification: Test file exists and tests fail appropriately

## Requirements Implemented (Expanded)

### REQ-OAV-005: IContent Conversion (Implementation)

**Full Text**: Must convert IContent[] ↔ Vercel SDK CoreMessage[] format
**Behavior**: See Phase 05 for behavior specification
**Why This Matters**: Vercel SDK expects specific message structure; incorrect conversion breaks API calls

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
  - ADD comment: `@plan:PLAN-20251127-OPENAIVERCEL.P06`
  - Implements: `@requirement:REQ-OAV-005`
  - Add private convertToVercelMessages method

### Required Implementation

```typescript
import type { CoreMessage } from 'ai';

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P06
 * @requirement REQ-OAV-005
 * 
 * Convert IContent[] from HistoryService to Vercel AI SDK CoreMessage[] format
 */
private convertToVercelMessages(contents: IContent[]): CoreMessage[] {
  const messages: CoreMessage[] = [];

  for (const content of contents) {
    if (content.speaker === 'human') {
      const textParts = content.blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      if (textParts) {
        messages.push({
          role: 'user',
          content: textParts,
        });
      }
    } else if (content.speaker === 'ai') {
      const textBlocks = content.blocks.filter((b): b is TextBlock => b.type === 'text');
      const toolCallBlocks = content.blocks.filter(
        (b): b is ToolCallBlock => b.type === 'tool_call'
      );

      const text = textBlocks.map(b => b.text).join('\n');

      if (toolCallBlocks.length > 0) {
        const toolCalls = toolCallBlocks.map(tc => ({
          id: this.normalizeToOpenAIToolId(tc.id),
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.parameters),
          },
        }));

        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls,
        });
      } else if (text) {
        messages.push({
          role: 'assistant',
          content: text,
        });
      }
    } else if (content.speaker === 'tool') {
      const toolResponses = content.blocks.filter(
        (b): b is ToolResponseBlock => b.type === 'tool_response'
      );

      for (const tr of toolResponses) {
        const responseContent = tr.error 
          ? JSON.stringify({ error: tr.error })
          : tr.result || '';

        messages.push({
          role: 'tool',
          tool_call_id: this.normalizeToOpenAIToolId(tr.callId),
          content: typeof responseContent === 'string' 
            ? responseContent 
            : JSON.stringify(responseContent),
        });
      }
    }
  }

  return messages;
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P06" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches
```

### Semantic Verification Checklist

- [ ] convertToVercelMessages method exists
- [ ] All P05 tests pass
- [ ] Tool call IDs are normalized using normalizeToOpenAIToolId
- [ ] Tool response callIds are normalized
- [ ] Multiple text blocks concatenated with newlines

## Success Criteria

- All tests from Phase 05 PASS
- No TODO/placeholder code
- TypeScript compiles without errors

## Failure Recovery

If this phase fails:
1. Review test failures
2. Fix implementation to match expected behavior
3. Re-run tests until GREEN

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P06.md`

---

# Phase 07: Tool Format Conversion TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P07`

## Prerequisites

- Required: Phase 06 completed
- Verification: Message conversion tests pass

## Requirements Implemented (Expanded)

### REQ-OAV-006: Tool Format Conversion

**Full Text**: Must convert Gemini-style tools (ProviderToolset) to OpenAI-style tools via ToolFormatter
**Behavior**:
- GIVEN: Tools in Gemini format (functionDeclarations array)
- WHEN: Converting for Vercel SDK
- THEN: Tools are in OpenAI format (type: 'function', function: {...})
**Why This Matters**: Vercel AI SDK expects OpenAI-style tool format; our internal format is Gemini-style

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/__tests__/toolFormatConversion.test.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P07`
  - MUST include: `@requirement:REQ-OAV-006`

### Required Test Cases

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P07
 * @requirement REQ-OAV-006
 */

describe('OpenAIVercelProvider Tool Format Conversion', () => {
  describe('convertToVercelTools', () => {
    it('should return undefined for empty toolset', () => {
      // Empty array → undefined
    });

    it('should return undefined for undefined toolset', () => {
      // undefined → undefined
    });

    it('should convert single function declaration to OpenAI format', () => {
      const toolset: ProviderToolset = [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file from disk',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path' },
                },
                required: ['path'],
              },
            },
          ],
        },
      ];
      // Should produce { read_file: { description: '...', parameters: {...} } }
    });

    it('should convert multiple function declarations', () => {
      const toolset: ProviderToolset = [
        {
          functionDeclarations: [
            { name: 'read_file', description: 'Read', parameters: {} },
            { name: 'write_file', description: 'Write', parameters: {} },
          ],
        },
      ];
      // Should produce object with both tools
    });

    it('should handle parametersJsonSchema when parameters is missing', () => {
      const toolset: ProviderToolset = [
        {
          functionDeclarations: [
            {
              name: 'simple_tool',
              description: 'A simple tool',
              parametersJsonSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ];
      // Should use parametersJsonSchema as parameters
    });

    it('should merge tools from multiple groups', () => {
      const toolset: ProviderToolset = [
        { functionDeclarations: [{ name: 'tool1', description: 'Tool 1' }] },
        { functionDeclarations: [{ name: 'tool2', description: 'Tool 2' }] },
      ];
      // Should produce { tool1: {...}, tool2: {...} }
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/toolFormatConversion.test.ts

# Run tests (expect failures - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolFormatConversion.test.ts
```

## Success Criteria

- Tests exist with proper structure
- Tests FAIL because convertToVercelTools doesn't exist

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P07.md`

---

# Phase 08: Tool Format Conversion Implementation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P08`

## Prerequisites

- Required: Phase 07 completed
- Verification: Test file exists and tests fail appropriately

## Requirements Implemented (Expanded)

### REQ-OAV-006: Tool Format Conversion (Implementation)

**Full Text**: Must convert Gemini-style tools to OpenAI-style tools
**Behavior**: See Phase 07 for behavior specification
**Why This Matters**: Vercel AI SDK expects OpenAI-style tool format

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
  - ADD comment: `@plan:PLAN-20251127-OPENAIVERCEL.P08`
  - Implements: `@requirement:REQ-OAV-006`
  - Add private convertToVercelTools method

### Required Implementation

```typescript
import { ToolFormatter } from '../../tools/ToolFormatter.js';

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P08
 * @requirement REQ-OAV-006
 * 
 * Convert ProviderToolset (Gemini format) to Vercel AI SDK tool format
 */
private convertToVercelTools(
  toolset?: ProviderToolset,
): Record<string, { description?: string; parameters: unknown }> | undefined {
  if (!toolset || toolset.length === 0) {
    return undefined;
  }

  const tools: Record<string, { description?: string; parameters: unknown }> = {};
  const formatter = new ToolFormatter();

  for (const group of toolset) {
    for (const decl of group.functionDeclarations) {
      const parameters = decl.parameters ?? decl.parametersJsonSchema ?? { type: 'object', properties: {} };
      
      tools[decl.name] = {
        description: decl.description,
        parameters,
      };
    }
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P08" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run tests (expect PASS)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolFormatConversion.test.ts
```

## Success Criteria

- All tests from Phase 07 PASS
- ToolFormatter imported correctly
- No TODO/placeholder code

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P08.md`

---

# Phase 09: Non-Streaming Generation TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P09`

## Prerequisites

- Required: Phase 08 completed
- Verification: Tool format conversion tests pass

## Requirements Implemented (Expanded)

### REQ-OAV-009: Non-Streaming Support

**Full Text**: Must support non-streaming text generation responses
**Behavior**:
- GIVEN: A request with streaming disabled
- WHEN: Calling generateChatCompletion
- THEN: Provider yields a single IContent with complete text
**Why This Matters**: Some use cases require complete responses before processing

### REQ-OAV-010: Tool Call Handling

**Full Text**: Must yield tool_call blocks for Core layer execution
**Behavior**:
- GIVEN: AI response contains tool calls
- WHEN: Converting response to IContent
- THEN: tool_call blocks are yielded with hist_tool_ IDs
**Why This Matters**: Core layer must receive tool calls to execute them

### REQ-OAV-011: Usage Metadata

**Full Text**: Must report token usage in metadata
**Behavior**:
- GIVEN: API response includes usage information
- WHEN: Converting to IContent
- THEN: metadata.usage contains promptTokens, completionTokens, totalTokens
**Why This Matters**: Token tracking for cost management and context window monitoring

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P09`
  - MUST include: `@requirement:REQ-OAV-009, REQ-OAV-010, REQ-OAV-011`

### Required Test Cases

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P09
 * @requirement REQ-OAV-009, REQ-OAV-010, REQ-OAV-011
 */

describe('OpenAIVercelProvider Non-Streaming Generation', () => {
  describe('generateChatCompletion (non-streaming)', () => {
    it('should yield IContent with text response', async () => {
      // Mock generateText to return simple text
      // Verify yielded IContent has speaker: 'ai' and text block
    });

    it('should yield IContent with tool_call blocks', async () => {
      // Mock generateText to return tool calls
      // Verify tool_call blocks have hist_tool_ IDs
    });

    it('should yield IContent with usage metadata', async () => {
      // Mock generateText to include usage
      // Verify metadata.usage has correct token counts
    });

    it('should handle mixed text and tool calls', async () => {
      // Response with both text and tool calls
      // Verify IContent has both text and tool_call blocks
    });

    it('should handle API errors gracefully', async () => {
      // Mock generateText to throw error
      // Verify error is propagated or handled appropriately
    });

    it('should use correct model from options', async () => {
      // Pass specific model in options
      // Verify createOpenAI called with correct model
    });

    it('should pass auth token to createOpenAI', async () => {
      // Verify API key passed correctly
    });

    it('should pass baseURL when configured', async () => {
      // Configure custom baseURL
      // Verify createOpenAI called with baseURL
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts

# Run tests (expect failures - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts
```

## Success Criteria

- Tests exist with mocking strategy defined
- Tests cover text, tool calls, usage, and errors
- Tests FAIL because implementation is stub

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P09.md`

---

# Phase 10: Non-Streaming Generation Implementation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P10`

## Prerequisites

- Required: Phase 09 completed
- Verification: Test file exists and tests fail appropriately

## Requirements Implemented (Expanded)

### REQ-OAV-009, REQ-OAV-010, REQ-OAV-011 (Implementation)

See Phase 09 for full specifications.

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
  - ADD comment: `@plan:PLAN-20251127-OPENAIVERCEL.P10`
  - Implements: `@requirement:REQ-OAV-009, REQ-OAV-010, REQ-OAV-011`
  - Implement generateChatCompletion for non-streaming case

### Required Implementation

```typescript
import { generateText, type GenerateTextResult } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P10
 * @requirement REQ-OAV-009, REQ-OAV-010, REQ-OAV-011
 * 
 * Generate non-streaming chat completion using Vercel AI SDK
 */
private async *generateNonStreamingCompletion(
  options: NormalizedGenerateChatOptions,
): AsyncIterableIterator<IContent> {
  const authToken = await this.getAuthToken();
  
  const openai = createOpenAI({
    apiKey: authToken.value,
    baseURL: options.resolved.baseURL ?? this.getBaseURL(),
  });

  const modelName = options.resolved.model || this.getDefaultModel();
  const model = openai(modelName);

  const messages = this.convertToVercelMessages(options.contents);
  const tools = this.convertToVercelTools(options.tools);

  const result = await generateText({
    model,
    messages,
    tools,
    maxTokens: this.extractMaxTokens(options),
  });

  const blocks: Array<TextBlock | ToolCallBlock> = [];

  // Add text content
  if (result.text) {
    blocks.push({
      type: 'text',
      text: result.text,
    });
  }

  // Add tool calls with normalized IDs
  if (result.toolCalls && result.toolCalls.length > 0) {
    for (const tc of result.toolCalls) {
      blocks.push({
        type: 'tool_call',
        id: this.normalizeToHistoryToolId(tc.toolCallId),
        name: tc.toolName,
        parameters: tc.args,
      });
    }
  }

  if (blocks.length > 0) {
    const content: IContent = {
      speaker: 'ai',
      blocks,
    };

    // Add usage metadata
    if (result.usage) {
      content.metadata = {
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        },
      };
    }

    yield content;
  }
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P10" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run tests (expect PASS)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts
```

## Success Criteria

- All non-streaming tests PASS
- Tool call IDs normalized to hist_tool_ format
- Usage metadata included when available

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P10.md`

---

# Phase 11: Streaming Generation TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P11`

## Prerequisites

- Required: Phase 10 completed
- Verification: Non-streaming tests pass

## Requirements Implemented (Expanded)

### REQ-OAV-008: Streaming Support

**Full Text**: Must support streaming text generation responses
**Behavior**:
- GIVEN: A request with streaming enabled (default)
- WHEN: Calling generateChatCompletion
- THEN: Provider yields incremental IContent blocks as text arrives
- THEN: Tool calls are yielded after stream completes
**Why This Matters**: Provides responsive UX with real-time output

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P11`
  - MUST include: `@requirement:REQ-OAV-008, REQ-OAV-010, REQ-OAV-011`

### Required Test Cases

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P11
 * @requirement REQ-OAV-008, REQ-OAV-010, REQ-OAV-011
 */

describe('OpenAIVercelProvider Streaming Generation', () => {
  describe('generateChatCompletion (streaming)', () => {
    it('should yield incremental text chunks', async () => {
      // Mock streamText to yield text in chunks
      // Verify multiple IContent yields with text blocks
    });

    it('should yield tool_call blocks after stream completes', async () => {
      // Mock streamText with tool calls
      // Verify tool_call blocks yielded after text stream
      // Verify IDs are hist_tool_ format
    });

    it('should yield usage metadata with final content', async () => {
      // Mock streamText with usage info
      // Verify final IContent has usage metadata
    });

    it('should handle stream interruption gracefully', async () => {
      // Mock stream that throws mid-way
      // Verify error handling
    });

    it('should handle abort signal', async () => {
      // Pass AbortSignal in options
      // Verify stream respects cancellation
    });

    it('should not buffer text unnecessarily', async () => {
      // Verify text chunks are yielded immediately
      // Not buffered until end
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts

# Run tests (expect failures - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts
```

## Success Criteria

- Tests cover streaming scenarios
- Tests verify incremental yielding behavior
- Tests FAIL because streaming implementation is stub

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P11.md`

---

# Phase 12: Streaming Generation Implementation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P12`

## Prerequisites

- Required: Phase 11 completed
- Verification: Test file exists and tests fail appropriately

## Requirements Implemented (Expanded)

### REQ-OAV-008: Streaming Support (Implementation)

See Phase 11 for full specification.

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
  - ADD comment: `@plan:PLAN-20251127-OPENAIVERCEL.P12`
  - Implements: `@requirement:REQ-OAV-008`
  - Implement streaming path in generateChatCompletion

### Required Implementation

```typescript
import { streamText, type StreamTextResult } from 'ai';

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P12
 * @requirement REQ-OAV-008, REQ-OAV-010, REQ-OAV-011
 * 
 * Generate streaming chat completion using Vercel AI SDK
 */
private async *generateStreamingCompletion(
  options: NormalizedGenerateChatOptions,
): AsyncIterableIterator<IContent> {
  const authToken = await this.getAuthToken();
  
  const openai = createOpenAI({
    apiKey: authToken.value,
    baseURL: options.resolved.baseURL ?? this.getBaseURL(),
  });

  const modelName = options.resolved.model || this.getDefaultModel();
  const model = openai(modelName);

  const messages = this.convertToVercelMessages(options.contents);
  const tools = this.convertToVercelTools(options.tools);

  const result = await streamText({
    model,
    messages,
    tools,
    maxTokens: this.extractMaxTokens(options),
    abortSignal: options.signal,
  });

  // Yield text chunks as they arrive
  for await (const chunk of result.textStream) {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: chunk }],
    };
  }

  // Wait for completion to get tool calls and usage
  const finalResult = await result;

  // Yield tool calls after stream completes
  if (finalResult.toolCalls && finalResult.toolCalls.length > 0) {
    const toolCallBlocks: ToolCallBlock[] = finalResult.toolCalls.map(tc => ({
      type: 'tool_call',
      id: this.normalizeToHistoryToolId(tc.toolCallId),
      name: tc.toolName,
      parameters: tc.args,
    }));

    const content: IContent = {
      speaker: 'ai',
      blocks: toolCallBlocks,
    };

    // Add usage metadata to the tool calls content
    if (finalResult.usage) {
      content.metadata = {
        usage: {
          promptTokens: finalResult.usage.promptTokens,
          completionTokens: finalResult.usage.completionTokens,
          totalTokens: finalResult.usage.totalTokens,
        },
      };
    }

    yield content;
  } else if (finalResult.usage) {
    // If no tool calls but we have usage, yield metadata-only content
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: {
        usage: {
          promptTokens: finalResult.usage.promptTokens,
          completionTokens: finalResult.usage.completionTokens,
          totalTokens: finalResult.usage.totalTokens,
        },
      },
    };
  }
}

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P12
 * @requirement REQ-OAV-008, REQ-OAV-009
 * 
 * Main generateChatCompletion entry point
 */
async *generateChatCompletion(
  options: GenerateChatOptions,
): AsyncIterableIterator<IContent> {
  const normalized = this.normalizeGenerateChatOptions(options);
  
  // Check if streaming is disabled in settings
  const streamingEnabled = this.isStreamingEnabled(normalized);
  
  if (streamingEnabled) {
    yield* this.generateStreamingCompletion(normalized);
  } else {
    yield* this.generateNonStreamingCompletion(normalized);
  }
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P12" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run all generation tests
npm run test -- packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts
npm run test -- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts
```

## Success Criteria

- All streaming tests PASS
- All non-streaming tests still PASS
- Streaming yields incremental chunks
- Tool calls yielded after stream completes

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P12.md`

---

# Phase 13: Provider Registration TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P13`

## Prerequisites

- Required: Phase 12 completed
- Verification: Streaming tests pass

## Requirements Implemented (Expanded)

### REQ-OAV-001: Provider Registration

**Full Text**: Provider must be selectable via `/provider openaivercel`
**Behavior**:
- GIVEN: OpenAIVercelProvider is registered
- WHEN: User executes `/provider openaivercel`
- THEN: Provider becomes active and handles subsequent requests
**Why This Matters**: Users need to be able to select this provider

### REQ-OAV-002: Standard Authentication

**Full Text**: Must support `/key` and `/keyfile` commands
**Behavior**:
- GIVEN: Provider is active
- WHEN: User sets API key via `/key <key>`
- THEN: Provider uses that key for requests
**Why This Matters**: Users need to authenticate with their API keys

### REQ-OAV-003: BaseURL Configuration

**Full Text**: Must support `/baseurl` for custom endpoints
**Behavior**:
- GIVEN: Provider is active
- WHEN: User sets `/baseurl https://custom.endpoint.com`
- THEN: Provider sends requests to that endpoint
**Why This Matters**: Enables use with custom/proxy endpoints

### REQ-OAV-004: Model Selection

**Full Text**: Must support `/model` command for model switching
**Behavior**:
- GIVEN: Provider is active
- WHEN: User executes `/model gpt-4-turbo`
- THEN: Provider uses that model for subsequent requests
**Why This Matters**: Users need to select which model to use

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P13`
  - MUST include: `@requirement:REQ-OAV-001, REQ-OAV-002, REQ-OAV-003, REQ-OAV-004`

### Required Test Cases

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P13
 * @requirement REQ-OAV-001, REQ-OAV-002, REQ-OAV-003, REQ-OAV-004
 */

describe('OpenAIVercelProvider Registration', () => {
  describe('Provider identity', () => {
    it('should have name "openaivercel"', () => {
      const provider = new OpenAIVercelProvider(undefined);
      expect(provider.name).toBe('openaivercel');
    });

    it('should return default model "gpt-4o"', () => {
      const provider = new OpenAIVercelProvider(undefined);
      expect(provider.getDefaultModel()).toBe('gpt-4o');
    });
  });

  describe('Authentication', () => {
    it('should accept API key in constructor', () => {
      const provider = new OpenAIVercelProvider('test-api-key');
      // Verify key is stored/usable
    });

    it('should fall back to OPENAI_API_KEY env var', async () => {
      process.env.OPENAI_API_KEY = 'env-key';
      const provider = new OpenAIVercelProvider(undefined);
      // Verify env key is used when no direct key
      delete process.env.OPENAI_API_KEY;
    });

    it('should accept keyfile path', async () => {
      // Test keyfile resolution
    });
  });

  describe('BaseURL configuration', () => {
    it('should accept baseURL in constructor', () => {
      const provider = new OpenAIVercelProvider('key', 'https://custom.api.com');
      // Verify baseURL is stored
    });

    it('should use default OpenAI URL when not specified', () => {
      const provider = new OpenAIVercelProvider('key');
      // Verify default baseURL
    });
  });

  describe('ProviderManager integration', () => {
    it('should be registerable with ProviderManager', () => {
      const manager = new ProviderManager();
      const provider = new OpenAIVercelProvider('key');
      manager.registerProvider(provider);
      expect(manager.getProvider('openaivercel')).toBe(provider);
    });

    it('should be settable as active provider', () => {
      const manager = new ProviderManager();
      const provider = new OpenAIVercelProvider('key');
      manager.registerProvider(provider);
      manager.setActiveProvider('openaivercel');
      expect(manager.getActiveProvider()).toBe(provider);
    });
  });

  describe('Model listing', () => {
    it('should return list of available models', async () => {
      const provider = new OpenAIVercelProvider('key');
      const models = await provider.getModels();
      expect(models).toBeInstanceOf(Array);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should include gpt-4o in model list', async () => {
      const provider = new OpenAIVercelProvider('key');
      const models = await provider.getModels();
      expect(models.some(m => m.id === 'gpt-4o')).toBe(true);
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts

# Run tests (some may pass, some may fail)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
```

## Success Criteria

- Tests cover provider identity, auth, baseURL, and registration
- Tests for ProviderManager integration

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P13.md`

---

# Phase 14: Provider Registration Implementation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P14`

## Prerequisites

- Required: Phase 13 completed
- Verification: Test file exists

## Requirements Implemented (Expanded)

### REQ-OAV-001, REQ-OAV-002, REQ-OAV-003, REQ-OAV-004 (Implementation)

See Phase 13 for full specifications.

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
  - ADD comment: `@plan:PLAN-20251127-OPENAIVERCEL.P14`
  - Implement getModels method with available models

- `packages/core/src/providers/index.ts` (if exists)
  - Export OpenAIVercelProvider

### Required Implementation

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P14
 * @requirement REQ-OAV-001, REQ-OAV-004
 * 
 * Return available models for this provider
 */
async getModels(): Promise<IModel[]> {
  return [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      provider: 'openaivercel',
      contextWindow: 16385,
    },
    {
      id: 'o1-preview',
      name: 'O1 Preview',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
    {
      id: 'o1-mini',
      name: 'O1 Mini',
      provider: 'openaivercel',
      contextWindow: 128000,
    },
  ];
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P14" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run registration tests
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
```

## Success Criteria

- All registration tests PASS
- Provider exports correctly
- Models list populated

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P14.md`

---

# Phase 15: Integration Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P15`

## Prerequisites

- Required: Phase 14 completed
- Verification: All unit tests pass

## Requirements Implemented (Expanded)

All requirements verified through integration testing.

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/openai-vercel/__tests__/OpenAIVercelProvider.integration.test.ts`
  - MUST include: `@plan:PLAN-20251127-OPENAIVERCEL.P15`
  - Full end-to-end integration tests

### Required Test Cases

```typescript
/**
 * @plan PLAN-20251127-OPENAIVERCEL.P15
 * @requirement REQ-OAV-001 through REQ-OAV-012
 */

describe('OpenAIVercelProvider Integration', () => {
  describe('Full conversation flow', () => {
    it('should handle multi-turn conversation with tool calls', async () => {
      // Simulate full conversation:
      // 1. User asks to read a file
      // 2. AI responds with tool call
      // 3. Tool response provided
      // 4. AI summarizes
      // Verify IDs match throughout
    });

    it('should handle conversation continuation after tool execution', async () => {
      // Verify tool responses properly reference tool calls
      // Verify next turn sees full context
    });
  });

  describe('Error handling', () => {
    it('should handle authentication errors', async () => {
      const provider = new OpenAIVercelProvider('invalid-key');
      // Verify appropriate error thrown
    });

    it('should handle network errors', async () => {
      // Mock network failure
      // Verify error propagation
    });

    it('should handle rate limiting', async () => {
      // Mock 429 response
      // Verify error handling
    });
  });

  describe('Context preservation', () => {
    it('should preserve tool call IDs through round-trip', async () => {
      // Create history with tool call
      // Convert to messages
      // Get response with tool
      // Verify IDs match
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Run integration tests
npm run test -- packages/core/src/providers/openai-vercel/__tests__/OpenAIVercelProvider.integration.test.ts
```

### Semantic Verification

```bash
# Run all provider tests
npm run test -- packages/core/src/providers/openai-vercel/

# Type check
npm run typecheck

# Lint
npm run lint
```

## Success Criteria

- All integration tests PASS
- No TypeScript errors
- No lint errors
- Full conversation flows work correctly

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P15.md`

---

# Phase 16: E2E Validation

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P16`

## Prerequisites

- Required: Phase 15 completed
- Verification: All integration tests pass

## Requirements Implemented (Expanded)

Final validation of all requirements.

## Implementation Tasks

### Manual Validation Steps

1. **Build and verify compilation**
```bash
npm run build
```

2. **Run full test suite**
```bash
npm run test
```

3. **Type checking**
```bash
npm run typecheck
```

4. **Lint checking**
```bash
npm run lint
```

5. **Format checking**
```bash
npm run format
```

6. **Smoke test with synthetic profile** (requires API key)
```bash
# Only if OPENAI_API_KEY is set
node scripts/start.js --profile-load synthetic --prompt "just say hi"
```

### Files to Create

- `project-plans/20251127openaivercel/.completed/P16.md`
  - Final completion marker with all verification outputs

## Verification Commands

### Full CI Pipeline

```bash
npm run ci:test
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
```

### Deferred Implementation Detection (Final)

```bash
# Final sweep for TODO/FIXME/HACK
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/ | grep -v ".test.ts"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/providers/openai-vercel/ | grep -v ".test.ts"
# Expected: No matches
```

### Plan Marker Verification

```bash
# Verify all phases have markers
for phase in P02 P04 P06 P08 P10 P12 P14; do
  count=$(grep -rc "@plan:PLAN-20251127-OPENAIVERCEL.$phase" packages/core/src/providers/openai-vercel/ || echo "0")
  echo "$phase: $count occurrences"
done
```

## Success Criteria

- [ ] All phases completed
- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Format passes
- [ ] Build succeeds
- [ ] No TODO/FIXME/placeholder code
- [ ] All plan markers present
- [ ] All requirement markers present

## Final Checklist

- [ ] REQ-OAV-001: Provider selectable via `/provider openaivercel`
- [ ] REQ-OAV-002: Standard auth via `/key` and `/keyfile`
- [ ] REQ-OAV-003: Custom endpoint via `/baseurl`
- [ ] REQ-OAV-004: Model selection via `/model`
- [ ] REQ-OAV-005: IContent ↔ Vercel messages conversion
- [ ] REQ-OAV-006: Gemini → OpenAI tool format conversion
- [ ] REQ-OAV-007: Tool call ID normalization (hist_tool_ ↔ call_)
- [ ] REQ-OAV-008: Streaming support
- [ ] REQ-OAV-009: Non-streaming support
- [ ] REQ-OAV-010: Tool call blocks yielded for Core execution
- [ ] REQ-OAV-011: Usage metadata reported
- [ ] REQ-OAV-012: Error handling

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P16.md`

Contents:
```markdown
# Phase 16 Completion: E2E Validation

Plan: PLAN-20251127-OPENAIVERCEL
Completed: [DATE TIME]

## Verification Results

### CI Pipeline
- ci:test: [PASS/FAIL]
- test: [PASS/FAIL]
- lint: [PASS/FAIL]
- typecheck: [PASS/FAIL]
- format: [PASS/FAIL]
- build: [PASS/FAIL]

### Deferred Implementation Detection
- TODO/FIXME check: [PASS/FAIL]
- Cop-out comment check: [PASS/FAIL]

### Plan Markers
[Paste marker count output]

### All Requirements Verified
[List each REQ with status]

## Final Status: COMPLETE
```

---

# Appendix A: File Structure

After completing all phases, the following files should exist:

```
packages/core/src/providers/openai-vercel/
├── OpenAIVercelProvider.ts
├── index.ts
└── __tests__/
    ├── toolIdNormalization.test.ts
    ├── messageConversion.test.ts
    ├── toolFormatConversion.test.ts
    ├── nonStreamingGeneration.test.ts
    ├── streamingGeneration.test.ts
    ├── providerRegistration.test.ts
    └── OpenAIVercelProvider.integration.test.ts

project-plans/20251127openaivercel/
├── PLAN.md (this file)
├── ARCHITECT-CONTEXT.md
├── issue621-raw.txt
└── .completed/
    ├── P01.md
    ├── P02.md
    ├── P03.md
    ├── P04.md
    ├── P05.md
    ├── P06.md
    ├── P07.md
    ├── P08.md
    ├── P09.md
    ├── P10.md
    ├── P11.md
    ├── P12.md
    ├── P13.md
    ├── P14.md
    ├── P15.md
    └── P16.md
```

---

# Appendix B: Dependencies

## Required npm Packages

```json
{
  "ai": "^4.0.0",
  "@ai-sdk/openai": "^1.0.0"
}
```

## Existing Dependencies Used

- `@vybestack/llxprt-code-core` (internal)
- `vitest` (testing)

---

# Appendix C: Quick Reference

## Key Type Imports

```typescript
// Provider types
import { IProvider, GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import { BaseProvider, NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { IModel } from '../IModel.js';
import { IProviderConfig } from '../types/IProviderConfig.js';

// Content types
import { 
  IContent, 
  TextBlock, 
  ToolCallBlock, 
  ToolResponseBlock 
} from '../../services/history/IContent.js';

// Tools
import { ToolFormatter } from '../../tools/ToolFormatter.js';

// Vercel AI SDK
import { streamText, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
```

## Key Methods

| Method | Purpose |
|--------|---------|
| `normalizeToOpenAIToolId(id)` | Convert hist_tool_ → call_ |
| `normalizeToHistoryToolId(id)` | Convert call_ → hist_tool_ |
| `convertToVercelMessages(contents)` | IContent[] → CoreMessage[] |
| `convertToVercelTools(toolset)` | ProviderToolset → Vercel tools |
| `generateStreamingCompletion(options)` | Streaming generation |
| `generateNonStreamingCompletion(options)` | Non-streaming generation |
