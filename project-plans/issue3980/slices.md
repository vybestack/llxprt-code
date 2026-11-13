# Issue bodies for the agent API adaptation

Plan: PLAN-20261112-AGENT-API. Target milestone: 0.12.0. Parent: #3980. Boundary burn-down: #4037.

Each numbered section below is a complete issue body, beginning with its proposed issue title. File paths marked **new** do not exist yet. Magnitudes include production and behavior-test additions/changes; deletions are listed separately and are not scope caps. No issue numbers have been allocated by this planning task.

Every issue inherits the verification and PR rules in `adaptation-plan.md`: test-first Bun tests, real boundary behavior, no weakened checks, short-lived branch from main, one slice per PR, `Refs #3980`, `Refs #4037` when retiring baseline sites, and `Fixes #<slice-issue>` only after its exit criteria pass. The parent closes only after the final deletion slice.

The 28 slices and their dependencies/magnitudes match the roadmap. D14-D18 and the policy translation matrix in the plan are inherited contracts; Q1-Q3 gate only affected release behavior. P23-P26 merge independently before the atomic P27 Ink switch.

## P01: Create agent-core contracts and enforce its import boundary

**Plan:** PLAN-20261112-AGENT-API.P01. **Dependencies:** none; confirm main/nightly prerequisite. **Magnitude:** 1,400-2,200 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Create the pure package and closed definition schemas. Complete the HTML value types, typed errors and fake ports without importing legacy core. Register the package in build, test discovery, packaging and CI from the first commit. This slice exports contracts and validation, not a stub createAgent pretending to be usable.

Freeze D14-D18 from Design amendments before any runtime slice. This includes replay scope/envelopes and transcript part IDs, cumulative UsageReport and dispatch certainty, ModelRecovery plus journal records, PreparedShell facts, and AfterTurnView. Keep PolicyDocument unchanged; Q3 does not authorize a regex matcher.

### Packages and files

**New:** packages/agent-core/package.json, index.ts, tsconfig.json, src/definition.ts, src/ports.ts, src/types.ts, src/testing/fake-ports.ts, src/definition.test.ts; scripts/check-agent-core-import-boundary.ts; scripts/tests/agent-core-import-boundary.test.ts. **Modify:** package.json, package-lock.json, bun.lock, tsconfig.json, scripts/test-shards.ts, scripts/affected-test-shards.data.json, scripts/runtime-entry-manifest.ts, scripts/check-runtime-state-boundary.ts, .github/workflows/ci.yml. Check scripts/build.ts and scripts/prepare-workspace-build.ts discovery rather than duplicating their workspace list.

### Public contract

AgentDefinition, AgentHost, Agent, AgentCommand, AgentEvent, AgentSnapshot, Turn, TurnResult, ContentPart, ContextItem, ModelPort, ToolCatalog, DecisionPort, SessionStore, Clock, DiagnosticSink, Interceptors and their value/error types; validateDefinition; ScriptedModel, MemoryTools, ScriptedDecisions, FakeClock, MemorySessionStore under a testing export.

Explicit additions: ReplayScope, ProviderReplayData, TranscriptPart/TranscriptEntry, UsageReport, ModelRecovery, PreparedShell/ShellSegment and AfterTurnView. Complete accounting event values alongside the existing event value types, separating measured Usage from conservative budget charges.

### Tests first

Closed definition rejects unknown fields, functions and missing required selection; reports all definition problems before any port effect. Authority allow is rejected. Invalid budgets/ratios/caps fail. Import fixtures reject direct, relative, aliased, barrel, type-only, dynamic and transitive forbidden dependencies and I/O globals. A permitted pure fixture builds and runs. No fake return value is the assertion target.

Schema and negative-type fixtures reject non-JSON replay/recovery data, unknown formats at adapter validation, dangling replay targets, secret-bearing scope inputs, decreasing/negative usage and incomplete reports marked complete. Round-trip plain replay and accounting records through MemorySessionStore. Require shell facts for shell descriptors and test AfterTurnView contains no Agent or callbacks.

### Exit criteria

Package builds and has passing runtime schema and negative compilation fixtures. CI invokes the graph guard on every PR, including this first one; runtime scanner discovers the new package. No new baseline findings.

P03 can implement failed-attempt accounting and replay using published contracts without inventing another data channel. P05 and P17 have the preparation/continuation facts they need; all D14-D18 contracts appear in emitted declarations.

### Deletions

None. Existing hosts continue unchanged.

### Risks

Type-only leaks and transitive re-exports can defeat shallow grep checks. The displayed design leaves some value types incomplete; define them explicitly, not with unknown service bags.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/definition.test.ts scripts/tests/agent-core-import-boundary.test.ts; npm run lint:test-shards; npm run lint:affected-shards; package build/declaration export smoke.

No #4037 entries retire. Add the stricter core graph rule; preserve every existing scanner rule. Pseudocode 01.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P02: Implement synchronous mailbox admission and command timing

**Plan:** PLAN-20261112-AGENT-API.P02. **Dependencies:** P01. **Magnitude:** 1,100-1,700 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Implement the actor mailbox and legal state transitions with explicit application points. Do not reuse the legacy coordinator, which depends on SafeBoundaryOutcome and legacy ActiveRun. Start integration harness at the public command/admission boundary; wire the loop in P03.

### Packages and files

**New:** packages/agent-core/src/mailbox.ts, src/state.ts, src/mailbox.test.ts. **Modify:** packages/agent-core/src/types.ts, src/testing/fake-ports.ts. **Read/retire later:** packages/agents/src/api/agentExecutionCoordinator.ts, packages/agents/src/session/session-execution-owner.ts.

### Public contract

BusyError, ClosedError, NotRunningError, CommandResult and the submit/steer/cancel/command contracts. Mailbox and reducer remain package-private.

### Tests first

S16.2 competing commands: two same-tick submits reserve only one turn; ClosedError precedes BusyError; steer idle fails; cancel idle is a no-op. Policy, boundary and turn-end commands apply at distinct points. Rewind/clear reject while running. A blocked external operation cannot prevent cancel/close admission. Queued commands settle on close; no promise remains orphaned.

### Exit criteria

Generated command/state traces preserve one active turn and admission linearization. Unit reducer tests and admission integration tests pass; no host uses an incomplete runtime.

### Deletions

None yet; old coordinator still serves old hosts.

### Risks

Accidentally holding the mailbox across an await; applying model/instruction changes during an active attempt.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/mailbox.test.ts; fast-check transition traces, at least 30% property cases within this slice. Accepted queued commands fulfill with rejected/closing on close; post-close calls throw ClosedError separately.

No baseline retirement. Existing AgentExecutionCoordinator disappears only P28. Pseudocode 03-04, 09, 11-12, 15.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P03: Run model attempts, context management and budgets in agent-core

**Plan:** PLAN-20261112-AGENT-API.P03. **Dependencies:** P02. **Magnitude:** 2,600-4,000 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Assemble ready createAgent for the supported in-memory model path; implement one-attempt streaming, explicit retry/fallback, context lifetimes, compaction, loop limits and usage reservations. Incrementally connect tools/policy/journal in following slices before host adoption. No legacy ChatSessionFactory or client ownership enters the package.

Implement the Provider replay and attempt accounting decision and D16 recovery admission. Keep replay provisional until finish, scope-filter history on request construction and track measured usage separately from reservation charges. Invoke afterTurn at a candidate done boundary, within the same turn, using D17 AfterTurnView.

### Packages and files

**New:** packages/agent-core/src/create-agent.ts, src/loop.ts, src/model-attempt.ts, src/context.ts, src/budget.ts, src/loop.test.ts, src/context.test.ts. **Modify:** packages/agent-core/index.ts, src/mailbox.ts, src/testing/fake-ports.ts. **Read:** packages/agents/src/core/agenticLoop/AgenticLoop.ts, packages/agents/src/core/ChatSessionFactory.ts, packages/providers/src/IProvider.ts.

### Public contract

createAgent(definition, host, start?, signal), ModelSelection, ModelClient, ModelChunk, ModelError, Usage, Limits, ContextStrategy; submit returns Turn and result resolves to an outcome, never rejects for turn failure.

### Tests first

Text/thinking remain provisional until finish; partial failing attempt is discarded before retry/fallback and its tool fragments never dispatch. Retry-after and abortable backoff; unsupported fallback modality/context skips that candidate; missing price with cost budget fails creation. Compaction occurs only at preparation and is charged; next-turn context expires, until-replaced context replaces by ID, untrusted context stays data. Timeout aborts without waiting for a boundary. S9.4 final text plus queued steer causes another step. All retries, compaction and reasoning count toward reservations; overshoot is reported.

Use early input/cache usage followed by truncation, cancellation after usage, cumulative repeated reports, complete error accounting, incomplete successful finish and sent-but-unreported failure. Assert exact measured totals and conservative charges independently; a failed attempt can exhaust the budget and prohibit retry. Prove no tool executes from discarded fragments/replay. Recovery consumes a normal attempt, cannot cross fallback scopes, honors abort, and cannot repeat the same repair. A continuation retains committed output and shares the original deadline/steps/budget; cancelled/failed/limit candidates cannot continue.

Conformance sequence: an initial 400 image-dimension error, a retryable transport failure on the repaired successor, then a further core-admitted retry. Assert every later payload stays repaired using core-retained validated instructions, without an adapter cache or another repair cycle; each stream call issues at most one generation, and usage is charged once per attempt. Cancellation or exhausted limits, including maxAttempts and budgets, must prevent the final send. Verify retained reconstruction state is cleared at logical-request end or scope incompatibility.

### Exit criteria

Model-only input to final transcript/result works through real core and scripted ports. Creation rejects invalid capabilities and failed resolve without publishing an agent. No silent provider defaults or duplicate retry owner.

One finish commits one model entry with replay. Usage survives content discard without duplicate accounting. Core admits every generation send and continuation, and emits one terminal turn result after continuation ends.

### Deletions

None in old runtime; identified replacement targets remain until P28.

### Risks

Unaccounted failed-attempt usage and compaction tokens; conflating continuation with retry; drift between estimated and actual provider context. Optional capability absence must have explicit semantics.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/loop.test.ts packages/agent-core/src/context.test.ts; all earlier core suites; fake-clock deadline and generated budget traces.

No baseline entries retire yet. The old ChatSessionFactory/chat-system-prompt/client entries are assigned to P28, not removed because equivalent new code exists. Pseudocode 01-07, 11-12.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P04: Schedule prepared tools with pinned catalogs and bounded output

**Plan:** PLAN-20261112-AGENT-API.P04. **Dependencies:** P03. **Magnitude:** 1,800-2,800 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Add tool preparation, committed-call dispatch, immutable per-turn catalogs, ordered parallel/exclusive segments, revocation and output limits. Use the real scheduling component and in-memory tools; integrate policy in P05. Cross-agent resource locks stay in host executors.

