# START HERE: Context Recovery for A2A Implementation

**If you are a context-wiped agent starting mid-execution, read this file FIRST.**

## What is this plan?

This plan implements **Agent-to-Agent (A2A) protocol support** in LLxprt Code, enabling invocation of remote agents hosted elsewhere alongside existing local agent execution.

## Critical Documents (Read in Order)

1. **THIS FILE** (START-HERE.md) — You are here
2. **00-overview.md** — Plan structure, phase sequence, success criteria
3. **execution-tracker.md** — Which phases are complete? Where are we?
4. **design.md** (parent directory) — Full technical architecture
5. **requirements.md** (parent directory) — 62 EARS requirements
6. **RULES.md** (dev-docs/) — Project rules (testing, TDD, conventions)
7. **COORDINATING.md** (dev-docs/) — How to execute plans with subagents

## Quick Orientation

### What are we building?

Before A2A support:
- LLxprt only supports **local agents** (run LLM loop in same process)
- Agents hardcoded: promptConfig, modelConfig, runConfig required

After A2A support:
- LLxprt supports **local AND remote agents** (discriminated union)
- Remote agents: just name + agentCardUrl (agent manages its own config)
- Agent cards fetched from remote servers via A2A SDK
- Session state (contextId/taskId) persisted for multi-turn conversations
- Authentication pluggable (NoAuth, GoogleADC, future: bearer token, multi-provider)

### Architecture Summary

```
AgentRegistry
    ├── LocalAgentDefinition (kind: 'local') → SubagentInvocation → AgentExecutor (existing)
    └── RemoteAgentDefinition (kind: 'remote') → RemoteAgentInvocation → A2AClientManager → A2A SDK
```

**Key Components (NEW):**
1. **Discriminated Union Types** (types.ts) — LocalAgentDefinition | RemoteAgentDefinition
2. **A2AClientManager** (a2a-client-manager.ts) — Manages A2A SDK clients, fetches agent cards
3. **RemoteAgentInvocation** (remote-invocation.ts) — Executes remote agents, manages session state
4. **RemoteAgentAuthProvider** (auth-providers.ts) — Pluggable auth (NoAuth, GoogleADC)
5. **a2a-utils.ts** — Text extraction from Message/Task responses
6. **TOML loader** (extend existing) — Load remote agents from config files

