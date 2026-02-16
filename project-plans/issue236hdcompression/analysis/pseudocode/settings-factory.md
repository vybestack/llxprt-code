# Pseudocode: Settings, Runtime Accessors, and Factory Update

**Requirement Coverage**: REQ-HD-009.1 through REQ-HD-009.6, REQ-HD-004.1, REQ-HD-004.2, REQ-HD-004.4, REQ-HD-001.10

---

## Interface Contracts

### INPUTS
```typescript
// Settings registration: static configuration data added to SETTINGS_REGISTRY array.
// Runtime accessors: no inputs — they read from live settings service.
// Factory: receives CompressionStrategyName string.
```

### OUTPUTS
```typescript
// Settings registration: 4 new SettingsSpec entries in SETTINGS_REGISTRY[].
// Runtime accessors: 4 new methods on ephemerals interface:
//   densityReadWritePruning(): boolean
//   densityFileDedupe(): boolean
//   densityRecencyPruning(): boolean
//   densityRecencyRetention(): number
// Factory: returns HighDensityStrategy instance for 'high-density'.
```

### DEPENDENCIES
```typescript
// settingsRegistry.ts already imports COMPRESSION_STRATEGIES from compression/types.ts.
// AgentRuntimeContext.ts defines the ephemerals interface.
// createAgentRuntimeContext.ts wires the accessors to the settings service.
// compressionStrategyFactory.ts imports strategy classes.
```

---

## Pseudocode: 4 New Settings in settingsRegistry.ts

```
 10: // ADD after the existing 'compression.profile' entry (after line 976)
 11: // These settings control the density optimization sub-features.
 12:
 13: // Setting 1: READ→WRITE pair pruning toggle
 14: {
 15:   key: 'compression.density.readWritePruning',
 16:   category: 'cli-behavior',
 17:   description: 'Enable READ→WRITE pair pruning in high-density strategy',
 18:   type: 'boolean',
 19:   default: true,
 20:   persistToProfile: true,
 21: },
 22:
 23: // Setting 2: Duplicate @ file dedup toggle
 24: {
 25:   key: 'compression.density.fileDedupe',
 26:   category: 'cli-behavior',
 27:   description: 'Enable duplicate @ file inclusion deduplication',
 28:   type: 'boolean',
 29:   default: true,
 30:   persistToProfile: true,
 31: },
 32:
 33: // Setting 3: Recency pruning toggle (default OFF)
 34: {
 35:   key: 'compression.density.recencyPruning',
 36:   category: 'cli-behavior',
 37:   description: 'Enable tool result recency pruning (keep last N per tool type)',
 38:   type: 'boolean',
 39:   default: false,
 40:   persistToProfile: true,
 41: },
 42:
 43: // Setting 4: Recency retention count
 44: {
 45:   key: 'compression.density.recencyRetention',
 46:   category: 'cli-behavior',
 47:   description: 'Number of recent results to keep per tool type',
 48:   type: 'number',
 49:   default: 3,
 50:   persistToProfile: true,
 51: },
```

---

## Pseudocode: Settings Auto-Registration for 'high-density'

```
 55: // REQ-HD-004.4: The existing compression.strategy setting at line 960
 56: // uses [...COMPRESSION_STRATEGIES] for enumValues.
 57: // When 'high-density' is added to the COMPRESSION_STRATEGIES tuple
 58: // (in strategy-interface.md, line 36-41), the enumValues for
 59: // compression.strategy AUTOMATICALLY includes 'high-density'.
 60: //
 61: // NO CHANGE needed in settingsRegistry for the strategy enum.
 62: // The derivation is:
 63: //   enumValues: [...COMPRESSION_STRATEGIES]
 64: //   → ['middle-out', 'top-down-truncation', 'one-shot', 'high-density']
```

---

## Pseudocode: Runtime Accessor Interface (AgentRuntimeContext.ts)

