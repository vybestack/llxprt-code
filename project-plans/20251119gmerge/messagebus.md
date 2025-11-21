# Message Bus & Policy Engine Integration Plan

## 1. Upstream Commit Details

### Important Note on Commit Availability

The commits listed below (`ba85aa49c`, `b8df8b2ab`, etc.) are from upstream's **main branch**, not the v0.6.1→v0.7.0 tag range. They were not included in the original cherry-pick assessment because that assessment only covered commits between release tags.

**Action Required:** These commits must be fetched separately from `upstream/main` or reimplemented custom for llxprt's architecture. Direct cherry-picking is not recommended due to the significant architectural differences in:
- Multi-provider model routing
- AppContainer state management
- Extension system differences

**Recommended Approach:** Reimplement based on upstream patterns but adapted for llxprt's architecture, using this plan as the specification.

---

### Commit ba85aa49c - Tool Confirmation Message Bus foundation
**Files Created/Modified:**
- `packages/core/src/confirmation-bus/index.ts` (8 lines) - exports
- `packages/core/src/confirmation-bus/message-bus.ts` (98 lines) - EventEmitter-based bus
- `packages/core/src/confirmation-bus/message-bus.test.ts` (235 lines) - tests
- `packages/core/src/confirmation-bus/types.ts` (51 lines) - MessageBusType enum, message interfaces
- `packages/core/src/policy/index.ts` (8 lines) - exports
- `packages/core/src/policy/policy-engine.ts` (107 lines) - rule matching, decisions
- `packages/core/src/policy/policy-engine.test.ts` (624 lines) - comprehensive tests
- `packages/core/src/policy/stable-stringify.ts` (128 lines) - deterministic JSON for pattern matching
- `packages/core/src/policy/types.ts` (55 lines) - PolicyDecision enum, PolicyRule, PolicyEngineConfig
- `packages/core/src/config/config.ts` (+16 lines) - adds getMessageBus(), getPolicyEngine()

### Commit b8df8b2ab - Wire up UI for ASK_USER policy decisions
**Files Modified:**
- `packages/core/src/confirmation-bus/types.ts` (+5 lines) - adds `requiresUserConfirmation` flag
- `packages/core/src/core/coreToolScheduler.ts` (+31 lines) - subscribes to message bus, handles ASK_USER
- `packages/core/src/tools/tools.ts` (+151/-97 lines) - refactors `getMessageBusDecision()` helper
- `packages/core/src/tools/web-fetch.ts` (+34 lines) - integrates message bus confirmation
- Various test files updated

### Commit bf80263bd - Implement message bus and policy engine
**Files Modified:**
- `packages/cli/src/config/policy.ts` (+41 lines) - adds `createPolicyUpdater()`, UPDATE_POLICY message
- `packages/cli/src/gemini.tsx` (+5 lines) - wires policy updater
- `packages/core/src/confirmation-bus/types.ts` (+9 lines) - adds UpdatePolicy message type
- `packages/core/src/tools/*.ts` - threads messageBus through all read-only tools (glob, grep, ls, read-file, read-many-files, ripGrep, web-search)
- Each tool gains 25-30 lines for messageBus constructor param and `createInvocation()` signature

### Commit b188a51c3 - Tool execution confirmation hook
**Files Modified:**
- `packages/core/src/core/coreToolScheduler.ts` (+58/-29 lines) - static WeakMap for subscription deduplication
- `packages/core/src/tools/edit.ts` (+45 lines) - extends BaseToolInvocation, adds `getConfirmationDetails()`
- `packages/core/src/tools/memoryTool.ts` (+34 lines) - message bus integration
- `packages/core/src/tools/shell.ts` (+20 lines) - message bus integration
- `packages/core/src/tools/smart-edit.ts` (+36 lines) - message bus integration
- `packages/core/src/tools/write-file.ts` (+24 lines) - message bus integration
- `packages/core/src/tools/tools.ts` (+46 lines) - adds `getConfirmationDetails()` pattern
- `packages/core/src/utils/errors.ts` (+7 lines) - adds CanceledError

### Commit 064edc52f - Config-based policy engine with TOML
**Files Created/Modified:**
- `packages/cli/src/config/policies/read-only.toml` (56 lines) - default read-only tool rules
- `packages/cli/src/config/policies/write.toml` (63 lines) - default write tool rules
- `packages/cli/src/config/policies/yolo.toml` (31 lines) - YOLO mode allow-all
- `packages/cli/src/config/policy-toml-loader.ts` (394 lines) - TOML parsing, rule transformation
- `packages/cli/src/config/policy-toml-loader.test.ts` (982 lines) - comprehensive loader tests
- `packages/cli/src/config/policy.ts` (+294 lines) - async policy config creation
- `packages/cli/src/config/policy.test.ts` (+1322 lines) - policy config tests
- `packages/cli/src/config/config.ts` (+29 lines) - async policy loading, debug logging

### Commit ffc5e4d04 - Refactor PolicyEngine to Core Package
**Files Created/Moved:**
- `packages/core/src/policy/config.ts` (251 lines) - moved from CLI
- `packages/core/src/policy/config.test.ts` (644 lines) - moved from CLI
- `packages/core/src/policy/toml-loader.ts` (renamed from CLI)
- `packages/core/src/policy/toml-loader.test.ts` (renamed from CLI)
- `packages/core/src/policy/policies/read-only.toml` (56 lines) - moved to core
- `packages/core/src/policy/policies/write.toml` (63 lines) - moved to core
- `packages/core/src/policy/policies/yolo.toml` (31 lines) - moved to core
- `packages/cli/src/ui/commands/policiesCommand.ts` (73 lines) - new `/policies` command
- Added `@iarna/toml` and `zod` dependencies to core package

