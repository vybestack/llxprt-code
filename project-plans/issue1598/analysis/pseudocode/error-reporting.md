<!-- @plan PLAN-20260223-ISSUE1598.P02 -->
# Pseudocode: Error Reporting (AllBucketsExhaustedError Enhancement)

**Plan ID**: PLAN-20260223-ISSUE1598  
**Purpose**: Enhance AllBucketsExhaustedError with detailed bucket failure reasons  
**Requirements**: REQ-1598-ER01 through ER04, IC05

---

## Modified Class: AllBucketsExhaustedError

```
1   // File: packages/core/src/providers/errors.ts
2   
3   export type BucketFailureReason =
4     | "quota-exhausted"
5     | "expired-refresh-failed"
6     | "reauth-failed"
7     | "no-token"
8     | "skipped"
9   
10  export class AllBucketsExhaustedError extends Error {
11    public readonly providerName: string
12    public readonly buckets: string[]
13    public readonly bucketFailureReasons: Record<string, BucketFailureReason>
14    
15    constructor(
16      providerName: string,
17      buckets: string[],
18      lastError: Error,
19      bucketFailureReasons?: Record<string, BucketFailureReason>
20    ) {
21      // Construct human-readable message
22      let message = `All API key buckets exhausted for ${providerName}`
23      
24      if buckets.length > 0 then
25        message += `: ${buckets.join(", ")}`
26      end if
27      
28      super(message)
29      
30      this.name = "AllBucketsExhaustedError"
31      this.providerName = providerName
32      this.buckets = buckets
33      this.bucketFailureReasons = bucketFailureReasons ?? {}
34      
35      // Preserve stack trace
36      if Error.captureStackTrace then
37        Error.captureStackTrace(this, AllBucketsExhaustedError)
38      end if
39    }
40  }
```

---

## Key Design Decisions

### Line 3-8: BucketFailureReason Type
**Decision**: Define as union type, export publicly  
**Rationale**: 
- Type safety for classification values
- No circular dependency (errors.ts has no imports from config.ts)
- Single source of truth for failure reasons

**Requirements**: REQ-1598-IC05, IC08

### Line 19: Optional bucketFailureReasons Parameter
**Decision**: Fourth parameter, optional with default empty record  
**Rationale**:
- Backward compatibility — existing call sites don't need changes
- Graceful degradation — missing reasons is better than breaking change

**Requirements**: REQ-1598-ER03

### Line 22-26: Message Construction
**Decision**: Human-readable format with provider and bucket list  
**Rationale**:
- Debugging aid for logs and error displays
- Consistent with existing error message format
- Bucket list provides quick context

**Requirements**: REQ-1598-ER04

### Line 33: Default Empty Record
**Decision**: `??` operator with empty object fallback  
**Rationale**:
- Ensures property is always defined (no undefined)
- Avoids null checks in error handling code

**Requirements**: REQ-1598-ER03

---

## Usage in RetryOrchestrator

```
// File: packages/core/src/providers/RetryOrchestrator.ts

1   async function handleRetry(): Promise<Response>
2     // ... retry loop ...
3     
4     // Attempt failover
5     let failoverHandler = config.getBucketFailoverHandler?.()
6     if failoverHandler !== undefined then
7       let context: FailoverContext = { triggeringStatus: lastStatus }
8       let failoverSuccess = await failoverHandler.tryFailover(context)
9       
10      if failoverSuccess === false then
11        // Retrieve failure reasons
12        let bucketFailureReasons = failoverHandler.getLastFailoverReasons?.() ?? {}
13        let attemptedBuckets = failoverHandler.getBuckets?.() ?? []
14        
15        // Construct enhanced error
16        throw new AllBucketsExhaustedError(
17          providerName,
18          attemptedBuckets,
19          lastError,
20          bucketFailureReasons
21        )
22      end if
23    end if
24  end function
```

---

## Requirements Traceability

