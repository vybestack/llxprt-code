# Message Bus Architecture

## System Overview

The message bus and policy engine provide a decoupled, event-driven architecture for tool execution authorization in llxprt-code. This document describes the components, message flows, and integration points.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                           llxprt-code System                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────┐         ┌──────────────┐        ┌──────────────┐   │
│  │   Model     │────────▶│ Tool Request │───────▶│ Tool Registry│   │
│  │  (Gemini/   │         │              │        │              │   │
│  │   etc.)     │         └──────────────┘        └──────┬───────┘   │
│  └─────────────┘                                         │           │
│                                                           │           │
│                                                           ▼           │
│                                                  ┌───────────────┐   │
│                                                  │ CoreTool      │   │
│                                                  │ Scheduler     │   │
│                                                  └───────┬───────┘   │
│                                                          │           │
│                    ┌─────────────────────────────────────┤           │
│                    │                                     │           │
│                    ▼                                     ▼           │
│         ┌──────────────────┐                   ┌─────────────────┐  │
│         │  Message Bus     │◀──────────────────│  Policy Engine  │  │
│         │  (EventEmitter)  │                   │                 │  │
│         └────────┬─────────┘                   └─────────────────┘  │
│                  │                                      ▲            │
│                  │                                      │            │
│      ┌───────────┴───────────┐                         │            │
│      │                       │                         │            │
│      ▼                       ▼                         │            │
│  ┌────────┐          ┌─────────────┐          ┌───────┴────────┐   │
│  │   UI   │          │  Scheduler  │          │ TOML Policy    │   │
│  │(React) │          │ Subscriber  │          │ Loader         │   │
│  └────────┘          └─────────────┘          └────────────────┘   │
│      │                       │                         ▲            │
│      │                       │                         │            │
│      └───────────────────────┼─────────────────────────┘            │
│                              │                                      │
│                              ▼                                      │
│                      ┌──────────────┐                               │
│                      │ Tool Execute │                               │
│                      └──────────────┘                               │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

## Component Descriptions

### PolicyEngine

**Location:** `packages/core/src/policy/policy-engine.ts`

**Responsibilities:**

- Evaluates tool execution requests against configured rules
- Matches rules by priority (highest wins)
- Validates MCP server names to prevent spoofing
- Returns `ALLOW`, `DENY`, or `ASK_USER` decisions

**Key Methods:**

```typescript
evaluate(toolName: string, args: Record<string, unknown>, serverName?: string): PolicyDecision
getRules(): readonly PolicyRule[]
getDefaultDecision(): PolicyDecision
isNonInteractive(): boolean
```

**Rule Matching Algorithm:**

1. Sort rules by priority (highest first) during construction
2. Iterate rules in priority order
3. For each rule:
   - Check if `toolName` matches (undefined = wildcard)
   - Check if `argsPattern` matches serialized args (undefined = match all)
   - If both match, return rule's decision
4. If no rules match, return `defaultDecision`
5. In non-interactive mode, convert `ASK_USER` → `DENY`

### MessageBus

**Location:** `packages/core/src/confirmation-bus/message-bus.ts`

**Responsibilities:**

- Event-driven pub/sub for tool confirmation messages
- Integrates with PolicyEngine for authorization
- Handles correlation IDs for request/response matching
- Implements 5-minute timeout for user confirmations

**Key Methods:**

```typescript
publish(message: MessageBusMessage): void
subscribe<T>(type: MessageBusType, handler: MessageHandler<T>): () => void
requestConfirmation(toolCall: FunctionCall, args: Record<string, unknown>, serverName?: string): Promise<boolean>
respondToConfirmation(
  correlationId: string,
  outcome: ToolConfirmationOutcome,
  payload?: ToolConfirmationPayload,
  requiresUserConfirmation?: boolean,
): void
```

**Message Flow:**

```
requestConfirmation()
    ↓
PolicyEngine.evaluate()
    ↓
┌───────┬──────────┬──────────┐
│ALLOW  │ DENY     │ ASK_USER │
↓       ↓          ↓
return  publish    publish TOOL_CONFIRMATION_REQUEST
true    REJECTION      ↓
        return     Wait for TOOL_CONFIRMATION_RESPONSE
        false          ↓
                   return outcome
```

### ToolRegistry

**Location:** `packages/core/src/tools/tool-registry.ts`

**Responsibilities:**

- Manages all available tools (built-in and MCP)
- Passes MessageBus to tools via `setMessageBus()`
- Prefixes discovered tools with `discovered_tool_`
- Provides tool lookup and discovery

**Integration Points:**

```typescript
setMessageBus(messageBus: MessageBus): void
getTools(): Map<string, Tool>
registerMCPTool(serverName: string, tool: MCPToolDefinition): void
```