### Packages and files

**New:** packages/agent-core/src/tools.ts, src/scheduler.ts, src/bounded-output.ts, src/tools.test.ts, src/scheduler.test.ts. **Modify:** packages/agent-core/src/loop.ts, src/testing/fake-ports.ts. **Read:** packages/tools/src/tools/tools.ts, packages/agents/src/session/turn-tool-execution-owner.ts, packages/agents/src/core/coreToolScheduler.ts.

### Public contract

ToolSet, ToolHandle, ToolDescriptor, PreparedCall, PreparedToken, ToolOutcome, ToolContext, BoundedWriter, ToolResult and tool-related AgentEvents; scheduling helpers remain private.

### Tests first

Unknown/unpinned IDs get results without executing. Exclusive A before parallel B/C before exclusive D preserves segment ordering even when A awaits a decision in the later integrated fixture. Per-call/per-step caps handle multibyte content and all truncation strategies; writer refuses excess before accumulation. Mid-turn additions appear next turn; revocation aborts running work and marks pending work not-run/revoked. S9.4/S16.3 cancel waits for running effects, preserves their actual result and prevents next-turn mutation.

### Exit criteria

Every proposed call has one terminal transcript result; only committed attempts dispatch. No progress data enters history; bounded acquisition is part of handle contract, not only final string slicing.

### Deletions

None yet; old scheduler and tool channel remain for unswitched hosts.

### Risks

Aborting an adapter does not undo effects; preserve partial-effect outcomes. Metadata from untrusted MCP descriptions must never control concurrency.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/tools.test.ts packages/agent-core/src/scheduler.test.ts; earlier core suites; deterministic latches instead of sleeps.

No baseline entries retire. Pseudocode 05, 08, 10-12.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P05: Evaluate authority, preferences and typed decisions in agent-core

**Plan:** PLAN-20261112-AGENT-API.P05. **Dependencies:** P04. **Magnitude:** 2,600-4,000 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Implement the fixed authority/grant/preference ordering, decision lifecycle, edited/stale approval, plan mode and built-in ask_user/propose_plan. Add constrained interceptor execution at policy-sensitive points; host hook translation comes later.

Implement the Policy source translation and rejection matrix core responsibilities: destructive hard deny as built-in shell authority, parsed-prefix matching, per-segment compound evaluation and redirection/parse-failure ask floors. Source loading and Q3 decisions remain P16. No PolicyEngine call in a ToolHandle.

### Packages and files

**New:** packages/agent-core/src/policy.ts, src/decisions.ts, src/interceptors.ts, src/policy.test.ts, src/decisions.test.ts, src/testing/turn-scenarios.ts. **Modify:** src/loop.ts, src/tools.ts, src/mailbox.ts under packages/agent-core. **Read:** packages/core/src/policy/policy-owner.ts, packages/policy/src/policy-engine.ts, packages/policy/src/confirmation-bus/message-bus.ts.

**Move pure behavior into new core modules:** packages/policy/src/destructive-commands.ts, destructive-credentials.ts and destructive-forkbomb.ts with their regression cases; update the old policy engine to import the one shared pure classifier through an explicit agent-core safety export, not a re-export shim. **Read:** packages/policy/src/types.ts, toml-loader.ts, utils.ts and utils/shell-utils.ts. Add packages/agent-core/src/shell-policy.test.ts; document the narrow pure safety export in public-surface checks.

### Public contract

PolicyDocument, PolicyLayer, PolicyRule, Grant, GrantScope, DecisionRequest, ResponseFor, Unavailable, DecidedBy; policy commands and built-in interaction tools, without extra Agent methods.

### Tests first

Complete S9.1, S9.2 and S9.3 plus S16.1 authority against grants and S16.4 stale previews. Realpath and parsed command-prefix matching cannot be bypassed by text prefixes or missing args. Edited approval prepares and checks again without an approval loop; stale execute requires a fresh ask. Headless tools absent and denied at dispatch; plan mode rejects headless. Policy changes re-evaluate waiting decisions; turn/session grant expiration differs. Interceptor timeout reports continue as specified; patch revalidates and redaction preserves audit raw data when store supports blobs.

Table-driven/property tests cover every matrix row that core evaluates: restrictive authority beats admin/user allows and YOLO; ordered preference ties; deny in later compound/pipeline segments; whole-token prefixes; directory preservation; redirection ask; parse-error ask; missing shell facts fail fast; edits re-prepare. Reuse destructive classifier regressions as pure input tests, never execute those commands. Invalid source features are P16 tests rather than a second runtime evaluator.

### Exit criteria

All three decision scenarios produce ordered audit events, consistent tool results and correct outcomes. Authority denial never reaches execute under any preference mode or child grant.

Non-bypassable restrictions apply even after set-authority, exact grants and user-mode changes. Audit events identify the built-in shell restriction and the matched source rule. Existing authority ordering remains unchanged.

### Deletions

No old policy bus removal yet; new handles must not delegate decisions to it.

### Risks

Grants broader than offered scopes; mixing credential prompts with tool decisions; treating unavailable as ordinary denial; reentrant port callbacks.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/policy.test.ts packages/agent-core/src/decisions.test.ts packages/agent-core/src/shell-policy.test.ts; all completed S9/S16 cases and generated authority/grant combinations.

No baseline entries retire until legacy policyComposition is deleted P28. Pseudocode 08-12.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P06: Publish ordered events, atomic snapshots and replay cursors

**Plan:** PLAN-20261112-AGENT-API.P06. **Dependencies:** P05. **Magnitude:** 1,000-1,600 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Complete the event stream and snapshot contract with exclusive cursors, bounded replay/subscriber buffers and turn filtering. No host callback pushes state into the agent.

### Packages and files

**New:** packages/agent-core/src/events.ts, src/snapshot.ts, src/events.test.ts. **Modify:** packages/agent-core/src/create-agent.ts, src/loop.ts, src/decisions.ts. **Read:** packages/agents/src/api/event-types.ts and packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts.

### Public contract

Agent.events({after?}), Agent.snapshot(), Sequence, CursorExpired, Lagging; event discriminants from design section 4. No field-level getters.

### Tests first

S16.7 expired cursor: snapshot plus after cursor gives no duplicate/gap under a concurrent transition. Slow reader gets Lagging without stalling a fast reader or model. Replay retains current turn even beyond ordinary window; progress coalesces. Every turn-scoped event has turn ID. Attempt discard removes only that attempt in a test view reducer; state.changed is absent for ordinary text deltas.

### Exit criteria

Operational snapshot is internally consistent with its cursor and does not duplicate transcript content. Iterator completion semantics are ready for P09.

### Deletions

None; host event reducers migrate with their hosts.

### Risks

Unbounded replay of very large current turns is permitted by the design window rule; measure bytes and document this scope rather than dropping required events. Subscribers must not retain full duplicated transcripts.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/events.test.ts; completed scenario event-sequence assertions; property interleavings.

No baseline entries retire. Pseudocode 03, 13.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P07: Journal turns and recover without repeating uncertain effects

**Plan:** PLAN-20261112-AGENT-API.P07. **Dependencies:** P06. **Magnitude:** 2,000-3,200 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Implement append-before-effect journal semantics, checkpoint consistency, transcript, resume, fork and rewind. Persist sequence allocation metadata and distinguish abandoned branches. The physical store follows P14.

Persist D14 committed replay and D15 reserved/settled attempt accounting, plus D16 recovery invalidation facts. History remains agent-owned and restart never needs a provider conversation cache.

### Packages and files

**New:** packages/agent-core/src/journal.ts, src/recovery.ts, src/transcript.ts, src/journal.test.ts, src/recovery.test.ts. **Modify:** packages/agent-core/src/create-agent.ts, src/tools.ts, src/events.ts, src/testing/fake-ports.ts. **Read:** packages/core/src/recording/types.ts, ReplayEngine.ts, RecordingIntegration.ts and packages/agents/src/api/control/sessionControl.ts.

### Public contract

JournalRecord and durable metadata, CheckpointId, TranscriptEntry, StoreError; Agent.transcript(range), createAgent resume/fork options, rewind/clear commands.

### Tests first

S16.5 crash after tool-started becomes indeterminate without repeated file effects. Unfinished turn closes cancelled/closing; pending decision is not reissued. Restore session grants only under current authority, drop turn grants. Failed append prevents dispatch and ends the turn failed; creation load/corruption fails typed. Rewind never creates unmatched calls; compacted-range rewind rejects; fork preserves source and yields independent identity. Resume increases event sequence above persisted watermark. No-store resume/fork fails explicitly.

Resume/fork/rewind preserve replay targets and bytes at retained checkpoints; compaction does not inherit signatures. Crash after reservation settles it conservatively without resend. Duplicate usage records cannot inflate totals. A rejected parent recorded before retry stays invalid after restart. A discarded attempt contributes accounting but neither transcript content nor replay.

### Exit criteria

Fault-injected MemorySessionStore demonstrates recovery at every record boundary and does not hide append failures. Complete transcript and checkpoint tests before physical store implementation.

Schema versions, checkpoint replay references, usage completeness and abandoned branch handling are validated before an agent is published.

### Deletions

None yet; do not reuse old RecordingIntegration as the journal.

### Risks

Persisting every event versus reserving sequence ranges has different write costs; choose and test a durable watermark strategy. Legacy transcript migration remains Q2.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/journal.test.ts packages/agent-core/src/recovery.test.ts; all scenario suites; property crash-point and rewind traces.

No baseline entries retire. Core recording ownership is replaced only at host cutover/final cleanup. Pseudocode 02, 10-14.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P08: Run turn-owned subagents with intersected policy and budgets

**Plan:** PLAN-20261112-AGENT-API.P08. **Dependencies:** P07. **Magnitude:** 1,400-2,200 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Add template-defined children as policy-controlled start_subagent calls. Children borrow filtered ports and have independent sessions, decisions tagged with child identity and shared parent-turn budget reservations.

### Packages and files

**New:** packages/agent-core/src/subagents.ts, src/subagents.test.ts. **Modify:** packages/agent-core/src/definition.ts, src/tools.ts, src/scheduler.ts, src/budget.ts, src/policy.ts. **Read:** packages/agents/src/core/subagentOrchestrator.ts, packages/agents/src/api/child-agent-assembly.ts, packages/agents/src/session/task-launch-owner.ts.

### Public contract

SubagentTemplate, ChildSummary, child.started/child.finished, built-in start_subagent; no detached-child API.

### Tests first

S16.6 competing children reserve one shared budget; excess actual usage stops parent. Parent ask plus child allow still asks; parent grant does not grant extra child tools; child grant stays local. Parent policy changes reach running children next evaluation. Parent tool pin intersects template IDs, maxParallelChildren bounds admission. Parent cannot complete before children settle. Cancel parent settles children and closes child sessions without closing shared ports.

### Exit criteria

