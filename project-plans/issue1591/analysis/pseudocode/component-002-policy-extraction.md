# Pseudocode: Policy Source Extraction

## Component: Moving policy engine source files to packages/policy/src/

### Interface Contracts

```typescript
// INPUTS: Source files from packages/core/src/policy/ and packages/core/src/utils/
// OUTPUTS: Self-contained policy source files with NO core imports
// DEPENDENCIES (resolved within package):
//   types.ts → no imports
//   stable-stringify.ts → no imports
//   utils.ts → no imports
//   shell-utils.ts (copy) → no imports (only node built-ins)
//   policy-engine.ts → types, stable-stringify, shell-utils (all local)
//   toml-loader.ts → types, utils, @iarna/toml, zod (all local or external)
//   config.ts (partial) → types, toml-loader, utils (all local)
```

### Pseudocode

```
# --- types.ts (MOVE, no changes) ---
10: MOVE packages/core/src/policy/types.ts → packages/policy/src/types.ts
11: NO content changes (self-contained: enums, interfaces only)

# --- stable-stringify.ts (MOVE, no changes) ---
20: MOVE packages/core/src/policy/stable-stringify.ts → packages/policy/src/stable-stringify.ts
21: NO content changes (self-contained)

# --- utils.ts (MOVE, no changes) ---
30: MOVE packages/core/src/policy/utils.ts → packages/policy/src/utils.ts
31: NO content changes (self-contained)

# --- shell-utils.ts (COPY subset) ---
40: CREATE packages/policy/src/utils/shell-utils.ts
41: COPY SHELL_TOOL_NAMES constant: ['run_shell_command', 'ShellTool']
42: COPY splitCommands function (extract from core/shell-utils.ts)
43: COPY hasRedirection function (extract from core/shell-utils.ts)
44: DO NOT copy: ShellConfiguration, getShellConfiguration, parseShellCommand,
    extractCommandNames, etc. (these have core deps)
45: UPDATE imports: remove all core imports, keep only node built-ins
46: ADD license header

# --- policy-engine.ts (MOVE, update imports) ---
50: MOVE packages/core/src/policy/policy-engine.ts → packages/policy/src/policy-engine.ts
51: CHANGE import './types.js' → stays './types.js' (same relative)
52: CHANGE import './stable-stringify.js' → stays (same relative)
53: CHANGE import '../utils/shell-utils.js' → './utils/shell-utils.js' (new relative path)

# --- toml-loader.ts (MOVE, update imports) ---
60: MOVE packages/core/src/policy/toml-loader.ts → packages/policy/src/toml-loader.ts
61: CHANGE import './types.js' → stays (same relative)
62: CHANGE import './utils.js' → stays (same relative)
63: VERIFY @iarna/toml import stays (external dep, declared in package.json)
64: VERIFY zod import stays (external dep, declared in package.json)

# --- config.ts (SPLIT - move partial) ---
70: CREATE packages/policy/src/config.ts
71: MOVE constants: DEFAULT_CORE_POLICIES_DIR, DEFAULT_POLICY_TIER, USER_POLICY_TIER, ADMIN_POLICY_TIER
72: MOVE function: getPolicyDirectories
73:   CHANGE: receive userPoliciesDir and adminPoliciesDir as parameters
74:   REMOVE: import { Storage } from '../config/storage.js'
75:   USE: passed-in paths instead of Storage.getUserPoliciesDir()/getSystemPoliciesDir()
76: MOVE function: getPolicyTier
77:   CHANGE: receive userPoliciesDir and adminPoliciesDir as parameters
78:   REMOVE: import { Storage } from '../config/storage.js'
79: MOVE function: formatPolicyError (no changes, pure function)
80: MOVE interface: PolicyConfigSource
81:   CHANGE: use ApprovalMode from ./types.js instead of from ../config/config.js
82: MOVE function: migrateLegacyApprovalMode
83:   CHANGE: use ApprovalMode from ./types.js
84:   REMOVE: import { ApprovalMode as ApprovalModeEnum } from '../config/config.js'
85: MOVE helper: normalizeToolName (used only by migrateLegacyApprovalMode)
86: MOVE helper: AUTO_EDIT_TOOLS constant
87: DO NOT MOVE: createPolicyEngineConfig, createPolicyUpdater, persistPolicyToToml
88: DO NOT MOVE: addMcpExcludedRules, addToolsExcludedRules, addToolsAllowedRules, etc.
89: DO NOT MOVE: buildConfigSourceRules, buildSettingsRules, loadUserPolicyRules
90: REMOVE from moved code: import { Storage } from '../config/storage.js'
91: REMOVE from moved code: import { ApprovalMode as ApprovalModeEnum } from '../config/config.js'
92: REMOVE from moved code: import { coreEvents } from '../utils/events.js'
93: REMOVE from moved code: import { debugLogger } from '../utils/debugLogger.js'

# --- policies/ directory (COPY) ---
100: COPY packages/core/src/policy/policies/*.toml → packages/policy/src/policies/
101: COPY read-only.toml, write.toml, discovered.toml, yolo.toml
```

### Integration Points

- Line 51-53: policy-engine.ts imports must resolve within packages/policy/src/
- Line 70-93: config.ts split is the most critical — wrong split means circular deps
- Line 73-78: Storage decoupling via parameter injection is the key design decision

### Anti-Pattern Warnings

```
[ERROR] DO NOT: Move createPolicyEngineConfig — it imports Storage, coreEvents
[OK] DO: Keep createPolicyEngineConfig in core, only move pure utilities

[ERROR] DO NOT: Import from '../config/storage.js' in policy config.ts
[OK] DO: Accept storage paths as function parameters

[ERROR] DO NOT: Copy entire shell-utils.ts (has Config, debugLogger deps)
[OK] DO: Copy only SHELL_TOOL_NAMES, splitCommands, hasRedirection

[ERROR] DO NOT: Import ApprovalModeEnum from core's config
[OK] DO: Use ApprovalMode from policy's own types.ts
```
