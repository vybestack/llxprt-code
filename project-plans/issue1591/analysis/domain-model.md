# Domain Analysis: Policy Package Extraction

## Entity Relationships

```
PolicyEngine ──── uses ──── PolicyRule[]
    │                           │
    │                           └── references PolicyDecision (enum)
    │
    ├── uses ──── stable-stringify (deterministic JSON)
    ├── uses ──── shell-utils (SHELL_TOOL_NAMES, splitCommands, hasRedirection)
    └── configured by ──── PolicyEngineConfig

MessageBus ──── uses ──── PolicyEngine
    │                       │
    │                       └── evaluates tool calls against policy
    │
    ├── publishes ──── MessageBusMessage (discriminated union)
    │                     ├── ToolConfirmationRequest
    │                     ├── ToolConfirmationResponse
    │                     ├── ToolPolicyRejection
    │                     ├── ToolExecutionSuccess
    │                     ├── ToolExecutionFailure
    │                     ├── UpdatePolicy
    │                     ├── BucketAuthConfirmationRequest/Response
    │                     ├── HookExecutionRequest/Response
    │                     └── ToolCallsUpdateMessage<T>
    │
    └── uses ──── ConfirmationOutcome (enum)
                 ConfirmationPayload (interface)

TomlLoader ──── uses ──── Zod schemas
    │                └── PolicyRuleSchema, PolicyFileSchema
    │
    ├── loads ──── .toml files from policy directories
    │                 ├── read-only.toml (default tier)
    │                 ├── write.toml (default tier)
    │                 ├── discovered.toml (default tier)
    │                 └── yolo.toml (default tier)
    │
    ├── transforms ──── priority: tier + rawPriority/1000
    └── filters ──── by ApprovalMode

Config (policy subset):
    ├── Constants: DEFAULT_CORE_POLICIES_DIR, tier values
    ├── getPolicyDirectories(userDir, adminDir) → string[]
    ├── getPolicyTier(dir, userDir, adminDir) → number
    ├── formatPolicyError(error) → string
    └── migrateLegacyApprovalMode(config) → PolicyRule[]
```

## State Transitions

### Policy Evaluation Flow

```
ToolCall(name, args, serverName?)
    │
    ▼
PolicyEngine.evaluate(name, args, serverName)
    │
    ├── Validate serverName → DENY if spoofing detected
    │
    ├── Find highest-priority matching rule
    │   ├── Check toolName match
    │   └── Check argsPattern match (via stableStringify)
    │
    ├── If matching rule found:
    │   ├── For shell commands: validate sub-commands recursively
    │   │   ├── Split compound commands
    │   │   ├── Evaluate each sub-command
    │   │   └── Aggregate: DENY > ASK_USER > ALLOW
    │   │
    │   ├── Check redirections (if not allowRedirection)
    │   └── Return rule.decision
    │
    └── If no matching rule:
        ├── Still validate shell sub-commands (security)
        └── Return defaultDecision (ASK_USER by default)
```

### Confirmation Flow

```
MessageBus.requestConfirmation(toolCall, args, serverName)
    │
    ├── PolicyEngine.evaluate() → ALLOW? → return true
    │                         → DENY?  → publish rejection, return false
    │                         → ASK_USER? ↓
    │
    ├── Publish ToolConfirmationRequest
    │
    ├── Subscribe to ToolConfirmationResponse (with correlationId)
    │
    ├── Wait (5 min timeout) for response
    │   ├── response.outcome provided:
    │   │   ├── ProceedOnce/ProceedAlways/etc → true
    │   │   └── Cancel/ModifyWithEditor/SuggestEdit → false
    │   └── response.confirmed (legacy) → boolean
    │
    └── Timeout → return false
```

## Dependency Boundary Analysis

### What CAN go into the policy package (no external deps beyond @iarna/toml and zod):

| Module | External Dependencies | Resolvable? |
|--------|----------------------|-------------|
| types.ts | None | [OK] Trivially |
| policy-engine.ts | types, stable-stringify, shell-utils (SHELL_TOOL_NAMES, splitCommands, hasRedirection) | [OK] Copy shell-utils subset |
| stable-stringify.ts | None | [OK] Trivially |
| utils.ts | None | [OK] Trivially |
| toml-loader.ts | types, utils, @iarna/toml, zod, fs, path | [OK] All available |
| config.ts (partial) | types, toml-loader, utils, Storage, ApprovalModeEnum, coreEvents, debugLogger | WARNING: Split needed |

### What CANNOT go into the policy package:

| Module | Blocking Dependencies |
|--------|----------------------|
| policy-helpers.ts | AnyToolInvocation, BaseToolInvocation, ToolCallRequestInfo, ToolErrorType, createErrorResponse, FunctionCall (@google/genai), MessageBus |
| createPolicyEngineConfig() | Storage (core config), ApprovalModeEnum (core config), coreEvents (core utils) |
| createPolicyUpdater() | Storage (for persistPolicyToToml), coreEvents, MessageBus |