Child usage appears once in parent totals, no permission widening, no orphan work after parent turn. Independent background work is deferred to a host-owned manager, not smuggled into this API.

### Deletions

None yet; legacy child assembly remains for old hosts until P28.

### Risks

Exclusivity across parent/children can deadlock if resource ownership is inconsistent. Treat nested scheduler ownership explicitly and test nested execution without allowing overlapping exclusive effects.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/subagents.test.ts; policy, budget, journal and scheduler suites.

No baseline entries retire yet; child-agent-assembly 21 sites assigned P28. Pseudocode 06, 08-12, 14-15.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P09: Finalize shutdown and complete the executable core scenarios

**Plan:** PLAN-20261112-AGENT-API.P09. **Dependencies:** P08. **Magnitude:** 900-1,500 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Complete idempotent close, independent work/finalization signals, owned-subscription cleanup and aggregated close reporting. Publish a fully usable core only after all sections 9/16 fixtures pass. Generate the HTML short scenario traces from the typed fixtures.

### Packages and files

**New:** packages/agent-core/src/close.ts, src/close.test.ts; scripts/generate-agent-api-scenarios.ts. **Modify:** packages/agent-core/src/create-agent.ts, src/testing/turn-scenarios.ts; project-plans/issue3980/agent-api-design.html (generated scenario data only during implementation). **Read:** packages/agents/src/session/session-client-cleanup.ts and packages/agents/src/api/fromConfig-cleanup.ts.

### Public contract

Agent.close({finalizeTimeoutMs?}): Promise<CloseReport>; CloseReport lists cancelled work, port failures and finalization completion; same promise returned for every close call.

### Tests first

Complete S9.5 close during pending decision and rerun all five S9 scenarios plus seven S16 scenarios. Close during model resolve/tool/interceptor/child; already-started operations settle after abort. Every accepted queued command promise fulfills with { status: 'rejected', reason: 'closing' }; assert allSettled reports fulfilled for every one and no unhandled rejection occurs. Calls made after closing begins separately throw ClosedError at admission, before BusyError. Store finalization uses an un-aborted separate signal and obeys deadline. Failures do not skip later finalization steps. turn.completed precedes closed state then agent.closed; all iterators end. Borrowed model/catalog/store ports remain usable by a sibling agent.

### Exit criteria

All core scenarios and fake-port conformance pass; no unsupported-runtime stubs, skipped tests or unjoined work. Explicitly document that a non-conforming port which ignores abort cannot be safely force-killed by core; conformance fails that adapter.

### Deletions

None in old hosts. Remove any temporary internal assembly placeholders introduced while building core.

### Risks

Confusing finalization deadline with permission to release a still-running side effect; unhandled failures in cleanup. A host must not close a port before core joins its work.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core; generated scenario drift check; all fake-port conformance suites.

No baseline entries retire. Pseudocode 15-16, 19.

### PR

One short-lived PR from current main. Implement the numbered pseudocode range above after the failing integration and behavior tests. Record red/green evidence and the semantic result. Title/body: `Refs #3980`; body: `Fixes #<this-slice-issue>`. Use `Refs #4037` when changing its baseline. Do not merge failing intermediate commits or close #3980 here.

## P10: Probe adapter feasibility before building host-kit

**Plan:** PLAN-20261112-AGENT-API.P10. **Dependencies:** P09. **Magnitude:** 1,100-1,800 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

This is the first host-kit slice and an executable go/no-go gate. Establish the package and reusable port-conformance harness, then test the exact dependency cuts in the feasibility census. No host switch and no whole-session facade. Record retained versus replaced behavior and measured allocation/abort limits.

### Packages and files

**New:** packages/host-kit/package.json, index.ts, tsconfig.json, src/conformance/model-port.ts, tool-catalog.ts, session-store.ts, diagnostics.ts, decisions.ts, interceptors.ts and source-builder.ts under src/conformance; src/adapter-feasibility.test.ts. **Modify:** package.json, package-lock.json, bun.lock, tsconfig.json, scripts/test-shards.ts, scripts/affected-test-shards.data.json, scripts/runtime-entry-manifest.ts, scripts/check-runtime-state-boundary.ts. **Probe existing:** packages/providers/src/ProviderManager.ts, IProvider.ts, runtimeNormalizer.ts, composition/providerManagerInstance.ts; packages/core/src/config/toolRegistryFactory.ts; packages/mcp/src/client/mcp-callable-tool.ts; packages/core/src/recording/SessionRecordingService.ts.

**Probe also:** packages/providers/src/anthropic/AnthropicProvider.ts, AnthropicProviderInternals.ts, AnthropicStreamProcessor.ts and AnthropicMessageNormalizer.ts; packages/providers/src/openai-responses/openAIResponsesExecutor.ts, openAIResponsesStreaming.ts, openAIResponsesWebSocketTransport.ts and OpenAIResponsesInputBuilder.ts; packages/providers/src/openai/OpenAIClientFactory.ts; packages/providers/src/openai-vercel/vercelRequestParams.ts; plugins/google-gemini/src/gemini/geminiResponseMapper.ts and its transport/client construction. Inventory SDK configuration on every dispatch route, including plugins and credential failover.

### Public contract

Conformance factory contracts only, including create-fixture/dispose for external test infrastructure. No replacement Agent API. Probe any necessary extraction behind explicit typed inputs rather than Config-shaped objects.

### Tests first

Real provider serializer against local HTTP streams text/tool fragments then failure; actual attempt count is visible and cancellation settles. Real file edit preparation leaves bytes unchanged, stale precondition stops write. MCP local server discovery/revocation/abort and oversized result are bounded. Physical store append failure prevents tool execution; restart identifies a started call as uncertain. Two sibling agents can share adapters and one close does not close the other.

Run real-converter model/tool/model round trips with signed/redacted thinking, encrypted reasoning and genuine IDs, and Gemini AFC metadata. Recreate clients after journal reload; repeat after fork and model/endpoint/principal/connection changes. Controlled HTTP/WebSocket fixtures trigger image-dimension recovery, rejected parent, renewal/fallback, 429/5xx and truncated streams. Assert actual generation requests per core attempt, early-usage retention and repaired request payloads, including zero successor sends when abort/limits prohibit them.

Conformance sequence: an initial 400 image-dimension error, a retryable transport failure on the repaired successor, then a further core-admitted retry. Assert every later payload stays repaired using core-retained validated instructions, without an adapter cache or another repair cycle; each stream call issues at most one generation, and usage is charged once per attempt. Cancellation or exhausted limits, including maxAttempts and budgets, must prevent the final send. Verify retained reconstruction state is cleared at logical-request end or scope incompatibility.

### Exit criteria

Written feasibility evidence for all four subsystems, no Config or session owner crosses core, and no hidden retry/decision engine in ports. If most of any subsystem must be replaced, stop adapter implementation and report the Rust trigger with evidence; do not introduce a compatibility layer. Otherwise keep the conformance harness and move proven cuts into P11-P14.

The extraction report includes all internal recovery branches and SDK/transport failover from the census, not just removal of RetryOrchestrator. A single hidden resend or lost replay/failed usage blocks P11. Separate measured HTTP/WebSocket generation sends from credential refresh/handshake traffic.

### Deletions

Only throwaway probe scaffolding if replaced by conformance fixtures in the same PR; do not delete legacy production before consumers switch.

### Risks

Lexical zero Config imports in MCP/storage can hide legacy assembly coupling. Simulated fsync cannot prove physical durability; process-kill tests and OS flush semantics must both be addressed.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/adapter-feasibility.test.ts; existing provider/tool/MCP/recording regression suites for any extraction touched; all core scenarios.

No baseline entries promised to retire; structural extractions remove any findings only if the underlying declarations actually disappear. Add host-kit to scanner discovery; no host-kit-to-host or host-kit-to-agents import. Pseudocode 17-19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P11: Adapt provider attempts and authentication to ModelPort

**Plan:** PLAN-20261112-AGENT-API.P11. **Dependencies:** P10 passed. **Magnitude:** 2,800-4,600 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Implement explicit per-model clients over existing provider transports/auth. Separate configuration/selection from provider construction, remove Config/SessionSettingsOwner requirements at the census seams, and give the core one model attempt at a time. Shared fixes apply to both old and new callers while both exist.

Complete the single-dispatch cuts in the Provider-internal recovery census; all provider-specific reconstruction is pure data from core history plus scoped ModelRecovery. Preserve existing legacy recovery behavior by shared primitive extraction, not by routing new calls through legacy orchestration.

### Packages and files

**New:** packages/host-kit/src/models/provider-model-port.ts, provider-model-port.test.ts, model-values.ts. **Modify:** packages/providers/src/ProviderManager.ts, IProviderManager.ts, BaseProvider.ts, LoggingProviderWrapper.ts, providerCapabilitiesService.ts, runtimeNormalizer.ts, auth/types.ts, composition/providerManagerInstance.ts, composition/aliasProviderFactory.ts, composition/runtimePlugins/types.ts; plugins/google-gemini/src/index.ts; actual callers in packages/agents/src/api/agentRuntimeAssembly.ts. **Read:** packages/providers/src/RetryOrchestrator.ts and retry\*.ts.

**Modify/extract also:** packages/providers/src/anthropic/AnthropicProvider.ts, AnthropicProviderInternals.ts, AnthropicStreamProcessor.ts, AnthropicMessageNormalizer.ts; packages/providers/src/openai-responses/openAIResponsesExecutor.ts, openAIResponsesStreaming.ts, openAIResponsesWebSocketTransport.ts, OpenAIResponsesInputBuilder.ts; packages/providers/src/openai/OpenAIClientFactory.ts; packages/providers/src/openai-vercel/vercelRequestParams.ts; plugins/google-gemini/src/gemini/geminiResponseMapper.ts and client construction identified in P10. Add provider-replay and internal-recovery conformance fixtures under packages/host-kit/src/models.

### Public contract

providerAdapters(explicitProviderInputs): ModelPort; host-owned provider catalog/auth and utility generation operations with explicit arguments. ModelClient.info/stream/countTokens/price and typed ModelError are the only conversation-facing capability.

### Tests first

Run ModelPort conformance for each provider family and Google plugin using real converters/transports against controlled HTTP. Assert prompt roles, tool IDs, image/audio mapping, system prompt preservation, resolved model/endpoint, token totals, partial-attempt discard, abort settlement, auth/quota/rate-limit/overloaded taxonomy and retryAfterMs. Re-auth permits a later submit without injecting credentials into definition/events. Two agents with different profiles cannot leak model params or credentials. Bucket failover must not hide extra model requests.

Repeat the P10 replay matrix with the production adapter: model/tool/model, process-style client recreation after resume, fork, switching away and back, changed endpoint/principal, expired connection parent, compaction and truncated attempts. Assert outgoing native signed thinking/encrypted items/IDs/AFC fields, not just envelope equality. Early usage then error/cancel must reach core and block an over-budget retry. Trigger image and parent repairs plus SDK 429/5xx and WebSocket fallback, observing at most one generation per stream call. Legacy caller regression fixtures prove shared extraction did not remove their recovery.

