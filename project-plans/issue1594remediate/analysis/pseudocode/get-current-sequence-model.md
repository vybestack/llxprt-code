<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-003 -->
# Pseudocode: Real `getCurrentSequenceModel`

Component target: `packages/agents/src/api/agentImpl.ts` (MODIFY — replace stub L668-670).
Requirements: REQ-003, REQ-003.1, REQ-003.2.

---

## Interface Contracts

```typescript
// SIGNATURE (already declared, agent.ts:330 and agentImpl.ts:668):
getCurrentSequenceModel(): string | null;

// DEPENDENCIES (NEVER stubbed):
interface Dependencies {
  resolveClient: () => AgentClientContract | undefined;   // EXISTING closure (createAgent.ts:257
                                                          // `const resolveClient = () => config.getAgentClient()`)
}
```

`AgentClientContract.getCurrentSequenceModel(): string | null` exists at
`packages/core/src/core/clientContract.ts:118`. The concrete `AgentClient.getCurrentSequenceModel`
returns `this.currentSequenceModel` (client.ts:653).

The impl already holds a `resolveClient` closure (`agentImpl.ts` deps; threaded from
createAgent.ts:257/282). The stub currently IGNORES it and returns `null`.

---

## Numbered Pseudocode

```
10: METHOD getCurrentSequenceModel() -> string | null
11:   SET client = this.deps.resolveClient()         # current bound client (post-auth)
12:   IF client is undefined OR null                 # pre-ready / mid-rebind guard
13:     RETURN null                                  # REQ-003.1 (no fabrication, no throw)
14:   RETURN client.getCurrentSequenceModel()        # REQ-003 — delegate to bound client
15: END METHOD
```

---

## Integration Points (Line-by-Line)

```
Line 11: this.deps.resolveClient()
         - MUST resolve fresh each call (R-CLIENT invariant from #1594): never cache a client.
         - After a provider/model switch + rebuildLoop, resolveClient() returns the NEW client,
           so the value reflects the current client (REQ-003.2).
Line 12-13: undefined guard
         - clientContract return is `string | null`; if there is no client yet, return null
           (matches the nullable contract; do NOT throw).
Line 14: client.getCurrentSequenceModel()
         - Returns the sticky load-balancer sequence model string, or null when none.
         - Consumers use `agent.getCurrentSequenceModel() ?? agent.getModel()`
           (mirrors useGeminiStreamLifecycle.ts and AgenticLoop.ts pattern).
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: return null;                         // the current stub — REMOVE it
[OK]   DO:     return this.deps.resolveClient()?.getCurrentSequenceModel() ?? null

[ERROR] DO NOT: const client = this.cachedClient     // caching violates R-CLIENT
[OK]   DO:     const client = this.deps.resolveClient()   // fresh resolve

[ERROR] DO NOT: return this.providerState.model       // wrong source (that's setModel value)
[OK]   DO:     delegate to the client's getCurrentSequenceModel()

[ERROR] DO NOT: throw if client missing               // contract is nullable
[OK]   DO:     return null when no client
```

---

## Behavior Decision Table (REQ-003)

| Bound client state | client.getCurrentSequenceModel() | Agent returns |
|---|---|---|
| no client (pre-ready) | n/a | `null` |
| client, sticky LB model `"gpt-4o"` | `"gpt-4o"` | `"gpt-4o"` |
| client, no sticky model | `null` | `null` |
| after switch → new client `"claude-x"` | `"claude-x"` | `"claude-x"` (REQ-003.2) |