### config.ts Split Strategy

**Move to policy package:**
- `DEFAULT_CORE_POLICIES_DIR` — just `path.join(__dirname, 'policies')`
- `DEFAULT_POLICY_TIER`, `USER_POLICY_TIER`, `ADMIN_POLICY_TIER` — constants
- `getPolicyDirectories()` — receives paths as parameters instead of calling `Storage`
- `getPolicyTier()` — receives paths as parameters
- `formatPolicyError()` — pure function
- `PolicyConfigSource` interface
- `migrateLegacyApprovalMode()` — uses `ApprovalMode` from types.ts, no core deps
- `normalizeToolName()` — used only by migrateLegacyApprovalMode

**Stay in core:**
- `createPolicyEngineConfig()` — imports Storage, coreEvents, debugLogger, ApprovalModeEnum
- `createPolicyUpdater()` — imports Storage, coreEvents, debugLogger
- `persistPolicyToToml()` — imports Storage, coreEvents, debugLogger
- All settings-based rule helpers (addMcpExcludedRules, etc.) — use PolicySettings which stays in policy

### Shell Utils Copy Strategy

Only these functions are needed by PolicyEngine:
- `SHELL_TOOL_NAMES` constant
- `splitCommands(command)` — splits on `&&`, `||`, `;`, `|`
- `hasRedirection(command)` — checks for `>`, `>>`, `<`, `|`

The rest of shell-utils.ts (ShellConfiguration, getShellConfiguration, parseShellCommand, etc.) has heavy core dependencies and stays in core.

## Edge Cases

1. **Circular dependency risk**: MessageBus imports PolicyEngine, PolicyEngine doesn't import MessageBus → Safe, same package
2. **TOML policies directory path**: Uses `__dirname` to locate `src/policies/` — must work from both source (ts) and compiled (dist) paths
3. **ApprovalMode enum duplication**: The enum exists in both `policy/types.ts` and `core/config/configTypes.ts` — policy's version is the canonical one, core's config.ts maps between them
4. **ConfirmationOutcome backward compat**: Must export as both `ConfirmationOutcome` (new) and `ToolConfirmationOutcome` (alias) from core
5. **FunctionCall type from @google/genai**: Used in confirmation-bus types and message-bus.ts — `PolicyFunctionCall` interface defined in policy package replaces it. `@google/genai` is NOT a dependency of the policy package (not prod, not dev). Core maps `FunctionCall` → `PolicyFunctionCall` at the boundary.

## Error Scenarios

1. Missing TOML files → PolicyLoadResult with errors, not thrown
2. Invalid TOML syntax → Detailed error with file, line, suggestion
3. Schema validation failure → Field-level error messages
4. Regex compilation failure → Caught and reported as PolicyFileError
5. ReDoS patterns → Blocked by validatePolicyRegex (nested quantifiers)
6. Priority overflow (> 999) → Blocked by Zod schema validation
7. Server name spoofing → PolicyEngine.validateServerName returns null → DENY

## P01 Verification Notes (2026-06-10)

Cross-referenced all entity relationships against actual code. Key findings:

1. **PolicyEngine**: Verified constructor `constructor(config?: PolicyEngineConfig)` at line 22, `evaluate()` public at line 39, `getRules()` at line 324, `validateServerName()` private at line 296 — matches model
2. **PolicyRule interface**: All fields verified at types.ts:19-60 (name, toolName, argsPattern, decision, priority, allowRedirection, source) — matches model exactly
3. **PolicyEngineConfig**: Verified at types.ts:62-80 (rules, defaultDecision, nonInteractive) — matches model
4. **PolicySettings**: Verified at types.ts:81-91 (mcp, tools, mcpServers) — matches model
5. **MessageBus**: Verified constructor `constructor(policyEngine?: PolicyEngine, debugMode = false)` at line 31, `publish()` at line 45, `subscribe()` at line 60, `requestConfirmation()` at line 93 — matches model
6. **ToolCallsUpdateMessage**: Verified at types.ts:22 as `export interface ToolCallsUpdateMessage { type: MessageBusType.TOOL_CALLS_UPDATE; readonly toolCalls: readonly ToolCall[]; }` — NOT currently generic, plan to make it generic `<T = unknown>` is correct
7. **MessageBusMessage union**: Verified at types.ts:149 as discriminated union of all message types — matches model
8. **TomlLoader**: Verified at toml-loader.ts with Zod schemas and @iarna/toml dependency — matches model
9. **Config split boundary**: Verified getPolicyDirectories (line 53) uses `Storage.getUserPoliciesDir()` and `Storage.getSystemPoliciesDir()` directly — must be refactored to accept parameters as planned
10. **Confirmation flow**: MessageBus.requestConfirmation() integrates with PolicyEngine.evaluate(), publishes ToolConfirmationRequest, subscribes to ToolConfirmationResponse with correlationId — matches state transitions in model

**Domain model accuracy: PASS — all entity relationships and state transitions verified against actual codebase**