Conformance sequence: an initial 400 image-dimension error, a retryable transport failure on the repaired successor, then a further core-admitted retry. Assert every later payload stays repaired using core-retained validated instructions, without an adapter cache or another repair cycle; each stream call issues at most one generation, and usage is charged once per attempt. Cancellation or exhausted limits, including maxAttempts and budgets, must prevent the final send. Verify retained reconstruction state is cleared at logical-request end or scope incompatibility.

### Exit criteria

One core attempt corresponds to one visible provider generation attempt. All available provider families pass the shared conformance matrix or block adoption, not silently disappear. Provider wrapper settings inputs are explicit and do not require a session owner.

D14-D16 schemas reject malformed matching-scope replay/recovery with typed errors, preserve required system prompts and never put credentials in journal/events. No provider-owned conversation/recovery cache on the new route; only connection/auth lifecycle state stays in adapters.

### Deletions

Remove Config constructor/setter alternatives once both current callers use explicit inputs. Old RetryOrchestrator remains only for legacy execution until P28; new route cannot invoke it. No renamed Config facade.

### Risks

Provider-native prompt envelopes and credential-bucket rotation are richer than the displayed ModelPort. Reuse conversion/auth code and surface attempts/usage rather than duplicating retry state. Price and modality support must reflect real capabilities.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/models; existing packages/providers tests and plugins/google-gemini tests; core model-attempt suites and real local HTTP smoke.

Existing provider module-mutation entries are not automatically removed by this adapter. Retire only exact findings eliminated by explicit owner extraction; otherwise retain under #4037. Pseudocode 02, 06-07, 17, 19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P12: Adapt builtin tools with effect-free preparation and resource locks

**Plan:** PLAN-20261112-AGENT-API.P12. **Dependencies:** P11. **Magnitude:** 2,500-4,000 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Implement workspaceCatalog from real builtin tool operations. Remove Config and old confirmation dependencies from shared tool composition, assign host-trusted effect/concurrency metadata, and enforce prepared-token preconditions at execution. Keep filesystem, shell, sandbox, IDE/LSP, memory and network execution in host-kit-backed adapters.

Include trusted shell preparation and TodoRead/TodoWrite/TodoPause. Shell preparation emits facts bound to final args/token; no approval or destructive-policy evaluator runs in prepare/execute. Todo failures remain typed error outcomes, and a pause is successful only after its durable task-store write.

### Packages and files

**New:** packages/host-kit/src/tools/workspace-catalog.ts, prepared-call.ts, resource-locks.ts, workspace-catalog.test.ts. **Modify:** packages/core/src/config/toolRegistryFactory.ts; packages/core/src/tools-adapters/CoreToolHostAdapter.ts, CoreShellToolHostAdapter.ts, CoreToolRegistryHostAdapter.ts; packages/tools/src/tools/tools.ts, edit.ts, write-file.ts, shell.ts and any invocation whose preview currently mutates; packages/tools/src/interfaces/IToolHost.ts, IToolRegistryHost.ts; packages/tools/src/tools/tool-registry.ts. Inventory any additional touched invocation at slice preflight; do not copy tool implementations.

**Modify/extract also:** packages/tools/src/tools/todo-read.ts, todo-write.ts, todo-pause.ts, todo-store.ts and reusable shell parsing helpers. Add task-tool and shell-fact cases to workspace-catalog.test.ts; keep parsing separate from permission decisions.

### Public contract

workspaceCatalog(explicitWorkspaceInputs): ToolCatalog; immutable ToolDescriptor/ToolHandle; host executor lifecycle close remains separate. Prepared tokens bind final args plus file preconditions; resource-lock acquisition is abortable.

### Tests first

Run ToolCatalog conformance against read, write/edit, AST edit, shell, memory, web and image families. Preparation cannot modify files or spawn processes; edited args re-prepare. Symlink target/realpath changes invalidate approval. S16.4 stale preview never applies old edit. Shell abort waits for process settlement, output cap prevents retained-byte growth, exclusive resources serialize separate agents. Malformed input and revoked capability return typed errors. No ToolHandle can ask a human or bypass core policy.

Parsed argv/segments/redirection match actual final shell args and update after edits. A later compound segment cannot escape core policy. Task-list writes preserve pause, invalid reason/write failure yields error rather than successful pause, and cancellation settles before state can change after return. P17 consumes only these typed outcomes and the task store.

### Exit criteria

Core plus real tools executes S9.1, cancellation and stale-approval cases in a temporary workspace. Known tool classes all have explicit descriptors; unknown classes fail registration rather than inheriting permissive metadata. Old and new consumers share extracted tool operations.

### Deletions

Remove Config dependencies at CoreShellToolHostAdapter/toolRegistryFactory by migrating all callers to explicit options. Remove per-tool confirmation work only where the old scheduler can consume the same extracted preparation without changing behavior. Legacy bus bridge is deleted at P28.

### Risks

Tools currently combine preview and confirmation in ToolInvocation.shouldConfirmExecute. Extract genuine pure preparation; do not auto-approve inside the adapter. Shell summaries that invoke models must be explicit host utilities or core-budgeted work, not unaccounted nested generations.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/tools; packages/tools behavior suites; core tool-adapter and filesystem/trust tests; actual shell process fixture with bounded output.

No blanket baseline removal from tools/core. Retire only removed declarations and preserve unrelated shell-parser/shellJobTail state for #4037. Pseudocode 05, 08-10, 17, 19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P13: Adapt MCP discovery, execution, revocation and content

**Plan:** PLAN-20261112-AGENT-API.P13. **Dependencies:** P12. **Magnitude:** 1,500-2,500 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Build MCP catalog/connection ownership separately from builtin tool preparation. Reuse McpClientManager and SDK transport; replace session-owner publication and legacy policy callbacks. Fetch prompts/resources in host-kit and turn them into content.

### Packages and files

**New:** packages/host-kit/src/mcp/mcp-catalog.ts, mcp-content.ts, mcp-catalog.test.ts. **Modify:** packages/mcp/src/host/hostInterfaces.ts, client/mcp-client-manager.ts, client/mcp-tool.ts, client/mcp-callable-tool.ts; reusable composition extracted from packages/agents/src/api/mcpRuntimeAssembly.ts and mcpRuntimePorts.ts. **Read:** packages/agents/src/session/session-tool-catalog-owner.ts.

### Public contract

mcpCatalog(explicitMcpInputs): ToolCatalog; composeToolCatalogs(catalogs); fetchMcpPrompt and fetchMcpResource returning UserInput/ContentPart values. Connections and authentication remain host-owned.

### Tests first

ToolCatalog conformance against a real local MCP fixture: duplicate server tool names cannot collide, descriptors are versioned and conservative despite malicious annotations, pin is stable during rediscovery, disconnect/trust withdrawal aborts sets and rejects pending decisions, running calls settle aborted/revoked. Large aggregate content respects acquisition limits, transport error stays typed, resources remain untrusted context. Reconnect appears only on next pin. Abort during connect or discovery cleans up unpublished sessions.

### Exit criteria

No new-path McpApprovalPolicy decides execution; core is the sole policy evaluator while transport authorization remains enforced. Two agents share connections without sharing session grants. Standalone MCP distribution still works.

### Deletions

Remove legacy session-client identity coupling only once old callers use the extracted host connection owner; old mcpRuntimeAssembly disappears P28. Do not duplicate transports.

### Risks

SDK response materialization may allocate before adapter sees content; P10 measurements determine transport cap work. A post-hoc truncate is not sufficient. OAuth/server lifetime must outlive borrowing agents.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/mcp; packages/mcp suites; npm run test:mcp:distribution; npm run build:packages and verify-lazy-mcp-build-coherence checks.

MCP has zero direct Config imports and no current widened baseline findings; do not claim a numerical reduction for merely adding its adapter. Pseudocode 05, 08-10, 17-19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P14: Implement durable SessionStore over storage primitives

**Plan:** PLAN-20261112-AGENT-API.P14. **Dependencies:** P13. **Magnitude:** 2,000-3,200 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Implement a versioned physical journal store and blob operations with durable append, explicit errors, bounded acquisition and exclusive writer ownership. Reuse storage path/media/lock mechanisms after extracting their owner-neutral inputs. Keep legacy logging distinct from the agent journal.

Store D14-D16 replay/accounting/recovery records losslessly. Expose task snapshot blob/index operations so P17 can bind todo/pause snapshots to core checkpoints and fork a separate task namespace without aliasing the live source file.

### Packages and files

**New:** packages/storage/src/journal/journal-file.ts, journal-file.test.ts; packages/host-kit/src/store/journal-store.ts, journal-store.test.ts. **Modify:** packages/storage/index.ts; reuse or relocate mechanisms from packages/core/src/recording/SessionLockManager.ts, packages/core/src/storage/SessionPersistenceService.ts and session-media-owner.ts. **Read:** packages/core/src/recording/SessionRecordingService.ts, ReplayEngine.ts, CheckpointService.ts; packages/storage/src/conversation/ConversationFileWriter.ts.

### Public contract

journalStore(explicitStoreInputs): SessionStore plus separate host-owned close/index/retention operations. Storage package deals in opaque versioned record bytes and media, not imported agent-core state or Config.

### Tests first

SessionStore conformance: acknowledged append survives process termination/reopen; fail writes/sync and verify no acknowledgement; truncated final record vs interior corruption; concurrent append ordering and writer-lock conflict; aborted queued I/O settles; blob publication/refcounts survive cancellation. Drive S16.5 through a real store and real tool effect, kill between durable start and finish, resume indeterminate without repeating. Fork leaves source bytes unchanged and sequence advances on resume.

Run real provider converters through a physical-journal model/tool/model round trip, close/reopen with fresh adapters, resume and fork. Verify signed thinking, encrypted reasoning/IDs and AFC metadata on the next native request; mismatched scopes are excluded, compacted text never inherits signatures, and source branch bytes remain unchanged. Crash/resume preserves conservative failed-attempt charges and rejected-parent invalidation. Capture task-state snapshots by checkpoint and prove fork mutation/pause cannot modify source task state.

### Exit criteria

File and directory flush strategy documented for supported OSes; durable acknowledgement has explicit platform semantics. Corrupt/unknown versions fail with StoreError. Q2 disposition is recorded before host session resume is enabled. Old journal format is never silently treated as a new conversation.

Physical durability covers replay and accounting as well as tool-started records. No recovery path reads a provider-local conversation cache or the source session live todo file when forking an older checkpoint.

### Deletions

No immediate recorder deletion while old hosts use it. Remove duplicate storage ownership after host migration, retaining diagnostic logging if it has readers.

### Risks