### Commit f5bd474e5 - Prevent server name spoofing
**Files Modified:**
- `packages/core/src/policy/policy-engine.ts` (+16 lines) - adds serverName validation
- `packages/core/src/policy/policy-engine.test.ts` (+234 lines) - spoofing prevention tests
- `packages/core/src/confirmation-bus/types.ts` (+1 line) - adds serverName to ToolConfirmationRequest
- `packages/core/src/confirmation-bus/message-bus.ts` (+5 lines) - passes serverName to policy check

### Commit c81a02f8d - Integrate DiscoveredTool with Policy Engine
**Files Created/Modified:**
- `packages/core/src/policy/policies/discovered.toml` (8 lines) - default ASK_USER for discovered tools
- `packages/core/src/tools/tool-registry.ts` (+42 lines) - prefixes discovered tools with `discovered_tool_`
- `packages/core/src/tools/tool-registry.test.ts` (+83 lines) - discovered tool policy tests

---

## 2. New Section - Dependencies

### Required Dependencies to Add

**packages/core/package.json:**
```json
{
  "dependencies": {
    "@iarna/toml": "^2.2.5",
    "zod": "^3.25.76"
  }
}
```

**Note:** llxprt's packages/cli already has `@iarna/toml` (verified in package-lock.json). Need to add it to core package where the TOML loader will live.

### Existing Dependencies Leveraged
- `node:events` - EventEmitter for MessageBus (already available)
- `node:crypto` - randomUUID for correlation IDs (already available)

---

## 3. New Section - Current State Analysis

### Tools With Confirmation Requirements

| Tool | File | Has `shouldConfirmExecute` | Confirmation Type |
|------|------|----------------------------|-------------------|
| EditTool | `edit.ts` | Yes | `edit` (diff display) |
| SmartEditTool | `smart-edit.ts` | Yes | `edit` (diff display) |
| ShellTool | `shell.ts` | Yes | `info` (command allowlist) |
| WriteFileTool | `write-file.ts` | Yes | `edit` (diff display) |
| MemoryTool | `memoryTool.ts` | Yes | `edit` (diff display) |
| WebFetchTool | `web-fetch.ts` | Yes | `info` (URL display) |
| MCPTool | `mcp-tool.ts` | Yes | `info` (generic) |

### Tools Without Confirmation (Read-Only)
- GlobTool, GrepTool, LSTool, ReadFileTool, ReadManyFilesTool, RipGrepTool, WebSearchTool, TaskTool, WriteTodosTool, ListSubagentsTool

### Current Tool Approval Flow

```
┌─────────────────┐
│ Model calls tool │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ CoreToolScheduler       │
│ _schedule()             │
│ - builds invocation     │
│ - calls shouldConfirm   │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Tool.shouldConfirmExecute│
│ - ApprovalMode check    │
│ - build confirmation UI │
└────────┬────────────────┘
         │
    ┌────┴────┐
    │ false?  │ → Execute immediately
    └────┬────┘
         │ true
         ▼
┌─────────────────────────┐
│ Status: awaiting_approval│
│ UI shows dialog         │
│ User clicks Proceed/    │
│ Always/Cancel           │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ handleConfirmationResponse│
│ - schedules execution   │
│ - auto-approves similar │
└─────────────────────────┘
```

### Current Trust System

**TrustLevel enum** (from `trustedFolders.ts`):
- `TRUST_FOLDER` - trust this specific folder
- `TRUST_PARENT` - trust parent directory (and children)
- `DO_NOT_TRUST` - explicitly untrust

**Usage:**
- `isWorkspaceTrusted()` - checks if CWD is trusted
- `isFolderTrustEnabled()` - checks settings.folderTrust flag
- MCP discovery respects `config.isTrustedFolder()` before loading tools

### MCP Tool Naming Convention
- Current: MCP tools use server name prefix (e.g., `my-server__tool-name`)
- Upstream adds `discovered_tool_` prefix for tools from `toolDiscoveryCommand`
- Server trust (`mcpServers.*.trust: true`) allows auto-approval of server tools

---

## 4. Expanded Phase A - Core Infrastructure

### Exact File Structure to Create

```
packages/core/src/
├── confirmation-bus/
│   ├── index.ts
│   ├── message-bus.ts
│   ├── message-bus.test.ts
│   └── types.ts
├── policy/
│   ├── index.ts
│   ├── policy-engine.ts
│   ├── policy-engine.test.ts
│   ├── stable-stringify.ts
│   ├── types.ts
│   ├── config.ts
│   ├── config.test.ts
│   ├── toml-loader.ts
│   ├── toml-loader.test.ts
│   └── policies/
│       ├── read-only.toml
│       ├── write.toml
│       ├── yolo.toml
│       └── discovered.toml
```

### TypeScript Interfaces

**packages/core/src/policy/types.ts:**
```typescript
export enum PolicyDecision {
  ALLOW = 'allow',
  DENY = 'deny',
  ASK_USER = 'ask_user',
}

export interface PolicyRule {
  toolName?: string;          // undefined = wildcard (all tools)
  argsPattern?: RegExp;       // Pattern to match against stable-stringified args
  decision: PolicyDecision;
  priority?: number;          // Higher wins, default 0
}

export interface PolicyEngineConfig {
  rules?: PolicyRule[];
  defaultDecision?: PolicyDecision;
  nonInteractive?: boolean;   // ASK_USER → DENY when true
}
```

