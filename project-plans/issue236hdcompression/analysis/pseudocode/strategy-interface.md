# Pseudocode: Strategy Interface Extension

**Requirement Coverage**: REQ-HD-001.1 through REQ-HD-001.10, REQ-HD-004.1 through REQ-HD-004.4

---

## Interface Contracts

### INPUTS
```typescript
// No runtime inputs — this is type/constant definition only.
// Existing code that imports from types.ts will gain new types.
```

### OUTPUTS
```typescript
// New types exported from compression/types.ts:
type StrategyTrigger =
  | { mode: 'threshold'; defaultThreshold: number }
  | { mode: 'continuous'; defaultThreshold: number };

interface DensityResult {
  removals: readonly number[];
  replacements: ReadonlyMap<number, IContent>;
  metadata: DensityResultMetadata;
}

interface DensityResultMetadata {
  readWritePairsPruned: number;
  fileDeduplicationsPruned: number;
  recencyPruned: number;
}

interface DensityConfig {
  readonly readWritePruning: boolean;
  readonly fileDedupe: boolean;
  readonly recencyPruning: boolean;
  readonly recencyRetention: number;
  readonly workspaceRoot: string;
}
```

### DEPENDENCIES
```typescript
// Existing dependency — IContent from services/history/IContent.ts
// Existing dependency — all existing types in compression/types.ts
// No new external dependencies required
```

---

## Pseudocode: types.ts Modifications

```
 10: // === NEW TYPE: StrategyTrigger ===
 11: TYPE StrategyTrigger IS UNION OF
 12:   { mode: 'threshold', defaultThreshold: number }
 13:   { mode: 'continuous', defaultThreshold: number }
 14:
 15: // === NEW TYPE: DensityResult ===
 16: INTERFACE DensityResult
 17:   removals: READONLY ARRAY OF number     // indices into raw history
 18:   replacements: READONLY MAP<number, IContent>
 19:   metadata: DensityResultMetadata
 20:
 21: // === NEW TYPE: DensityResultMetadata ===
 22: INTERFACE DensityResultMetadata
 23:   readWritePairsPruned: number
 24:   fileDeduplicationsPruned: number
 25:   recencyPruned: number
 26:
 27: // === NEW TYPE: DensityConfig ===
 28: INTERFACE DensityConfig
 29:   READONLY readWritePruning: boolean
 30:   READONLY fileDedupe: boolean
 31:   READONLY recencyPruning: boolean
 32:   READONLY recencyRetention: number
 33:   READONLY workspaceRoot: string
 34:
 35: // === UPDATE: COMPRESSION_STRATEGIES tuple ===
 36: CONST COMPRESSION_STRATEGIES = [
 37:   'middle-out',
 38:   'top-down-truncation',
 39:   'one-shot',
 40:   'high-density',                        // ← NEW entry
 41: ] AS CONST
 42:
 43: // CompressionStrategyName automatically includes 'high-density'
 44: // via (typeof COMPRESSION_STRATEGIES)[number]
 45:
 46: // === UPDATE: CompressionStrategy interface ===
 47: INTERFACE CompressionStrategy
 48:   READONLY name: CompressionStrategyName
 49:   READONLY requiresLLM: boolean
 50:   READONLY trigger: StrategyTrigger       // ← NEW required property
 51:
 52:   // NEW optional method — only continuous strategies implement this
 53:   OPTIONAL optimize(
 54:     history: READONLY ARRAY OF IContent,
 55:     config: DensityConfig
 56:   ): DensityResult
 57:
 58:   // Existing method — unchanged signature
 59:   compress(context: CompressionContext): PROMISE<CompressionResult>
 60:
 61: // === UPDATE: CompressionContext interface ===
 62: INTERFACE CompressionContext
 63:   // ... all existing fields preserved ...
 64:   READONLY activeTodos?: READONLY ARRAY OF Todo   // ← NEW optional field
 65:   READONLY transcriptPath?: string                 // ← NEW optional field
```

---

## Pseudocode: Updating Existing Strategies

### MiddleOutStrategy.ts

```
 70: CLASS MiddleOutStrategy IMPLEMENTS CompressionStrategy
 71:   READONLY name = 'middle-out'
 72:   READONLY requiresLLM = true
 73:   READONLY trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 }
 74:                                       // ← NEW property added
 75:
 76:   // optimize() is NOT implemented — threshold-only strategy
 77:   // compress() method body is UNCHANGED
```

### TopDownTruncationStrategy.ts