fsync/directory durability differs across OSes; external filesystem failure is valid typed failure, not a fallback to in-memory success. SessionStore.load currently returns an array, so record-count memory use remains a design limit to measure, not a promise of streaming history.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/storage/src/journal packages/host-kit/src/store; existing recording/replay/lock/media suites; process-kill and disk-error fixtures on supported CI platforms.

Existing storage baseline entries remain unless the specific mechanism is actually replaced. No wholesale baseline reset. Pseudocode 02, 10, 13-14, 16-19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P15: Route diagnostics through one host-owned sink

**Plan:** PLAN-20261112-AGENT-API.P15. **Dependencies:** P14. **Magnitude:** 700-1,200 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Implement push-only diagnostics over telemetry with root-owned redaction, debug filtering, bounded buffering and explicit host flush/close. Model/tool adapters use the same host diagnostics root. Core never queries telemetry or logging preferences.

### Packages and files

**New:** packages/host-kit/src/diagnostics/diagnostic-sink.ts, diagnostic-sink.test.ts. **Modify:** packages/telemetry/src/debug/ConfigurationManager.ts, DebugLogger.ts, FileOutput.ts only where explicit ownership requires it; packages/providers/src/LoggingProviderWrapper.ts. **Read:** packages/telemetry/src/perf/perfConsumer.ts and perfRecords.ts.

### Public contract

debugSink(explicitDiagnosticInputs): DiagnosticSink; acquireDiagnosticSink returns sink and separate flush/close ownership, not a readable settings interface on the sink.

### Tests first

DiagnosticSink conformance: emit is synchronous, nonblocking and never throws even when the exporter fails; bounded overflow has observable host health counters. Debug off drops debug records, auth/secrets are redacted from nested records, agent/turn/attempt/child IDs survive. Two roots do not leak configuration. Flush/close failures are visible to host cleanup without converting successful agent behavior to fake diagnostics success.

### Exit criteria

Core has no DebugLogger import, debug boolean or telemetry getter. Exporter behavior is isolated infrastructure handling; no blanket catch around core execution.

### Deletions

Remove newly obsolete Config alternative in logging wrapper if not already removed P11; keep unrelated diagnostic utility consumers until P28 audit.

### Risks

Diagnostics can leak secrets through provider payloads. Never promise lossless export from a nonblocking bounded sink; distinguish diagnostics from durable journal records.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/diagnostics; packages/telemetry debug/perf owner-isolation suites; provider logging redaction tests.

Retain unrelated telemetry module-mutation baseline entries under #4037. Pseudocode 07-19 diagnostics at transitions.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P16: Load host sources and build closed AgentDefinition values

**Plan:** PLAN-20261112-AGENT-API.P16. **Dependencies:** P15; Q3 disposition required before shipping affected policies. **Magnitude:** 2,800-4,400 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Move shared settings/profile/argv/environment/trust resolution into host-kit, preserving observed precedence and profile/auth semantics. Separate pure definition building from source I/O and adapter acquisition. Include narrow host profile/session/catalog/IDE utility APIs needed by all four hosts; no new service locator.

Implement the full Policy source translation and rejection matrix, retaining provenance and all approval-mode presets. Translate getMaxSessionTurns into host-only HostAdmissionLimits, never maxStepsPerTurn; carry todo enablement into host continuation inputs.

### Packages and files

**New:** packages/host-kit/src/sources/load-host-sources.ts, build-definition.ts, profile-service.ts, source-precedence.test.ts, build-definition.test.ts. **Modify/extract:** packages/cli/src/config/configBuilder.ts, profileBootstrap.ts, settings.ts, cliArgParser.ts; packages/agents/src/api/profile-preflight.ts; packages/settings/src/settings/SettingsService.ts. **Read:** packages/core/src/config/configConstructor.ts, configTypes.ts, configBaseCore.ts and packages/zed-acp/src/zed-session-config.ts. CLI rendering/argv syntax stays at host entry; source resolution is shared.

**New:** packages/host-kit/src/sources/policy-translation.ts, policy-translation.test.ts and host-admission-limits.ts. **Read/extract loader mechanics:** packages/policy/src/toml-loader.ts, types.ts, utils.ts and stable-stringify.ts, plus actual saved approval sources in packages/core/src/policy/policy-owner.ts. Do not import PolicyEngine into host-kit execution.

### Public contract

HostSourceInput, HostSources, DefinitionSources, loadHostSources, buildDefinition; typed builders for approval preferences, trust authority, model selection and instructions. Profile save/delete/default/catalog operations stay on an explicit host profile service. A profile update creates a validated definition delta and sends permitted commands at their timing points.

PolicySourceError carries source kind/file/rule/field and a migration explanation. HostSources includes HostAdmissionLimits.maxSessionSubmits and built-in continuation options outside DefinitionSources. Source policy provenance never becomes credentials or mutable Config.

### Tests first

Source-builder conformance: system/user/project settings, profile and argv precedence match existing behavior; invalid profile/model/required limits fail before side effects; source cancellation releases acquisitions. No credentials, functions, environment objects or source paths in definition. Folder trust cannot be widened by YOLO or project settings. Same source fixture yields identical definition for CLI/ACP/a2a after explicit protocol differences. Profile change during active turn cannot rewrite request history. Skills/memory/IDE context respect trust and lifetime. Browser/profile management works before any agent exists.

Load real temporary admin/user/default TOML and persisted approval fixtures, then assert the definition or specific pre-creation error: argsPattern, commandRegex, allowRedirection true/false, priority ties and tiers, active/inactive mode filters, unsupported authority-mode filters and overlapping restriction exceptions. Exercise a compiled definition through real core on compound/redirection/deny scenarios. Invalid inputs cannot partially load or quietly revert to ask/allow. Distinguish session-submit ceiling from per-turn steps in the built sources.

### Exit criteria

Every Config/preflight group in mapping has a concrete owner; no AgentProfilePreflight is used by new hosts. All host-only settings remain usable without exposing them to core. Both old/new composition use shared extracted resolution where practical; no duplicated precedence logic.

Each matrix row is either exact under the approved authority ordering or rejected with provenance. Q3 disposition and default-policy migration are recorded before affected host switches. No implicit policy feature removal.

### Deletions

Delete moved pure resolution functions at old location and update old callers to new host-kit functions, not re-export shims. Leave legacy activation/Config assembly only for remaining old hosts until P28.

### Risks

Config is spread across four classes; transferring a giant getters object repeats the problem. Some legacy profile modes such as provider-side routing need explicit translation, not silent selection loss. Capture current behavior in tests before extraction.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/sources; CLI config/settings/profile precedence and startup tests; settings package tests; core definition validation.

profile-preflight baseline entry remains until P28. Do not create new service bags in host-kit or move existing baselined declarations there. Pseudocode 01-02, 17-19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P17: Adapt user hooks and built-in continuation without a host model loop

**Plan:** PLAN-20261112-AGENT-API.P17. **Dependencies:** P16; Q1 disposition recorded for unsupported mutations. **Magnitude:** 1,900-3,000 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Implement host hook execution and output validation for the six approved interceptor points. Event-only observers are subscriptions; session lifecycle hooks belong to host acquisition/close. Resolve the Q1 release behavior without expanding core hook authority.

Also implement mandatory built-in thinking-only/todo/reminder/pause continuation using D17 AfterTurnView and the Session admission and built-in continuation decision. User hooks disabled does not disable these built-ins. Share one afterTurn composition; it returns data, never drives another model request.

### Packages and files

**New:** packages/host-kit/src/hooks/hook-interceptors.ts, hook-interceptors.test.ts. **Modify:** packages/core/src/hooks/hookEventHandler.ts, hookRunner.ts, types.ts; shared extraction from packages/agents/src/core/beforeModelHookFire.ts and related hook helpers. **Read:** packages/agents/src/core/chatSession.issue1749.test.ts and packages/core/src/hooks/hookTranslator.ts.

**New:** packages/host-kit/src/hooks/builtin-continuation.ts, builtin-continuation.test.ts and continuation-composition.ts. **Read/extract pure reminder formatting:** packages/agents/src/core/TodoContinuationService.ts and MessageStreamOrchestrator.ts:657-765; task persistence comes from P12/P14, not imports of agents into host-kit.

### Public contract

hookInterceptors(explicitHookInputs): Interceptors; host observer subscription and session-start/session-end lifecycle helpers. No synthetic-response or arbitrary request-rewrite port is introduced.

builtinContinuation(explicitTodoStoreAndOptions): Interceptors plus a tested composition with user hooks. Inputs are AfterTurnView and bounded task-store data; no Agent reference, native history or submit callback. Hook ownership remains outside core, scheduling and budgets remain inside it.

### Tests first

Interceptor conformance: deadline/abort, block, addContext, patchArgs validation and policy re-evaluation, redaction preserves raw blob audit, afterTurn continuation bounded by turn limits. Real subprocess hook fixtures test malformed output and process cancellation. Session start fails before submit and still cleans up; session end failure does not skip other cleanup. Unsupported mutating outputs fail explicitly according to Q1 rather than disappearing.

With user hooks absent/disabled, pending/in-progress todos continue, thinking-only gets a concrete-action continuation, pending reminders survive no-active-todo cases, successful persisted pause stops and failed pause does not. Test three-pass bound, unchanged turn ID/budget/deadline, one terminal result, cancellation during todo read, no discard of prior committed text, explicit next-input unpause, restart with paused tasks, and checkpoint/fork task isolation. Task I/O errors fail visibly rather than manufacturing empty todos. User continueWith cannot bypass pause or reset limits.

### Exit criteria

All supported existing hook behaviors have externally meaningful tests on both paths while both exist. Unsupported behavior has a recorded product disposition and user-facing error/release note; no hidden engine override.

No continuation remains unmapped when old MessageStreamOrchestrator is deleted. Journal tool outcomes and task snapshots supply restart/fork state; host event subscribers do not race afterTurn to infer pause.

### Deletions

Remove transferred supported hook execution code from the old composition when shared callers use new implementation. Old mutation-only integration is deleted with old engine at P28 once Q1 authorizes disposition.

### Risks

Old hooks intentionally override model responses; mapping them to afterTool would change their meaning. Deadline-as-continue is explicitly approved behavior, not permission to swallow malformed or denied hook results.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/hooks; builtin-continuation and checkpoint/task-fork suites with user hooks disabled; existing hooks package/core suites; S9.1/S9.5, hook blocking and continuation cases.

No guaranteed baseline reduction; current chat-system-prompt service-bag remains P28. Pseudocode 05-12, 15-19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P18: Manage background agents and borrowed host resources explicitly

**Plan:** PLAN-20261112-AGENT-API.P18. **Dependencies:** P17. **Magnitude:** 1,200-2,000 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Provide host-owned background agent/job management, cancellable input queues and shared-adapter lifetime management. Keep separate agents independent of turn-owned core children. Replace auto-trigger callbacks that reach old clients with explicit host input policy.

### Packages and files

