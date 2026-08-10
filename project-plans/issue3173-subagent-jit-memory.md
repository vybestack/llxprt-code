# Issue 3173: Align Main-Agent and Subagent Prompt Memory Sourcing

Plan ID: PLAN-20260808-ISSUE3173

## Accepted Behavior

### REQ-3173-01: Shared memory derivation policy

Both the main-agent and subagent system-prompt builders must consume one internal memory-derivation policy rather than independently choosing configuration accessors.

The policy produces the existing prompt inputs for user memory, core memory, and MCP instructions. It must remain internal to the existing prompt-assembly implementation; this issue does not add a public API.

### REQ-3173-02: JIT-enabled memory

Given JIT context is enabled:

- user memory starts with `Config.getGlobalMemory()`, not `Config.getUserMemory()`;
- JIT memory is loaded for `Config.getWorkingDir()` through `Config.getJitMemoryForPath()`;
- non-empty global and JIT memories are joined with the existing two-newline separator;
- an empty global memory or empty JIT memory does not introduce an extra separator;
- core memory continues to come from `Config.getCoreMemory()`;
- MCP instructions continue to come from `Config.getMcpInstructions()` and are supplied through the existing dedicated prompt option.

The resulting subagent prompt therefore contains the same subdirectory `LLXPRT.md` memory as the main-agent prompt and contains the MCP instruction block exactly once.

### REQ-3173-03: JIT-disabled memory

Given JIT context is disabled:

- user memory continues to come from `Config.getUserMemory()`;
- no JIT subdirectory memory is added;
- core memory and MCP instructions retain their existing sources and placement;
- main-agent and subagent prompt behavior remains otherwise unchanged.

### REQ-3173-04: Main-agent compatibility

For every supported combination of empty/non-empty user, global, JIT, core, and MCP memory, the main-agent system-prompt text must be byte-for-byte identical to the text produced by the existing implementation under the same valid `Config` behavior.

The existing ordering remains environment context, core prompt, and any path-specific additions already owned by the main-agent builder. This issue does not reorder prompt sections or alter prompt formatting.

## Relevant Inputs and Boundaries

- JIT mode: enabled or disabled.
- Execution mode: main agent or subagent.
- Working directory: the exact value returned by `Config.getWorkingDir()`.
- Global/user/JIT/core/MCP memory: empty, undefined where the current accessor permits it, or non-empty.
- Per-turn behavior: subagent creation-time and subsequent turn assembly must use the same policy.
- MCP content may also be present in JIT environment memory when `getUserMemory()` is used. The JIT-enabled policy must avoid that accessor rather than deduplicating prompt text after assembly.
- Memory loading errors, filesystem traversal semantics, trusted-root rules, `allMemoriesAreCore`, compression prompts, auxiliary prompt call sites, provider placement, and core-memory disk fallback are outside this issue.

## Behavioral Test Evidence

Tests must be written or adjusted before production code and must use Bun with `bun:test`.

1. **Main agent, JIT enabled**
   - Build the main-agent instruction with distinct global, user/environment, JIT, core, and MCP markers.
   - Assert the prompt inputs use global plus JIT memory, exclude the JIT-mode `getUserMemory()` marker, preserve core memory, and carry MCP instructions once through the dedicated option.
   - Assert JIT memory is requested for the configured working directory.

2. **Main agent, JIT disabled**
   - Build the main-agent instruction with distinct user and global markers.
   - Assert the existing user-memory path and exact assembled text remain unchanged and no JIT memory is added.

3. **Subagent, JIT enabled**
   - Exercise the real subagent assembler at creation and on a subsequent turn.
   - Assert both assemblies receive global plus JIT user memory, preserve core memory and subagent interaction mode, and exclude environment memory from the user-memory channel.
   - Assert the rendered prompt contains the JIT subdirectory marker and exactly one MCP marker.

4. **Subagent, JIT disabled**
   - Exercise creation-time and per-turn assembly.
   - Assert both use `getUserMemory()` unchanged, do not add JIT memory, preserve core memory, and contain exactly one MCP marker when MCP instructions are configured.

5. **Boundary formatting**
   - Cover empty base memory and empty JIT memory so the shared policy preserves existing separator behavior and produces no synthetic whitespace.

Tests must assert prompt content or exact prompt inputs, not merely mock invocation counts. Any infrastructure substitution must leave the production memory policy and assembler under test.

## Implementation Scope

- Add one private/internal shared memory-derivation helper in the existing agents prompt-assembly area.
- Replace only the duplicated main-agent and subagent memory derivation with that helper.
- Update only directly affected Bun tests and this plan.
- Remove or update the issue-specific explanatory comment in `subagentRuntimeSetup.ts` once it no longer describes current behavior.

No dependency, workflow, settings schema, public abstraction, memory file-loading behavior, unrelated prompt call site, or adjacent audit finding is part of this issue.

## Review Finding Triage

Every finding is classified before action:

- **Blocker-Fix**: breaks an accepted behavior, required gate, safety rule, or candidate-head correctness.
- **In-scope-Fix**: improves correctness or test evidence within the behavior and files above.
- **Reject**: factually incorrect, already covered, or contrary to the accepted behavior.
- **Defer**: valid but outside this issue, including adjacent prompt architecture or memory-policy work.

Only Blocker-Fix and In-scope-Fix findings authorize changes in this effort.

## Completion Gates

- Behavioral evidence exists for every requirement and boundary above.
- Focused tests and the full local verification suite pass on the candidate head.
- The smoke test passes.
- DeepThinker and Open Code Review findings are triaged; all Blocker-Fix and In-scope-Fix findings are resolved.
- PR CI is green, review threads are resolved or explicitly awaiting user judgment, ancestry is correct, and the PR is conflict-free.
