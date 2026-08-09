# Issue #3176 — Request-scoped system-prompt parameters

## Scope

Fix audit findings D5, D7, and D8:

- D5: system-prompt template selection must use the concrete provider and model
  for the request being executed.
- D7: auxiliary prompt assembly must not reread `.LLXPRT_SYSTEM` on every call,
  including when JIT context is disabled.
- D8: compression prompt assembly must describe the session whose history is
  being compressed.

Out of scope:

- D9 and the vestigial normalized `userMemory` channel.
- General redesign of the `undefined` core-memory sentinel tracked by #3174.
- Subagent JIT/MCP behavior tracked by #3173.
- Removal of the retained executor path tracked by #3152.

## Grounding

Prompt templates are resolved through provider/model-specific paths. Before this
change, callers supplied a request model but omitted the provider, leaving the
provider to ambient settings. This could combine one runtime's provider with a
different runtime's model.

Load balancers add a second boundary: the wrapper cannot know the concrete
provider/model pair until it selects a member. Prompt assembly therefore has to
flow as a request-scoped port and rerun for each selected member or failover
attempt.

The auxiliary prompt path also omitted `coreMemory`. The core prompt layer
interprets `undefined` as "load core memory from disk," causing repeated reads.
The exact first disk result must be retained when no explicit in-memory value is
available.

Compression previously derived interaction mode only from `Config`. The
existing authoritative subagent marker is a non-empty
`AgentRuntimeState.subagentName`.

## Accepted behavior

### Provider/model coherence

1. Main-agent initial and per-turn prompt assembly pairs the stable runtime
   provider with the current config model.
2. Live subagent initial and per-turn assembly uses the isolated runtime
   provider, never foreground settings, while retaining current-model behavior.
3. AgentClient auxiliary requests pass the AgentClient runtime provider.
4. The retained executor uses its config-owned active provider because that
   legacy path has no concrete runtime state.
5. Main load-balancer round-robin and failover attempts reassemble with each
   selected member's concrete provider and model.
6. Ordinary compression uses the resolved compression provider and model.
7. Compression load balancing defers wrapper-level assembly and reassembles for
   every concrete round-robin selection and failover attempt.
8. Missing or blank controlled compression provider/model identities fail fast.
9. `asyncSubagentsEnabled` and `profileAsyncEnabled` remain settings-resolved;
   they are not added to the request-scoped assembler contract.

### Auxiliary core memory

1. A defined `config.getCoreMemory()` value is passed through exactly.
2. When it is undefined, `loadCoreMemoryContent(process.cwd())` runs once per
   `Config`, and its promise/result is cached in a `WeakMap`.
3. The empty string is a valid cached snapshot.
4. Load failures are not swallowed by the cache.
5. `getCoreSystemPromptAsync` always receives a defined value from the
   auxiliary path, so it does not perform a second per-call disk fallback.

### Compression interaction mode

1. A non-empty `runtimeState.subagentName` produces `subagent`.
2. Otherwise the existing config-based interactive/non-interactive derivation
   is preserved.
3. A compression load balancer derives the mode from the compressed session
   once and passes the same mode to every candidate.

## Test-first coverage

All new or changed tests use Bun and `bun:test`.

1. A real temporary provider/model template fixture drives an actual subagent
   request. Ambient provider A differs from executing provider B; the sent
   prompt must contain only provider B's sentinel.
2. Subagent assembler tests prove the runtime provider remains stable while a
   current-model change is reflected at the provider boundary.
3. ChatSessionFactory and ChatSession tests prove runtime-provider/current-model
   pairing and propagation of the assembler port.
4. Main load-balancer tests cover mixed provider/model round-robin and failover
   attempts.
5. Ordinary compression tests cover provider identity plus subagent,
   interactive, and non-interactive modes.
6. Compression load-balancer tests cover candidate-specific round-robin and
   failover assembly and prove OneShotStrategy does not perform wrapper-level
   assembly first.
7. Auxiliary tests prove explicit in-memory core memory is delivered.
8. Real filesystem tests call the auxiliary API twice, mutate the disk fixture
   after the first call, and prove the first exact snapshot remains in use.
   A second case proves an empty result is cached.
9. A core-layer filesystem test proves explicitly supplied core memory bypasses
   the disk fallback without suppressing content.

## Verification gates

Before delivery:

- Run all affected tests individually to avoid Bun's process-wide mock
  collisions.
- Run touched-workspace lint and typecheck plus the ESLint guard.
- Run Open Code Review detached with a 20-minute floor and include changed test
  files; run rustreviewer alongside it.
- Run the full repository test, lint, typecheck, format, and build commands.
- Run the `stepfun-37` smoke test.
- Create one PR whose title and body reference and fix #3176, then remediate CI
  and CodeRabbit findings until all checks are green and threads are resolved.