**New:** packages/host-kit/src/background/background-agents.ts, background-agents.test.ts, src/lifecycle/host-session.ts, host-session.test.ts, src/input/input-queue.ts. **Modify/extract:** packages/agents/src/session/task-launch-owner.ts, shell-job-owner.ts; packages/core/src/services/asyncTaskManager.ts, asyncTaskAutoTrigger.ts; packages/tools/src/tools/check-async-tasks.ts. **Read:** packages/agents/src/api/control/tasksControl.ts.

**New:** packages/host-kit/src/input/session-admission.ts and session-admission.test.ts. The helper keeps only the live-conversation submit count and returns a host admission result, not a replacement Turn or Agent facade.

### Public contract

HostBackgroundAgents.start/status/cancel/join/close with typed definitions and identities; acquireHostSession and host input queue helpers. Never give ToolHandles the foreground Agent or DecisionPort; host-managed start/cancel tooling is policy-controlled with spawn/execute metadata.

### Tests first

Background agent survives foreground turn completion but not owning host shutdown; cancel one task leaves siblings alive. Host input queue cancels unsubmitted items without steering an unrelated turn. Completed task notices are applied once at a host-selected input boundary. Shared ports close after the last borrowing agent; startup failure cleans up partial acquisition. Shell process jobs retain their own process-group cancellation and output bounds. Memory remains bounded for completed task retention.

With maxSessionSubmits two, admit two top-level inputs even when each performs multiple model/tool steps; reject a third without model effects. Failed/cancelled accepted turns count, BusyError/ClosedError do not; queue draining uses the same gate. Fresh resume/fork resets the live counter, reconnect retains it, and clear/rewind do not reset it. A per-turn step limit independently stops the first long turn.

### Exit criteria

No detached core child and no runtime-global task registry; lifecycle and resource ownership are explicit for each host. Background utilities use the same port conformance-tested adapters.

Every host can apply the same admission semantics without intercepting model/tool steps or owning conversation state.

### Deletions

Only extracted obsolete ownership code with migrated callers; legacy task client bridge removed in P28. Do not delete shell process mechanics just because agent tasks change owner.

### Risks

Auto-submitting task results into a busy foreground agent can reorder user input; choose a deterministic host queue and test it. Long-lived agents need bounded task/result retention.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/host-kit/src/background packages/host-kit/src/lifecycle packages/host-kit/src/input; existing async-task/shell-job suites; core child isolation tests.

No immediate #4037 retirement guaranteed; old child assembly remains until P28. Pseudocode 12, 15-19.

### PR

One short-lived PR from current main. Write failing integration/conformance tests before production extraction; expand the referenced numbered pseudocode before implementation. Record retained behavior and observed red/green results. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` for baseline removals. No compatibility facade and no weakened check.

## P19: Prepare hidden host-entry selection and shared external behavior tests

**Plan:** PLAN-20261112-AGENT-API.P19. **Dependencies:** P18. **Magnitude:** 600-1,000 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Create the test infrastructure for each host cutover and enforce that only host entrypoints may read LLXPRT_EXPERIMENTAL_AGENT_CORE. Do not ship a flag that selects an unimplemented path. The actual temporary read/branch is introduced and removed within each host switch PR; this slice provides the behavior matrix and location guard.

### Packages and files

**New:** packages/test-utils/src/agent-host-contract.ts; scripts/check-agent-host-import-boundary.ts; scripts/tests/agent-host-import-boundary.test.ts; scripts/tests/agent-host-flag-location.test.ts. **Modify:** packages/test-utils/index.ts, package.json, .github/workflows/ci.yml; scripts/check-cli-import-boundary.ts, scripts/cli-boundary/config.ts, scripts/check-a2a-import-boundary.ts and scripts/a2a-boundary/a2aBoundary.ts to compose stricter checks without widening existing allowlists. **Allowed future readers:** packages/cli/src/cli.tsx, packages/zed-acp/src/zedIntegration.ts, packages/a2a-server/src/http/server.ts.

### Public contract

Test-only HostScenarioRunner accepts external input and returns wire output, exit/task state and observable effects. No production legacy-Agent compatibility type. The env flag accepts only absent/0 or 1 and is not exposed in help, settings or AgentDefinition.

### Tests first

Boundary fixtures reject hidden flag reads from core/host-kit/adapters/UI reducers, unknown flag values fail, and the selected new route never falls back on construction/runtime failure. One external test body runs against legacy and new entry factories; compare files, protocol outputs and lifecycle, not mock calls. Tests must still catch a missing output event or skipped cleanup in either factory.

### Exit criteria

Dual-path harness is ready for all four hosts; current hosts still pass existing checks. Host migration registry has zero switched hosts initially and grows monotonically, with no expiry/exemption backdoors. No live unused hidden flag read exists.

### Deletions

None. Test-only legacy factory support is removed per host when its production path is removed.

### Risks

A generic run-both harness can normalize away regressions. Normalize only nondeterministic IDs/timestamps, not decision, result, error, ordering or text semantics.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test scripts/tests/agent-host-import-boundary.test.ts scripts/tests/agent-host-flag-location.test.ts; test-utils contract fixtures; existing CLI/a2a scanner suites.

No baseline entries retire. Add host graph enforcement and flag-location rule; old CLI allowlist remains empty. Pseudocode 17-19.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.

## P20: Switch non-interactive CLI to agent-core and delete its old path

**Plan:** PLAN-20261112-AGENT-API.P20. **Dependencies:** P19; Q1/Q2/Q3 release dispositions before affected flows switch. **Magnitude:** 1,400-2,300 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Migrate the first host. Branch before old foreground preflight/Config/provider activation, not after constructing both runtimes. Load host sources/adapters, submit input, consume events/result and close in finally. Preserve stdin/prompt combination, slash input handling, text/json/stream-json presentation, exit mapping, auth errors, signals and session management.

### Packages and files

**New:** packages/cli/src/session/headless-agent-session.ts and headless-agent-session.test.ts; temporary packages/cli/src/session/legacy-interactive-entry.tsx (delete P27); packages/host-kit/src/decisions/headless-decisions.ts and headless-decisions.test.ts. **Modify:** packages/cli/src/cli.tsx, cliBootstrap.tsx, cliSessionBootstrap.ts, nonInteractiveCli.ts, nonInteractiveBindings.ts, session/nonInteractiveSession.ts, session/signalHandlers.ts; existing nonInteractiveCli\*.test.ts suites. **Delete obsolete portions:** nonInteractiveCliAcquisition.ts and legacy headless branch/bindings only after checking remaining callers.

### Public contract

headlessDecisions({onAsk: deny|fail|approve}): DecisionPort with presence none; host session runner returns exit/result output. Internal host-only functions do not become Agent methods.

### Tests first

Shared old/new external suite: piped input plus prompt, empty input failure, slash commands and file/MCP resource expansion, JSON/stream JSON framing, quiet/reasoning/profile labels, cancellation and no duplicate committed retry text, auth error/unknown provider before model effect, cleanup aggregation and session resume. New contract cases S9.2/S9.3 plus DecisionPort conformance: immediate response, exact-scope auto-approval only, abort, no re-entry, no human interaction tools. CLI exit matches current documented mapping for setup errors and non-done turn outcomes.

Carry the P18 session-admission fixture through this host: two multi-step submits fit a ceiling of two, the third is stopped without a generation, reconnect retains the count and fresh resume starts a new live counter. Keep an independent per-turn max-step assertion. No submit-limit value is translated into maxStepsPerTurn.

With user hooks disabled, preserve thinking-only and todo/reminder continuation, successful pause and failed pause behavior, cancellation and one turn budget across every pass. Native replay survives model/tool/model and resumed sessions through the production host adapter.

### Exit criteria

At the cutover commit all shared tests pass on both paths; then remove old headless route and this host flag read in the same PR and rerun new-only suites. Headless runtime graph reaches no legacy agents/Config even though interactive CLI in the same repository is still old. Installed CLI smoke passes.

### Deletions

Delete headless-only old stream/acquisition/binding code, legacy test factory and hidden read. Keep presentation serializers if still used. Do not delete shared startup code still used by Ink until P27.

### Risks

Both CLI modes currently share ForegroundSessionHost and preflight, so selecting too late leaves forbidden startup coupling. Stream JSON is an external contract: translate events in the host serializer rather than exporting the old Agent API.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + CLI nonInteractiveCli\*, nonInteractiveSigint, nonInteractiveCliCancellation, nonInteractiveUnconfiguredProvider and nonInteractive-owner behavior suites; DecisionPort conformance; integration-tests noninteractive cases; installed bundle and lunahigh smoke.

No guaranteed #4037 finding deletion in shared cli.tsx; its two environment writes remain separate debt. Apply strict new-path host closure rule. Pseudocode 17-19.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.

## P21: Switch zed-acp to one core agent per session

**Plan:** PLAN-20261112-AGENT-API.P21. **Dependencies:** P20. **Magnitude:** 1,800-3,000 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Replace Config/SettingsService injection and old callback bundles with host-kit source/adapter acquisition and one Agent per ACP session. Keep ACP filesystem, terminal transport, protocol mapping, authentication UI, session discovery and deletion in the host. Wire human DecisionPort to permission requests.

### Packages and files

**New:** packages/zed-acp/src/acp-decisions.ts, acp-decisions.test.ts. **Modify:** packages/zed-acp/src/zedIntegration.ts, zed-session-agent.ts, zed-session.ts, zed-session-lifecycle.ts, zed-session-loader.ts, zed-session-replay.ts, zed-session-events.ts, zed-config-options.ts, zed-initialize.ts, fileSystemService.ts, zed-terminal-manager.ts; packages/cli/src/cli.tsx and cliProviderInit.ts for ACP dispatch. **Tests:** existing zed-session-lifecycle.test.ts and zedIntegration tests plus new dual-path ACP contract fixture.

### Public contract

ACP host session composition accepts explicit source/credential/workspace/connection inputs, not Config or SettingsService. acpDecisions(connection, sessionId): DecisionPort; all control uses submit/cancel/command/events/snapshot/transcript.

### Tests first

Shared external ACP protocol suite: initialize/authenticate, new/load/resume/list/delete sessions, two cwd/profile-isolated sessions, tool update ordering, requestPermission approve/reject/edit, cancel pending permission, retry discard, reconnect/replay, and terminal/file operations. Failed startup closes unpublished session and terminals; connection shutdown joins accepted work. DecisionPort conformance handles disconnect/abort promptly. Resume cannot reuse event sequence or reissue stale permissions.

Carry the P18 session-admission fixture through this host: two multi-step submits fit a ceiling of two, the third is stopped without a generation, reconnect retains the count and fresh resume starts a new live counter. Keep an independent per-turn max-step assertion. No submit-limit value is translated into maxStepsPerTurn.

### Exit criteria

ACP passes shared suites on both implementations; switch default, delete old callback construction and ACP flag read in same PR, rerun strict all-package host graph. CLI ACP dispatch does not construct foreground preflight/Config solely to seed ACP.

### Deletions

Delete captureZedHostInputs/captureZedSessionParameters/captureZedAgentDeclaration and old Agent acquisition route in zed-session-agent.ts. Retain reusable protocol/filesystem/terminal implementations with narrow inputs. Remove settings-clone factory from CLI-to-ACP handoff and old ACP test factory.

### Risks

Current disposal starts terminal disposal before retiring agent; new contract requires settled agent work before shared ports close. Preserve remote process cancellation without retaining this ordering defect. Session file import depends on Q2.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + all packages/zed-acp suites and ACP protocol conformance fixture; packages/cli ACP dispatch tests; installed ACP handshake/session smoke against local transport.

Target exact runtime-ambient-delegation findings initializeZedAgent and ZedAgent.admitWork (2 sites) through explicit ownership, listed in baseline ledger. Other zed module state remains #4037. Pseudocode 17-19.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.

## P22: Switch a2a tasks to core agents and typed decisions

**Plan:** PLAN-20261112-AGENT-API.P22. **Dependencies:** P21. **Magnitude:** 1,200-2,100 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Replace Task stream/confirmation callback injection with one core agent per task. Preserve task states/artifacts and request identity while DecisionPort pauses for client input. A disconnect cancels the turn under the approved design. Host owns settings, authentication and HTTP lifecycle.

### Packages and files

**New:** packages/a2a-server/src/agent/a2a-decisions.ts, a2a-decisions.test.ts. **Modify:** packages/a2a-server/src/http/server.ts, agent/task-session-owner.ts, task.ts, executor.ts, task-support.ts, config/config.ts; packages/a2a-server/src/agent/task-owner.behavior.test.ts, task-ports.behavior.test.ts, task.approval-semantics.test.ts, task.provider-neutral.test.ts and task.test.ts.

### Public contract

a2aDecisions(taskIdentity, clientChannel): DecisionPort; request-scoped pending decisions map to input-required, replies resolve by request identity. Core Agent remains private to the Task host composition, not a getter bag handed through protocol layers.

### Tests first

Shared external task suite: task creation/output artifacts, input-required then approve/reject/edit, stale/duplicate client response, next-client-message resolution, cancellation/disconnect, busy input and steer, two-task credential/permission isolation, failed model/setup states, retry discard and close cleanup. DecisionPort conformance proves abort settlement and no re-entry. Final artifacts contain committed text only.

Carry the P18 session-admission fixture through this host: two multi-step submits fit a ceiling of two, the third is stopped without a generation, reconnect retains the count and fresh resume starts a new live counter. Keep an independent per-turn max-step assertion. No submit-limit value is translated into maxStepsPerTurn.

### Exit criteria

Both routes pass external protocol scenarios before default switch. Delete a2a flag and old route in same PR. Entire a2a runtime graph has only approved agent-core/host-kit repository dependencies plus explicit pure value exports.

### Deletions

Delete old task-session-owner acquisition and legacy stream/steer/tool-confirmation callbacks, old Agent imports and stale confirmation replay workaround where cursor semantics replaces it. Retain protocol Task artifact/status logic.

### Risks

Current Task can retain a paused async generator across client messages; replacing it must not lose task identity or resolve an old decision on a later turn. Avoid exposing credentials in a2a errors.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + all packages/a2a-server suites; real local HTTP/SSE task lifecycle fixture; DecisionPort conformance; npm run lint:a2a-boundary.

No current a2a widened-baseline sites to retire. Strengthen a2a scanner imports; keep existing forbidden assembly/getConfig checks. Pseudocode 17-19.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.

## P23: Build and test the Ink snapshot/event view reducer

**Plan:** PLAN-20261112-AGENT-API.P23. **Dependencies:** P22; core event/replay contracts from P06/P09. **Magnitude:** 900-1,400 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Implement a standalone host view reducer and subscribeView using the new public API. Keep it unconnected to the production Ink execution path until P27. This is production presentation code tested against a real core agent, not a translator from the old Agent interface. The existing host stays green and unchanged in execution.

### Packages and files

**New:** packages/cli/src/session/agent-view-store.ts, agent-view-store.test.ts and view-replay.test.ts. **Read:** packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts, ui/AppContainerRuntime.tsx and existing retry-rendering regressions. No startup or legacy binding rewrite here.

### Public contract

subscribeView(agent) returns a host-owned read-only view store and subscription disposal, using snapshot plus events(after: cursor). The view retains current provisional attempts and committed display data, not mutable native history. UI never receives Agent internals.

### Tests first

Run a real core with scripted external ports through snapshot/subscribe races, expired cursors, lagging subscribers, discard after partial text, committed continuations with paragraph separation, tool progress, cancellation and close. Assert displayed records/order and bounded retained state, not dispatch spy counts. S9.1/S9.4/S9.5 traces project consistently. Test replacing a snapshot never duplicates transcript entries or hides failed-attempt charges.

### Exit criteria

The reducer and subscription lifecycle pass independently with no production flag or second active UI runtime. Existing interactive and switched-host suites pass unchanged. P27 only wires this tested component.

### Deletions

No old reducer/owner deletion yet. Remove only duplicated pure presentation helpers if all current callers move directly to the new location without re-exports.

### Risks

Presentation tests can normalize away committed-versus-provisional distinctions. Assert visible paragraph/order semantics, including #3840, and never let a replay gap silently drop output.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/cli/src/session/agent-view-store.test.ts packages/cli/src/session/view-replay.test.ts; existing stream/UI rendering suites. No promised baseline reduction. Pseudocode 13, 18-19.

### PR

One short-lived PR from current main. Write failing boundary/behavior tests before implementation, then run G0 and the unchanged legacy interactive suites as well as all switched hosts. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` only for actual retired findings. This is preparation, not a partial host cutover: no execution switch, flag read, new legacy-Agent facade or boundary exemption. Never merge without Andrew's explicit instruction.