**packages/core/src/confirmation-bus/types.ts:**
```typescript
import type { FunctionCall } from '@google/genai';

export enum MessageBusType {
  TOOL_CONFIRMATION_REQUEST = 'tool-confirmation-request',
  TOOL_CONFIRMATION_RESPONSE = 'tool-confirmation-response',
  TOOL_POLICY_REJECTION = 'tool-policy-rejection',
  TOOL_EXECUTION_SUCCESS = 'tool-execution-success',
  TOOL_EXECUTION_FAILURE = 'tool-execution-failure',
  UPDATE_POLICY = 'update-policy',
}

export interface ToolConfirmationRequest {
  type: MessageBusType.TOOL_CONFIRMATION_REQUEST;
  toolCall: FunctionCall;
  correlationId: string;
  serverName?: string;        // For MCP tool spoofing prevention
}

export interface ToolConfirmationResponse {
  type: MessageBusType.TOOL_CONFIRMATION_RESPONSE;
  correlationId: string;
  confirmed: boolean;
  requiresUserConfirmation?: boolean;  // When true, use legacy UI
}

export interface UpdatePolicy {
  type: MessageBusType.UPDATE_POLICY;
  toolName: string;
}

// ... other message types
```

### Export Structure

**packages/core/src/index.ts additions:**
```typescript
// Policy Engine
export * from './policy/types.js';
export * from './policy/policy-engine.js';
export * from './policy/config.js';

// Message Bus
export * from './confirmation-bus/types.js';
export * from './confirmation-bus/message-bus.js';
```

### Config Integration

**packages/core/src/config/config.ts additions:**
```typescript
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import type { PolicyEngineConfig } from '../policy/types.js';

// In ConfigParameters interface:
policyEngineConfig?: PolicyEngineConfig;

// In Config class:
private readonly messageBus: MessageBus;
private readonly policyEngine: PolicyEngine;

// In constructor:
this.policyEngine = new PolicyEngine(params.policyEngineConfig);
this.messageBus = new MessageBus(this.policyEngine, this.debugMode);

// Add getters:
getMessageBus(): MessageBus { return this.messageBus; }
getPolicyEngine(): PolicyEngine { return this.policyEngine; }
getEnableMessageBusIntegration(): boolean {
  return this.ephemeralSettings?.['tools.enableMessageBusIntegration'] ?? false;
}
```

---

## 5. Expanded Phase C - Tool Updates

### Complete Tool List Requiring Updates

| Tool | Est. Lines | Priority | Notes |
|------|------------|----------|-------|
| BaseToolInvocation (tools.ts) | +60 | HIGH | Add `getMessageBusDecision()`, `getConfirmationDetails()` |
| EditTool | +50 | HIGH | Extend BaseToolInvocation, rename to getConfirmationDetails |
| SmartEditTool | +50 | HIGH | Same pattern as EditTool |
| ShellTool | +40 | HIGH | Add message bus constructor param |
| WriteFileTool | +40 | HIGH | Same pattern |
| MemoryTool | +40 | MEDIUM | Same pattern |
| WebFetchTool | +40 | MEDIUM | Already has partial message bus code |
| GlobTool | +30 | LOW | Constructor param, createInvocation signature |
| GrepTool | +30 | LOW | Same |
| LSTool | +30 | LOW | Same |
| ReadFileTool | +30 | LOW | Same |
| ReadManyFilesTool | +30 | LOW | Same |
| RipGrepTool | +30 | LOW | Same |
| WebSearchTool | +30 | LOW | Same |
| MCPTool | +30 | MEDIUM | Add serverName for spoofing prevention |
| ToolRegistry | +50 | HIGH | setMessageBus(), pass to all tools |
| DiscoveredTool | +40 | MEDIUM | Add `discovered_tool_` prefix |

**Total estimated additions: ~700 lines across tools**

### Order of Implementation

1. **Base classes** - `tools.ts` (BaseToolInvocation, DeclarativeTool)
2. **Write tools** - edit, smart-edit, shell, write-file, memoryTool
3. **Network tools** - web-fetch, web-search
4. **Read-only tools** - glob, grep, ls, read-file, read-many-files, ripGrep
5. **MCP integration** - mcp-tool, tool-registry
6. **Discovered tools** - tool-registry DiscoveredTool class

### Phase C.6: UI Integration (0.5 days)

1. Update `ToolCallConfirmationDetails` interface with `correlationId` field
2. Modify `ToolConfirmationMessage.tsx` to publish via message bus when feature flag enabled
3. Add message bus subscription to AppContainer for `TOOL_CONFIRMATION_REQUEST` events
4. Wire IDE confirmation pathway through message bus (wrap existing promise pattern)
5. Add integration tests for UI ↔ bus ↔ scheduler flow:
   - Test confirmation request flows from scheduler to UI
   - Test confirmation response flows from UI back to scheduler
   - Test correlation ID matching
   - Test backward compatibility with feature flag off

### Phase C.7: Legacy Migration (0.5 days)