```
 70: // ADD to the ephemerals interface in AgentRuntimeContext.ts:
 71: // (alongside existing compressionStrategy, compressionThreshold, etc.)
 72:
 73: INTERFACE EphemeralAccessors
 74:   // ... existing accessors ...
 75:   compressionStrategy(): string
 76:   compressionThreshold(): number
 77:   compressionProfile(): string
 78:   preserveThreshold(): number
 79:   topPreserveThreshold(): number
 80:
 81:   // NEW density accessors
 82:   densityReadWritePruning(): boolean
 83:   densityFileDedupe(): boolean
 84:   densityRecencyPruning(): boolean
 85:   densityRecencyRetention(): number
```

---

## Pseudocode: Wiring Accessors (createAgentRuntimeContext.ts)

```
 90: // In createAgentRuntimeContext.ts, the ephemerals object is built from
 91: // the settings service. Each accessor reads the setting value with a
 92: // type-safe fallback to the default.
 93: //
 94: // Pattern from existing code (e.g., compressionStrategy accessor):
 95: //   compressionStrategy: () => settingsService.get('compression.strategy') ?? 'middle-out',
 96: //
 97: // NEW accessors follow the same pattern:
 98:
 99: densityReadWritePruning: () =>
100:   LET value = settingsService.get('compression.density.readWritePruning')
101:   IF typeof value === 'boolean'
102:     RETURN value
103:   RETURN true    // default: true
104:
105: densityFileDedupe: () =>
106:   LET value = settingsService.get('compression.density.fileDedupe')
107:   IF typeof value === 'boolean'
108:     RETURN value
109:   RETURN true    // default: true
110:
111: densityRecencyPruning: () =>
112:   LET value = settingsService.get('compression.density.recencyPruning')
113:   IF typeof value === 'boolean'
114:     RETURN value
115:   RETURN false   // default: false
116:
117: densityRecencyRetention: () =>
118:   LET value = settingsService.get('compression.density.recencyRetention')
119:   IF typeof value === 'number' AND value >= 1
120:     RETURN value
121:   RETURN 3       // default: 3
```

---

## Pseudocode: EphemeralSettings Types Update

```
125: // REQ-HD-009.6: Add optional fields to EphemeralSettings interface
126: // (in packages/core/src/types/modelParams.ts or wherever EphemeralSettings is defined)
127:
128: INTERFACE EphemeralSettings
129:   // ... existing fields ...
130:   'compression.density.readWritePruning'?: boolean
131:   'compression.density.fileDedupe'?: boolean
132:   'compression.density.recencyPruning'?: boolean
133:   'compression.density.recencyRetention'?: number
```

---

## Pseudocode: Factory Update (compressionStrategyFactory.ts)

```
140: // This is also covered in strategy-interface.md (lines 100-112).
141: // Repeated here for settings-factory completeness.
142:
143: FUNCTION getCompressionStrategy(name: CompressionStrategyName): CompressionStrategy
144:   SWITCH name
145:     CASE 'middle-out':
146:       RETURN NEW MiddleOutStrategy()
147:     CASE 'top-down-truncation':
148:       RETURN NEW TopDownTruncationStrategy()
149:     CASE 'one-shot':
150:       RETURN NEW OneShotStrategy()
151:     CASE 'high-density':
152:       RETURN NEW HighDensityStrategy()
153:     DEFAULT:
154:       THROW NEW UnknownStrategyError(name)
155:
156: // IMPORT must be added at top of file:
157: // import { HighDensityStrategy } from './HighDensityStrategy.js';
```

---

## Pseudocode: Threshold Precedence Resolution

```
160: // REQ-HD-001.10: Threshold precedence
161: //
162: // Resolution order for compression threshold:
163: //   1. Ephemeral override (user typed /set compression-threshold 0.9)
164: //   2. Profile setting (loaded from profile JSON)
165: //   3. Strategy default (trigger.defaultThreshold)
166: //
167: // Current implementation in createAgentRuntimeContext.ts:
168: //   compressionThreshold: () => {
169: //     const value = settingsService.get('compression-threshold');
170: //     return typeof value === 'number' ? value : 0.85;
171: //   }
172: //
173: // The hardcoded 0.85 fallback matches all strategies' defaultThreshold.
174: // For now, no change is needed — the precedence works correctly.
175: //
176: // FUTURE: If a strategy declares a different defaultThreshold:
177: //   compressionThreshold: () => {
178: //     const value = settingsService.get('compression-threshold');
179: //     if (typeof value === 'number') return value;
180: //     // Resolve active strategy's default
181: //     const strategyName = settingsService.get('compression.strategy') ?? 'middle-out';
182: //     const strategy = getCompressionStrategy(parseCompressionStrategyName(strategyName));
183: //     return strategy.trigger.defaultThreshold;
184: //   }
185: //
186: // This future approach is NOT implemented now to avoid circular dependencies
187: // (settings accessor calling strategy factory which reads settings).
```