### CoreToolScheduler

**Location:** `packages/core/src/core/coreToolScheduler.ts`

**Responsibilities:**

- Schedules tool execution from model requests
- Subscribes to message bus for confirmation events
- Manages pending confirmations via correlation IDs
- Evaluates policy decisions before invoking legacy confirmation flows

### TOML Policy Loader

**Location:** `packages/core/src/policy/toml-loader.ts`

**Responsibilities:**

- Loads and parses TOML policy files
- Validates schema with Zod
- Transforms string regex patterns to RegExp objects
- Enforces priority band constraints
- Provides comprehensive error messages

**Loading Sequence:**

```
loadPolicyFromToml(path)
    ↓
readFile(path)
    ↓
toml.parse(content)
    ↓
PolicyFileSchema.parse(parsed)
    ↓
transformRule() for each rule
    ↓
validatePriorityBand()
    ↓
parseArgsPattern()
    ↓
return PolicyRule[]
```

**Error Handling:**

- `PolicyLoadError` for TOML syntax errors
- `PolicyLoadError` for schema validation failures
- `PolicyLoadError` for invalid regex patterns
- `PolicyLoadError` for out-of-range priorities

## Message Flow Diagrams

### ALLOW Flow (Immediate Execution)

```
Model Request
    ↓
CoreToolScheduler._schedule()
    ↓
MessageBus.requestConfirmation()
    ↓
PolicyEngine.evaluate()
    ↓
Decision: ALLOW
    ↓
return true immediately
    ↓
Tool Executes
```

### DENY Flow (Rejection)

```
Model Request
    ↓
CoreToolScheduler._schedule()
    ↓
MessageBus.requestConfirmation()
    ↓
PolicyEngine.evaluate()
    ↓
Decision: DENY
    ↓
publish TOOL_POLICY_REJECTION message
    ↓
return false
    ↓
Tool Blocked
```

### ASK_USER Flow (User Confirmation)

```
Model Request
    ↓
CoreToolScheduler._schedule()
    ↓
MessageBus.requestConfirmation()
    ↓
PolicyEngine.evaluate()
    ↓
Decision: ASK_USER
    ↓
Generate correlationId (UUID)
    ↓
Subscribe to TOOL_CONFIRMATION_RESPONSE
    ↓
publish TOOL_CONFIRMATION_REQUEST
    ↓
[Wait up to 5 minutes]
    ↓
UI receives request
    ↓
User clicks Proceed/Cancel
    ↓
UI publishes TOOL_CONFIRMATION_RESPONSE
    ↓
MessageBus matches correlationId
    ↓
Unsubscribe & resolve promise
    ↓
return outcome (ToolConfirmationOutcome)
    ↓
Tool Executes or Blocked
```

### Timeout Flow

```
MessageBus.requestConfirmation() with ASK_USER
    ↓
Set 5-minute timeout
    ↓
publish TOOL_CONFIRMATION_REQUEST
    ↓
[Wait 5 minutes with no response]
    ↓
Timeout fires
    ↓
Unsubscribe
    ↓
return false (treat as denied)
    ↓
Tool Blocked
```

## Confirmation Flow Reference

### Legacy Confirmation Path (Historical)

**Legacy Path:**

```
Tool Request
    ↓
CoreToolScheduler checks tool.shouldConfirmExecute()
    ↓
If true:
  - AppContainer shows confirmation dialog
  - Direct callback to handleConfirmationResponse()
  - Tool executes
If false:
  - Tool executes immediately
```

This describes the original synchronous UX. Parts of it (like diff generation) remain in use after policy evaluation to preserve IDE features.

### Unified Message Bus Flow

Message bus routing is always active:

```
Tool Request
    ↓
PolicyEngine evaluates rules
    ↓
Message bus publishes TOOL_CONFIRMATION_REQUEST (if needed)
    ↓
UI or automations respond via TOOL_CONFIRMATION_RESPONSE
    ↓
Tool executes based on policy decision/outcome
```

All tools now run through the policy engine regardless of approval mode, with legacy confirmation hooks layered on after policy evaluation to preserve UX features such as IDE diffs.

## Compatibility Notes

Earlier builds relied on a feature flag to opt into the message bus path. That flag has been removed—message bus integration is always enabled and ApprovalMode/allowed-tools settings are converted into policy rules automatically.

### Migration Bridge

`packages/core/src/policy/config.ts` provides migration functions:

```typescript
migrateLegacyApprovalMode(config: Config): PolicyRule[]
```

This converts:

- `ApprovalMode.YOLO` → Wildcard ALLOW at priority 1.999
- `ApprovalMode.AUTO_EDIT` → Write tools ALLOW at priority 1.015
- `--allowed-tools` → Individual ALLOW rules at priority 2.3
- `--exclude-tools` → Individual DENY rules at priority 2.4

