# Pseudocode: Test Migration

## Component: Moving tests to packages/policy and updating retained tests

### Interface Contracts

```typescript
// INPUTS: Test files from packages/core/src/policy/ and packages/core/src/confirmation-bus/
// OUTPUTS: Policy-specific tests in packages/policy/, integration tests remain in core
// DEPENDENCIES: Moved tests depend only on policy package internals
```

### Pseudocode

```
# --- Tests to MOVE to packages/policy/src/ ---
10: MOVE packages/core/src/policy/policy-engine.test.ts
11:   → packages/policy/src/policy-engine.test.ts
12:   UPDATE imports: './policy-engine.js' stays (same relative)
13:   UPDATE imports: './types.js' stays (same relative)
14:   NO other import changes needed (tests only import from policy-engine and types)

20: MOVE packages/core/src/policy/shell-safety.test.ts
21:   → packages/policy/src/shell-safety.test.ts
22:   UPDATE imports: same relative paths, no external deps

30: MOVE packages/core/src/policy/toml-loader.test.ts
31:   → packages/policy/src/toml-loader.test.ts
32:   UPDATE imports: './toml-loader.js' stays, './types.js' stays
33:   VERIFY: @iarna/toml, fs, path, os imports work (all available)

40: MOVE packages/core/src/policy/utils.test.ts
41:   → packages/policy/src/utils.test.ts
42:   UPDATE imports: './utils.js' stays
43:   NO other changes

50: MOVE packages/core/src/confirmation-bus/message-bus.test.ts
51:   → packages/policy/src/confirmation-bus/message-bus.test.ts
52:   UPDATE imports: './message-bus.js' stays
53:   UPDATE imports: '../policy/policy-engine.js' → '../policy-engine.js'
54:   UPDATE imports: '../policy/types.js' → '../types.js'
55:   UPDATE imports: './types.js' stays
56:   UPDATE imports: ToolConfirmationOutcome → ConfirmationOutcome (from ./types.js)
57:   UPDATE imports: remove debugLogger import — use injected PolicyLogger or no-op default
58:   UPDATE imports: FunctionCall from @google/genai → PolicyFunctionCall from ./types.js
59:   VERIFY: zero @google/genai imports in policy package (not prod, not dev, not test)

# --- Tests to KEEP in packages/core ---
70: KEEP packages/core/src/policy/config.test.ts
71:   REASON: Tests createPolicyEngineConfig which stays in core
72:   UPDATE imports: import policy types from '@vybestack/llxprt-code-policy'

73: KEEP packages/core/src/policy/persistence.test.ts
74:   REASON: Tests persistPolicyToToml/createPolicyUpdater which stay in core
75:   UPDATE imports: import PolicyEngine, types from '@vybestack/llxprt-code-policy'
76:   UPDATE imports: import MessageBus from '@vybestack/llxprt-code-policy'

77: KEEP packages/core/src/policy/policy-helpers.test.ts
78:   REASON: Tests policy-helpers.ts which stays in core
79:   UPDATE imports: import types from '@vybestack/llxprt-code-policy'

80: KEEP packages/core/src/policy/policy-updater.test.ts
81:   REASON: Tests createPolicyUpdater which stays in core
82:   UPDATE imports: import from '@vybestack/llxprt-code-policy'

83: KEEP packages/core/src/confirmation-bus/integration.test.ts
84:   REASON: Integration test requiring both policy and core tool systems
85:   UPDATE imports: import from '@vybestack/llxprt-code-policy'

# --- Verification ---
90: RUN npm run test --workspace @vybestack/llxprt-code-policy
91:   VERIFY: All moved tests pass
92: RUN npm run test --workspace @vybestack/llxprt-code-core
93:   VERIFY: All retained tests pass
94: RUN npm run test (full workspace)
95:   VERIFY: No regressions
```

### Integration Points

- Line 50-58: message-bus.test.ts has the most import changes
- Line 70-85: Kept tests need import updates but no logic changes
- Line 90-95: Full test suite must pass before proceeding

### Anti-Pattern Warnings

```
[ERROR] DO NOT: Move config.test.ts (tests createPolicyEngineConfig which depends on Storage)
[OK] DO: Keep config.test.ts in core, update imports

[ERROR] DO NOT: Move persistence.test.ts (depends on Storage and core's createPolicyUpdater)
[OK] DO: Keep persistence.test.ts in core

[ERROR] DO NOT: Move integration.test.ts (tests cross-cutting concerns)
[OK] DO: Keep integration.test.ts in core

[ERROR] DO NOT: Forget to update vitest.config.ts to resolve policy package
[OK] DO: Add alias in core's vitest.config.ts for test resolution
```