1. Implement `migrateLegacyApprovalMode()` in `packages/core/src/policy/config.ts`
2. Bridge `--allowed-tools` CLI flag to priority 2.3 policy rules
3. Bridge `--exclude-tools` CLI flag to priority 2.4 policy rules (if exists)
4. Add feature flag guards to CoreToolScheduler:
   - Check `config.getEnableMessageBusIntegration()` before using message bus
   - Fall back to legacy `shouldConfirmExecute()` pattern when disabled
5. Write migration tests:
   - YOLO mode → wildcard allow-all at 1.999
   - AUTO_EDIT mode → write tools allow at 1.015
   - --allowed-tools → priority 2.3 rules
   - Priority precedence tests (higher priority wins)
6. Update any tools that directly call `config.getApprovalMode()` to use new path

---

## 6. New Section - Multi-Provider Considerations

### Provider-Specific Policy Rules

The upstream implementation uses tool names for policy matching. For llxprt's multi-provider architecture:

**Schema Example - Provider-Aware Rules:**
```toml
# Allow Claude-specific tools
[[rule]]
toolName = "claude_artifacts"
decision = "allow"
priority = 100

# Deny certain tools for specific providers (future)
[[rule]]
toolName = "google_web_search"
argsPattern = "sensitive_query"
decision = "deny"
priority = 150
```

### Provider Hints in Tools

Tools that are provider-specific should still work with the policy engine since rules match by tool name, not provider. The policy engine doesn't need to know about providers.

---

## 6.5. UI Consumption Integration

This section details how the React UI layer integrates with the message bus for tool confirmations.

### AppContainer Subscription Pattern

The AppContainer component must subscribe to message bus events to receive tool confirmation requests and publish user responses:

```typescript
// In AppContainer.tsx
import { useEffect, useState } from 'react';
import type { ToolCallConfirmationDetails } from '../types.js';
import { MessageBusType, type ToolConfirmationRequest } from '@anthropic/core';

export function AppContainer({ config }: AppContainerProps) {
  const [confirmationRequest, setConfirmationRequest] = useState<{
    correlationId: string;
    toolCall: ToolCallConfirmationDetails;
  } | null>(null);

  useEffect(() => {
    if (!config.getEnableMessageBusIntegration()) return;

    const messageBus = config.getMessageBus();
    const unsubscribe = messageBus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message: ToolConfirmationRequest) => {
        // Bridge to existing UI state
        setConfirmationRequest({
          correlationId: message.correlationId,
          toolCall: {
            correlationId: message.correlationId,
            toolName: message.toolCall.name,
            args: message.toolCall.args,
            // ... map to existing ToolCallConfirmationDetails
          },
        });
      },
    );
    return unsubscribe;
  }, [config]);

  // When user confirms:
  const handleConfirm = (outcome: ToolConfirmationOutcome) => {
    if (!confirmationRequest) return;

    const messageBus = config.getMessageBus();
    messageBus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId: confirmationRequest.correlationId,
      confirmed: outcome !== ToolConfirmationOutcome.Cancel,
    });

    setConfirmationRequest(null);
  };

  // ... rest of component
}
```

### ToolConfirmationMessage Changes

The `ToolConfirmationMessage.tsx` component must be updated to publish to the message bus instead of calling direct callbacks:

**Before (direct callback):**
```typescript
const handleProceed = () => {
  onConfirm(ToolConfirmationOutcome.Proceed);
};
```

**After (message bus publish):**
```typescript
const handleProceed = () => {
  if (config.getEnableMessageBusIntegration()) {
    const messageBus = config.getMessageBus();
    messageBus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId: confirmationDetails.correlationId,
      confirmed: true,
    });
  } else {
    // Legacy path
    onConfirm(ToolConfirmationOutcome.Proceed);
  }
};
```

### Correlation ID Pattern

The `correlationId` links UI responses back to pending tool calls in the CoreToolScheduler:

**Interface Update:**
```typescript
// In packages/core/src/types.ts or similar
export interface ToolCallConfirmationDetails {
  correlationId: string;  // NEW - required field
  toolName: string;
  args: Record<string, unknown>;
  type: 'info' | 'edit';
  message?: string;
  diff?: DiffContent;
  // ... existing fields
}
```

**Generation in CoreToolScheduler:**
```typescript
import { randomUUID } from 'node:crypto';

// In CoreToolScheduler._schedule() when creating confirmation:
const correlationId = randomUUID();
const confirmationDetails: ToolCallConfirmationDetails = {
  correlationId,
  toolName: tool.name,
  args: toolCall.args,
  // ... rest of details
};

// Store pending promise keyed by correlationId
this.pendingConfirmations.set(correlationId, {
  resolve: (confirmed: boolean) => { /* ... */ },
  reject: (error: Error) => { /* ... */ },
});
```

### IDE Confirmation Pathway

The IDE confirmation pathway (when using the extension/IDE integration) must also publish to the message bus:

```typescript
// In IDE confirmation handler
async function handleIdeConfirmation(
  toolCall: ToolCallConfirmationDetails,
  config: Config,
): Promise<boolean> {
  // Keep existing ideConfirmation promise pattern
  const confirmed = await ideConfirmationPromise(toolCall);

  // But also publish to message bus for observability
  if (config.getEnableMessageBusIntegration()) {
    const messageBus = config.getMessageBus();
    messageBus.publish({
      type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      correlationId: toolCall.correlationId,
      confirmed,
    });
  }

  return confirmed;
}
```

### Backward Compatibility

All message bus code paths are guarded by the feature flag:

```typescript
// Pattern used throughout:
if (config.getEnableMessageBusIntegration()) {
  // New message bus flow
  const messageBus = config.getMessageBus();
  // ... use message bus
} else {
  // Existing direct callback flow
  // ... use legacy pattern
}
```

**Key Points:**
- When `enableMessageBusIntegration` is false (default), all existing code paths work unchanged
- No breaking changes to existing UI components
- Gradual migration path - components can be updated one at a time
- Both paths must produce equivalent behavior for testing

---

## 7. New Section - Trust System Integration

### Interaction Between Folder Trust and Tool Policy

```
┌─────────────────────────┐
│ Workspace Trust Check   │
│ isWorkspaceTrusted()    │
└────────┬────────────────┘
         │
    ┌────┴────┐
    │ false?  │ → Block MCP discovery entirely
    └────┬────┘
         │ true
         ▼
┌─────────────────────────┐
│ Policy Engine Check     │
│ PolicyDecision          │
└────────┬────────────────┘
         │
    ┌────┴────────┬────────┐
    │ ALLOW       │ DENY   │ ASK_USER
    ▼             ▼        ▼
  Execute      Reject   Show dialog
```

### Migration Path for Existing Trust Settings

1. **No breaking changes** - existing `trustedFolders.json` continues to work
2. **MCP server trust** - `mcpServers.*.trust: true` maps to policy rule priority 2.2
3. **New policies layer** - TOML policies layer on top, don't replace trust system

### Priority Bands

```
Tier 3 (Admin): 3.xxx    - Enterprise admin policies
Tier 2 (User):  2.xxx    - User settings and TOML policies
  2.95 - "Always Allow" UI selections
  2.9  - MCP servers excluded
  2.4  - --exclude-tools CLI flag
  2.3  - --allowed-tools CLI flag
  2.2  - MCP servers with trust=true
  2.1  - MCP servers in allowed list
Tier 1 (Default): 1.xxx  - Built-in default policies
  1.999 - YOLO mode allow-all
  1.05  - Read-only tools
  1.015 - AUTO_EDIT mode overrides
  1.01  - Write tools ASK_USER
```

---

## 7.5. Approval Mode Migration Strategy

This section details how existing ApprovalMode and --allowed-tools patterns map to the new policy engine.

### Legacy Mode Mapping

The existing `ApprovalMode` enum values map to policy rules as follows:

| ApprovalMode | Policy Rule | Priority | Description |
|--------------|-------------|----------|-------------|
| `YOLO` | Allow all tools | 1.999 | Wildcard allow-all rule |
| `AUTO_EDIT` | Allow write tools | 1.015 | Allow edit, write-file, shell |
| `DEFAULT` | Standard stack | N/A | Normal policy evaluation applies |

**ApprovalMode.YOLO → Priority 1.999 allow-all:**
```typescript
{
  toolName: undefined,  // wildcard - matches all tools
  decision: PolicyDecision.ALLOW,
  priority: 1.999,
}
```

**ApprovalMode.AUTO_EDIT → Priority 1.015 write tools allow:**
```typescript
// Rules for each write tool
[
  { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1.015 },
  { toolName: 'smart_edit', decision: PolicyDecision.ALLOW, priority: 1.015 },
  { toolName: 'write_file', decision: PolicyDecision.ALLOW, priority: 1.015 },
  { toolName: 'shell', decision: PolicyDecision.ALLOW, priority: 1.015 },
]
```

### --allowed-tools Migration

Each tool specified via the `--allowed-tools` CLI flag becomes a priority 2.3 ALLOW rule:

```typescript
// For each tool in config.getAllowedTools():
{
  toolName: "toolName",
  decision: PolicyDecision.ALLOW,
  priority: 2.3,
}
```

**Example:**
```bash
llxprt --allowed-tools edit,shell,glob
```

Becomes:
```typescript
[
  { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 2.3 },
  { toolName: 'shell', decision: PolicyDecision.ALLOW, priority: 2.3 },
  { toolName: 'glob', decision: PolicyDecision.ALLOW, priority: 2.3 },
]
```

### Rollout Phases

**Phase 1: Parallel Operation (Initial Release)**
- Both systems run simultaneously
- Feature flag `enableMessageBusIntegration` controls which path is active
- When flag is ON: message bus handles confirmations
- When flag is OFF: legacy ApprovalMode checks apply
- Full backward compatibility maintained

**Phase 2: Deprecation (After 2 Stable Releases)**
- Deprecation warnings on direct `config.getApprovalMode()` calls in tools
- Tools should use `getMessageBusDecision()` instead
- Document migration path for any external tools

**Phase 3: Removal (After 4 Stable Releases)**
- Remove legacy code paths
- ApprovalMode enum kept for CLI parsing compatibility
- All tool approval flows through policy engine

### Config Bridge Code

The bridge code in `packages/core/src/policy/config.ts` converts legacy settings to policy rules:

```typescript
import { PolicyDecision, type PolicyRule } from './types.js';
import { ApprovalMode } from '../config/config.js';
import type { Config } from '../config/config.js';

/**
 * Converts legacy ApprovalMode and --allowed-tools to policy rules.
 * Called during PolicyEngine initialization.
 */
export function migrateLegacyApprovalMode(config: Config): PolicyRule[] {
  const rules: PolicyRule[] = [];

  // Map ApprovalMode
  const approvalMode = config.getApprovalMode();
  if (approvalMode === ApprovalMode.YOLO) {
    rules.push({
      toolName: undefined, // wildcard - matches all tools
      decision: PolicyDecision.ALLOW,
      priority: 1.999,
    });
  } else if (approvalMode === ApprovalMode.AUTO_EDIT) {
    // Allow write tools at priority 1.015
    const writeTools = ['edit', 'smart_edit', 'write_file', 'shell', 'memory'];
    for (const tool of writeTools) {
      rules.push({
        toolName: tool,
        decision: PolicyDecision.ALLOW,
        priority: 1.015,
      });
    }
  }
  // ApprovalMode.DEFAULT doesn't add any rules - standard policy stack applies

  // Map --allowed-tools
  const allowedTools = config.getAllowedTools();
  for (const tool of allowedTools) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ALLOW,
      priority: 2.3,
    });
  }

  // Map --exclude-tools (if we have this flag)
  const excludedTools = config.getExcludedTools?.() ?? [];
  for (const tool of excludedTools) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.DENY,
      priority: 2.4,
    });
  }

  return rules;
}

/**
 * Creates the full PolicyEngineConfig by merging:
 * 1. Default TOML policy files
 * 2. Legacy ApprovalMode migration
 * 3. User-defined TOML policies
 * 4. Runtime rules (Always Allow selections)
 */
export async function createPolicyEngineConfig(
  config: Config,
): Promise<PolicyEngineConfig> {
  const rules: PolicyRule[] = [];

  // Load default policies from TOML
  const defaultRules = await loadDefaultPolicies();
  rules.push(...defaultRules);

  // Migrate legacy settings
  const legacyRules = migrateLegacyApprovalMode(config);
  rules.push(...legacyRules);

  // Load user-defined policies (if any)
  const userPolicyPath = config.getUserPolicyPath();
  if (userPolicyPath) {
    const userRules = await loadPolicyFromToml(userPolicyPath);
    rules.push(...userRules);
  }

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
    nonInteractive: config.getNonInteractive(),
  };
}
```

### Test Coverage for Migration

Required tests for the migration bridge:

```typescript
describe('migrateLegacyApprovalMode', () => {
  it('converts YOLO to wildcard allow-all at priority 1.999', () => {
    const config = createMockConfig({ approvalMode: ApprovalMode.YOLO });
    const rules = migrateLegacyApprovalMode(config);

    expect(rules).toContainEqual({
      toolName: undefined,
      decision: PolicyDecision.ALLOW,
      priority: 1.999,
    });
  });

  it('converts AUTO_EDIT to write tool rules at priority 1.015', () => {
    const config = createMockConfig({ approvalMode: ApprovalMode.AUTO_EDIT });
    const rules = migrateLegacyApprovalMode(config);

    expect(rules).toContainEqual({
      toolName: 'edit',
      decision: PolicyDecision.ALLOW,
      priority: 1.015,
    });
  });

  it('converts --allowed-tools to rules at priority 2.3', () => {
    const config = createMockConfig({
      allowedTools: ['edit', 'shell'],
    });
    const rules = migrateLegacyApprovalMode(config);

    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      toolName: 'edit',
      decision: PolicyDecision.ALLOW,
      priority: 2.3,
    });
  });

  it('--allowed-tools overrides AUTO_EDIT (priority 2.3 > 1.015)', async () => {
    const config = createMockConfig({
      approvalMode: ApprovalMode.AUTO_EDIT,
      allowedTools: ['glob'], // read-only tool, not in AUTO_EDIT set
    });

    const engineConfig = await createPolicyEngineConfig(config);
    const engine = new PolicyEngine(engineConfig);

    // glob should be allowed due to --allowed-tools
    expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
  });
});
```

---

## 8. New Section - Risk Mitigation

### Feature Flag Approach

**Enable incrementally via settings:**
```json
{
  "tools": {
    "enableMessageBusIntegration": false  // Default off until stable
  }
}
```

**Code guards:**
```typescript
if (this.config.getEnableMessageBusIntegration()) {
  const messageBus = this.config.getMessageBus();
  // ... use message bus
} else {
  // ... existing behavior
}
```

### Rollback Plan

1. **Phase A rollback** - Remove new modules from exports, keep files for future
2. **Phase C rollback** - Guard all tool changes behind feature flag
3. **Phase D rollback** - UI components can be hidden via feature flag

### Breaking Change Considerations

| Area | Risk | Mitigation |
|------|------|------------|
| Tool constructor signatures | HIGH | Use optional messageBus param with default undefined |
| Config API | LOW | Add new getters, don't modify existing |
| Message bus events | LOW | New event types, won't conflict |
| Policy file format | MEDIUM | Use separate policies/ directory, won't conflict with settings |

### Test Coverage Requirements

1. **Policy engine** - 100% coverage of rule matching logic
2. **Message bus** - All message types, timeout handling, abort signals
3. **Tool integration** - Each tool's `getMessageBusDecision()` path
4. **TOML loading** - All rule transformations, error handling
5. **Integration tests** - End-to-end flows with real tools

---

## 9. Revised Implementation Plan

### Phase A - Core Infrastructure (1.5 days)

**Day 1 Morning:**
1. Add `@iarna/toml` and `zod` to core package.json
2. Create `packages/core/src/policy/` directory structure
3. Implement `types.ts` and `stable-stringify.ts`
4. Implement `policy-engine.ts` with full test coverage

**Day 1 Afternoon:**
5. Create `packages/core/src/confirmation-bus/` directory
6. Implement `types.ts` and `message-bus.ts`
7. Write message bus tests
8. Update core package exports