## P24: Build and test the Ink DecisionPort and dialog queue

**Plan:** PLAN-20261112-AGENT-API.P24. **Dependencies:** P23; DecisionPort conformance from P10. **Magnitude:** 800-1,300 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Implement Ink decision queue/presenter on the approved typed requests. Exercise dialogs through a mounted test harness without selecting a new production execution path. Reuse presentational dialog components with explicit props, not the old confirmation bus as the new port.

### Packages and files

**New:** packages/cli/src/session/ink-decisions.ts and ink-decisions.test.tsx. **Modify if needed:** dialog components under packages/cli/src/ui/components, extracting layout-only behavior and updating direct callers. **Read:** legacy approval/plan dialogs and packages/host-kit/src/conformance/decisions.ts.

### Public contract

inkDecisionQueue(): DecisionPort with presence human plus a separate host-owned render subscription. Typed request IDs bind replies; no Agent reference, MessageBus or policy evaluation enters the queue.

### Tests first

Real mounted dialogs exercise approve/reject/edited args, offered grant scopes, plan revise/approve/reject, FIFO queue ordering, stale/duplicate replies, cancellation, timeout and unmount. Shared DecisionPort conformance checks abort settlement/no re-entry; core integration proves stale edit re-prepares and cancelled dialogs cannot approve later calls. Existing legacy dialogs still pass their own behavior suites.

### Exit criteria

Typed dialogs and queue pass conformance before P27. No production switch/flag, no second policy engine, and no adapter translating old Agent methods. New presentation code remains separately testable.

### Deletions

Only obsolete layout helpers whose callers now use the extracted component; keep legacy decision ownership until P27 removes it atomically.

### Risks

Sharing dialog markup must not share mutable pending-request state between legacy tests and the new queue. Each instance owns its requests and disposes render subscriptions.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/cli/src/session/ink-decisions.test.tsx; DecisionPort conformance; existing dialog suites and interactive startup regression. No promised baseline reduction. Pseudocode 09, 15, 18-19.

### PR

One short-lived PR from current main. Write failing boundary/behavior tests before implementation, then run G0 and the unchanged legacy interactive suites as well as all switched hosts. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` only for actual retired findings. This is preparation, not a partial host cutover: no execution switch, flag read, new legacy-Agent facade or boundary exemption. Never merge without Andrew's explicit instruction.

## P25: Extract Ink host-only operations from execution bindings

**Plan:** PLAN-20261112-AGENT-API.P25. **Dependencies:** P24; host-kit services P11-P18. **Magnitude:** 1,300-2,200 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Move profile/auth/catalog/IDE/workspace/session-browser/terminal/background administration out of the bound Agent member bag. P16 supplies services; this slice moves UI command consumers to narrow host handlers. The old foreground execution loop remains the only interactive production loop. Never wrap legacy Agent as the implementation of a new host service.

### Packages and files

**New:** packages/cli/src/session/host-operation-handlers.ts and host-operation-handlers.test.ts; add narrow modules under packages/host-kit/src only for operations not already present. **Modify:** packages/cli/src/session/interactiveUI.tsx, ui/AppContainerRuntime.tsx, affected ui/commands/*.ts and host-only contexts/hooks. **Read:** the 33-member mapping and P16 profile/session/catalog APIs.

### Public contract

Named profile, auth, catalog, workspace and session-index handlers with explicit arguments/results. Do not aggregate them into a replacement Agent getter bag. Conversation operations such as submit/steer/model-command/rewind remain on the existing execution route until P27.

### Tests first

Run profile save/delete/default and browser operations before any agent exists; verify credential isolation, catalog refresh, IDE/context acquisition, task status/cancel and cleanup with real host services and temporary files. Run current interactive commands against those same handlers. Negative imports prohibit handlers from depending on legacy agents, Config or an Agent reference. Existing foreground stream behavior remains unchanged.

### Exit criteria

All mapped host-only controls have direct consumers with explicit ownership, are callable independently of execution and pass existing CLI behavior. P27 has no host-service extraction left to perform, only wiring input/commands to core and deleting displaced execution.

### Deletions

Delete migrated host-only binding members and obsolete forwarding/context glue at their current locations. Keep only actually used execution bindings until P27; no deprecated aliases. Retire any vanished baseline declaration in this PR, otherwise the final ledger remains P27.

### Risks

A broad HostOperations object recreates the old surface. Use domain-specific handlers and keep runtime settings changes distinct from core AgentCommand timing. Shared legacy callers must call extracted mechanisms directly, not through a shim.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/cli/src/session/host-operation-handlers.test.ts; affected profile/auth/commands/IDE/background suites; unchanged interactive and switched-host tests. Recount remaining execution bindings. Pseudocode 17-19.

### PR

One short-lived PR from current main. Write failing boundary/behavior tests before implementation, then run G0 and the unchanged legacy interactive suites as well as all switched hosts. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` only for actual retired findings. This is preparation, not a partial host cutover: no execution switch, flag read, new legacy-Agent facade or boundary exemption. Never merge without Andrew's explicit instruction.