| Line(s) | Requirement | Description |
|---------|-------------|-------------|
| 3-8 | REQ-1598-IC05, IC08 | BucketFailureReason type definition |
| 13 | REQ-1598-ER02 | bucketFailureReasons property |
| 19, 33 | REQ-1598-ER03 | Optional parameter with default |
| 22-26 | REQ-1598-ER04 | Human-readable message |

### Usage Pseudocode Requirements

| Line(s) | Requirement | Description |
|---------|-------------|-------------|
| 12 | REQ-1598-IC01, IC03 | getLastFailoverReasons() optional method |
| 12 | REQ-1598-IC04 | Default to empty record if method missing |
| 16-21 | REQ-1598-ER01 | Construct error with reasons from failover handler |

---

## Example Error Structure

### Before Enhancement
```typescript
AllBucketsExhaustedError {
  name: "AllBucketsExhaustedError",
  message: "All API key buckets exhausted for anthropic: default, claudius, vybestack",
  providerName: "anthropic",
  buckets: ["default", "claudius", "vybestack"]
}
```

### After Enhancement
```typescript
AllBucketsExhaustedError {
  name: "AllBucketsExhaustedError",
  message: "All API key buckets exhausted for anthropic: default, claudius, vybestack",
  providerName: "anthropic",
  buckets: ["default", "claudius", "vybestack"],
  bucketFailureReasons: {
    "default": "quota-exhausted",
    "claudius": "expired-refresh-failed",
    "vybestack": "no-token"
  }
}
```

---

## Backward Compatibility

### Existing Call Sites (Pre-Enhancement)
```typescript
// Old signature (3 parameters)
throw new AllBucketsExhaustedError(
  providerName,
  attemptedBuckets,
  lastError
)
// Still works — fourth parameter defaults to {}
```

### New Call Sites (Post-Enhancement)
```typescript
// New signature (4 parameters)
throw new AllBucketsExhaustedError(
  providerName,
  attemptedBuckets,
  lastError,
  bucketFailureReasons
)
```

**No Breaking Changes**: All existing call sites continue to function without modification.

---

## Interface Update: BucketFailoverHandler

```
// File: packages/core/src/config/config.ts

import type { BucketFailureReason } from '../providers/errors.js'

export interface FailoverContext {
  triggeringStatus?: number
}

export interface BucketFailoverHandler {
  getBuckets(): string[]
  getCurrentBucket(): string | undefined
  tryFailover(context?: FailoverContext): Promise<boolean>
  isEnabled(): boolean
  resetSession(): void
  reset(): void
  getLastFailoverReasons?(): Record<string, BucketFailureReason>  // NEW: Optional
}
```

**Key Points**:
- Import `BucketFailureReason` from errors.ts (no circular dependency)
- `getLastFailoverReasons()` is optional (`?`) for backward compatibility
- `FailoverContext` type added for `tryFailover()` parameter

---

## Implementation Notes

### Type Safety
- `BucketFailureReason` is a union type, not an enum
- TypeScript will enforce only valid values can be assigned
- Runtime validation not required (TypeScript handles at compile time)

### Circular Dependency Prevention
- `errors.ts` defines `BucketFailureReason` type
- `config.ts` imports `BucketFailureReason` from `errors.ts`
- No reverse import — `errors.ts` does not import from `config.ts`

### Optional Method Handling
- `getLastFailoverReasons?.()` uses optional chaining
- Returns `Record<string, BucketFailureReason> | undefined`
- Caller must provide fallback: `?? {}`

---

## Verification Points

### Compilation
- [ ] TypeScript compiles without errors
- [ ] No circular dependency warnings
- [ ] Type definitions match between files

### Runtime
- [ ] Existing call sites (3 params) still work
- [ ] New call sites (4 params) populate reasons
- [ ] Optional method calls don't crash if method missing
- [ ] Default empty record works correctly

### Testing
- [ ] Unit tests for AllBucketsExhaustedError constructor
- [ ] Tests for optional parameter (undefined vs empty vs populated)
- [ ] Tests for backward compatibility (3-param constructor)
- [ ] Integration tests verifying reasons flow from failover to error