**Day 2 Morning:**
9. Extend Config class with PolicyEngine and MessageBus
10. Add `getEnableMessageBusIntegration()` feature flag
11. Write config integration tests

### Phase B - CLI Policy Configuration (1 day)

**Day 2 Afternoon:**
1. Implement `toml-loader.ts` with rule transformations
2. Create default policy TOML files in `policies/`
3. Write loader tests

**Day 3 Morning:**
4. Implement `config.ts` for async policy creation
5. Wire into CLI config loading (make `createPolicyEngineConfig` async)
6. Add `createPolicyUpdater()` for UPDATE_POLICY messages
7. Update gemini.tsx bootstrap

### Phase C - Tool & Scheduler Integration (2 days)

**Day 3 Afternoon:**
1. Update `BaseToolInvocation` with `getMessageBusDecision()` and `getConfirmationDetails()`
2. Update `DeclarativeTool` to pass messageBus to invocations

**Day 4:**
3. Update write tools (edit, smart-edit, shell, write-file, memoryTool)
4. Update network tools (web-fetch, web-search)
5. Update read-only tools (6 tools)

**Day 5 Morning:**
6. Update ToolRegistry with `setMessageBus()`
7. Update MCP tools with serverName validation
8. Update DiscoveredTool with prefix
9. Wire CoreToolScheduler to message bus

### Phase D - Testing & Documentation (0.5 days)

**Day 5 Afternoon:**
1. Run full test suite, fix failures
2. Add integration tests for policy flows
3. Document policy configuration in docs/
4. Final review and PR preparation

---

## 9.5. /policies Command Integration

This section details the implementation of the `/policies` slash command for inspecting active policy rules.

### Command Implementation

**File: `packages/cli/src/ui/commands/policiesCommand.ts`**

```typescript
import type { Command } from './types.js';
import type { Config } from '@anthropic/core';
import { PolicyDecision } from '@anthropic/core';

export const policiesCommand: Command = {
  name: 'policies',
  description: 'Display active policy rules and their priorities',
  execute: async (config: Config): Promise<string> => {
    const policyEngine = config.getPolicyEngine();
    const rules = policyEngine.getRules();

    if (rules.length === 0) {
      return 'No policy rules configured.';
    }

    // Sort by priority (highest first)
    const sortedRules = [...rules].sort((a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0)
    );

    const lines: string[] = ['Active Policy Rules:', ''];

    for (const rule of sortedRules) {
      const toolName = rule.toolName ?? '*';
      const decision = rule.decision;
      const priority = rule.priority ?? 0;
      const argsPattern = rule.argsPattern
        ? ` (args: ${rule.argsPattern.source})`
        : '';

      const decisionColor = decision === PolicyDecision.ALLOW
        ? 'green'
        : decision === PolicyDecision.DENY
          ? 'red'
          : 'yellow';

      lines.push(
        `  ${priority.toFixed(3).padStart(7)} │ ${toolName.padEnd(25)} │ ${decision}${argsPattern}`
      );
    }

    lines.push('');
    lines.push(`Default decision: ${policyEngine.getDefaultDecision()}`);
    lines.push(`Non-interactive mode: ${config.getNonInteractive()}`);

    return lines.join('\n');
  },
};
```

### AppContainer Registration

Register the command in AppContainer's command map:

```typescript
// In packages/cli/src/ui/AppContainer.tsx
import { policiesCommand } from './commands/policiesCommand.js';

// In command registration:
const commands: Map<string, Command> = new Map([
  ['help', helpCommand],
  ['clear', clearCommand],
  ['policies', policiesCommand],  // NEW
  // ... other commands
]);

// Handler:
const handleSlashCommand = async (input: string): Promise<void> => {
  const [commandName, ...args] = input.slice(1).split(' ');
  const command = commands.get(commandName);

  if (command) {
    const result = await command.execute(config, args);
    addMessage({ type: 'system', content: result });
  } else {
    addMessage({ type: 'error', content: `Unknown command: ${commandName}` });
  }
};
```

**Availability:**
- Available in both interactive (REPL) and non-interactive modes
- Non-interactive: `llxprt --command "/policies"`

### Async Policy Loading

The `loadCliConfig()` function must become async to load TOML policies:

**Before:**
```typescript
// packages/cli/src/config/cliConfig.ts
export function loadCliConfig(options: CliOptions): CliConfig {
  // ...
  const policyEngineConfig = createPolicyEngineConfig(baseConfig);
  // ...
}
```

**After:**
```typescript
// packages/cli/src/config/cliConfig.ts
export async function loadCliConfig(options: CliOptions): Promise<CliConfig> {
  // ...
  const policyEngineConfig = await createPolicyEngineConfig(baseConfig);
  // ...
}
```

**Callsite updates required:**
- `packages/cli/src/gemini.tsx` - main entry point
- `packages/cli/src/index.ts` - CLI bootstrap
- Any test files that call `loadCliConfig()`

### Error Handling for Malformed TOML

The policy loader must handle malformed TOML gracefully:

```typescript
// In packages/core/src/policy/toml-loader.ts
export async function loadPolicyFromToml(path: string): Promise<PolicyRule[]> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    const parsed = toml.parse(content);

    // Validate with Zod schema
    const validated = PolicyFileSchema.parse(parsed);

    return transformToRules(validated);
  } catch (error) {
    if (error instanceof toml.TomlError) {
      throw new PolicyLoadError(
        `Invalid TOML syntax in ${path}: ${error.message}`,
        { cause: error }
      );
    }
    if (error instanceof z.ZodError) {
      throw new PolicyLoadError(
        `Invalid policy schema in ${path}: ${error.errors.map(e => e.message).join(', ')}`,
        { cause: error }
      );
    }
    throw error;
  }
}

export class PolicyLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PolicyLoadError';
  }
}
```

