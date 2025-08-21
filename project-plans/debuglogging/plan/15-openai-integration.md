# Phase 15: OpenAI Provider Integration

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P15`

## Prerequisites
- Phases 03-14 completed (all core components implemented)
- Verification: `npm test debug` passes

## Implementation Tasks

### Files to Modify (Integration with Existing Code)

#### UPDATE `packages/core/src/providers/openai/OpenAIProvider.ts`

**Current code to replace:**
```typescript
if (process.env.DEBUG) {
  console.log('OpenAI request:', messages);
}
```

**Replace with:**
```typescript
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import { DebugLogger } from '../../debug';

export class OpenAIProvider {
  private logger = new DebugLogger('llxprt:openai:provider');
  
  async processMessages(messages: IMessage[]) {
    this.logger.debug(() => `Processing ${messages.length} messages`);
    this.logger.debug(() => JSON.stringify(messages, null, 2));
    // ... rest of implementation
  }
}
```

#### UPDATE `packages/core/src/providers/openai/streaming.ts`

**Current code to replace:**
```typescript
if (DEBUG) {
  console.log('Stream chunk:', chunk);
}
```

**Replace with:**
```typescript
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import { DebugLogger } from '../../debug';

const logger = new DebugLogger('llxprt:openai:streaming');

export function handleStreamChunk(chunk: any) {
  logger.debug(() => `Stream chunk size: ${JSON.stringify(chunk).length}`);
  logger.debug(() => `Chunk data: ${JSON.stringify(chunk)}`);
  // ... rest of implementation
}
```

#### UPDATE `packages/core/src/providers/openai/tools.ts`

**Current code to replace:**
```typescript
if (process.env.DEBUG === '1') {
  console.log('Tool call:', toolCall);
}
```

**Replace with:**
```typescript
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import { DebugLogger } from '../../debug';

const logger = new DebugLogger('llxprt:openai:tools');

export function handleToolCall(toolCall: any) {
  logger.debug(() => `Tool: ${toolCall.name}`);
  logger.debug(() => `Arguments: ${JSON.stringify(toolCall.arguments)}`);
  // ... rest of implementation
}
```

### Cerebras-Specific Logging

#### CREATE `packages/core/src/providers/openai/debug.ts`

```typescript
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-006
 */
import { DebugLogger } from '../../debug';

const logger = new DebugLogger('llxprt:openai:cerebras');

export function logCerebrasIssue(issue: string, data: any) {
  logger.error(() => `CEREBRAS API ISSUE: ${issue}`);
  logger.error(() => `Data causing issue: ${JSON.stringify(data, null, 2)}`);
  logger.error(() => `This proves Cerebras API fragmentation`);
}
```

## Integration Verification

```bash
# Verify no if(DEBUG) remains in OpenAI
grep -r "if.*DEBUG\|process.env.DEBUG" packages/core/src/providers/openai/
# Expected: 0 occurrences

# Verify new logger usage
grep -r "DebugLogger\|logger.debug" packages/core/src/providers/openai/
# Expected: 10+ occurrences  

# Run with new logging
DEBUG=llxprt:openai:* npm test openai
# Expected: Logs written to ~/.llxprt/debug/

# Test clean break
DEBUG=1 npm test openai
# Expected: No debug output (DEBUG=1 not supported)
```

## Success Criteria
- All if(DEBUG) replaced in OpenAI provider
- Lazy evaluation used for expensive operations
- Cerebras-specific logging implemented
- File output working
- Tests still pass