```
 80: CLASS TopDownTruncationStrategy IMPLEMENTS CompressionStrategy
 81:   READONLY name = 'top-down-truncation'
 82:   READONLY requiresLLM = false
 83:   READONLY trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 }
 84:                                       // ← NEW property added
 85:
 86:   // optimize() is NOT implemented — threshold-only strategy
 87:   // compress() method body is UNCHANGED
```

### OneShotStrategy.ts

```
 90: CLASS OneShotStrategy IMPLEMENTS CompressionStrategy
 91:   READONLY name = 'one-shot'
 92:   READONLY requiresLLM = true
 93:   READONLY trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 }
 94:                                       // ← NEW property added
 95:
 96:   // optimize() is NOT implemented — threshold-only strategy
 97:   // compress() method body is UNCHANGED
```

---

## Pseudocode: Factory Update (compressionStrategyFactory.ts)

```
100: FUNCTION getCompressionStrategy(name: CompressionStrategyName): CompressionStrategy
101:   SWITCH name
102:     CASE 'middle-out':
103:       RETURN NEW MiddleOutStrategy()
104:     CASE 'top-down-truncation':
105:       RETURN NEW TopDownTruncationStrategy()
106:     CASE 'one-shot':
107:       RETURN NEW OneShotStrategy()
108:     CASE 'high-density':                   // ← NEW case
109:       RETURN NEW HighDensityStrategy()
110:     DEFAULT:
111:       // exhaustive check — TypeScript never type
112:       THROW NEW UnknownStrategyError(name)
```

---

## Pseudocode: Index Export Update (index.ts)

```
115: // ADD to existing exports:
116: EXPORT { HighDensityStrategy } FROM './HighDensityStrategy.js'
```

---

## Integration Points

```
Line 36-41: COMPRESSION_STRATEGIES tuple update
  - settingsRegistry.ts line 965 uses [...COMPRESSION_STRATEGIES] for enumValues
  - This AUTOMATICALLY makes 'high-density' a valid option for compression.strategy
  - parseCompressionStrategyName() AUTOMATICALLY accepts 'high-density'
  - No change needed in settingsRegistry for the enum — it derives from the tuple

Line 47-59: CompressionStrategy interface update
  - ALL existing strategy classes MUST add the trigger property to compile
  - The optimize method is OPTIONAL (using ?) so existing strategies need not implement it
  - TypeScript will enforce: any class implementing CompressionStrategy MUST have trigger

Line 50: trigger property is REQUIRED (not optional)
  - This is a BREAKING CHANGE for existing strategies
  - MiddleOutStrategy, TopDownTruncationStrategy, OneShotStrategy MUST be updated
  - in the SAME phase to avoid compilation errors

Line 62-65: CompressionContext additions
  - activeTodos uses the Todo type from tools/todo-schemas.ts
  - The import of Todo type must be added to types.ts
  - The field is optional so existing buildCompressionContext() calls still compile

Line 108-109: Factory case for 'high-density'
  - The import of HighDensityStrategy must be added to compressionStrategyFactory.ts
  - The default exhaustive check handles the new CompressionStrategyName variant
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Add trigger as optional (trigger?: StrategyTrigger)
        WHY: Every strategy MUST declare its trigger. Making it optional means
             the orchestrator needs null-checks everywhere.
[OK]    DO: Make trigger required. Update all existing strategies in same phase.

[ERROR] DO NOT: Create a separate interface (DensityStrategy extends CompressionStrategy)
        WHY: The spec explicitly says ONE interface with optional optimize().
             A subtype would require type guards in the orchestrator.
[OK]    DO: Add optimize? as optional method on CompressionStrategy.

[ERROR] DO NOT: Use 'any' for the DensityResult.replacements map value type
        WHY: replacements values MUST be IContent. Using any loses type safety.
[OK]    DO: Use ReadonlyMap<number, IContent>.

[ERROR] DO NOT: Add 'high-density' to COMPRESSION_STRATEGIES without updating
        the factory switch statement in the same phase
        WHY: The exhaustive switch default (never check) will cause a TypeScript
             error if a new name exists in the union but has no case.
[OK]    DO: Add tuple entry, factory case, and HighDensityStrategy class together.

[ERROR] DO NOT: Import Todo type directly from a CLI package into core types
        WHY: Core must not depend on CLI. Todo schema lives in core already
             (packages/core/src/tools/todo-schemas.ts).
[OK]    DO: Import Todo from the core tools module.
```