**Key Changes (BREAKING):**
- `AgentDefinition` becomes discriminated union (breaking change #1)
- `AgentRegistry.registerAgent()` becomes async (breaking change #2)
- `AgentExecutor.create()` signature changes to `LocalAgentDefinition` only (breaking change #3)
- `SubagentInvocation` constructor changes to `LocalAgentDefinition` only (breaking change #4)

## Where are we in the plan?

Check **execution-tracker.md** for current phase status. Look for:
- Last PASS: What was the last completed phase?
- Current WIP: What phase is in progress?
- Next: What phase should start next?

## How to execute a phase

1. **Read the phase file** (e.g., `03-type-system-stub.md`)
2. **Check prerequisites**: Did previous phase complete?
3. **Read requirements**: What EARS requirements does this implement?
4. **Follow subagent prompt**: Exact instructions for implementation
5. **Run verification**: Did automated checks pass?
6. **Update tracker**: Mark phase complete in execution-tracker.md

## Phase Numbering

**CRITICAL**: Execute phases in EXACT numerical order:

```
P00a → P03 → P03a → P04 → P04a → P05 → P05a → P06 → P06a → ...
```

**DO NOT SKIP NUMBERS**. Each "a" phase is verification.

## Breaking Changes Timeline

**Phases 03-05**: Introduce discriminated union types
- **Symptom**: Compilation errors in executor.ts, invocation.ts (accessing promptConfig on AgentDefinition)
- **Solution**: Don't fix yet — these are intentional breaking changes
- **When fixed**: Phases 30-31 (Integration & Migration)

**Phases 18-20**: Make registerAgent async
- **Symptom**: Callers of registerAgent need await
- **Solution**: Update callers in these phases
- **Affected**: loadBuiltInAgents, tests

**Phases 24-26**: Add factory dispatch method
- **Symptom**: Direct SubagentInvocation instantiation breaks
- **Solution**: Use AgentRegistry.createInvocation() factory
- **Affected**: task.ts, tests

## Testing Philosophy

From RULES.md:
- **Behavioral tests ONLY** — Test input → output transformations
- **NO mock theater** — Don't just verify mocks were called
- **TDD is mandatory** — Write test first (RED), minimal code (GREEN), refactor if valuable
- **Property-based tests** — 30% of tests should use fast-check or similar
- **NO reverse testing** — Don't test for NotYetImplemented or stub behavior

## Common Mistakes to Avoid

1. **Skipping phases** — "Phase 07 is just tests, I'll skip to 08" → NO, execute all phases
2. **Batching phases** — "Phases 09-14 are auth, I'll do them together" → NO, one phase at a time
3. **Ignoring breaking changes** — "Compilation errors? I'll fix them now" → NO, wait for integration phases
4. **Mock theater** — "I'll test that A2AClientManager.sendMessage was called" → NO, test actual responses
5. **Time estimates** — Never include time estimates in plans or output

## Key Files to Understand

Before implementing, understand these baseline files:

- **packages/core/src/agents/types.ts** — Current agent definition (will become discriminated union)
- **packages/core/src/agents/registry.ts** — Agent registration (will become async)
- **packages/core/src/agents/executor.ts** — Local agent execution (no changes, but type narrowing needed)
- **packages/core/src/agents/invocation.ts** — Local agent invocation wrapper (type narrowing needed)
- **packages/core/src/config/config.ts** — Central config (DI pattern, will add auth provider)
- **packages/core/src/tools/tools.ts** — BaseToolInvocation pattern (RemoteAgentInvocation extends this)

## Requirements Traceability

Every phase implements specific requirements from requirements.md. Example:

- **Phase 03-05**: Implements A2A-REG-001 (discriminated union types)
- **Phase 06-08**: Implements A2A-EXEC-003, A2A-EXEC-004 (text extraction)
- **Phase 15-17**: Implements A2A-DISC-001, A2A-DISC-002, A2A-DISC-003 (client manager)

See 00-overview.md for full traceability matrix.

## Upstream Reference

gemini-cli 0.24.5 implemented this feature in 4 commits (~2,000 LoC):
- 02a36afc: A2A Client Manager (~516 LoC)
- 848e8485: Remote agents and multi-agent TOML (~335 LoC)
- 3ebe4e6a: Remote agents in registry (~168 LoC)
- 96b9be3e: Remote agent support (~980 LoC)

**Key differences from upstream:**
1. **Auth abstraction**: LLxprt uses pluggable RemoteAgentAuthProvider (upstream hardcoded Google ADC)
2. **Multi-provider philosophy**: Consistent with LLxprt's provider-agnostic design
3. **Type safety**: Explicit discriminated union (upstream added kind field gradually)
4. **Session state**: Injected Map (upstream used static singleton)

## Dependencies

**Existing packages** (verify in preflight):
- `@google/genai` (Gemini SDK)
- `zod` (schema validation)
- `vitest` (testing)

**NEW packages** (add during implementation):
- `@google/genai-a2a-sdk` (Phase 15) — A2A protocol SDK
- `google-auth-library` (Phase 12) — Google ADC authentication

## What if I'm stuck?

1. **Read the phase file again** — Instructions are explicit
2. **Check prerequisites** — Did previous phase actually complete?
3. **Read design.md** — Architecture details
4. **Read requirements.md** — What behavior is required?
5. **Read RULES.md** — Testing and code conventions
6. **Check execution-tracker.md** — Are we on the right phase?
7. **Use todo_pause** — If blocked, pause and document the blocker

## Next Steps

1. Check **execution-tracker.md** to see current phase
2. Read that phase's file (e.g., `03-type-system-stub.md`)
3. Verify prerequisites complete
4. Execute the subagent prompt
5. Run verification commands
6. Update execution-tracker.md with completion
7. Proceed to next phase (numerical order)

## Emergency Recovery

If you're completely lost:

```bash
# Step 1: Where are we?
cat project-plans/gmerge-0.24.5/a2a/plan/execution-tracker.md

# Step 2: What's the plan?
cat project-plans/gmerge-0.24.5/a2a/plan/00-overview.md

# Step 3: What's the architecture?
cat project-plans/gmerge-0.24.5/a2a/design.md

# Step 4: What are the requirements?
cat project-plans/gmerge-0.24.5/a2a/requirements.md

# Step 5: Read this file again (START-HERE.md)
```

Then identify the next phase to execute and read its phase file.

## Success Metrics

Plan is complete when:
- [ ] All 33 phases executed (00a through 33)
- [ ] All 62 EARS requirements satisfied (tests pass)
- [ ] Type system enforces local vs remote at compile time
- [ ] Remote agents load from TOML
- [ ] Agent cards fetched with authentication
- [ ] Session state persists correctly
- [ ] Integration tests pass
- [ ] No breaking changes unfixed
- [ ] 80%+ mutation test coverage
- [ ] Documentation updated

Good luck!