### Runtime Considerations

- Message bus integration is always enabled
- Legacy UI components still receive confirmation details for IDE workflows
- Config API exposes `getMessageBus()`/`getPolicyEngine()` everywhere
- TOML policies are stored separately from settings.json

## Integration Points

### Config Integration

**Location:** `packages/core/src/config/config.ts`

**New Fields:**

```typescript
class Config {
  private readonly messageBus: MessageBus;
  private readonly policyEngine: PolicyEngine;

  getMessageBus(): MessageBus;
  getPolicyEngine(): PolicyEngine;
}
```

**Initialization:**

```typescript
constructor(params: ConfigParameters) {
  // Create policy engine with loaded config
  this.policyEngine = new PolicyEngine(params.policyEngineConfig);

  // Create message bus with policy engine
  this.messageBus = new MessageBus(this.policyEngine, this.debugMode);
}
```

### CLI Integration

**Location:** `packages/cli/src/config/cliConfig.ts`

**Async Policy Loading:**

```typescript
export async function loadCliConfig(options: CliOptions): Promise<CliConfig> {
  // Create policy engine config (async due to TOML loading)
  const policyEngineConfig = await createPolicyEngineConfig(baseConfig);

  // Pass to Config constructor
  return new Config({
    ...params,
    policyEngineConfig,
  });
}
```

**Policy Update Handler:**

```typescript
function createPolicyUpdater(config: Config): void {
  const messageBus = config.getMessageBus();

  messageBus.subscribe(
    MessageBusType.UPDATE_POLICY,
    (message: UpdatePolicy) => {
      // Add runtime rule for "Always Allow" UI selections
      const policyEngine = config.getPolicyEngine();
      policyEngine.addRule({
        toolName: message.toolName,
        decision: PolicyDecision.ALLOW,
        priority: 2.95,
      });
    },
  );
}
```

### UI Integration

**Location:** `packages/cli/src/ui/AppContainer.tsx`

**Message Bus Subscription:**

```typescript
useEffect(() => {
  const messageBus = config.getMessageBus();

  const unsubscribe = messageBus.subscribe(
    MessageBusType.TOOL_CONFIRMATION_REQUEST,
    (message: ToolConfirmationRequest) => {
      // Bridge to existing UI state
      setConfirmationRequest({
        correlationId: message.correlationId,
        toolCall: convertToLegacyFormat(message.toolCall),
      });
    },
  );

  return unsubscribe;
}, [config]);
```

**Confirmation Response:**

```typescript
const handleConfirm = (outcome: ToolConfirmationOutcome) => {
  const messageBus = config.getMessageBus();

  messageBus.publish({
    type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
    correlationId: confirmationRequest.correlationId,
    outcome,
    confirmed: outcome === ToolConfirmationOutcome.Proceed,
  });
};
```

### Tool Integration

**Base Class Pattern:**

```typescript
class BaseToolInvocation {
  protected readonly messageBus?: MessageBus;

  constructor(messageBus?: MessageBus) {
    this.messageBus = messageBus;
  }

  protected async getMessageBusDecision(
    toolCall: FunctionCall,
    args: Record<string, unknown>,
    serverName?: string,
  ): Promise<boolean> {
    if (!this.messageBus) {
      return true; // No message bus = allow (legacy)
    }

    return await this.messageBus.requestConfirmation(
      toolCall,
      args,
      serverName,
    );
  }
}
```

**Tool Implementation:**

```typescript
class EditTool extends DeclarativeTool {
  async execute(args: EditArgs): Promise<EditResult> {
    // Check message bus decision
    if (this.messageBus) {
      const approved = await this.getMessageBusDecision(
        { name: 'edit', args },
        args,
      );

      if (!approved) {
        throw new Error('Edit operation denied by policy');
      }
    }

    // Execute edit...
  }
}
```

## Security Architecture

### MCP Server Spoofing Prevention

**Problem:** Malicious MCP server could claim to be another server

**Solution:** Validate tool name prefix matches server name

```typescript
private validateServerName(toolName: string, serverName: string): string | null {
  const expectedPrefix = `${serverName}__`;

  if (toolName.startsWith(expectedPrefix)) {
    return toolName; // Valid
  }

  if (!toolName.includes('__')) {
    // Built-in tool, serverName should not be set
    return null; // Spoofing attempt
  }

  // Tool has different server prefix
  return null; // Spoofing attempt
}
```

**Enforcement:**

```typescript
evaluate(toolName: string, args: Record<string, unknown>, serverName?: string): PolicyDecision {
  if (serverName) {
    const validatedToolName = this.validateServerName(toolName, serverName);
    if (validatedToolName === null) {
      return PolicyDecision.DENY; // Spoofing detected
    }
  }

  // Continue with rule matching...
}
```

