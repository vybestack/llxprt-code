# Phase 05: DebugLogger Implementation

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P05`

## Prerequisites
- Phase 04 completed (tests exist and fail)
- Verification: Tests fail naturally, not with NotYetImplemented catches

## Implementation Tasks

### Files to Modify

#### UPDATE `packages/core/src/debug/DebugLogger.ts`

Follow pseudocode from `analysis/pseudocode/DebugLogger.md`:

```typescript
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P05
 * @requirement REQ-001,REQ-002,REQ-006
 * @pseudocode lines 10-121
 */
import createDebug from 'debug';
import type { Debugger } from 'debug';

export class DebugLogger {
  private debugInstance: Debugger; // Line 11
  private namespace: string; // Line 12
  private configManager: ConfigurationManager; // Line 13
  private fileOutput: FileOutput; // Line 14
  private enabled: boolean; // Line 15

  constructor(namespace: string) {
    // Lines 17-24: Initialize logger
    this.namespace = namespace; // Line 18
    this.debugInstance = createDebug(namespace); // Line 19
    this.configManager = ConfigurationManager.getInstance(); // Line 20
    this.fileOutput = FileOutput.getInstance(); // Line 21
    this.enabled = this.checkEnabled(); // Line 22
    this.configManager.subscribe(() => this.onConfigChange()); // Line 23
  }

  log(messageOrFn: string | (() => string), ...args: any[]): void {
    // Lines 26-60: Main log method
    if (!this.enabled) { // Line 27-29
      return;
    }
    
    let message: string;
    if (typeof messageOrFn === 'function') { // Line 32
      try {
        message = messageOrFn(); // Line 34
      } catch (error) {
        message = '[Error evaluating log function]'; // Line 36
      }
    } else {
      message = messageOrFn; // Line 39
    }

    message = this.redactSensitive(message); // Line 42
    const timestamp = new Date().toISOString(); // Line 43
    
    const logEntry = { // Lines 45-51
      timestamp,
      namespace: this.namespace,
      level: 'debug',
      message,
      args
    };

    const target = this.configManager.getOutputTarget();
    if (target.includes('file')) { // Line 53-55
      this.fileOutput.write(logEntry);
    }

    if (target.includes('stderr')) { // Line 57-59
      this.debugInstance(message, ...args);
    }
  }

  debug(messageOrFn: string | (() => string), ...args: any[]): void {
    // Lines 62-64
    this.log(messageOrFn, ...args);
  }

  error(messageOrFn: string | (() => string), ...args: any[]): void {
    // Lines 66-70
    // Temporarily set level to error
    this.log(messageOrFn, ...args);
  }

  private checkEnabled(): boolean {
    // Lines 72-85: Check if logger enabled
    const config = this.configManager.getEffectiveConfig(); // Line 73
    if (!config.enabled) { // Line 74-76
      return false;
    }

    for (const pattern of config.namespaces) { // Line 78-82
      if (this.matchesPattern(this.namespace, pattern)) {
        return true;
      }
    }

    return false; // Line 84
  }

  private matchesPattern(namespace: string, pattern: string): boolean {
    // Lines 87-98: Pattern matching
    if (pattern === namespace) { // Line 88-90
      return true;
    }

    if (pattern.endsWith('*')) { // Line 92-95
      const prefix = pattern.slice(0, -1);
      return namespace.startsWith(prefix);
    }

    return false; // Line 97
  }

  private redactSensitive(message: string): string {
    // Lines 100-110: Redact sensitive data
    const patterns = this.configManager.getRedactPatterns(); // Line 101
    let result = message; // Line 102
    
    for (const pattern of patterns) { // Line 104-107
      const regex = new RegExp(`${pattern}["']?:\\s*["']?([^"'\\s]+)`, 'gi');
      result = result.replace(regex, `${pattern}: [REDACTED]`);
    }

    return result; // Line 109
  }

  private onConfigChange(): void {
    // Lines 112-114
    this.enabled = this.checkEnabled();
  }

  dispose(): void {
    // Lines 116-119
    this.configManager.unsubscribe(this.onConfigChange);
    // Flush pending writes handled by FileOutput
  }
}
```

### Dependencies to Add

Update `packages/core/package.json`:
```json
{
  "dependencies": {
    "debug": "^4.3.4"
  }
}
```

## Required Code Markers

Implementation includes:
- `@plan PLAN-20250120-DEBUGLOGGING.P05`
- `@requirement REQ-001,REQ-002,REQ-006`
- `@pseudocode lines 10-121`
- Comments referencing specific pseudocode line numbers

## Verification Commands

```bash
# All tests pass
npm test DebugLogger
# Expected: All tests pass

# Check pseudocode compliance
grep -c "Line [0-9]" packages/core/src/debug/DebugLogger.ts
# Expected: 20+ line references

# Performance test
npm test -- --grep "zero overhead"
# Expected: Passes in < 1ms

# Check lazy evaluation
npm test -- --grep "lazy evaluation"
# Expected: Functions only called when enabled
```

## Success Criteria
- All P04 tests pass
- Pseudocode followed line-by-line
- Lazy evaluation working
- Zero overhead when disabled