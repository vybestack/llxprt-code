# Message Bus & Policy Engine Integration Plan

## 1. Upstream Commit Details

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

## 10. Deliverables Summary

1. **New modules**: confirmation-bus, policy (with TOML policies)
2. **Updated tools**: All 16 tools with message bus integration
3. **Config integration**: PolicyEngine and MessageBus in Config
4. **CLI wiring**: Policy loader, updater, debug logging
5. **Feature flag**: Disabled by default for safe rollout
6. **Tests**: ~2000 lines of new test coverage
7. **Documentation**: Policy configuration guide

**Total estimate: 4.5-5 engineering days**