### Priority Band Enforcement

**Validation:** TOML loader enforces priority range [1.0, 4.0)

```typescript
function validatePriorityBand(
  priority: number | undefined,
  path: string,
): void {
  if (priority === undefined) {
    return; // Default priority 0 is valid
  }

  if (priority < 1.0 || priority >= 4.0) {
    throw new PolicyLoadError(
      `Invalid priority ${priority} in ${path}. Must be in range [1.0, 4.0).`,
      path,
    );
  }
}
```

**Purpose:**

- Prevent accidental priority conflicts
- Reserve tier 3 for future enterprise features
- Ensure user policies (tier 2) override defaults (tier 1)

### Stable Stringify

**Location:** `packages/core/src/policy/stable-stringify.ts`

**Purpose:** Deterministic JSON serialization for pattern matching

**Algorithm:**

- Sort object keys alphabetically
- Recursively process nested objects
- Consistent output for same input regardless of key insertion order

**Example:**

```typescript
// Both produce same output:
const a = { b: 1, a: 2 };
const b = { a: 2, b: 1 };

stableStringify(a) === stableStringify(b); // true
// Output: '{"a":2,"b":1}'
```

**Security Benefit:** Prevents pattern bypass via key reordering

## Performance Characteristics

### Rule Evaluation

**Time Complexity:** O(n) where n = number of rules

- Rules sorted once at construction
- Linear scan stops at first match
- Typical case: < 50 rules, negligible overhead

**Optimization:** Priority sorting moves most likely matches to front

### Message Bus

**Pub/Sub Overhead:** Minimal (EventEmitter is optimized)

- Event dispatch: O(1)
- Subscription management: O(1)
- Memory: ~50 listeners max (configurable)

### TOML Loading

**Startup Cost:** Async file I/O + parsing

- Default policies: ~200 lines, < 10ms to load
- User policies: Variable, typically < 50ms
- Occurs once at startup, not per-request

### Correlation ID Map

**Memory Management:**

- WeakMap in CoreToolScheduler prevents leaks
- 5-minute timeout cleanup for pending confirmations
- Unsubscribe on response or timeout

## Testing Strategy

### Unit Tests

**PolicyEngine:**

- Rule matching logic (priority, wildcards, patterns)
- Server name validation
- Non-interactive mode behavior
- Default decision fallback

**MessageBus:**

- Pub/sub mechanics
- Correlation ID matching
- Timeout handling
- Concurrent requests

**TOML Loader:**

- Valid TOML parsing
- Schema validation errors
- Priority band enforcement
- Regex compilation errors

### Integration Tests

**End-to-End Flows:**

- Tool request → policy → allow → execute
- Tool request → policy → deny → block
- Tool request → policy → ask → UI → approve → execute
- Tool request → policy → ask → timeout → block

**Feature Flag Tests:**

- Legacy path when flag OFF
- New path when flag ON
- No interference between paths

### Migration Tests

**Legacy Compatibility:**

- ApprovalMode.YOLO → wildcard allow
- ApprovalMode.AUTO_EDIT → write tools allow
- --allowed-tools → individual allow rules
- Priority precedence (user > legacy > default)

## Future Enhancements

### Dynamic Policy Reload

**Command:** `/reload-policies`

**Implementation:**

```typescript
async reloadPolicies(): Promise<void> {
  const newRules = await loadPolicyFromToml(this.policyPath);
  this.rules = newRules;
  this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}
```

### Policy Audit Logging

**Feature:** Log all policy decisions for compliance

**Implementation:**

```typescript
evaluate(toolName: string, args: Record<string, unknown>, serverName?: string): PolicyDecision {
  const decision = this.evaluateInternal(toolName, args, serverName);

  // Audit log
  this.auditLog.append({
    timestamp: Date.now(),
    toolName,
    serverName,
    decision,
    matchedRule: this.lastMatchedRule,
  });

  return decision;
}
```

### Policy Testing Framework

**Feature:** Test policy files before deployment

**CLI Command:**

```bash
llxprt test-policy ~/.llxprt/my-policy.toml \
  --tool edit \
  --args '{"file_path": "/etc/hosts"}'
```

**Output:**

```
Testing policy: ~/.llxprt/my-policy.toml

Rule matched:
  Priority: 2.7
  Tool: edit
  Pattern: /etc/
  Decision: DENY

Result: Tool would be BLOCKED
```

## Related Documentation

- [Message Bus User Guide](../message-bus.md)
- [Policy Configuration Guide](../policy-configuration.md)
- [Migration Guide](../migration/approval-mode-to-policies.md)
- [Message Bus Implementation Plan](../../project-plans/20251119gmerge/messagebus.md)
