# Remote Agent (A2A Protocol) Support - Design Specification

**Version:** 2.0  
**Date:** March 2, 2026  
**Author:** LLxprt Design Team  
**Status:** Draft

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Architecture (Baseline)](#2-current-architecture-baseline)
3. [Upstream Architecture (Reference)](#3-upstream-architecture-reference)
4. [Gap Analysis](#4-gap-analysis)
5. [Target Architecture (Proposed)](#5-target-architecture-proposed)
6. [Component Diagram](#6-component-diagram)
7. [Key Design Decisions](#7-key-design-decisions)
8. [Non-Goals (Out of Scope)](#8-non-goals-out-of-scope)
9. [Implementation Phases](#9-implementation-phases)

---

## 1. Problem Statement

LLxprt Code currently supports **local agents only** — agents that execute within the same runtime using LLM API calls. Users cannot:

- **Delegate to remote AI agents** hosted elsewhere (e.g., specialized agents with unique capabilities, domain-specific tools, or proprietary data)
- **Compose multi-agent workflows** where LLxprt orchestrates between local and remote agents
- **Leverage the A2A (Agent-to-Agent) protocol** for standardized cross-agent communication

This limits LLxprt's extensibility and prevents integration with the growing ecosystem of A2A-compatible agents (e.g., Google's Agent Engine, third-party A2A servers).

**Why it matters:**
- **Specialized capabilities:** Remote agents can provide domain expertise (code analysis, security auditing, data processing) without local implementation
- **Resource efficiency:** Offload compute-intensive tasks to remote agents with specialized infrastructure
- **Ecosystem integration:** Tap into the A2A protocol ecosystem for standardized agent interoperability
- **Multi-provider vision:** Aligns with LLxprt's core philosophy of provider-agnostic AI integration

---

## 2. Current Architecture (Baseline)

This section describes **LLxprt's existing agent system as-is** (no remote agent support).

### 2.1 Agent System Overview

```
AgentRegistry (registry.ts)
    ↓ stores
AgentDefinition (types.ts) — single type, no variants
    ↓ used by
AgentExecutor (executor.ts) — local LLM loop only
    ↓ wrapped by
SubagentInvocation (invocation.ts) — tool invocation wrapper
```

### 2.2 Core Types (Current)

**`AgentDefinition<TOutput>`** (`types.ts`):
```typescript
interface AgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown> {
  name: string;
  displayName?: string;
  description: string;
  promptConfig: PromptConfig;      // MANDATORY
  modelConfig: ModelConfig;        // MANDATORY
  runConfig: RunConfig;            // MANDATORY
  toolConfig?: ToolConfig;
  outputConfig?: OutputConfig<TOutput>;
  inputConfig: InputConfig;        // MANDATORY
  processOutput?: (output: z.infer<TOutput>) => string;
}
```

**Key limitations:**
- All fields assume **local execution** (system prompt, model settings, tool registry)
- No discrimination between local and remote agents
- No `kind` field or type variants

### 2.3 AgentRegistry (Current)

**File:** `packages/core/src/agents/registry.ts`

**Responsibilities:**
- Discover and register agent definitions
- Validate agent metadata
- Provide agent lookup by name

**Current implementation:**
```typescript
class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();
  
  async initialize(): Promise<void> {
    this.loadBuiltInAgents();  // Empty - no built-in agents
  }
  
  protected registerAgent<TOutput>(definition: AgentDefinition<TOutput>): void {
    // Validation (name, description required)
    // Store in map
  }
  
  getDefinition(name: string): AgentDefinition | undefined;
  getAllDefinitions(): AgentDefinition[];
}
```

**Limitations:**
- `registerAgent` is **synchronous** (no async operations allowed)
- No agent card fetching
- No client management
- No error handling for network failures

### 2.4 AgentExecutor (Current)

**File:** `packages/core/src/agents/executor.ts`

**Responsibilities:**
- Execute agent's conversational loop via local LLM
- Manage tool calls and responses
- Handle termination conditions (goal, timeout, max turns, error)

**Execution flow (current):**
```typescript
class AgentExecutor<TOutput> {
  async run(inputs: AgentInputs, signal: AbortSignal): Promise<OutputObject> {
    const chat = await this.createChatObject(inputs);  // GeminiChat
    const tools = this.prepareToolsList();
    
    while (true) {
      // Check termination
      const { functionCalls } = await this.callModel(chat, message, tools);
      
      if (functionCalls includes 'complete_task') {
        // Extract and return result
        break;
      }
      
      // Execute tools locally via executeToolCall()
      const { nextMessage, taskCompleted } = 
        await this.processFunctionCalls(functionCalls, signal);
      
      if (taskCompleted) break;
    }
  }
}
```

**Critical limitation:**
- **Hard-coded to GeminiChat** for local LLM execution
- No alternative execution path for remote agents
- `processFunctionCalls` uses `executeToolCall` (local tool executor)

### 2.5 SubagentInvocation (Current)

**File:** `packages/core/src/agents/invocation.ts`

**Responsibilities:**
- Wrap agent execution as a tool invocation (implements `BaseToolInvocation`)
- Stream agent "thoughts" to user

**Current implementation:**
```typescript
class SubagentInvocation<TOutput> extends BaseToolInvocation<AgentInputs, ToolResult> {
  async execute(signal: AbortSignal, updateOutput?: (output: string) => void): Promise<ToolResult> {
    const executor = await AgentExecutor.create(definition, config, onActivity);
    const output = await executor.run(this.params, signal);
    return { llmContent: [...], returnDisplay: '...' };
  }
}
```

**Limitation:** Hard-coded to use `AgentExecutor` (local execution only).

### 2.6 Confirmation System (Current)

**File:** `packages/core/src/confirmation-bus/message-bus.ts`

**MessageBus pattern:**
```typescript
messageBus.requestConfirmation(toolCall, args) → 
  PolicyEngine.evaluate() →
    ALLOW → return true
    DENY → publish TOOL_POLICY_REJECTION, return false
    ASK_USER → publish TOOL_CONFIRMATION_REQUEST, await response
```

**Integration:** Tool invocations can call `requestConfirmation` before execution.

**Note:** `SubagentInvocation` does **not** currently call `requestConfirmation` directly. Confirmation is mediated by the tool execution framework when invocations are built from tools.

### 2.7 Configuration (Current)

- **Config class:** Central configuration object
- **Agent loading:** Only programmatic registration (no TOML, no directory scanning)
- **No remote agent auth providers**

---

## 3. Upstream Architecture (Reference)

This section describes **how gemini-cli implemented remote agents** (for reference only).

### 3.1 Overview

Upstream gemini-cli added remote agent support via **4 commits totaling ~2,000 LoC**:

1. **A2A Client Manager** (02a36afc) — +516 LoC
2. **Remote agents and multi-agent TOML** (848e8485) — +335 LoC
3. **Remote agents in registry** (3ebe4e6a) — +168 LoC
4. **Remote agent support** (96b9be3e) — +980 LoC

### 3.2 A2A Protocol Primer

The **Agent-to-Agent (A2A) protocol** defines:

#### Agent Card
JSON descriptor of agent capabilities:
```json
{
  "name": "Code Analyzer",
  "url": "https://agent.example.com/card",
  "skills": [
    { "name": "analyze_code", "description": "..." }
  ],
  "capabilities": ["blocking", "streaming"]
}
```

#### Task Lifecycle
```
1. Client sends Message (user query) → Agent
2. Agent returns Task (status: submitted|working|completed|failed|input-required|canceled)
3. Client polls Task until status is terminal
4. Extract result from Task.status.message or Task.artifacts
```

**Task States (A2A Protocol):**
- `submitted` — Task accepted, not yet processing
- `working` — Task in progress
- `input-required` — Task paused, waiting for user input
- `completed` — Task finished successfully
- `failed` — Task encountered error
- `canceled` — Task terminated by user/timeout

#### Message Format
```typescript
interface Message {
  kind: 'message';
  role: 'user' | 'agent';
  messageId: string;
  parts: Part[];           // TextPart | DataPart | FilePart
  contextId?: string;      // Conversation continuity
  taskId?: string;         // Link to in-progress task
}
```

#### Task Format
```typescript
interface Task {
  kind: 'task';
  id: string;
  contextId: string;
  status: {
    state: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required';
    message?: Message;
  };
  artifacts?: Artifact[];
}
```

### 3.3 Upstream A2AClientManager

**Purpose:** Singleton manager for A2A client lifecycle.

**Key patterns:**
- Singleton ensures one client per agent name
- Lazy initialization (agents loaded on first use)
- Authentication abstraction via `AuthenticationHandler`
- Error wrapping with agent name context

**Limitation:** Hard-coded to **Google ADC** for authentication.

### 3.4 Upstream Type Evolution

**TOML schema:**
```toml
# Local agent
kind = "local"
name = "code-helper"
[prompts]
system_prompt = "..."

# Remote agent
kind = "remote"
name = "remote-analyzer"
agent_card_url = "https://..."
```

**Runtime types:**
```typescript
type AgentDefinition = LocalAgentDefinition | RemoteAgentDefinition;
```

### 3.5 Upstream Registry Integration

**Changes:**
1. Made `registerAgent` **async**
2. Added `registerRemoteAgent` method for card fetching
3. Parallel loading via `Promise.allSettled`

### 3.6 Upstream RemoteAgentInvocation

**Key features:**
- Static session state map for contextId/taskId persistence
- Lazy client loading in `execute()`
- Info-type confirmation
- Text extraction from Message/Task responses

**Session state pattern:**
```typescript
private static sessionState = new Map<string, { contextId?: string; taskId?: string }>();
```

---

## 4. Gap Analysis

### 4.1 What Exists in LLxprt

| Component | Status | Notes |
|-----------|--------|-------|
| AgentRegistry | [OK] Exists | Synchronous only |
| AgentDefinition | [OK] Exists | Single type, no variants |
| AgentExecutor | [OK] Exists | Local LLM loop only |
| SubagentInvocation | [OK] Exists | Hard-coded to AgentExecutor |
| MessageBus | [OK] Exists | Confirmation infrastructure |
| Multi-provider support | [OK] Exists | ProviderManager pattern |

### 4.2 What's Missing

| Component | Priority | Estimated LoC |
|-----------|----------|---------------|
| Discriminated AgentDefinition types | MUST | ~50 |
| A2A Client Manager | MUST | ~400 |
| RemoteAgentInvocation class | MUST | ~250 |
| A2A utilities (text/ID extraction) | MUST | ~100 |
| Async AgentRegistry | MUST | ~50 |
| Auth provider abstraction | MUST | ~300 |
| TOML loader | SHOULD (post-MVP) | ~300 |

### 4.3 Incompatibilities with Upstream

1. **Type system:** Upstream broke `AgentDefinition` into discriminated union; LLxprt needs same
2. **Registry:** Upstream made `registerAgent` async; all callers need updates
3. **Authentication:** Upstream hard-coded Google ADC; LLxprt needs multi-provider
4. **Execution dispatch:** No clear insertion point for remote execution without modifying tool invocation builder

---

## 5. Target Architecture (Proposed)

This section describes **the proposed changes** to add remote agent support.

**Notation:**
- **[NEW]** — File/component to be added (does not exist in current codebase)
- **[MODIFIED]** — Existing file/component that will be modified
- **[BASELINE]** — Existing file/component referenced but not modified

All file paths and method signatures in this section are **proposals for future implementation** unless explicitly marked as [BASELINE].

### 5.1 Type System Changes (Target)

**[MODIFIED]** `packages/core/src/agents/types.ts`

```typescript
/**
 * Base interface for all agent definitions.
 */
interface BaseAgentDefinition {
  name: string;
  displayName?: string;
  description?: string;  // OPTIONAL - can be populated from agent card for remote agents
  inputConfig: InputConfig;  // All agents accept inputs
}

/**
 * Local agent definition (existing behavior).
 * Requires all local execution configuration.
 */
export interface LocalAgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown> 
  extends BaseAgentDefinition {
  kind: 'local';
  promptConfig: PromptConfig;  // MANDATORY for local
  modelConfig: ModelConfig;    // MANDATORY for local
  runConfig: RunConfig;        // MANDATORY for local
  toolConfig?: ToolConfig;
  outputConfig?: OutputConfig<TOutput>;
  processOutput?: (output: z.infer<TOutput>) => string;
}

/**
 * Remote agent definition (new).
 * Only requires agent card URL; remote agent manages prompt/model/tools.
 */
export interface RemoteAgentDefinition extends BaseAgentDefinition {
  kind: 'remote';
  agentCardUrl: string;        // MANDATORY for remote
  // NO promptConfig, modelConfig, runConfig, toolConfig
}

/**
 * Discriminated union of agent types.
 */
export type AgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown> =
  | LocalAgentDefinition<TOutput>
  | RemoteAgentDefinition;
```

**Breaking changes:**
- This IS a breaking change. Direct property access on `AgentDefinition` throughout executor code means type narrowing is required.
- Existing code that accesses `promptConfig`, `modelConfig`, or `runConfig` on an `AgentDefinition` must first narrow to `LocalAgentDefinition` via a type guard: `if (definition.kind === 'local') { ... }`
- Components must handle both variants explicitly

**Impacted signatures:**
- `AgentRegistry.registerAgent(definition)` — NOW accepts both kinds (union type), must dispatch based on `kind`
- `AgentExecutor.create(definition, ...)` — signature changes to ONLY accept `LocalAgentDefinition` (not the union)
- `SubagentInvocation` constructor — signature changes to ONLY accept `LocalAgentDefinition` (not the union)
- Tool invocation dispatch point (currently in `SubagentInvocation` creation in `invocation.ts`) — must dispatch based on `kind` to route to either `SubagentInvocation` (local) or `RemoteAgentInvocation` (remote)

### 5.2 A2A Client Manager (Target)

**[NEW]** `packages/core/src/agents/a2a-client-manager.ts`

```typescript
export interface RemoteAgentAuthProvider {
  getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler | undefined>;
}

export class A2AClientManager {
  private readonly clients = new Map<string, Client>();
  private readonly agentCards = new Map<string, AgentCard>();
  private readonly authProvider?: RemoteAgentAuthProvider;
  
  constructor(authProvider?: RemoteAgentAuthProvider);
  
  async loadAgent(name: string, agentCardUrl: string): Promise<AgentCard>;
  async sendMessage(agentName: string, message: string, options?: { contextId?: string; taskId?: string; signal?: AbortSignal }): Promise<Message | Task>;
  async getTask(agentName: string, taskId: string): Promise<Task>;
  async cancelTask(agentName: string, taskId: string): Promise<Task>;
  
  getAgentCard(name: string): AgentCard | undefined;
  getClient(name: string): Client | undefined;
}
```

**Lifetime & injection:**
- **NOT a singleton** — Auth provider is injected per-instance via constructor
- **Session-scoped** — `AgentRegistry` creates one `A2AClientManager` per initialization and holds it for the session lifetime. `RemoteAgentInvocation` receives the manager via the registry factory method, NOT by instantiating a new one
- This ensures agent card caching and SDK client reuse work correctly across invocations within the same session
- `AgentRegistry` receives auth provider from `Config` and passes to the manager at construction time

**Key responsibilities:**
- Manage A2A SDK clients (one per agent name)
- Fetch agent cards via SDK
- Send messages with authentication
- Cache agent cards
- Error wrapping with agent context

**Abort semantics:**
- `sendMessage` accepts optional `AbortSignal` in options
- Abort is wired to in-flight HTTP request via A2A SDK's native abort support
- If abort fires before taskId is available, the HTTP request is cancelled
- Cancellation handling is in `finally` block to ensure cleanup even on abort
- Race condition: if abort fires during response parsing, return partial response or error

**Error handling:**
- All methods wrap errors: `"A2AClient ${method} error [${agentName}]: ${error}"`
- Network failures propagate as `Error` (caller handles gracefully)

### 5.3 AgentRegistry Changes (Target)

**[MODIFIED]** `packages/core/src/agents/registry.ts`

```typescript
class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();
  
  async initialize(): Promise<void> {
    this.loadBuiltInAgents();
    // Future: Load from TOML (post-MVP)
  }
  
  // NOW ASYNC
  protected async registerAgent<TOutput>(definition: AgentDefinition<TOutput>): Promise<void> {
    // Validation
    if (!definition.name || !definition.description) {
      this.logger.warn('Skipping invalid agent');
      return;
    }
    
    if (definition.kind === 'remote') {
      await this.registerRemoteAgent(definition);
    } else {
      this.registerLocalAgent(definition);
    }
  }
  
  private async registerRemoteAgent(definition: RemoteAgentDefinition): Promise<void> {
    // Uses session-scoped clientManager (created once in initialize(), NOT per registration)
    try {
      const agentCard = await this.clientManager.loadAgent(
        definition.name,
        definition.agentCardUrl
      );
      
      // Populate description from skills if not provided
      if (!definition.description && agentCard.skills?.length) {
        definition.description = agentCard.skills
          .map(s => `${s.name}: ${s.description}`)
          .join('\n');
      }
      
      this.agents.set(definition.name, definition);
    } catch (error) {
      this.logger.error(`Failed to load remote agent '${definition.name}': ${error}`);
      // Don't throw - allow other agents to load
    }
  }
  
  private registerLocalAgent<TOutput>(definition: LocalAgentDefinition<TOutput>): void {
    this.agents.set(definition.name, definition);
  }
  
  // Unchanged
  getDefinition(name: string): AgentDefinition | undefined;
  getAllDefinitions(): AgentDefinition[];
}
```

**Breaking change:** `registerAgent` is now **async**.

**Impacted call sites (ALL must be updated to await):**
1. `AgentRegistry.loadBuiltInAgents()` — Currently calls `registerAgent` synchronously; must become async and await each registration
2. Any test files that call `registerAgent` directly — Must add `await`
3. Future TOML loader (post-MVP) — Will call `registerAgent` asynchronously
4. Any user-defined agent registration code (if exposed via API)

**Migration pattern:**
```typescript
// BEFORE (synchronous)
private loadBuiltInAgents(): void {
  this.registerAgent(agentDef1);
  this.registerAgent(agentDef2);
}

// AFTER (async, concurrent via Promise.allSettled)
private async loadBuiltInAgents(): Promise<void> {
  const results = await Promise.allSettled(
    definitions.map(def => this.registerAgent(def))
  );
  // Log any rejected results (don't throw)
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      this.logger.error(`Failed to register agent '${definitions[i].name}': ${r.reason}`);
    }
  });
}
```

### 5.4 RemoteAgentInvocation (Target)

**[NEW]** `packages/core/src/agents/remote-invocation.ts`

```typescript
export class RemoteAgentInvocation extends BaseToolInvocation<AgentInputs, ToolResult> {
  // Session state scoped to runtime session (not static)
  private readonly sessionState: Map<string, { contextId?: string; taskId?: string }>;
  
  constructor(
    params: AgentInputs,
    definition: RemoteAgentDefinition,
    sessionState: Map<string, { contextId?: string; taskId?: string }>,
    messageBus?: MessageBus,
    displayName?: string
  ) {
    super(params, messageBus);
    // Validate params.query is non-empty string
  }
  
  async execute(signal: AbortSignal, updateOutput?: (output: string) => void): Promise<ToolResult> {
    // Get auth provider from Config and create manager instance
    const authProvider = this.config.getRemoteAgentAuthProvider();
    const clientManager = new A2AClientManager(authProvider);
    
    // Lazy load agent if needed
    if (!clientManager.getClient(this.definition.name)) {
      await clientManager.loadAgent(this.definition.name, this.definition.agentCardUrl);
    }
    
    // Retrieve session state
    // Session key includes runtime session ID to avoid collisions across parallel contexts
    const sessionKey = `${this.definition.name}#${this.config.getSessionId()}`;
    const state = this.sessionState.get(sessionKey) || {};
    
    try {
      // Send message with abort signal
      const result = await clientManager.sendMessage(
        this.definition.name,
        this.params.query,
        { 
          contextId: state.contextId, 
          taskId: state.taskId,
          signal 
        }
      );
      
      // Extract and persist IDs
      const { contextId, taskId } = extractIdsFromResponse(result);
      this.sessionState.set(sessionKey, { contextId, taskId });
      
      // Handle input-required state
      if (result.kind === 'task' && result.status.state === 'input-required') {
        // For MVP: return error to LLM indicating agent needs input
        const errorMsg = `Remote agent paused and requires user input: ${extractTaskText(result)}`;
        return {
          llmContent: [{ text: errorMsg }],
          returnDisplay: errorMsg,
          error: {
            message: 'Agent requires user input',
            type: ToolErrorType.EXECUTION_FAILED
          }
        };
      }
      
      // Extract text
      const text = result.kind === 'message' 
        ? extractMessageText(result)
        : extractTaskText(result);
      
      return {
        llmContent: [{ text }],
        returnDisplay: text
      };
    } catch (error) {
      // Check if error is due to abort
      if (signal.aborted) {
        // Best-effort cancellation if we have taskId
        const taskId = state.taskId;
        if (taskId) {
          try {
            await clientManager.cancelTask(this.definition.name, taskId);
          } catch {
            // Ignore cancellation errors
          }
        }
      }
      
      return {
        llmContent: [{ text: `Remote agent '${this.definition.name}' failed: ${error}` }],
        returnDisplay: `Remote agent failed: ${error}`,
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: ToolErrorType.EXECUTION_FAILED
        }
      };
    } finally {
      // Cleanup: clear taskId if aborted before completion
      if (signal.aborted) {
        const currentState = this.sessionState.get(sessionKey);
        if (currentState) {
          this.sessionState.set(sessionKey, {
            contextId: currentState.contextId,
            taskId: undefined
          });
        }
      }
    }
  }
  
  protected async getConfirmationDetails(): Promise<ToolCallConfirmationDetails | false> {
    // SECURITY: Remote agent calls send local context/code outbound
    // Type should be configurable via policy or at least 'warning' level
    // For MVP, using 'info' but noting data exfiltration risk
    return {
      type: 'info',  // TODO: Consider 'warning' or policy-based confirmation level
      title: `Remote Agent: ${this.definition.displayName || this.definition.name}`,
      prompt: `Invoking remote agent at ${this.definition.agentCardUrl}

WARNING:  This will send your query and context to an external service.`,
      previewContent: `Query: ${this.params.query}`
    };
  }
}
```

**Session state management:**
- **No longer static global map** (avoids session leaks, race conditions)
- Scoped to runtime session via injected `Map` instance
- Cleanup handled by session lifecycle

**Task lifecycle:**
- On response, extract `contextId` and `taskId`
- If task is terminal (`completed`/`failed`/`canceled`), clear `taskId`
- Next invocation starts fresh task with same `contextId`

**Task completion strategy (MVP decision):**
For MVP, use **SDK blocking mode** — pass `blocking: true` to `sendMessage`, letting the A2A SDK handle waiting internally:
- If response is `Message`, return immediately (synchronous response)
- If response is `Task` with terminal state (`completed`/`failed`/`canceled`), return result
- The SDK handles internal wait/retry logic; LLxprt does NOT implement its own polling loop for MVP
- Enforce overall timeout (default: 5 minutes, configurable) via `AbortSignal.timeout()` wrapping the SDK call
- Post-MVP: Add explicit polling with backoff for `working` state, `input-required` handling, async task submission

### 5.5 A2A Utilities (Target)

**[NEW]** `packages/core/src/agents/a2a-utils.ts`

```typescript
export function extractMessageText(message: Message): string {
  // Extract text from parts (TextPart, DataPart, FilePart)
}

export function extractTaskText(task: Task): string {
  // Format: "Task [id]: [state]\n[status message]\n[artifacts]"
}

export function extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string } {
  if (result.kind === 'message') {
    return {
      contextId: result.contextId,
      taskId: result.taskId
    };
  }
  
  // Task response
  const isTerminal = ['completed', 'failed', 'canceled'].includes(result.status.state);
  return {
    contextId: result.contextId,
    taskId: isTerminal ? undefined : result.id  // Clear taskId if terminal
  };
}
```

**Behavior for terminal states:**
- `completed`, `failed`, `canceled` → clear `taskId` (allows new task in same context)
- `working`, `submitted`, `input-required` → preserve `taskId` (continue task)

### 5.6 Execution Dispatch Point (Target)

**Problem:** No existing dispatch mechanism for local vs remote execution.

**Solution:** Add a factory method on `AgentRegistry` as the **single canonical dispatch point**.

**Canonical dispatch point:** `AgentRegistry.createInvocation()` — all agent invocation creation routes through this factory. Callers that currently instantiate `SubagentInvocation` directly must switch to this factory method. This ensures type-safe dispatch via discriminated union narrowing in one location.

```typescript
class AgentRegistry {
  createInvocation(
    agentName: string,
    params: AgentInputs,
    messageBus?: MessageBus,
    sessionState?: Map<string, { contextId?: string; taskId?: string }>,
  ): BaseToolInvocation<AgentInputs, ToolResult> {
    const definition = this.getDefinition(agentName);
    
    if (!definition) {
      throw new Error(`Agent '${agentName}' not found in registry`);
    }
    
    if (definition.kind === 'remote') {
      return new RemoteAgentInvocation(
        params,
        definition,
        sessionState ?? new Map(),  // Default to empty map if not provided
        messageBus,
      );
    }
    
    // Local agent
    return new SubagentInvocation(
      params,
      definition,
      this.config,
      messageBus,
    );
  }
}
```

This factory centralizes the dispatch logic and ensures type safety via narrowing.

### 5.7 Authentication Providers (Target)

**[NEW]** `packages/core/src/agents/auth-providers.ts`

**[MODIFIED]** `packages/core/src/config/config.ts` — Add auth provider getter/setter

**Interface:**
```typescript
export interface RemoteAgentAuthProvider {
  getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler | undefined>;
}
```

**Config integration (to be added):**
```typescript
class Config {
  private remoteAgentAuthProvider?: RemoteAgentAuthProvider;
  
  setRemoteAgentAuthProvider(provider: RemoteAgentAuthProvider): void {
    this.remoteAgentAuthProvider = provider;
  }
  
  getRemoteAgentAuthProvider(): RemoteAgentAuthProvider | undefined {
    return this.remoteAgentAuthProvider;
  }
}
```

**Implementations:**

#### NoAuthProvider (MVP)
```typescript
export class NoAuthProvider implements RemoteAgentAuthProvider {
  async getAuthHandler(): Promise<undefined> {
    return undefined;  // No authentication
  }
}
```

#### GoogleADCAuthProvider (Post-MVP)
```typescript
export class GoogleADCAuthProvider implements RemoteAgentAuthProvider {
  async getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler> {
    const { ADCHandler } = await import('@a2a-js/sdk/client');
    return new ADCHandler({ audience: agentCardUrl });
  }
}
```

#### BearerTokenAuthProvider (Post-MVP)
```typescript
export class BearerTokenAuthProvider implements RemoteAgentAuthProvider {
  constructor(private readonly token: string) {}
  
  async getAuthHandler(): Promise<AuthenticationHandler> {
    return {
      getAuthHeader: async () => `Bearer ${this.token}`
    };
  }
}
```

#### MultiProviderAuthProvider (Post-MVP)
```typescript
export class MultiProviderAuthProvider implements RemoteAgentAuthProvider {
  private readonly rules: Array<{ pattern: RegExp; provider: RemoteAgentAuthProvider }> = [];
  private readonly defaultProvider?: RemoteAgentAuthProvider;
  
  addRule(pattern: RegExp, provider: RemoteAgentAuthProvider): this;
  
  async getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler | undefined> {
    // Match URL against patterns (first match wins)
    for (const rule of this.rules) {
      if (rule.pattern.test(agentCardUrl)) {
        return rule.provider.getAuthHandler(agentCardUrl);
      }
    }
    
    // Fall back to default
    return this.defaultProvider?.getAuthHandler(agentCardUrl);
  }
}
```

**Resolution order:**
1. Per-agent config (future: agent-specific auth override)
2. URL pattern matcher (MultiProviderAuthProvider rules)
3. Default provider (fallback)

**Failure semantics:**
- If `getAuthHandler()` throws, propagate error and skip agent registration
- If authentication fails during `sendMessage`, return `ToolResult` with error

### 5.8 Error Handling Strategy (Target)

**Principles:**
1. **Graceful degradation:** Errors return `ToolResult` (don't throw)
2. **LLM visibility:** Error text included in `llmContent` for LLM recovery
3. **User visibility:** Error shown in UI via `returnDisplay`
4. **Consistent structure:** Align to existing `ToolResult` error pattern

**Error types:**

| Error Scenario | Handling |
|----------------|----------|
| Agent card fetch fails | Log error, skip registration, continue initialization |
| Auth fails during load | Log error, skip registration |
| Network timeout during sendMessage | Return `ToolResult` with `error: { type: EXECUTION_FAILED }` |
| Invalid response (malformed JSON) | Return `ToolResult` with protocol error message |
| Task state unknown | Return `ToolResult` with error text |

**Error structure:**
```typescript
{
  llmContent: [{ text: "Remote agent 'X' failed: <error>" }],
  returnDisplay: "Remote agent failed: <error>",
  error: {
    message: "<error>",
    type: ToolErrorType.EXECUTION_FAILED
  }
}
```

**Never prescribe exact error strings** — allow implementations flexibility.

### 5.9 Observability (Target)

**Debug logging:**
- All A2A operations logged at debug level
- Logger namespace: `llxprt:agents:a2a`
- **MUST redact credentials** — Never log auth tokens, API keys, or bearer tokens in full
- Log preview format: `Bearer ***<last 4 chars>` or `<token length> chars (redacted)`

**Log entries:**
```
[llxprt:agents:a2a] Loading remote agent 'X' from https://...
[llxprt:agents:a2a] Loaded agent 'X': <agent name from card>
[llxprt:agents:a2a] Sending message to 'X': <query preview (first 100 chars)>
[llxprt:agents:a2a] Received response from 'X': message|task
[llxprt:agents:a2a] Error: <operation> failed for 'X': <error message (credentials redacted)>
```

**Telemetry (optional):**
- Emit `CoreEvent.AGENT_INVOCATION_START` / `_END` for remote agents
- Include metadata: `{ agentName, kind: 'remote', duration, success }`
- **MUST NOT include sensitive data** — No tokens, PII, or full query content

**Activity events:**
- Remote invocations emit same `SubagentActivityEvent` types as local:
  - `TOOL_CALL_START` — (not applicable for remote)
  - `TOOL_CALL_END` — (not applicable for remote)
  - `THOUGHT_CHUNK` — if remote agent streams thinking (future)
  - `ERROR` — on failure

### 5.10 Security Requirements (Target)

1. **HTTPS only (MUST):** Reject `http://` agent card URLs
   ```typescript
   if (!agentCardUrl.startsWith('https://')) {
     throw new Error('Agent card URLs must use HTTPS');
   }
   ```

2. **SSRF protection (MUST):** By default, reject localhost, private IPs, link-local addresses. Configurable via policy for enterprise/private deployments.
   ```typescript
   const url = new URL(agentCardUrl);
   const policy = config.getRemoteAgentPolicy();
   // Default: block private networks unless policy.allowPrivateNetworks is true
   if (!policy?.allowPrivateNetworks) {
     if (url.hostname === 'localhost' || 
         url.hostname === '127.0.0.1' ||
         url.hostname.startsWith('192.168.') ||
         url.hostname.startsWith('10.') ||
         url.hostname.startsWith('172.16.') ||
         url.hostname.startsWith('169.254.')) {
       throw new Error('Agent card URL targets restricted network (localhost/private IP). Set allowPrivateNetworks in policy to override.');
     }
   }
   ```

3. **Redirect constraints (MUST):** A2A SDK client must not follow redirects to non-HTTPS or restricted networks
   - Configure SDK with `maxRedirects: 5` (or similar)
   - Validate final URL after redirects

4. **Domain allowlist/denylist (SHOULD):** Config can specify allowed/denied domains
   ```typescript
   remoteAgentPolicy: {
     allowedDomains: ['*.googleapis.com', 'agent.example.com'],  // Optional
     deniedDomains: ['internal.corp.com'],  // Optional
   }
   ```

5. **Timeout requirements (MUST):**
   - Agent card fetch: 30 seconds
   - Message send: 60 seconds (or configurable per agent)
   - Task completion (blocking SDK call): 5 minutes total (or configurable via AbortSignal.timeout())

6. **Retry/backoff strategy (SHOULD):**
   - Transient network errors: retry up to 3 times with exponential backoff (1s, 2s, 4s)
   - Non-retryable errors (4xx): fail immediately
   - Circuit breaker pattern for repeated failures to same agent

7. **Max request/response size (MUST):** Truncate responses exceeding limit (e.g., 10MB)
   ```typescript
   const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;  // 10MB
   if (responseText.length > MAX_RESPONSE_SIZE) {
     responseText = responseText.slice(0, MAX_RESPONSE_SIZE) + '\n[truncated]';
     this.logger.warn(`Response from '${agentName}' exceeded size limit`);
   }
   ```

8. **Credential redaction (MUST):** Prevent token leakage in logs/errors/telemetry
   ```typescript
   // Never log full tokens
   this.logger.debug(`Auth: Bearer ***${token.slice(-4)}`);
   // Never include tokens in error messages
   throw new Error(`Auth failed for agent '${agentName}'`);  // NO token details
   ```

9. **No token persistence (MUST):** Auth tokens never stored in session state, only in memory

10. **A2A SDK version pinning (SHOULD):** Lock to specific SDK version in package.json to prevent supply chain attacks
    ```json
    "@a2a-js/sdk": "1.2.3"  // Not "^1.2.3"
    ```

---

## 6. Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        LLxprt Core                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐                                           │
│  │  AgentRegistry   │                                           │
│  │                  │                                           │
│  │  + registerAgent()  ◄─── NOW ASYNC                           │
│  │  + getDefinition()                                           │
│  └────────┬─────────┘                                           │
│           │ stores                                              │
│           ▼                                                      │
│  ┌──────────────────────────────────────────────────┐           │
│  │         AgentDefinition (Union Type)              │           │
│  │  = LocalAgentDefinition | RemoteAgentDefinition   │           │
│  └───────┬────────────────────────┬─────────────────┘           │
│          │                        │                             │
│          ▼                        ▼                             │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │ LocalAgent       │    │ RemoteAgent      │                  │
│  │ Definition       │    │ Definition       │                  │
│  │                  │    │                  │                  │
│  │ kind: 'local'    │    │ kind: 'remote'   │                  │
│  │ promptConfig     │    │ agentCardUrl     │                  │
│  │ modelConfig      │    │ (no model/prompt)│                  │
│  │ runConfig        │    │                  │                  │
│  └─────┬────────────┘    └────────┬─────────┘                  │
│        │                          │                             │
│        ▼                          ▼                             │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │ SubagentInvocation│   │ RemoteAgent      │                  │
│  │                  │    │ Invocation       │                  │
│  │ ◄──AgentExecutor │    │ ◄──A2AClient     │                  │
│  │    (local loop)  │    │    Manager       │                  │
│  └─────┬────────────┘    └────────┬─────────┘                  │
│        │                          │                             │
│        └──────────┬───────────────┘                             │
│                   ▼                                             │
│          ┌────────────────────┐                                 │
│          │  ToolResult        │                                 │
│          │  (unified return)  │                                 │
│          └────────────────────┘                                 │
│                                                                  │
│  ┌──────────────────────────────────────────────┐               │
│  │       A2AClientManager (Singleton)           │               │
│  │                                              │               │
│  │  - clients: Map<name, Client>                │               │
│  │  - agentCards: Map<name, AgentCard>          │               │
│  │                                              │               │
│  │  + loadAgent(name, url)                      │               │
│  │  + sendMessage(name, msg, options)           │               │
│  │  + getTask(name, taskId)                     │               │
│  │  + cancelTask(name, taskId)                  │               │
│  └──────────────────┬───────────────────────────┘               │
│                     │ uses                                      │
│                     ▼                                           │
│  ┌────────────────────────────────────────┐                     │
│  │   RemoteAgentAuthProvider              │                     │
│  │   (interface)                          │                     │
│  │                                        │                     │
│  │   + getAuthHandler(url) → AuthHandler  │                     │
│  └────────────────────────────────────────┘                     │
│           ▲                                                     │
│           │ implemented by                                      │
│           │                                                     │
│     ┌─────┴───────┬──────────────┬─────────────┐               │
│     │             │              │             │               │
│  ┌──▼───┐   ┌────▼─────┐   ┌────▼────┐   ┌────▼────┐          │
│  │NoAuth│   │GoogleADC │   │Bearer   │   │Multi    │          │
│  │Prov. │   │Provider  │   │Token    │   │Provider │          │
│  └──────┘   └──────────┘   └─────────┘   └─────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ calls
                            ▼
                  ┌───────────────────┐
                  │  @a2a-js/sdk      │
                  │                   │
                  │  - Client         │
                  │  - ClientFactory  │
                  │  - AgentCard      │
                  │  - Message/Task   │
                  └───────────────────┘
```

---

## 7. Key Design Decisions

### 7.1 Discriminated Union vs Inheritance

**Decision:** Use discriminated union (`kind: 'local' | 'remote'`).

**Rationale:**
- TypeScript narrows types automatically via `kind` check
- Clear compile-time distinction
- Easy to extend (add `kind: 'hybrid'` later)
- Matches upstream pattern

**Alternative rejected:** Class inheritance (`LocalAgent extends BaseAgent`)
- Adds runtime overhead
- Less idiomatic for TypeScript

### 7.2 Async Registry Registration

**Decision:** Make `registerAgent` async.

**Rationale:**
- Remote agents require async operations (HTTP fetch)
- Can't use sync wrappers (violates Node.js best practices)

**Breaking change impact:**
- All callers must `await registerAgent()`
- Registry `initialize()` already async (no change there)

**Impacted callers:**
- `AgentRegistry.loadBuiltInAgents()` (internal)
- Any future TOML loader (will be async anyway)

### 7.3 Auth Provider Abstraction

**Decision:** Use pluggable `RemoteAgentAuthProvider` interface.

**Rationale:**
- Multi-provider from day one (not Google-only)
- Testable (mock auth in tests)
- Extensible (users can add custom auth)

**Rejected:** Hard-code Google ADC like upstream
- Violates LLxprt's multi-provider principle
- Locks ecosystem to Google agents only

### 7.4 Session State Scoping

**Decision:** Inject session-scoped `Map` into `RemoteAgentInvocation` (not static global).

**Rationale:**
- **Avoids session leaks:** Static map persists across sessions/tests
- **Prevents races:** Concurrent invocations don't share mutable state
- **Bounded memory:** Session lifecycle controls cleanup

**Implementation:**
```typescript
class RuntimeSession {
  private readonly remoteAgentSessionState = new Map<string, { contextId?: string; taskId?: string }>();
  
  createRemoteAgentInvocation(definition, params) {
    return new RemoteAgentInvocation(
      params,
      definition,
      this.remoteAgentSessionState,  // Injected
      messageBus
    );
  }
}
```

### 7.5 Error Return vs Throw

**Decision:** Return `ToolResult` with error (don't throw).

**Rationale:**
- Consistent with other tool error handling
- LLM can see error and adjust strategy
- User sees error in UI without crash

**Exception:** Agent card fetch during registration logs error but doesn't throw (allows other agents to load).

### 7.6 TOML Loading: Out of Scope for MVP

**Decision:** Programmatic registration only for MVP.

**Rationale:**
- Complex validation (~300 LoC)
- Lower priority than core A2A functionality
- Can add post-MVP without breaking changes

**MVP approach:**
```typescript
agentRegistry.registerAgent({
  kind: 'remote',
  name: 'analyzer',
  description: 'Code analysis agent',
  agentCardUrl: 'https://agent.example.com/card',
  inputConfig: { inputs: { query: { type: 'string', required: true, description: 'Task' } } }
});
```

### 7.7 Confirmation Type: Info (Not Dangerous)

**Decision:** Remote agent invocations show "info" confirmation.

**Rationale:**
- Remote agents don't modify local system state
- User should be informed data is sent externally
- Not "dangerous" like file write/delete tools

**Customization:** Policy engine can auto-approve trusted agents.

### 7.8 Task Polling: Blocking Only (MVP)

**Decision:** Use `blocking: true` in A2A message send (no polling loop).

**Rationale:**
- A2A SDK handles polling internally
- Simpler implementation
- Sufficient for most use cases

**Post-MVP:** Add explicit polling with backoff for `working` state, `input-required` handling.

---

## 8. Non-Goals (Out of Scope)

These features are **explicitly excluded from MVP** to reduce scope and risk:

### 8.1 TOML Configuration
- **Rationale:** Complex validation, directory scanning, file watching
- **MVP approach:** Programmatic registration only
- **Post-MVP:** Implement full TOML loader with Zod schemas

### 8.2 Multi-Agent Orchestration
- **Rationale:** Requires orchestration primitives, parallel execution, result aggregation
- **MVP approach:** LLM calls agents sequentially via tool calls
- **Post-MVP:** Add workflow primitives (parallel execution, fan-out/fan-in)

### 8.3 Advanced Task Lifecycle
- **Rationale:** Handling `input-required`, manual polling, long-running tasks
- **MVP approach:** Blocking calls only
- **Post-MVP:** Add polling strategy, backoff, max attempts, `input-required` handling

### 8.4 Streaming Responses
- **Rationale:** A2A protocol supports streaming, but adds complexity
- **MVP approach:** Blocking responses only
- **Post-MVP:** Stream task progress to `updateOutput` callback

### 8.5 Agent-Specific Auth Overrides
- **Rationale:** Per-agent auth config requires schema changes
- **MVP approach:** Single global auth provider
- **Post-MVP:** Add `auth` field to `RemoteAgentDefinition`

### 8.6 Dialect Adapters
- **Rationale:** Upstream added for Vertex AI quirks; unproven need
- **MVP approach:** Standard A2A protocol only
- **Post-MVP:** Add adapter if compatibility issues arise

### 8.7 Agent Introspection/Discovery UI
- **Rationale:** UI for browsing available agents, skills
- **MVP approach:** List via `agentRegistry.getAllDefinitions()`
- **Post-MVP:** Add CLI command `llxprt agents list --remote`

---

## 9. Implementation Phases

### Phase 1: Core Types & Utilities (Week 1)
- [ ] Add discriminated union types to `types.ts`
- [ ] Create `a2a-utils.ts` (text/ID extraction)
- [ ] Add `RemoteAgentAuthProvider` interface
- [ ] Implement `NoAuthProvider`
- [ ] Add `@a2a-js/sdk` dependency

### Phase 2: Client Manager (Week 1)
- [ ] Implement `A2AClientManager` (config-scoped, not singleton)
- [ ] Add error wrapping
- [ ] Write unit tests with mock SDK

### Phase 3: Registry Integration (Week 2)
- [ ] Make `registerAgent` async
- [ ] Add `registerRemoteAgent` method
- [ ] Update all callers to `await`
- [ ] Add error handling for card fetch failures

### Phase 4: Remote Invocation (Week 2)
- [ ] Implement `RemoteAgentInvocation` class
- [ ] Add session state injection
- [ ] Implement `getConfirmationDetails`
- [ ] Add abort signal handling

### Phase 5: Dispatch & Tools (Week 3)
- [ ] Create `DelegateToAgentTool` (or equivalent)
- [ ] Add dispatch logic based on `kind`
- [ ] Register tool in global registry
- [ ] Add LLM-visible documentation

### Phase 6: Testing & Polish (Week 3)
- [ ] Unit tests (all components)
- [ ] Integration tests (with mock A2A agent)
- [ ] E2E test (with real test agent if available)
- [ ] Documentation updates
- [ ] Security review

### Post-MVP (Future)
- [ ] Implement `GoogleADCAuthProvider`
- [ ] Implement `BearerTokenAuthProvider`
- [ ] Implement `MultiProviderAuthProvider`
- [ ] Add TOML loader
- [ ] Add advanced task lifecycle (polling, `input-required`)
- [ ] Add streaming support
- [ ] Add telemetry events

---

## Conclusion

This design provides a **complete blueprint** for adding A2A remote agent support to LLxprt Code:

[OK] **Clear state separation** — Current vs Target architecture explicitly delineated  
[OK] **Type-safe** — Discriminated union with compile-time guarantees  
[OK] **Multi-provider** — Auth abstraction (not Google-only)  
[OK] **Safe execution** — Session-scoped state, graceful error handling  
[OK] **Minimal breaking changes** — Async registry only  
[OK] **Well-scoped MVP** — TOML, advanced features deferred  
[OK] **Testable** — All components accept injected dependencies  
[OK] **Observable** — Debug logging, telemetry hooks  
[OK] **Secure** — HTTPS enforcement, no token leakage  

**Next step:** Implement detailed requirements specification (see `requirements.md`).

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-02 | Initial draft |
| 2.0 | 2026-03-02 | Round-2 review remediation: Made description optional on BaseAgentDefinition, removed singleton from A2AClientManager (inject auth per-config), clarified breaking changes explicitly, added abort semantics, added session state keying details, updated confirmation security classification, added SSRF/timeout/retry/credential redaction requirements, added input-required state handling, specified polling strategy (synchronous MVP), clarified dispatch point (registry factory vs tool), added [NEW]/[MODIFIED]/[BASELINE] notation, updated all "proposed" file references to distinguish from existing baseline, added Config method signatures for auth provider |
| 3.0 | 2026-03-02 | Round-3 review remediation: Resolved polling/blocking contradiction (MVP uses SDK blocking mode, not manual polling), made AgentRegistry.createInvocation() the single canonical dispatch point, clarified A2AClientManager is session-scoped (not per-invocation), normalized registration to Promise.allSettled for concurrency, made SSRF protection configurable via allowPrivateNetworks policy for enterprise deployments, tightened terminal-state ToolResult semantics for failed/canceled tasks |