## P26: Remove Ink infrastructure imports and isolate remaining execution wiring

**Plan:** PLAN-20261112-AGENT-API.P26. **Dependencies:** P25. **Magnitude:** 1,000-1,800 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Complete pure-value relocation and direct import cleanup before cutover. Inventory the reviewed 304 CLI production files importing core, classify each edge as pure data, host operation or still-legacy execution, and eliminate the first two categories using P25 services and explicit pure exports. Do not defer hundreds of mechanical imports to P27 or enlarge an allowlist.

### Packages and files

**Modify:** production imports under packages/cli/src, owning pure definitions under packages/agent-core/src or packages/host-kit/src, package exports and direct consumers of moved values; scripts/tests/agent-host-import-boundary.test.ts and existing import fixtures. **Read:** scripts/check-cli-import-boundary.ts, scripts/cli-boundary/config.ts, scripts/check-agent-host-import-boundary.ts. Use the P20 temporary legacy-interactive-entry.tsx for remaining old composition only, not a new facade.

### Public contract

Only explicit pure-value exports and the already declared host operations. A type-only import has the same boundary requirements as a runtime import. No re-export of old infrastructure barrels; no Config-shaped types exposed as values.

### Tests first

Negative graph fixtures cover deep imports, barrel/type-only leaks, aliases and new handlers importing old infrastructure. Build source and emitted/installed exports. Existing terminal/UI/profile tests and all switched hosts pass after moves; CLI import allowlist remains empty. Inventory tests assert every residual old import belongs to named old execution code scheduled for deletion in P27, with no new arbitrary exemption.

### Exit criteria

No unrelated UI component or host-only command reaches infrastructure. Residual old graph is limited to the already-unswitched interactive execution root and its enumerated deletion set. Existing checks remain active; the P19 switched-root rule is not expanded to bless new paths. P27 needs only the execution switch and removal, not a general import migration.

### Deletions

Delete old pure-value definitions only when all consumers import their new owning module directly; no forwarding exports. Delete unused operational imports and dead host glue. Keep live legacy execution until the final cutover.

### Risks

The file count is an inventory, not evidence all imports are trivial. Record exact classified edges and actual changed/moved LoC. This estimate includes changed import lines/tests; mechanical relocations are separately estimated at 2,000-5,000 LoC, not hidden inside P27.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + boundary scanner negative suites, installed declaration/bundle smoke and affected UI suites. No promised baseline reduction; remove only genuinely vanished identities. Pseudocode 17-19 and graph invariants.

### PR

One short-lived PR from current main. Write failing boundary/behavior tests before implementation, then run G0 and the unchanged legacy interactive suites as well as all switched hosts. Use `Refs #3980`, `Fixes #<this-slice-issue>` and `Refs #4037` only for actual retired findings. This is preparation, not a partial host cutover: no execution switch, flag read, new legacy-Agent facade or boundary exemption. Never merge without Andrew's explicit instruction.

## P27: Switch the interactive Ink CLI to snapshot and event-driven presentation

**Plan:** PLAN-20261112-AGENT-API.P27. **Dependencies:** P26; P23 view reducer, P24 DecisionPort and P25 host operations already green. **Magnitude:** 2,000-3,200 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Migrate the final host by wiring the tested P23 view store, P24 DecisionPort and P25 host handlers to core input/commands and ready-agent lifecycle. P26 has already completed pure-value/import cleanup. Replace the remaining execution bindings and props; UI never sequences model/tool work. Keep the actual execution switch, interactive flag removal and deletion of all displaced execution wiring in this one PR.

### Packages and files

**Reuse unchanged contracts:** packages/cli/src/session/agent-view-store.ts and ink-decisions.ts from P23/P24, host-operation-handlers.ts from P25. **Modify:** packages/cli/src/session/interactiveUI.tsx, foregroundOwner.ts; packages/cli/src/cli.tsx, cliBootstrap.tsx, cliSessionBootstrap.ts, cliProviderInit.ts, cliTerminalSession.ts; packages/cli/src/ui/AppContainerRuntime.tsx; packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts; packages/cli/src/ui/containers/AppContainer/hooks/useSteer.ts, useSessionInitialization.ts, useIdeContextBridge.ts, useExitHandling.ts; only remaining conversation-command handlers and execution contexts; host-only command extraction is already complete in P25. **Tests:** interactiveUI.startup.transaction.behavior.test.ts, interactive-owner-startup.test.tsx and scripts/tests/interactive-ui.test.ts.

### Public contract

Host-only subscribeView(agent), inputPort(agent), inkDecisionQueue(): DecisionPort. UI receives view snapshots/events and narrow host command handlers, not Agent fields or Config. Slash model/compress/plan/approval commands use AgentCommand; auth/profile/catalog/IDE administration uses host-kit.

### Tests first

Shared terminal/UI behavior suite: initial prompt, streamed committed/provisional output, discarded attempt removal, steer/cancel/queue, approval editing and stale preview, plan revise/approve/reject, model/profile switches, auth isolation, context/memory/skills refresh, sessions/rewind, shell/background tasks, tool progress/truncation, keyboard shutdown and failed startup cleanup. Snapshot-to-subscribe race and expired/lagging replay have visible recovery. DecisionPort conformance verifies queued dialogs, request identity, timeout/cancel and unavailable behavior. S9.1/S9.4/S9.5 run through the real view reducer.

Carry the P18 session-admission fixture through this host: two multi-step submits fit a ceiling of two, the third is stopped without a generation, reconnect retains the count and fresh resume starts a new live counter. Keep an independent per-turn max-step assertion. No submit-limit value is translated into maxStepsPerTurn.

With user hooks disabled, preserve thinking-only and todo/reminder continuation, successful pause and failed pause behavior, cancellation and one turn budget across every pass. Native replay survives model/tool/model and resumed sessions through the production host adapter.

### Exit criteria

Dual-path UI assertions pass before removing old route; then delete interactive flag/read and old engine bindings in same PR. Entire CLI repository dependency graph follows the new host boundary. No model/tool scheduling or native-history mutation remains in hooks. Existing terminal behavior and isolated roots continue to work.

### Deletions

Delete temporary packages/cli/src/session/legacy-interactive-entry.tsx, bindApplicationOperations, old execution props and their contexts where now unused, legacy useAgentEventStream ownership plumbing, ForegroundSessionHost/preflight route in cli.tsx and old interactive factory. Keep presentation/layout/theme contexts. Remove now-unused CLI Config construction after all host readers move.

### Risks

Integration can still expose lifecycle/input timing defects. Do not fold unrelated host operation extraction or import cleanup back into this PR; those are prerequisites with independent exits. UI wiring must not accumulate duplicate history or restore per-field execution callbacks. If prerequisites fail, repair their source behavior before switching; do not merge a half-cutover. Mechanical relocation is accounted in P26, not hidden in this magnitude.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + CLI session/UI hooks/commands/context suites; npm run test:interactive-ui; startup transaction, profile/auth isolation and foreground MCP plugin tests; installed interactive and lunahigh smoke; all already-switched host suites.

Target interactiveUI runtime-ambient-delegation declarations buildAndStartPerfOwner, commitInteractiveStartup, initializeInteractivePresentation, prepareInteractiveStartup (4 sites). The module-mutation render entry is separate #4037 debt unless its mutable binding is removed. Pseudocode 13, 17-19.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.

## P28: Delete the old Agent API, preflight and unread Config surface

**Plan:** PLAN-20261112-AGENT-API.P28. **Dependencies:** P27. **Magnitude:** 900-1,500 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Finish the rip-and-replace migration. Remove legacy API/assembly/session execution and their exports only after all four host switches. Remove Config members and constructor fields with no remaining readers, update actual infrastructure consumers to explicit inputs, and remove package/build/test references that now point nowhere. Keep unrelated useful utilities rather than deleting packages blindly.

### Packages and files

**Delete obsolete:** packages/agents/src/api/agent.ts, createAgent.ts, profile-preflight.ts, fromConfig-session.ts, agentRuntimeAssembly.ts, activationPreflightState.ts, adopted-agent-assembly.ts, foreground-agent-assembly.ts, child-agent-assembly.ts, policyComposition.ts, agentExecutionCoordinator.ts; packages/agents/src/session/session-client-owner.ts, session-client-acquisition-owner.ts, session-client-binding.ts, session-execution-owner.ts, session-tool-catalog-owner.ts and obsolete scheduler/cleanup/control files; packages/agents/src/core/agenticLoop/, ChatSessionFactory.ts, client.ts and old chat-system-prompt.ts after reusable prompt assembly moved. **Modify:** packages/agents/index.ts, package.json and exports if any non-engine feature remains; packages/core/src/config/config.ts, configBase.ts, configBaseCore.ts, configMediaDefaults.ts, configTypes.ts, configConstructor.ts; obsolete core recording/scheduler/bus bridges; scripts/check-agents-api-surface.ts; scripts/runtime-state-widened-baseline.json; root package/build/shard/entry manifests and removed package references.

### Public contract

No new public runtime API. Keep only agent-core and host-kit public surfaces for all hosts. Remove legacy exports entirely, without forwarding aliases, adapter shims or deprecated getters.

### Tests first

Negative compilation/import tests reject old Agent/preflight/Config access from all hosts. Replay all external host behavior suites against the new path, all core S9/S16 fixtures and all real port-conformance suites. Installed package exports contain no removed API entry. Reader inventory proves every removed Config field has no remaining consumer; any still-read infrastructure field gets explicit input migration before removal. Source discovery/build/test discovery must reject missing package roots.

### Exit criteria

Zero old Agent API/preflight references in production, zero migration flag reads/branches, zero host imports of old core/agents/providers/etc, no unread Config member retained just for hypothetical compatibility. Remove at least the identified 73 agents baseline sites after their source declarations disappear; preserve unrelated #4037 debt. Main and release/nightly suites are green before closing #3980.

### Deletions

Expected deletion magnitude is 12,000-25,000 LoC of legacy source/tests/assembly, an estimate to replace with actual diff counts. Do not delete behavioral tests: move their assertions to new public/integration suites; delete only obsolete implementation-specific scaffolding. Remove old RetryOrchestrator path if all generation consumers have migrated, preserving reusable error/auth utilities.

### Risks

Unseen non-host or plugin consumers can keep an old export alive; use compiler/import graph and installed-package tests, not grep alone. Retiring the old API scanner without equivalent new-surface assertions weakens enforcement and is forbidden.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + every workspace/host/conformance suite; all boundary scanner fixtures; full build/bundle and installed CLI/ACP/a2a smoke; current nightly/release integration checks. Re-run after all deletions, not just before them.

Remove exact P28 entries in baseline ledger, never regenerate an arbitrary baseline. Replace old API-surface targets with stricter new public-surface tests in the same PR; scanner rule families remain. Pseudocode 01-19 end-to-end.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.
