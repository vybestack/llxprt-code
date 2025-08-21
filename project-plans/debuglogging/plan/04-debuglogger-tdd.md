# Phase 04: DebugLogger TDD

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P04`

## Prerequisites
- Phase 03 completed (stub exists)
- Verification: `grep -r "@plan:PLAN-20250120-DEBUGLOGGING.P03" packages/core/src/debug`

## Implementation Tasks

### Files to Create

#### `packages/core/src/debug/DebugLogger.test.ts`

```typescript
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P04
 * @requirement REQ-001,REQ-002,REQ-006
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebugLogger } from './DebugLogger';

describe('DebugLogger', () => {
  /**
   * @requirement REQ-001.1
   * @scenario Logger creation with namespace
   * @given namespace 'llxprt:test'
   * @when new DebugLogger created
   * @then Logger instance exists with namespace set
   */
  it('should create logger with namespace @plan:PLAN-20250120-DEBUGLOGGING.P04', () => {
    const logger = new DebugLogger('llxprt:test');
    expect(logger).toBeDefined();
    expect(logger.namespace).toBe('llxprt:test');
  });

  /**
   * @requirement REQ-001.2
   * @scenario Lazy evaluation of log functions
   * @given expensive function that returns message
   * @when logger disabled and log called with function
   * @then Function never evaluated
   */
  it('should not evaluate function when disabled @plan:PLAN-20250120-DEBUGLOGGING.P04', () => {
    const logger = new DebugLogger('llxprt:test');
    logger.enabled = false;
    
    const expensiveFn = vi.fn(() => 'expensive message');
    logger.log(expensiveFn);
    
    expect(expensiveFn).not.toHaveBeenCalled();
  });

  /**
   * @requirement REQ-001.2
   * @scenario Lazy evaluation when enabled
   * @given expensive function that returns message
   * @when logger enabled and log called with function
   * @then Function evaluated and result logged
   */
  it('should evaluate function when enabled @plan:PLAN-20250120-DEBUGLOGGING.P04', () => {
    const logger = new DebugLogger('llxprt:test');
    logger.enabled = true;
    
    const expensiveFn = vi.fn(() => 'expensive message');
    const writeSpy = vi.spyOn(logger.fileOutput, 'write');
    
    logger.log(expensiveFn);
    
    expect(expensiveFn).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'expensive message'
      })
    );
  });

  /**
   * @requirement REQ-002.1
   * @scenario Namespace pattern matching
   * @given namespace 'llxprt:openai:tools'
   * @when pattern 'llxprt:openai:*' configured
   * @then Logger is enabled
   */
  it('should match wildcard namespaces @plan:PLAN-20250120-DEBUGLOGGING.P04', () => {
    const logger = new DebugLogger('llxprt:openai:tools');
    logger.configManager.setEphemeralConfig({
      enabled: true,
      namespaces: ['llxprt:openai:*']
    });
    
    expect(logger.checkEnabled()).toBe(true);
  });

  /**
   * @requirement REQ-006.1
   * @scenario Zero overhead when disabled
   * @given logger disabled
   * @when log called 1000 times
   * @then Execution time < 1ms
   */
  it('should have zero overhead when disabled @plan:PLAN-20250120-DEBUGLOGGING.P04', () => {
    const logger = new DebugLogger('llxprt:test');
    logger.enabled = false;
    
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      logger.log('test message');
    }
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(1);
  });

  /**
   * @requirement REQ-001
   * @scenario Sensitive data redaction
   * @given message with API key
   * @when logged
   * @then API key replaced with [REDACTED]
   */
  it('should redact sensitive data @plan:PLAN-20250120-DEBUGLOGGING.P04', () => {
    const logger = new DebugLogger('llxprt:test');
    logger.enabled = true;
    
    const writeSpy = vi.spyOn(logger.fileOutput, 'write');
    logger.log('Using apiKey: sk-1234567890');
    
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Using apiKey: [REDACTED]'
      })
    );
  });

  // Property-based tests (30% requirement)
  
  /**
   * @requirement REQ-002
   * @scenario Property: Any valid namespace format works
   */
  it.prop([fc.string()])('should handle any namespace string @plan:PLAN-20250120-DEBUGLOGGING.P04', (namespace) => {
    const logger = new DebugLogger(namespace);
    expect(logger.namespace).toBe(namespace);
  });

  /**
   * @requirement REQ-001
   * @scenario Property: Log accepts any message type
   */
  it.prop([fc.anything()])('should handle any message type @plan:PLAN-20250120-DEBUGLOGGING.P04', (message) => {
    const logger = new DebugLogger('test');
    logger.enabled = false;
    expect(() => logger.log(message)).not.toThrow();
  });
});
```

## Required Code Markers

Every test includes:
- `@plan:PLAN-20250120-DEBUGLOGGING.P04`
- `@requirement` tags
- Behavioral assertions (toBe, toEqual)
- No reverse testing for NotYetImplemented

## Verification Commands

```bash
# Check plan markers
grep -r "@plan:PLAN-20250120-DEBUGLOGGING.P04" packages/core/src/debug | wc -l
# Expected: 8+ occurrences

# Check for reverse testing
grep -r "toThrow.*NotYetImplemented" packages/core/src/debug/
# Expected: No results

# Run tests (will fail naturally)
npm test DebugLogger
# Expected: Tests fail with real errors, not NotYetImplemented catches
```

## Success Criteria
- 8+ behavioral tests created
- 30% property-based tests
- Tests fail naturally
- No reverse testing