---

## Integration Points

```
Line 10-51: Settings registration
  - Settings are added to the SETTINGS_REGISTRY array in settingsRegistry.ts.
  - The array is processed at startup by the settings service.
  - Each setting becomes available via settingsService.get(key).
  - The 'persistToProfile: true' flag means these can be saved in profiles.

Line 55-64: Auto-registration of 'high-density' in compression.strategy enum
  - The existing 'compression.strategy' setting derives enumValues from
    [...COMPRESSION_STRATEGIES].
  - Adding to the tuple is sufficient — no manual enum update needed.
  - This means the /set compression.strategy high-density command will work
    once the tuple is updated.

Line 70-85: Ephemeral accessor interface
  - The interface in AgentRuntimeContext.ts is the type contract.
  - All code that uses runtimeContext.ephemerals.densityReadWritePruning()
    depends on this interface.
  - Must be updated BEFORE the orchestration code that calls these accessors.

Line 90-121: Accessor wiring
  - createAgentRuntimeContext.ts creates the concrete implementation.
  - Each accessor reads from the settings service with type checking.
  - The defaults here MUST match the defaults in the SETTINGS_REGISTRY specs.
  - If they diverge, the setting spec says one default but the accessor
    returns a different one — causing confusing behavior.

Line 125-133: EphemeralSettings types
  - The EphemeralSettings interface may need updating for profile persistence.
  - These fields allow profiles to save density settings.
  - Must be checked against the actual EphemeralSettings location in the codebase.

Line 140-157: Factory update
  - The import of HighDensityStrategy.ts must be added.
  - The switch case must be added BEFORE the default exhaustive check.
  - This is a compilation requirement — if 'high-density' is in the
    CompressionStrategyName union but not in the switch, TypeScript will
    error on the never check.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Use different default values in settings spec vs accessor
        WHY: The settings spec says default: true for readWritePruning.
             If the accessor returns false when the setting is unset,
             behavior is inconsistent and confusing.
[OK]    DO: Match defaults exactly: spec default === accessor fallback.

[ERROR] DO NOT: Add validation to the boolean settings that rejects non-boolean values
        WHY: The existing pattern for boolean settings uses type: 'boolean'
             without a validate function. The settings service handles type coercion.
             Adding custom validation creates inconsistency with other boolean settings.
[OK]    DO: Use type: 'boolean' only, matching existing pattern.

[ERROR] DO NOT: Add the settings AFTER the closing ] of SETTINGS_REGISTRY
        WHY: The SETTINGS_REGISTRY is a const array. New entries must be
             inside the array literal, before the closing bracket.
[OK]    DO: Add entries after the last existing entry (compression.profile)
        and before the closing ];

[ERROR] DO NOT: Import HighDensityStrategy at the settings level
        WHY: Settings and strategy are separate layers. The settings registry
             should NOT import strategy classes — only the factory does that.
[OK]    DO: Keep imports layered: settings → types only, factory → strategy classes.

[ERROR] DO NOT: Hardcode 'high-density' string in the settings file
        WHY: The enumValues for compression.strategy are derived from
             COMPRESSION_STRATEGIES. Adding the string manually creates
             duplication and divergence risk.
[OK]    DO: Let the tuple drive the enum. Just update the tuple in types.ts.

[ERROR] DO NOT: Add a validate function to recencyRetention that clamps to minimum 1
        WHY: The setting spec allows any number. The clamping to minimum 1
             happens in the strategy code (optimize method, line 408 in
             high-density-optimize.md). Settings validation should validate
             the setting value, not the business rule.
             However, a validation rejecting negative numbers IS appropriate.
[OK]    DO: Consider adding validate for recencyRetention to reject values < 1,
        but keep the Math.max(1, ...) clamp in the strategy as a safety net.
```
