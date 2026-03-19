# Remote Agent (A2A Protocol) Support - Requirements Specification

**Version:** 2.0  
**Date:** March 2, 2026  
**Status:** Draft  
**Format:** EARS (Easy Approach to Requirements Syntax)

---

## Document Purpose

This document specifies **functional requirements** for adding Remote Agent (A2A protocol) support to LLxprt Code. All requirements use EARS format for clarity and testability.

**EARS Patterns:**
- **Ubiquitous:** "The [system] shall [action]."
- **Event-driven:** "When [trigger], the [system] shall [action]."
- **State-driven:** "While [state], the [system] shall [action]."
- **Unwanted behavior:** "If [condition], then the [system] shall [action]."
- **Optional:** "Where [feature is enabled], the [system] shall [action]."

**Priority Levels:**
- **MUST:** Critical for MVP functionality
- **SHOULD:** Important but can be deferred to post-MVP
- **MAY:** Nice-to-have, low priority

---

## Table of Contents

1. [Agent Discovery](#1-agent-discovery)
2. [Agent Registration](#2-agent-registration)
3. [Agent Execution](#3-agent-execution)
4. [Authentication](#4-authentication)
5. [Configuration](#5-configuration)
6. [Confirmation/Approval](#6-confirmationapproval)
7. [Error Handling](#7-error-handling)
8. [Observability](#8-observability)
9. [Security](#9-security)

---

## 1. Agent Discovery

### A2A-DISC-001
**Statement:** The system shall support discovering remote agents via agent card URLs.

**Priority:** MUST

**Rationale:** Agent cards are the standard A2A protocol mechanism for describing agent capabilities.

**Traceability:** 
- Upstream: 02a36afc (A2AClientManager), 96b9be3e (Remote agent support)
- LLxprt: `packages/core/src/agents/a2a-client-manager.ts` (proposed)

**Acceptance Criteria:**
- Given a valid HTTPS agent card URL
- When the system fetches the agent card via A2A SDK
- Then it shall retrieve an AgentCard object with name, skills, and capabilities
- And the AgentCard shall be cached for the session

---

### A2A-DISC-002
**Statement:** When an agent card fetch fails, the system shall log an error and skip registration without blocking initialization.

**Priority:** MUST

**Rationale:** Single agent failures should not prevent other agents from loading.

**Traceability:** 
- Upstream: 3ebe4e6a (Remote agents in registry)
- LLxprt: `packages/core/src/agents/registry.ts` (registerRemoteAgent method)

**Acceptance Criteria:**
- Given an invalid or unreachable agent card URL
- When the system attempts to fetch the card during registration
- Then it shall log the error with agent name and URL
- And initialization shall continue for other agents
- And the failed agent shall not appear in registry.getAllDefinitions()

---

### A2A-DISC-003
**Statement:** The system shall cache fetched agent cards to avoid redundant network requests within a session.

**Priority:** MUST

**Rationale:** Agent cards are immutable during a session and should be cached for performance.

**Traceability:** 
- Upstream: 02a36afc (A2AClientManager caching)
- LLxprt: `A2AClientManager.agentCards` map (proposed)

**Acceptance Criteria:**
- Given an agent has been loaded once in a session
- When the system accesses the agent's metadata again
- Then it shall use the cached AgentCard without making a new HTTP request
- And the cache shall be scoped to the A2AClientManager instance lifecycle

---

### A2A-DISC-004
**Statement:** The system shall extract agent descriptions from agent card skills if not explicitly provided in configuration.

**Priority:** SHOULD

**Rationale:** Agent cards contain rich metadata that improves agent discoverability.

**Traceability:** 
- Upstream: 3ebe4e6a (Remote agents in registry)
- LLxprt: `AgentRegistry.registerRemoteAgent()` (proposed)

**Acceptance Criteria:**
- Given a remote agent definition without a description field
- And the agent card contains one or more skills with descriptions
- When the system registers the agent
- Then it shall populate the description by concatenating skill information
- And the concatenation format shall include skill names and descriptions (implementation may vary)

---

## 2. Agent Registration

### A2A-REG-001
**Statement:** The system shall support registering both local and remote agent definitions via a discriminated union type.

**Priority:** MUST

**Rationale:** Local and remote agents have different execution models and must be distinguishable at compile time.

**Traceability:** 
- Upstream: 848e8485 (TOML multi-agent support)
- LLxprt: `packages/core/src/agents/types.ts` (LocalAgentDefinition | RemoteAgentDefinition)

**Acceptance Criteria:**
- Given an AgentDefinition with `kind: 'local'`
- When the system validates the definition
- Then it shall require promptConfig, modelConfig, and runConfig fields
- And TypeScript shall enforce these fields at compile time
- Given an AgentDefinition with `kind: 'remote'`
- When the system validates the definition
- Then it shall require agentCardUrl field only
- And shall not require promptConfig, modelConfig, or runConfig
- And TypeScript shall prevent accessing these fields without type narrowing

---

### A2A-REG-002
**Statement:** The AgentRegistry.registerAgent() method shall be asynchronous to support remote agent card fetching.

**Priority:** MUST

**Rationale:** Remote agents require async operations (HTTP fetches) during registration.

**Traceability:** 
- Upstream: 3ebe4e6a (Async registry)
- LLxprt: `packages/core/src/agents/registry.ts` (modified)

**Acceptance Criteria:**
- Given a call to AgentRegistry.registerAgent(definition)
- When the definition has `kind: 'remote'`
- Then the method shall await agent card fetching from the A2A client manager
- And return a Promise<void> that resolves when registration completes or fails
- And all callers shall await the Promise

---

### A2A-REG-003
**Statement:** The system shall not fail initialization due to individual agent registration failures.

**Priority:** MUST

**Rationale:** Parallel registration improves startup time and resilience to network issues.

**Traceability:** 
- Upstream: 3ebe4e6a (Promise.allSettled usage)
- LLxprt: `AgentRegistry.initialize()` (proposed pattern)

**Acceptance Criteria:**
- Given a list of 5 agent definitions (3 local, 2 remote)
- When the system initializes the registry
- Then it shall register all agents concurrently
- And if 1 remote agent fails, the other 4 shall still register successfully
- And the system shall log errors for failed agents without throwing

---

### A2A-REG-004
**Statement:** The system shall validate that remote agent definitions include a valid name and agentCardUrl before registration.

**Priority:** MUST

**Rationale:** These fields are required for client creation and invocation.

**Traceability:** 
- Upstream: 3ebe4e6a (Validation logic)
- LLxprt: `AgentRegistry.registerRemoteAgent()` (proposed)

**Acceptance Criteria:**
- Given a remote agent definition with missing `name`
- When the system attempts to register it
- Then it shall log a warning and skip registration
- Given a remote agent definition with missing `agentCardUrl`
- When the system attempts to register it
- Then it shall log a warning and skip registration

---

### A2A-REG-005
**Statement:** The system shall allow overriding existing agent definitions during registration.

**Priority:** MUST

**Rationale:** User-defined agents should override built-in agents with the same name.

**Traceability:** 
- LLxprt: `packages/core/src/agents/registry.ts` (existing behavior)

**Acceptance Criteria:**
- Given an agent "analyzer" is already registered
- When a new definition for "analyzer" is registered
- Then the system shall replace the old definition
- And log a debug message indicating the override

---

### A2A-REG-006
**Statement:** The system shall load remote agent definitions from TOML files with `kind = "remote"` and `agent_card_url` fields.

**Priority:** MUST

**Rationale:** Upstream `848e8485c` ships TOML loading in v0.24.5. Without it, users must write code to register remote agents — not feature-parity with gemini-cli and not usable for non-developers.

**Traceability:** 
- Upstream: 848e8485 (TOML loader with remote agent schema + Zod validation)
- LLxprt: `packages/core/src/agents/toml-loader.ts` (extend existing)

**Acceptance Criteria:**
- Given a TOML file with `[[remote_agents]]` entries
- When the system loads the file
- Then it shall parse each remote agent into a RemoteAgentDefinition
- And register all parsed agents asynchronously

---

## 3. Agent Execution

### A2A-EXEC-001
**Statement:** The system shall delegate remote agent invocations to the A2AClientManager.

**Priority:** MUST

**Rationale:** A2AClientManager encapsulates all A2A SDK interactions for consistency and testability.

**Traceability:** 
- Upstream: 96b9be3e (RemoteAgentInvocation)
- LLxprt: `packages/core/src/agents/remote-invocation.ts` (proposed)

**Acceptance Criteria:**
- Given a RemoteAgentInvocation is executed
- When the invocation sends a message to the remote agent
- Then it shall call A2AClientManager.sendMessage()
- And shall not directly import or use the A2A SDK Client

---

### A2A-EXEC-002
**Statement:** When executing a remote agent invocation, the system shall persist contextId and taskId for conversation continuity.

**Priority:** MUST

**Rationale:** Multi-turn conversations require context persistence across tool calls.

**Traceability:** 
- Upstream: 96b9be3e (Session state management)
- LLxprt: `RemoteAgentInvocation.sessionState` (injected Map)

**Acceptance Criteria:**
- Given a first call to a remote agent returns contextId="ctx-1" and taskId="task-1"
- When a second call is made to the same agent in the same session
- Then the system shall include contextId="ctx-1" and taskId="task-1" in the message
- And the remote agent shall continue the same conversation/task
- And the session state shall be scoped to the runtime session (not global static)
- And the session state key shall include both agent name and session ID to prevent collisions across parallel contexts
- Format: "{agentName}#{sessionId}"

---

### A2A-EXEC-003
**Statement:** When a remote agent task reaches a terminal state (completed, failed, canceled), the system shall clear the taskId from session state.

**Priority:** MUST

**Rationale:** New queries should start fresh tasks, not be bound to completed tasks.

**Traceability:** 
- Upstream: 96b9be3e (extractIdsFromResponse logic)
- LLxprt: `a2a-utils.ts` extractIdsFromResponse function (proposed)

**Acceptance Criteria:**
- Given a remote agent returns a Task with status.state="completed"
- When the system persists session state
- Then it shall set taskId to undefined
- And contextId shall remain set for conversation continuity
- Given the next invocation to the same agent in the same session
- When the system sends a message
- Then it shall omit taskId, starting a new task in the same context
- Given a Task with status.state="working" or "submitted" or "input-required"
- When the system persists session state
- Then it shall preserve the taskId for task continuation

---

### A2A-EXEC-004
**Statement:** The system shall extract text from remote agent responses (Message or Task) and return it as a ToolResult.

**Priority:** MUST

**Rationale:** LLM needs textual response to understand agent output.

**Traceability:** 
- Upstream: 96b9be3e (a2aUtils text extraction)
- LLxprt: `a2a-utils.ts` (proposed)

**Acceptance Criteria:**
- Given a remote agent returns a Message with parts=[{kind: 'text', text: 'Hello'}]
- When the system processes the response
- Then ToolResult.llmContent shall be [{text: 'Hello'}]
- Given a remote agent returns a Task with artifacts
- When the system processes the response
- Then ToolResult.llmContent shall include formatted task summary and artifact content
- And the format shall include: task state, status message (if present), and concatenated text from all artifact parts
- Given a remote agent Task reaches `failed` state
- Then ToolResult shall include error with type `ToolErrorType.EXECUTION_FAILED` and the failure message from the task status
- Given a remote agent Task reaches `canceled` state
- Then ToolResult shall include error with type `ToolErrorType.EXECUTION_FAILED` and message indicating cancellation

---

### A2A-EXEC-005
**Statement:** When a remote agent invocation is aborted, the system shall attempt to cancel the remote task.

**Priority:** SHOULD

**Rationale:** Graceful cleanup prevents orphaned tasks on remote agents.

**Traceability:** 
- Upstream: 96b9be3e (Abort signal handling)
- LLxprt: `RemoteAgentInvocation.execute()` abort handling (proposed)

**Acceptance Criteria:**
- Given a remote agent invocation is executing with taskId="task-1"
- When the abort signal is triggered
- Then the system shall call A2AClientManager.cancelTask("agent-name", "task-1")
- And shall ignore errors from the cancel operation (best-effort)
- And shall return a ToolResult indicating abortion

---

### A2A-EXEC-006
**Statement:** The system shall validate that remote agent invocations include a non-empty 'query' parameter.

**Priority:** MUST

**Rationale:** Remote agents require a query/task description to execute.

**Traceability:** 
- Upstream: 96b9be3e (RemoteAgentInvocation constructor validation)
- LLxprt: `RemoteAgentInvocation` constructor (proposed)

**Acceptance Criteria:**
- Given a RemoteAgentInvocation constructor is called with params={} (no query)
- When the invocation is created
- Then it shall throw an error indicating query is required
- Given params={query: ''} (empty string)
- When the invocation is created
- Then it shall throw an error indicating query must be non-empty

---

### A2A-EXEC-007
**Statement:** The system shall lazy-load remote agent clients on first invocation if not already loaded.

**Priority:** MUST

**Rationale:** Avoids loading all agents at startup; loads on-demand for efficiency.

**Traceability:** 
- Upstream: 96b9be3e (RemoteAgentInvocation lazy loading)
- LLxprt: `RemoteAgentInvocation.execute()` (proposed)

**Acceptance Criteria:**
- Given a remote agent "analyzer" is registered but not loaded
- When a RemoteAgentInvocation executes for "analyzer"
- Then the system shall call A2AClientManager.loadAgent("analyzer", url)
- And shall cache the client for subsequent invocations in the same session

---

### A2A-EXEC-008
**Statement:** The system shall support extracting text from DataPart and FilePart in remote agent responses.

**Priority:** SHOULD

**Rationale:** Agents may return structured data or file references.

**Traceability:** 
- Upstream: 96b9be3e (a2aUtils part extraction)
- LLxprt: `a2a-utils.ts` extractMessageText function (proposed)

**Acceptance Criteria:**
- Given a Message with parts=[{kind: 'data', data: {foo: 'bar'}}]
- When the system extracts text
- Then it shall return a representation of the data (e.g., JSON string)
- Given a Message with parts=[{kind: 'file', file: {name: 'report.pdf'}}]
- When the system extracts text
- Then it shall return a reference to the file

---

### A2A-EXEC-009
**Statement:** When a remote agent task enters 'input-required' state, the system shall return an error to the LLM indicating the agent is blocked.

**Priority:** MUST

**Rationale:** LLxprt operates in non-interactive mode and cannot prompt users during remote agent execution. The LLM needs to know the task is blocked.

**Traceability:** 
- LLxprt: `RemoteAgentInvocation.execute()` state handling (proposed)

**Acceptance Criteria:**
- Given a remote agent returns a Task with status.state="input-required"
- When RemoteAgentInvocation processes the response
- Then it shall return a ToolResult with error
- And llmContent shall include text explaining the agent requires user input
- And error.type shall be ToolErrorType.EXECUTION_FAILED
- (Post-MVP) The system may support prompting the user and resuming the task

---

### A2A-EXEC-010
**Statement:** The system shall use SDK blocking mode for task completion in MVP.

**Priority:** MUST

**Rationale:** MVP needs a simple blocking execution model; the A2A SDK handles internal wait logic. Explicit polling with backoff is post-MVP.

**Traceability:** 
- LLxprt: `RemoteAgentInvocation.execute()` blocking call (proposed)

**Acceptance Criteria:**
- When RemoteAgentInvocation sends a message to a remote agent
- Then it shall pass `blocking: true` to the A2A SDK sendMessage call
- And the SDK shall handle internal wait/retry logic
- And LLxprt shall NOT implement its own polling loop for MVP
- And the overall call shall be wrapped with AbortSignal.timeout() defaulting to 5 minutes (configurable)
- When timeout is exceeded
- Then it shall abort the SDK call and return timeout error
- (Post-MVP) The system may add explicit polling with backoff for `working` state, `input-required` handling

---

### A2A-EXEC-011
**Statement:** The agent invocation dispatch point shall support both local and remote agents via type-based routing.

**Priority:** MUST

**Rationale:** LLM should not need to know execution model details; dispatch is transparent based on agent definition type.

**Traceability:** 
- LLxprt: `packages/core/src/agents/invocation.ts` (current SubagentInvocation creation site)
- LLxprt: `AgentRegistry.createInvocation()` factory method (proposed, canonical dispatch point)

**Acceptance Criteria:**
- The system shall have exactly one canonical dispatch point: `AgentRegistry.createInvocation()`
- All callers that currently instantiate `SubagentInvocation` directly shall migrate to this factory
- Given a call to `AgentRegistry.createInvocation()` for agent "local-agent" with kind='local'
- Then it shall return a SubagentInvocation instance
- Given a call to `AgentRegistry.createInvocation()` for agent "remote-agent" with kind='remote'
- Then it shall return a RemoteAgentInvocation instance (passing the session-scoped A2AClientManager)
- And the dispatch shall use TypeScript discriminated union narrowing on `definition.kind` for type safety

---

### A2A-EXEC-012
**Statement:** The A2AClientManager shall wrap fetch with a Vertex AI Agent Engine dialect adapter.

**Priority:** MUST

**Rationale:** Upstream `96b9be3ec` includes `createAdapterFetch()` (~120 LoC) that translates between the A2A SDK's JSON format and Vertex AI Agent Engine's proto-JSON dialect. Without it, agents hosted on Vertex AI Agent Engine (the most common A2A deployment target) return incompatible responses. Upstream marks this `TODO: Remove when a2a-js fixes compatibility`.

**Traceability:** 
- Upstream: 96b9be3e (`createAdapterFetch`, `mapTaskState` in a2a-client-manager.ts)
- LLxprt: `packages/core/src/agents/a2a-client-manager.ts` (proposed)

**Acceptance Criteria:**
- When `A2AClientManager.loadAgent()` sets up a client
- Then it shall wrap the fetch implementation with `createAdapterFetch()`
- And the adapter shall:
  - Normalize `TASK_STATE_WORKING` → `working` (proto-JSON enum casing)
  - Unwrap JSON-RPC 2.0 envelopes to extract params
  - Map `parts` → `content` and strip SDK `kind` fields in requests
  - Restore `kind` on response parts and top-level result (task/message)
- Given a Vertex AI Agent Engine returns `{ "task": { "status": { "state": "TASK_STATE_COMPLETED" } } }`
- Then the adapter shall normalize to `{ "kind": "task", "status": { "state": "completed" } }`

---

## 4. Authentication

### A2A-AUTH-001
**Statement:** The system shall support pluggable authentication providers via a RemoteAgentAuthProvider interface.

**Priority:** MUST

**Rationale:** Different remote agents may require different authentication mechanisms (ADC, bearer token, OAuth, none).

**Traceability:** 
- LLxprt: `packages/core/src/agents/auth-providers.ts` (proposed)

**Acceptance Criteria:**
- Given a RemoteAgentAuthProvider implementation
- When the system loads a remote agent
- Then it shall call authProvider.getAuthHandler(agentCardUrl)
- And use the returned AuthenticationHandler for all HTTP requests to that agent
- And the interface shall be: `getAuthHandler(url: string): Promise<AuthenticationHandler | undefined>`

---

### A2A-AUTH-002
**Statement:** The system shall provide a NoAuthProvider for unauthenticated remote agents.

**Priority:** MUST

**Rationale:** Not all remote agents require authentication (e.g., public demo agents).

**Traceability:** 
- LLxprt: `NoAuthProvider` class (proposed)

**Acceptance Criteria:**
- Given a NoAuthProvider is configured
- When the system loads a remote agent
- Then authProvider.getAuthHandler() shall return undefined
- And the system shall use native fetch without authentication headers

---

### A2A-AUTH-003
**Statement:** The system shall provide a GoogleADCAuthProvider for Google Cloud agents.

**Priority:** MUST

**Rationale:** Upstream ships ADCHandler as the only auth path in 0.24.5 (`96b9be3ec`). Without it, Vertex AI Agent Engine integration doesn't work. LLxprt wraps this in the pluggable `RemoteAgentAuthProvider` interface so it's swappable for other cloud providers (OCI, AWS, Azure).

**Traceability:** 
- Upstream: 96b9be3e (ADCHandler hardcoded in remote-invocation.ts)
- LLxprt: `GoogleADCAuthProvider` class (proposed, MVP)

**Acceptance Criteria:**
- Given a GoogleADCAuthProvider is configured
- When the system loads a remote agent at https://agent.googleapis.com/...
- Then authProvider.getAuthHandler() shall return an ADCHandler
- And HTTP requests shall include Google ADC bearer tokens

---

### A2A-AUTH-004
**Statement:** The system shall provide a BearerTokenAuthProvider for agents requiring static bearer tokens.

**Priority:** SHOULD

**Rationale:** Supports agents with API key authentication.

**Traceability:** 
- LLxprt: `BearerTokenAuthProvider` class (proposed, post-MVP)

**Acceptance Criteria:**
- Given a BearerTokenAuthProvider with token="secret123"
- When the system loads a remote agent
- Then HTTP requests shall include header: "Authorization: Bearer secret123"

---

### A2A-AUTH-005
**Statement:** The system shall provide a MultiProviderAuthProvider that routes to different auth strategies based on URL patterns.

**Priority:** SHOULD

**Rationale:** Enables supporting multiple agent providers with different auth requirements in a single configuration.

**Traceability:** 
- LLxprt: `MultiProviderAuthProvider` class (proposed, post-MVP)

**Acceptance Criteria:**
- Given a MultiProviderAuthProvider with:
  - Pattern /^https:\/\/.*\.googleapis\.com\// → GoogleADCAuthProvider
  - Pattern /^https:\/\/my-agent\.com\// → BearerTokenAuthProvider
- When the system loads "https://agent.googleapis.com/card"
- Then it shall use GoogleADCAuthProvider
- When the system loads "https://my-agent.com/card"
- Then it shall use BearerTokenAuthProvider
- When no pattern matches, it shall use the default provider (if configured)

---

### A2A-AUTH-006
**Statement:** If authentication fails during agent loading, the system shall log the error and skip registration.

**Priority:** MUST

**Rationale:** Authentication failures should not silently succeed or crash the system.

**Traceability:** 
- LLxprt: `AgentRegistry.registerRemoteAgent()` error handling (proposed)

**Acceptance Criteria:**
- Given a remote agent with GoogleADCAuthProvider
- And ADC credentials are not available
- When the system attempts to load the agent
- Then it shall log an error with agent name and auth failure details
- And the agent shall not appear in the registry

---

## 5. Configuration

### A2A-CFG-001
**Statement:** The system shall accept a RemoteAgentAuthProvider via the Config class.

**Priority:** MUST

**Rationale:** Centralized configuration for all remote agent authentication.

**Traceability:** 
- LLxprt: `packages/core/src/config/config.ts` (to be modified - methods do not exist in baseline)

**Acceptance Criteria:**
- Given a Config instance
- When config.setRemoteAgentAuthProvider(provider) is called
- Then the provider shall be stored for retrieval
- And config.getRemoteAgentAuthProvider() shall return the provider
- And RemoteAgentInvocation shall retrieve the provider from Config when creating A2AClientManager instances

---

### A2A-CFG-002
**Statement:** The system shall use NoAuthProvider as default if no RemoteAgentAuthProvider is configured.

**Priority:** MUST

**Rationale:** System should work out-of-box for unauthenticated agents.

**Traceability:** 
- LLxprt: `A2AClientManager` default behavior (proposed)

**Acceptance Criteria:**
- Given Config has no auth provider set
- When a remote agent is loaded
- Then the system shall use NoAuthProvider (no authentication)

---

### A2A-CFG-003
**Statement:** The system shall parse remote agent definitions from TOML with Zod schema validation.

**Priority:** MUST

**Rationale:** Upstream ships TOML parsing with Zod schemas in 0.24.5 (`848e8485c`). Required for feature parity.

**Traceability:** 
- Upstream: 848e8485 (TOML schemas with `remoteAgentSchema` Zod validation)
- LLxprt: `packages/core/src/agents/toml-loader.ts` (extend existing)

**Acceptance Criteria:**
- Given a TOML file with:
  ```toml
  [[remote_agents]]
  name = "analyzer"
  agent_card_url = "https://agent.example.com/card"
  ```
- When the system parses the file
- Then it shall create a RemoteAgentDefinition with kind='remote'
- And register the agent in the registry

---

### A2A-CFG-004
**Statement:** The system shall infer `kind = 'remote'` if `agent_card_url` is present in TOML without explicit kind.

**Priority:** MUST

**Rationale:** Upstream infers kind from presence of `agent_card_url`. Reduces boilerplate and matches upstream behavior.

**Traceability:** 
- Upstream: 848e8485 (kind inference in TOML schema)
- LLxprt: `packages/core/src/agents/toml-loader.ts` (extend existing)

**Acceptance Criteria:**
- Given a TOML entry with agent_card_url but no kind field
- When the system parses the entry
- Then it shall set kind='remote' automatically

---

### A2A-CFG-005
**Statement:** The system shall validate that TOML remote agent entries include a valid agent_card_url (URL format).

**Priority:** MUST

**Rationale:** Prevents invalid configurations from being registered. Upstream validates via Zod.

**Traceability:** 
- Upstream: 848e8485 (Zod URL validation in `remoteAgentSchema`)
- LLxprt: `packages/core/src/agents/toml-loader.ts` (extend existing)

**Acceptance Criteria:**
- Given a TOML entry with agent_card_url="not-a-url"
- When the system validates the entry
- Then it shall reject the entry with a validation error

---

## 6. Confirmation/Approval

### A2A-APPR-001
**Statement:** When a remote agent invocation is about to execute, the system shall request user confirmation if the approval policy requires it.

**Priority:** MUST

**Rationale:** Users should be aware when data is sent to external services.

**Traceability:** 
- LLxprt: `packages/core/src/confirmation-bus/message-bus.ts` (existing), `RemoteAgentInvocation` (proposed)

**Acceptance Criteria:**
- Given the tool execution framework detects a RemoteAgentInvocation
- When the invocation provides confirmation details via getConfirmationDetails()
- Then the tool scheduler shall publish a TOOL_CONFIRMATION_REQUEST
- And wait for user approval before calling execute()

---

### A2A-APPR-002
**Statement:** The system shall provide confirmation details that include the agent name, URL, and query preview.

**Priority:** MUST

**Rationale:** Users need context to make informed approval decisions.

**Traceability:** 
- Upstream: 96b9be3e (getConfirmationDetails)
- LLxprt: `RemoteAgentInvocation.getConfirmationDetails()` (proposed)

**Acceptance Criteria:**
- Given a RemoteAgentInvocation for agent "Analyzer" with query="analyze code"
- When getConfirmationDetails() is called
- Then it shall return:
  - type: 'info'
  - title: "Remote Agent: Analyzer" (or displayName if set)
  - prompt: includes agent card URL
  - previewContent: includes query text

---

### A2A-APPR-003
**Statement:** The confirmation type for remote agents shall support configurable security classification based on data exfiltration risk.

**Priority:** MUST

**Rationale:** Remote agents send local context/code to external services, which poses data exfiltration risk. While they don't modify local system state, the outbound data transfer requires appropriate user awareness.

**Traceability:** 
- LLxprt: Design decision 7.7 (updated)

**Acceptance Criteria:**
- Given a RemoteAgentInvocation (MVP implementation)
- When getConfirmationDetails() returns details
- Then details.type shall be 'info' for MVP
- And details.prompt shall include a warning about data being sent to external service
- (Post-MVP) The system should support policy-based confirmation levels where security-sensitive contexts can elevate remote agent calls to 'warning' or require explicit approval

---

### A2A-APPR-004
**Statement:** If the user denies confirmation, the system shall cancel the remote agent invocation without executing it.

**Priority:** MUST

**Rationale:** User consent is required for remote communication.

**Traceability:** 
- LLxprt: `MessageBus` confirmation flow (existing)

**Acceptance Criteria:**
- Given a remote agent invocation is awaiting confirmation
- When the user responds with confirmed=false
- Then the tool execution framework shall not call execute()
- And shall return a ToolResult indicating user denial

---

### A2A-APPR-005
**Statement:** Where policy rules allow, the system shall auto-approve remote agent invocations without prompting the user.

**Priority:** SHOULD

**Rationale:** Reduces friction for trusted agents in production workflows.

**Traceability:** 
- LLxprt: `PolicyEngine` integration (existing)

**Acceptance Criteria:**
- Given a PolicyEngine rule that allows agent "analyzer"
- When a RemoteAgentInvocation for "analyzer" is built
- Then the tool execution framework shall not prompt the user
- And shall proceed directly to execute()

---

## 7. Error Handling

### A2A-ERR-001
**Statement:** When a remote agent message send fails, the system shall return a ToolResult with error details conforming to the ToolResult error structure.

**Priority:** MUST

**Rationale:** Failures should be visible to LLM and user without crashing.

**Traceability:** 
- LLxprt: `RemoteAgentInvocation.execute()` catch block (proposed), `ToolResult` interface (existing)

**Acceptance Criteria:**
- Given A2AClientManager.sendMessage() throws an error
- When RemoteAgentInvocation.execute() catches the error
- Then it shall return ToolResult with:
  - llmContent: [{text: includes error message}]
  - returnDisplay: includes error message
  - error: {message: string, type: ToolErrorType.EXECUTION_FAILED}

---

### A2A-ERR-002
**Statement:** If agent card fetching fails during registration, the system shall log the error and skip that agent without blocking initialization.

**Priority:** MUST

**Rationale:** Single agent failures should not block other agents.

**Traceability:** 
- LLxprt: `AgentRegistry.registerRemoteAgent()` catch block (proposed)

**Acceptance Criteria:**
- Given an agent card URL returns 404
- When AgentRegistry.registerRemoteAgent() attempts to load it
- Then it shall log an error with agent name and URL
- And the agent shall not appear in registry.getAllDefinitions()
- And initialization shall complete successfully for other agents

---

### A2A-ERR-003
**Statement:** When a remote agent returns an invalid response (malformed JSON, missing required fields), the system shall return a ToolResult with protocol error.

**Priority:** MUST

**Rationale:** Protocol violations should be surfaced to user/LLM.

**Traceability:** 
- LLxprt: `RemoteAgentInvocation.execute()` error handling (proposed)

**Acceptance Criteria:**
- Given a remote agent returns non-JSON response
- When RemoteAgentInvocation processes the response
- Then it shall catch the parsing error
- And return ToolResult with error indicating invalid response

---

### A2A-ERR-004
**Statement:** The system shall wrap all A2A SDK errors with agent name and operation context.

**Priority:** MUST

**Rationale:** Error messages should be actionable and traceable.

**Traceability:** 
- Upstream: 02a36afc (error wrapping)
- LLxprt: `A2AClientManager` error handling (proposed)

**Acceptance Criteria:**
- Given client.sendMessage() throws Error("Connection refused")
- When A2AClientManager.sendMessage() catches it
- Then it shall throw: "A2AClient sendMessage error [agent-name]: Connection refused"

---

### A2A-ERR-005
**Statement:** If a remote agent task times out (no response within timeout period), the system shall return a ToolResult with timeout error.

**Priority:** SHOULD

**Rationale:** Long-running tasks should have observable failure modes.

**Traceability:** 
- LLxprt: Future polling implementation (post-MVP)

**Acceptance Criteria:**
- Given a remote agent task runs for 5 minutes (exceeds timeout)
- When RemoteAgentInvocation waits for completion
- Then it shall return ToolResult with error indicating timeout
- And shall attempt to cancel the task (best-effort)

---

### A2A-ERR-006
**Statement:** When authentication fails, the error message shall include actionable guidance specific to the auth provider.

**Priority:** SHOULD

**Rationale:** Auth errors are common and users need actionable guidance.

**Traceability:** 
- LLxprt: Auth provider implementations (proposed)

**Acceptance Criteria:**
- Given GoogleADCAuthProvider fails with "ADC not configured"
- When the error is logged
- Then it shall include guidance (e.g., "Run 'gcloud auth application-default login'")

---

## 8. Observability

### A2A-OBS-001
**Statement:** The system shall log all remote agent operations (load, sendMessage, getTask, cancelTask) at debug level.

**Priority:** MUST

**Rationale:** Debugging remote agent issues requires visibility into all operations.

**Traceability:** 
- LLxprt: `A2AClientManager` DebugLogger (proposed)

**Acceptance Criteria:**
- Given debug logging is enabled
- When A2AClientManager.loadAgent() is called
- Then it shall log with namespace 'llxprt:agents:a2a': "Loading remote agent 'X' from https://..."
- When A2AClientManager.sendMessage() is called
- Then it shall log: "Sending message to 'X': <preview>"
- And after response: "Received response from 'X': message|task"

---

### A2A-OBS-002
**Statement:** The system shall log errors with sufficient context for troubleshooting (agent name, URL, operation, error message).

**Priority:** MUST

**Rationale:** Error logs must be actionable.

**Traceability:** 
- LLxprt: `A2AClientManager`, `AgentRegistry` error logging (proposed)

**Acceptance Criteria:**
- Given a remote agent load fails
- When the error is logged
- Then it shall include: agent name, agent card URL, error message
- Example: "[AgentRegistry] Failed to load remote agent 'analyzer' from https://...: Connection timeout"

---

### A2A-OBS-003
**Statement:** Where telemetry is enabled, the system shall emit CoreEvent.AGENT_INVOCATION_START and AGENT_INVOCATION_END for remote agents.

**Priority:** SHOULD

**Rationale:** Enables tracking agent usage patterns and performance.

**Traceability:** 
- LLxprt: Future telemetry integration (post-MVP)

**Acceptance Criteria:**
- Given telemetry is enabled
- When RemoteAgentInvocation.execute() starts
- Then it shall emit CoreEvent.AGENT_INVOCATION_START with metadata: {agentName, kind: 'remote', timestamp}
- When execution completes
- Then it shall emit CoreEvent.AGENT_INVOCATION_END with metadata: {agentName, kind: 'remote', duration, success: true|false}

---

### A2A-OBS-004
**Statement:** The system shall include agent kind ('local' or 'remote') in all agent-related log messages.

**Priority:** SHOULD

**Rationale:** Helps distinguish execution paths in logs.

**Traceability:** 
- LLxprt: Logging conventions (proposed)

**Acceptance Criteria:**
- Given a log message about an agent operation
- When the message is formatted
- Then it shall include kind if relevant: "[AgentRegistry] Registered remote agent 'X' ..."

---

### A2A-OBS-005
**Statement:** Where streaming output is supported, the system shall stream remote agent responses to the UI in real-time.

**Priority:** MAY

**Rationale:** Improves user experience for long-running agent tasks.

**Traceability:** 
- LLxprt: Future streaming implementation (post-MVP)

**Acceptance Criteria:**
- Given a RemoteAgentInvocation with updateOutput callback
- When the system receives incremental responses from the remote agent
- Then it shall call updateOutput(text) for each chunk
- And the UI shall display updates live

---

## 9. Security

### A2A-SEC-001
**Statement:** The system shall only send user queries to remote agents after explicit or policy-based approval.

**Priority:** MUST

**Rationale:** User data should not be sent to external services without consent.

**Traceability:** 
- LLxprt: Confirmation flow (Section 6)

**Acceptance Criteria:**
- Given no policy rule auto-approves agent "X"
- When an invocation to "X" is attempted
- Then the system shall request user confirmation before sending any data

---

### A2A-SEC-002
**Statement:** The system shall enforce HTTPS for all agent card URLs and reject HTTP URLs.

**Priority:** MUST

**Rationale:** Unencrypted communication exposes user data to interception.

**Traceability:** 
- LLxprt: `A2AClientManager.loadAgent()` validation (proposed)

**Acceptance Criteria:**
- Given an agent card URL "http://agent.example.com/card" (not https)
- When the system attempts to load the agent
- Then it shall reject the URL with error: "Agent card URLs must use HTTPS"

---

### A2A-SEC-003
**Statement:** The system shall limit the size of responses from remote agents to prevent resource exhaustion.

**Priority:** SHOULD

**Rationale:** Malicious agents could return multi-GB responses to exhaust memory.

**Traceability:** 
- LLxprt: `RemoteAgentInvocation` response handling (proposed)

**Acceptance Criteria:**
- Given a remote agent returns a 100MB response
- When the system processes the response
- Then it shall truncate to a maximum size (e.g., 10MB)
- And log a warning: "Response from 'X' exceeded size limit"

---

### A2A-SEC-004
**Statement:** The system shall not log sensitive data (auth tokens, user queries with PII) in debug logs.

**Priority:** MUST

**Rationale:** Debug logs may be collected and shared without sanitization.

**Traceability:** 
- LLxprt: `A2AClientManager` logging (proposed)

**Acceptance Criteria:**
- Given a message with query containing sensitive data
- When the system logs the message send operation
- Then it shall truncate or redact the query: "Sending message to 'X': <first 100 chars>..."
- Given an AuthenticationHandler with bearer token
- When the system logs auth operations
- Then it shall not log the token value

---

### A2A-SEC-005
**Statement:** The system shall not persist authentication credentials (tokens, keys) in agent session state.

**Priority:** MUST

**Rationale:** Session state may be logged or serialized to disk.

**Traceability:** 
- LLxprt: `RemoteAgentInvocation` session state design (proposed)

**Acceptance Criteria:**
- Given a RemoteAgentInvocation with authenticated client
- When session state is persisted
- Then it shall only store contextId and taskId
- And shall not store authentication tokens or headers

---

### A2A-SEC-006
**Statement:** Where policy enforcement is enabled, the system shall respect policy rules for remote agent access.

**Priority:** MUST

**Rationale:** Enterprises may restrict which agents can be used.

**Traceability:** 
- LLxprt: `PolicyEngine` integration (existing)

**Acceptance Criteria:**
- Given a policy rule denies agent "untrusted-agent"
- When a RemoteAgentInvocation for "untrusted-agent" is attempted
- Then the system shall block execution
- And publish TOOL_POLICY_REJECTION message

---

### A2A-SEC-007
**Statement:** The system shall validate agent card URLs to prevent SSRF (Server-Side Request Forgery) attacks.

**Priority:** MUST

**Rationale:** Malicious URLs could target internal services or exfiltrate data via DNS.

**Traceability:** 
- LLxprt: `A2AClientManager.loadAgent()` validation (proposed)

**Acceptance Criteria:**
- Given an agent card URL "http://localhost:8080/admin"
- When the system validates the URL with default policy
- Then it shall reject URLs pointing to:
  - localhost, 127.0.0.1
  - Private IP ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
  - Link-local addresses (169.254.x.x)
- And shall reject non-HTTPS URLs
- And shall support allowlist/denylist configuration for domains
- Given a remote agent policy with `allowPrivateNetworks: true`
- When the system validates a URL pointing to a private IP
- Then it shall allow the connection (for enterprise/internal A2A endpoints)

---

### A2A-SEC-008
**Statement:** The system shall sanitize agent names to prevent injection attacks in logs and UI.

**Priority:** SHOULD

**Rationale:** Malicious agent names could exploit log parsers or UI renderers.

**Traceability:** 
- LLxprt: `AgentRegistry` validation (proposed)

**Acceptance Criteria:**
- Given an agent name with special characters
- When the name is displayed in logs or UI
- Then it shall be sanitized or rejected during registration
- And shall only allow alphanumeric characters, hyphens, and underscores

---

### A2A-SEC-009
**Statement:** The system shall enforce timeouts for all network operations to remote agents.

**Priority:** MUST

**Rationale:** Hung connections or slow agents should not block indefinitely.

**Traceability:** 
- LLxprt: `A2AClientManager` timeout configuration (proposed)

**Acceptance Criteria:**
- When the system fetches an agent card
- Then it shall enforce a timeout (default: 30 seconds)
- When the system sends a message to a remote agent
- Then it shall enforce a timeout (default: 60 seconds, configurable per agent)
- When the system awaits task completion via SDK blocking mode
- Then it shall enforce a total timeout via AbortSignal.timeout() (default: 5 minutes, configurable)
- When any timeout is exceeded
- Then it shall cancel the request and return a timeout error

---

### A2A-SEC-010
**Statement:** The system shall implement retry logic with exponential backoff for transient network failures.

**Priority:** SHOULD

**Rationale:** Improves reliability in face of temporary network issues.

**Traceability:** 
- LLxprt: `A2AClientManager` retry logic (proposed, post-MVP)

**Acceptance Criteria:**
- When a network request fails with a transient error (connection reset, timeout)
- Then the system shall retry up to 3 times
- And shall use exponential backoff delays (1s, 2s, 4s)
- When a request fails with a non-retryable error (4xx HTTP status)
- Then the system shall fail immediately without retrying

---

### A2A-SEC-011
**Statement:** The system shall redact authentication credentials in all error messages and logs.

**Priority:** MUST

**Rationale:** Prevent credential leakage via error propagation to LLM, user, or logs.

**Traceability:** 
- LLxprt: `A2AClientManager` error handling, logging (proposed)

**Acceptance Criteria:**
- When an error occurs during authenticated request
- Then error messages shall not include tokens or API keys
- When logging authentication operations
- Then logs shall show only token prefix or length: "Bearer ***<last 4>" or "<token length> chars"
- When telemetry captures errors
- Then credentials shall be redacted from metadata

---

### A2A-SEC-012
**Statement:** The system shall constrain HTTP redirects to prevent redirect-based SSRF attacks.

**Priority:** MUST

**Rationale:** Agent card URLs could redirect to internal services.

**Traceability:** 
- LLxprt: `A2AClientManager` HTTP client configuration (proposed)

**Acceptance Criteria:**
- When the HTTP client follows a redirect
- Then it shall enforce a maximum of 5 redirects
- And shall validate that redirect targets are HTTPS
- And shall validate that redirect targets are not localhost/private networks
- When redirect limit is exceeded or validation fails
- Then it shall abort the request and return an error

---

### A2A-SEC-013
**Statement:** The system shall pin the A2A SDK version to prevent supply chain attacks.

**Priority:** SHOULD

**Rationale:** Unpinned dependencies can introduce vulnerabilities via automatic updates.

**Traceability:** 
- LLxprt: `package.json` dependency management (proposed)

**Acceptance Criteria:**
- When package.json specifies the A2A SDK dependency
- Then it shall use exact version pinning (not caret or tilde ranges)
- Example: "@a2a-js/sdk": "1.2.3" (not "^1.2.3")
- And package-lock.json shall lock all transitive dependencies

---

## Requirements Summary

| Category | MUST | SHOULD | MAY | Total |
|----------|------|--------|-----|-------|
| Agent Discovery | 3 | 1 | 0 | 4 |
| Agent Registration | 5 | 1 | 0 | 6 |
| Agent Execution | 9 | 2 | 0 | 11 |
| Authentication | 2 | 4 | 0 | 6 |
| Configuration | 2 | 3 | 0 | 5 |
| Confirmation/Approval | 4 | 1 | 0 | 5 |
| Error Handling | 4 | 2 | 0 | 6 |
| Observability | 2 | 3 | 1 | 6 |
| Security | 8 | 5 | 0 | 13 |
| **Total** | **39** | **22** | **1** | **62** |

---

## MVP Scope

**MUST requirements (39)** form the MVP scope:
- Core A2A types (discriminated union)
- A2A client manager with caching (non-singleton, per-config)
- Basic registration (async, programmatic only)
- Remote invocation with session persistence (scoped by agent+session)
- Abort signal wiring and cleanup
- Input-required state handling
- SDK blocking mode for task completion (no manual polling in MVP)
- NoAuthProvider (unauthenticated agents)
- Configurable confirmation with data exfiltration warning
- Error handling with ToolResult
- Debug logging with credential redaction
- HTTPS enforcement
- SSRF protection (localhost/private IP blocking)
- Timeout enforcement (card fetch, message send, task completion)
- Redirect constraints
- Credential redaction in errors/logs
- Session state keying with agent+session ID
- No token persistence

**SHOULD requirements (22)** for post-MVP:
- TOML configuration
- Multi-provider auth (Google ADC, bearer token, MultiProvider)
- Retry logic with exponential backoff
- Telemetry events
- Response size limits
- Agent name sanitization
- Domain allowlist/denylist
- A2A SDK version pinning

**MAY requirements (1)** for future consideration:
- Real-time streaming output

---

## Traceability Matrix

| Requirement ID | Upstream Commit | LLxprt Component |
|----------------|-----------------|------------------|
| A2A-DISC-001 | 02a36afc | `packages/core/src/agents/a2a-client-manager.ts` |
| A2A-DISC-002 | 3ebe4e6a | `packages/core/src/agents/registry.ts` |
| A2A-DISC-003 | 02a36afc | `A2AClientManager.agentCards` |
| A2A-DISC-004 | 3ebe4e6a | `AgentRegistry.registerRemoteAgent()` |
| A2A-REG-001 | 848e8485 | `packages/core/src/agents/types.ts` |
| A2A-REG-002 | 3ebe4e6a | `packages/core/src/agents/registry.ts` |
| A2A-REG-003 | 3ebe4e6a | `AgentRegistry.initialize()` |
| A2A-REG-004 | 3ebe4e6a | `AgentRegistry.registerRemoteAgent()` |
| A2A-REG-005 | - | `packages/core/src/agents/registry.ts` (existing) |
| A2A-REG-006 | 848e8485 | Future TOML loader |
| A2A-EXEC-001 | 96b9be3e | `packages/core/src/agents/remote-invocation.ts` |
| A2A-EXEC-002 | 96b9be3e | `RemoteAgentInvocation.sessionState` |
| A2A-EXEC-003 | 96b9be3e | `packages/core/src/agents/a2a-utils.ts` |
| A2A-EXEC-004 | 96b9be3e | `a2a-utils.ts` extractMessageText/extractTaskText |
| A2A-EXEC-005 | 96b9be3e | `RemoteAgentInvocation.execute()` |
| A2A-EXEC-006 | 96b9be3e | `RemoteAgentInvocation` constructor |
| A2A-EXEC-007 | 96b9be3e | `RemoteAgentInvocation.execute()` |
| A2A-EXEC-008 | 96b9be3e | `a2a-utils.ts` extractMessageText |
| A2A-EXEC-009 | - | `RemoteAgentInvocation.execute()` state handling |
| A2A-EXEC-010 | - | `RemoteAgentInvocation.execute()` blocking call + timeout |
| A2A-EXEC-011 | - | `AgentRegistry.createInvocation()` or equivalent |
| A2A-AUTH-001-006 | - | `packages/core/src/agents/auth-providers.ts` |
| A2A-CFG-001-002 | - | `packages/core/src/config/config.ts` |
| A2A-CFG-003-005 | 848e8485 | Future TOML loader |
| A2A-APPR-001-005 | 96b9be3e | `RemoteAgentInvocation.getConfirmationDetails()` |
| A2A-ERR-001-006 | 02a36afc, 96b9be3e | Error handling across components |
| A2A-OBS-001-005 | - | DebugLogger, telemetry hooks |
| A2A-SEC-001-006 | - | Security validation, confirmation flow |
| A2A-SEC-007 | - | `A2AClientManager.loadAgent()` SSRF validation |
| A2A-SEC-008 | - | `AgentRegistry` name sanitization |
| A2A-SEC-009 | - | `A2AClientManager` timeout configuration |
| A2A-SEC-010 | - | `A2AClientManager` retry logic (post-MVP) |
| A2A-SEC-011 | - | Error handling, logging across components |
| A2A-SEC-012 | - | HTTP client redirect constraints |
| A2A-SEC-013 | - | `package.json` dependency pinning |

---

## Acceptance Testing Strategy

**Unit Tests:**
- `A2AClientManager`: loadAgent, sendMessage, getTask, cancelTask
- `RemoteAgentInvocation`: execute, session state, error handling
- Auth providers: getAuthHandler for each provider type
- A2A utilities: extractMessageText, extractTaskText, extractIdsFromResponse
- `AgentRegistry`: registerRemoteAgent, async registration

**Integration Tests:**
- End-to-end: register remote agent → delegate task → receive result
- Multi-turn conversation: verify contextId/taskId persistence
- Error scenarios: network timeout, invalid response, auth failure
- Confirmation flow: info-type confirmation → approval → execution

**E2E Tests:**
- Real remote agent (if available): full workflow with actual A2A server
- Mock A2A server: simulate various task states, error conditions
- Performance: measure latency, throughput for remote invocations

**Security Tests:**
- HTTPS enforcement: reject HTTP URLs
- SSRF prevention: reject localhost, private IPs
- Token leakage: verify no credentials in logs or session state
- Input validation: malformed agent names, URLs

---

## Appendix: Requirement ID Changes

**Renamed from v1.0:**
- `A2A-CONF-*` (Configuration) → `A2A-CFG-*` (to avoid collision with Confirmation)
- No other ID changes

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-02 | Initial draft |
| 2.0 | 2026-03-02 | Round-2 review remediation: Fixed auth singleton, added SSRF/timeout/retry/credential redaction requirements, clarified input-required handling, added polling strategy, improved session state keying, updated confirmation security classification, distinguished baseline vs proposed components |
| 2.0 | 2026-03-02 | **Remediation of review findings:**<br>- Renamed A2A-CONF-* to A2A-CFG-* to avoid collision with Confirmation<br>- Completed truncated Observability and Security sections<br>- Fixed EARS syntax inconsistencies<br>- Added traceability to LLxprt components (not just upstream hashes)<br>- Reworded A2A-REG-003 to behavior (not implementation)<br>- Added explicit task state behavior in A2A-EXEC-003<br>- Clarified confirmation integration point (A2A-APPR-001)<br>- Enhanced security requirements (A2A-SEC-002 through A2A-SEC-008)<br>- Added auth failure semantics (A2A-AUTH-006, A2A-ERR-006)<br>- Aligned error structures to ToolResult (A2A-ERR-001) |
| 3.0 | 2026-03-02 | Round-3 review remediation: Aligned EXEC-010 to SDK blocking mode (no manual polling in MVP), made SSRF configurable via allowPrivateNetworks, tightened terminal-state ToolResult semantics for failed/canceled, canonical dispatch point in EXEC-011, updated timeout references from polling to blocking |
| 3.1 | 2026-03-02 | Scope correction: Promoted GoogleADCAuthProvider (A2A-AUTH-003) to MUST — upstream ships it as only auth path. Promoted TOML config (A2A-REG-006, A2A-CFG-003/004/005) to MUST — upstream ships in 0.24.5. Added A2A-EXEC-012 for Vertex AI dialect adapter (createAdapterFetch). Auth interface remains pluggable for OCI/AWS/Azure post-MVP providers. |