### Settings Validation

Add the new settings key to the schema:

```typescript
// In packages/cli/src/config/settings-schema.ts
export const settingsSchema = z.object({
  // ... existing settings
  tools: z.object({
    enableMessageBusIntegration: z.boolean().default(false),
    // ... other tool settings
  }).optional(),
});
```

**Settings file example:**
```json
{
  "tools": {
    "enableMessageBusIntegration": true
  }
}
```

### Output Format Example

```
> /policies

Active Policy Rules:

  2.950 │ *                         │ allow    (Always Allow - runtime)
  2.400 │ shell                     │ deny     (--exclude-tools)
  2.300 │ edit                      │ allow    (--allowed-tools)
  2.300 │ shell                     │ allow    (--allowed-tools)
  2.200 │ my-server__*              │ allow    (MCP trust=true)
  1.999 │ *                         │ allow    (YOLO mode)
  1.050 │ glob                      │ allow    (read-only default)
  1.050 │ grep                      │ allow    (read-only default)
  1.010 │ edit                      │ ask_user (write default)

Default decision: ask_user
Non-interactive mode: false
```

### Test Coverage

```typescript
describe('policiesCommand', () => {
  it('displays rules sorted by priority', async () => {
    const config = createMockConfig({
      policyEngineConfig: {
        rules: [
          { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1.01 },
          { toolName: 'glob', decision: PolicyDecision.ALLOW, priority: 1.05 },
        ],
      },
    });

    const result = await policiesCommand.execute(config);

    expect(result).toContain('1.050');
    expect(result).toContain('1.010');
    // Higher priority (1.05) should appear before lower (1.01)
    expect(result.indexOf('glob')).toBeLessThan(result.indexOf('edit'));
  });

  it('handles empty rules gracefully', async () => {
    const config = createMockConfig({
      policyEngineConfig: { rules: [] },
    });

    const result = await policiesCommand.execute(config);

    expect(result).toBe('No policy rules configured.');
  });
});
```

---

## 10. Deliverables Summary

### Core Deliverables

1. **New modules**: confirmation-bus, policy (with TOML policies)
2. **Updated tools**: All 16 tools with message bus integration
3. **Config integration**: PolicyEngine and MessageBus in Config
4. **CLI wiring**: Policy loader, updater, debug logging
5. **Feature flag**: Disabled by default for safe rollout
6. **Tests**: ~2500 lines of new test coverage
7. **Documentation**: Policy configuration guide

### Additional Deliverables (from Codex Review)

8. **UI consumption layer**: AppContainer message bus subscriptions for tool confirmations
9. **Correlation ID pattern**: Links UI responses back to pending tool calls via `randomUUID()`
10. **Legacy ApprovalMode migration bridge**: Converts YOLO/AUTO_EDIT/--allowed-tools to policy rules
11. **/policies command**: New slash command for inspecting active policy rules with AppContainer registration
12. **Async policy loading**: `loadCliConfig()` becomes async to support TOML loading
13. **Settings validation**: New `tools.enableMessageBusIntegration` key in settings schema

### Updated Timeline

| Phase | Description | Original | Revised | Delta |
|-------|-------------|----------|---------|-------|
| A | Core Infrastructure | 1.5 days | 1.5 days | 0 |
| B | CLI Policy Configuration | 1.0 days | 1.0 days | 0 |
| C | Tool & Scheduler Integration | 2.0 days | 2.0 days | 0 |
| C.6 | UI Integration | - | 0.5 days | +0.5 |
| C.7 | Legacy Migration | - | 0.5 days | +0.5 |
| D | Testing & Documentation | 0.5 days | 1.0 days | +0.5 |

**Original estimate: 4.5-5 engineering days**
**Revised estimate: 6-6.5 engineering days**

### Rationale for Timeline Increase

1. **UI Integration (+0.5 days)**: The AppContainer subscription pattern, correlation ID implementation, and integration tests for UI↔bus↔scheduler flow require careful implementation to maintain backward compatibility.

2. **Legacy Migration (+0.5 days)**: The `migrateLegacyApprovalMode()` bridge and comprehensive migration tests need thorough coverage to ensure existing CLI flags continue working correctly.

3. **Testing Expansion (+0.5 days)**: Additional integration tests for:
   - UI confirmation flow end-to-end
   - Legacy mode priority precedence
   - /policies command output format
   - Async config loading error handling

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| UI state management complexity | HIGH | Feature flag allows immediate rollback |
| Correlation ID race conditions | MEDIUM | Use Map with cleanup timeouts |
| Async config breaks existing tests | HIGH | Update all test fixtures systematically |
| Legacy migration edge cases | MEDIUM | Comprehensive test coverage |

### Definition of Done

- [ ] All existing tests pass (no regressions)
- [ ] New tests achieve >90% coverage of new code
- [ ] Feature flag defaults to OFF
- [ ] /policies command works in interactive and non-interactive modes
- [ ] Legacy ApprovalMode/--allowed-tools produce equivalent behavior
- [ ] Documentation updated with policy configuration examples
- [ ] No lint errors or TypeScript warnings
