# Issue bodies for the agent API adaptation

Plan: PLAN-20261112-AGENT-API. Target milestone: 0.12.0. Parent: #3980. Boundary burn-down: #4037.

Each numbered section below is a complete issue body, beginning with its proposed issue title. P01 records delivered files in merged PR #4076; other file paths marked **new** are planned additions. Magnitudes include production and behavior-test additions/changes; deletions are listed separately and are not scope caps. P01 is issue #4039 / PR #4076; no further issue numbers have been allocated by this planning task.

Every issue inherits the verification and PR rules in `adaptation-plan.md`: test-first Bun tests, real boundary behavior, no weakened checks, short-lived branch from main, one slice per PR, `Refs #3980`, `Refs #4037` when retiring baseline sites, and `Fixes #<slice-issue>` only after its exit criteria pass. The parent closes only after the final deletion slice.

The 30 slices (completed P01 plus 29 remaining) and their dependencies/magnitudes match the roadmap. Start with P01a, then P02-P04, P05a, P05b and P06-P28; P01 is delivery history, not reopened work. Total 50,400-81,300 LoC includes P01's historical estimate; remaining planned work is 49,000-79,100 authored LoC. Relocation is separate: P05a 4,600-6,000 and P26 2,000-5,000, totaling 6,600-11,000 LoC. D14-D19, the policy translation matrix and approved offline import in the plan are inherited contracts; Q1/Q4 gate affected release behavior; Q5 remains open and is required before P05b implements decision/dispatch integration. P01a, P02 and pure P05a can proceed without choosing Q4/Q5. Q2 and Q3 are decided. P23-P26 merge independently before the atomic P27 Ink switch.

## P01: Create agent-core contracts and enforce its import boundary

**Plan:** PLAN-20261112-AGENT-API.P01. **Status:** implemented and merged in PR #4076 (branch `issue4039`, issue #4039). **Dependencies:** none; historical implementation scope below. **Magnitude:** 1,400-2,200 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

This section records the delivered pre-D19 scope, not new work. Its magnitude is the original estimate, not a measured PR diff. Do not reopen P01 or recreate its package, boundary guard or contracts. P01a owns the subsequent policy/shell and import contract amendments.

Create the pure package and closed definition schemas. Complete the HTML value types, typed errors and fake ports without importing legacy core. Register the package in build, test discovery, packaging and CI from the first commit. This slice exports contracts and validation, not a stub createAgent pretending to be usable.

P01 delivered the then-approved D14-D18 contracts before runtime work. This includes replay scope/envelopes and transcript part IDs, cumulative UsageReport and dispatch certainty, ModelRecovery plus journal records, PreparedShell facts, and AfterTurnView. The delivered PolicyDocument, PolicyRule, PolicyMatch, ArgMatcher and PreparedShell are the pre-D19 shapes. Regex support and the later shell-fact changes belong to P01a and P05a.

### Packages and files

**Delivered:** packages/agent-core/package.json, index.ts, tsconfig.json, src/definition.ts, src/plain-data.ts, src/errors.ts, src/ports.ts, src/types.ts, src/types-contracts.ts, src/types-events.ts, src/testing/fake-ports.ts, src/definition.test.ts, src/definition-boundary.test.ts, src/fake-ports.test.ts, type-fixtures/invalid-contract.ts; scripts/check-agent-core-import-boundary.ts; scripts/tests/agent-core-import-boundary.test.ts. **Registration/guard integration delivered:** package.json, package-lock.json, bun.lock, tsconfig.json, scripts/test-shards.ts, scripts/affected-test-shards.data.json, scripts/runtime-entry-manifest.ts, scripts/check-runtime-state-boundary.ts, .github/workflows/ci.yml. Check scripts/build.ts and scripts/prepare-workspace-build.ts discovery rather than duplicating their workspace list.

### Public contract

AgentDefinition, AgentHost, Agent, AgentCommand, AgentEvent, AgentSnapshot, Turn, TurnResult, ContentPart, ContextItem, ModelPort, ToolCatalog, DecisionPort, SessionStore, Clock, DiagnosticSink, Interceptors and their value/error types; validateDefinition; ScriptedModel, MemoryTools, ScriptedDecisions, FakeClock, MemorySessionStore under a testing export.

Delivered additions: PolicyDocument, PolicyRule, PolicyMatch, ArgMatcher, ReplayScope, ProviderReplayData, TranscriptPart/TranscriptEntry, UsageReport, ModelRecovery, PreparedShell/ShellSegment and AfterTurnView. Complete accounting event values alongside the existing event value types, separating measured Usage from conservative budget charges.

### Tests first

The following describes the delivered P01 test contract. PR #4076 records its verification; this documentation correction does not rerun that implementation suite.

Closed definition rejects unknown fields, functions and missing required selection; reports all definition problems before any port effect. Authority allow is rejected. Invalid budgets/ratios/caps fail. Import fixtures reject direct, relative, aliased, barrel, type-only, dynamic and transitive forbidden dependencies and I/O globals. A permitted pure fixture builds and runs. No fake return value is the assertion target.

Schema and negative-type fixtures reject non-JSON replay/recovery data, unknown formats at adapter validation, dangling replay targets, secret-bearing scope inputs, decreasing/negative usage and incomplete reports marked complete. Round-trip plain replay and accounting records through MemorySessionStore. Require shell facts for shell descriptors and test AfterTurnView contains no Agent or callbacks.

### Exit criteria

Package builds and has passing runtime schema and negative compilation fixtures. CI invokes the graph guard on every PR, including this first one; runtime scanner discovers the new package. No new baseline findings.

P03 can implement failed-attempt accounting and replay using published contracts without inventing another data channel. P05a/P05b and P17 have the preparation/continuation facts they need; all D14-D18 contracts appear in emitted declarations.

### Deletions

None. Existing hosts continue unchanged.

### Risks

Type-only leaks and transitive re-exports can defeat shallow grep checks. The displayed design leaves some value types incomplete; define them explicitly, not with unknown service bags.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/definition.test.ts scripts/tests/agent-core-import-boundary.test.ts; npm run lint:test-shards; npm run lint:affected-shards; package build/declaration export smoke.

No #4037 entries retire. Add the stricter core graph rule; preserve every existing scanner rule. Pseudocode 01.

### PR

Completed by [PR #4076](https://github.com/vybestack/llxprt-code/pull/4076), branch `issue4039`, closing #4039. No new P01 issue or PR. The parent #3980 remains open for the later slices.

## P01a: Amend the delivered contracts for policy parity and offline import

**Plan:** PLAN-20261112-AGENT-API.P01a. **Dependencies:** completed P01 / merged PR #4076. **Magnitude:** 800-1,300 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Amend the existing package in place before P02. Preserve delivered D14-D17 contracts and the import boundary. Replace the pre-D19 policy/shell shapes and their fixtures with the approved shapes, without a compatibility union, parallel schema or facade. Add approved Q2 import value contracts; importer behavior remains P14. This slice supplies native regex compilation/definition validation, not a runtime permission evaluator.

### Packages and files

**Modify delivered files:** packages/agent-core/src/types-contracts.ts, src/types-events.ts, src/types.ts, src/ports.ts, src/errors.ts, src/definition.ts, src/testing/fake-ports.ts, src/definition.test.ts, src/definition-boundary.test.ts, src/fake-ports.test.ts, type-fixtures/invalid-contract.ts and index.ts as needed for exports. **New:** packages/agent-core/src/policy-regex.ts and src/policy-regex.test.ts for the shared native compiler/validation helper; src/policy-source-stack.ts and src/policy-source-stack.test.ts for pure source-stack derivation and validation. No new dependency, package setup or import-guard relaxation.

### Public contract

PolicyDocument gains approvalMode, independent RestrictionRule authority and paired sourceStacks; PolicyRule gains priority/order/provenance and allowRedirection; PolicyMatch gains sourceTool, modes and unless; ArgMatcher gains serializedArgs: PolicyRegex. Add ApprovalMode, PolicyRegex with required PolicyRegexInput path/input evidence, PolicyProvenance, RestrictionRule and PolicySourceStack. Export pure normalizePolicyRegex(input: PolicyRegexInput): PolicyRegex and derivePolicySourceStack(id: string, preferences: readonly PolicyLayer[]): PolicySourceStack; definition/command validators verify pairs against that derivation. Neither helper returns permission outcomes. PreparedShell gains exact raw command, whole-command redirection and policySplit text/facts separate from parsed argv/failure. Add required ToolDescriptor.policyIdentity: { readonly name: string; readonly server?: string }; validate a closed shape with a nonempty name and optional string server when descriptors are pinned. Core checks nonempty server prefixes before policy/dispatch; absent or empty server retains the current no-server-check behavior. Source identity is never reconstructed from qualified/versioned ToolId. Update set-preferences with atomic independently editable layers/approvalMode, set-authority with independent restrictions only, add atomic set-source-stacks for paired source-owned copies, and give Grant stable order. Add ImportNotice, imported-history and StoreError import-required. Compile plain-data patterns with native RegExp during definition validation, retaining existing flavor, flags, source validation and subject semantics; instances remain private, never definition data.

### Tests first

1. Round-trip every added plain-data form and reject RegExp instances/callbacks, malformed predicates, nonfinite priorities and authority allow. Preserve literal source names and inactive mode filters.
2. Native compilation rejects invalid syntax, duplicate/unknown flags and u+v with rule/field provenance before effects, including inactive and unless patterns. Exercise every path in the Regex decision validation table, its 1,024/1,025 checks and adjacent-quantifier heuristic at the specified stage. A 1,024-unit commandRegex passes directory validation but fails its 1,035-unit single-file wrapper check; 513 forward slashes pass authored validation and single-file loading but fail directory native-source validation at 1,026 units. Test prefix expansion boundaries, no new cap on direct/utils-prefix paths, malformed path evidence and effective source/flags mismatch.
3. Replace pre-D19 policy and shell fixtures in the same PR. Negative type fixtures reject the superseded shapes; positive fixtures exercise mode changes, shell facts and remembered-grant ordering without starting a runtime.
4. Imported-history round-trips without live capabilities or restored grants. Store errors retain import-required guidance. Existing replay, accounting, recovery and boundary assertions remain unchanged in strength.
5. Update all fake descriptors and positive/negative type fixtures for required policyIdentity. Pure descriptor validation and negative type fixtures reject missing identity, missing/empty name and non-string server; original names, literal stars and exact-or-prefix forms round-trip. No dispatch implementation is required in P01a. P05b owns real prepared-call matching/server-mismatch tests; P12/P13 populate trusted adapter identities.
6. Source-stack pairs validate against pure derivation, including cross-file ties and modes; missing/stale predicates, duplicate group IDs and mismatched source-rule copies fail. Amended command fixtures distinguish paired replacement from independent authority/preferences. P02 owns reducer installation tests; no decisions, evaluator or loop implementation is required here.

### Exit criteria

All emitted declarations, closed schemas, fakes and fixtures use one amended shape. Definition validation compiles every regex with provenance and no port effects. P02 can consume the amended command shape and P05a can reuse the native compiler. G0 passes independently with no host switched and no placeholder runtime.

### Deletions

Replace superseded policy/shell fixture shapes; retain their behavioral assertions. No old host or public runtime is removed here.

### Risks

Retrofitting D19 into the completed P01 would misstate delivery and leave schema/type drift. Change types, validators and fixtures together. Preserve source-path validation differences, including the single-file generated-pattern check and directory native-source check; a universal authored or effective cap changes accepted inputs.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + Bun definition, fake-port and policy-regex suites, negative compilation fixtures, declaration export checks and the unchanged agent-core boundary guard. No #4037 entries retire. Pseudocode 01.

### PR

One short-lived PR from current main. Write failing behavior and integration tests first, then implement the numbered pseudocode. Record red/green evidence. Use `Refs #3980` and `Fixes #<this-slice-issue>`; retain every existing check and merge only after G0 passes. Never merge without Andrew's explicit instruction.

## P02: Implement synchronous mailbox admission and command timing

**Plan:** PLAN-20261112-AGENT-API.P02. **Dependencies:** P01a. **Magnitude:** 1,300-2,000 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Implement the actor mailbox and legal state transitions with explicit application points. Do not reuse the legacy coordinator, which depends on SafeBoundaryOutcome and legacy ActiveRun. Start integration harness at the public command/admission boundary; wire the loop in P03.

### Packages and files

**New:** packages/agent-core/src/mailbox.ts, src/state.ts, src/mailbox.test.ts. **Modify:** packages/agent-core/src/types.ts, src/testing/fake-ports.ts. **Read/retire later:** packages/agents/src/api/agentExecutionCoordinator.ts, packages/agents/src/session/session-execution-owner.ts.

### Public contract

BusyError, ClosedError, NotRunningError, CommandResult and the submit/steer/cancel/command contracts. Mailbox and reducer remain package-private.

### Tests first

Use the real mailbox/reducer only, driving explicit policy/boundary/turn-end application points without a loop, evaluator or DecisionPort. D19 set-preferences installs independently editable layers and approvalMode in one immutable snapshot/revision. set-source-stacks installs both validated source-owned copies and removals together, preserving independent authority/preferences/mode; invalid updates leave the snapshot unchanged. Assert snapshots and CommandResult ordering at idle, the policy point, turn end without a policy point, cancel settlement and close rejection. Do not require waiting-decision or compound evaluation behavior here: P05b owns those integration tests after P03/P05a exist.

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

Add tool preparation, committed-call dispatch, immutable per-turn catalogs, ordered parallel/exclusive segments, revocation and output limits. Use the real scheduling component and in-memory tools; integrate evaluation in P05a and permission/dispatch lifecycle in P05b. Cross-agent resource locks stay in host executors.

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

## P05a: Implement policy matching and evaluation with parity on every form

**Plan:** PLAN-20261112-AGENT-API.P05a. **Dependencies:** P04; P01a amended contracts and native compiler. **Magnitude:** 2,600-4,000 LoC authored additions/changes, including tests, plus 4,600-6,000 LoC mechanical relocation counted separately. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Implement every core-owned form in the Policy source translation matrix: serialized regex, source identity, priority/ties, authority-owned exceptions, mode filters, parsed-prefix matching, exact shell branches/exemptions and destructive hard deny. Reuse P01a's native RegExp compiler and the existing subject handling. P16 loads/translates sources; no ToolHandle calls PolicyEngine. Q4 conflict fixtures remain explicit release conditions; Q5 is a prerequisite of P05b. Neither permits removal of forms, and this pure slice selects neither outcome.

Keep this slice independently green as a pure evaluator exercised through package-local behavior tests. Do not switch a host or dispatch tools through an incomplete permission path. P05b integrates its typed results with decisions, grants and dispatch; no temporary allow stub or second evaluator is permitted.

### Packages and files

**New:** packages/agent-core/src/policy.ts, src/policy.test.ts and src/shell-policy.test.ts. **Reuse/modify:** src/policy-regex.ts and src/policy-regex.test.ts delivered by P01a. **Read:** packages/core/src/policy/policy-owner.ts and packages/policy/src/policy-engine.ts.

**Move pure behavior into new core modules:** packages/policy/src/destructive-commands.ts, destructive-credentials.ts and destructive-forkbomb.ts with their regression cases; move stable-stringify.ts and the shell splitting/redirection helpers too, exposing a narrow pure shell-facts helper usable by host preparation but no permission evaluator; update the old policy engine to import the one shared pure classifier through an explicit agent-core safety export, not a re-export shim. **Read:** packages/policy/src/types.ts, toml-loader.ts, utils.ts and utils/shell-utils.ts. Add packages/agent-core/src/shell-policy.test.ts; document the narrow pure safety export in public-surface checks.

**Relocation evidence:** the five existing source files total 2,601 lines (1,098 destructive commands, 309 credentials, 852 fork-bomb, 183 stable stringify, 159 shell helpers). The four destructive suites total 1,982 lines: destructive-commands.test.ts (871), destructive-commands.redirect-forkbomb.test.ts (682), destructive-commands.dd-of-credential.test.ts (54), destructive-disabled-list.test.ts (375). Move all four without reducing their assertions. The measured baseline is 4,583 relocated lines at e3c1782b96d0a968f12a09401c04671cc29cacb9; budget 4,600-6,000 for this and additional helper fixture moves found at preflight. Count relocated content once, not as both deletion and addition. Import edits, test-port changes, the new evaluator and new behavior tests belong to the separate 2,600-4,000 authored range. P05a's combined magnitude is 7,200-10,000 LoC; it does not consume P26's relocation budget.

### Public contract

Consume the P01a PolicyDocument, PolicyLayer, PolicyRule, PolicyMatch, ArgMatcher, RestrictionRule, PolicySourceStack and PreparedShell contracts. The package-private evaluator accepts prepared facts and one immutable policy revision/mode, returning allow/ask/deny with matched provenance and shell traversal facts. No human prompt or tool effect occurs here. Invalid definitions fail validation before evaluation.

### Tests first

Tests assert real evaluator outcomes for every form; all denied/error fixtures perform no tool execution:

1. Stable sorted JSON argsPattern matching, directory-loader dot-star behavior versus direct patterns, commandRegex anchors/alternation/JSON escaping, exact/prefix/literal-star identities and missing arguments.
2. Default/user/admin tiers, missing priority zero, overlapping equal-priority rules, base-before-overlay ties, later rule insertion and preference/grant priority 2.95. High admin allow/ask over lower admin deny; high admin ask over lower user deny; an independent authority restriction survives all exceptions/preferences/grants. Assert that editing ordinary preferences cannot change source-owned unless predicates, and evaluate successive complete source-stack revisions, including removals; never accept a mismatched pair. Include Q4's code-derived old allow versus independent-authority restriction as an explicit conflict fixture.
3. default/autoEdit/yolo filters including absent/empty/multiple modes, restriction and exception activation, evaluations against successive revisions and one immutable revision across all compound segments. Invalid inactive patterns fail creation too. P05b adds mid-turn/waiting-decision changes and grant lifecycle tests.
4. Compound/pipeline/background commands with mixed allow/ask/deny; whole-call matches versus no match; fallback ask retained despite all-allow segments; unchanged dir_path; quoted separators; empty split and unmatched quotes with the actual lightweight splitter. Assert Q5's whole-call ask short circuit separately from post-approval dispatch safety.
5. Redirection omitted/false/true on competing winning rules, non-inheritance of an outer exemption, quotes versus real redirects, pipes not redirects, simple fallback allow exemption and explicit camel-case versus loaded YOLO behavior. Destructive inputs always evaluate to deny under YOLO, simulated remembered approvals and allowRedirection true; P05b proves dispatch is prevented. Never execute classifier fixture commands.
6. Native regex syntax/flags, lookahead/lookbehind, backreferences, Unicode classes/sets and repeated g/y matching with reset lastIndex. Use benign source/subject fixtures and compare existing engine outcomes; preserve each loader's flags and subject transforms.
7. Reuse P01a's complete path-specific validation table and boundary fixtures, including single-file generated-pattern checks and the directory native-source check, inactive/exception patterns and provenance. No invalid pattern selects a later permissive rule. Test paths with no length/heuristic check without inventing a cap.

Realpath/new parsed argv matchers retain bypass tests for text prefixes, missing args and segment boundaries. Missing trusted shell facts fail fast. File loading is P16's responsibility, never a second evaluator.

### Exit criteria

Every matrix form has a passing pure evaluator fixture. Non-bypassable effective restrictions survive priority exceptions, YOLO and simulated remembered-approval rules. Audit facts identify provenance, mode/revision, selected priority and authority exceptions. Native compilation and subject parity pass before P16 adopts them. G0 passes with no new host/runtime route; Q4/Q5 remain explicitly recorded conflicts.

### Deletions

Move the shared pure classifier and helpers once and update legacy imports without re-export shims. No policy bus or old runtime removal yet.

### Risks

Catastrophic backtracking behaves as today and is outside this plan; see the possible follow-up issue in the regex decision. Never test catastrophic native workloads. Source-path transforms, stable ties and authority-owned exceptions need separate fixtures to avoid false parity claims.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/policy.test.ts packages/agent-core/src/shell-policy.test.ts packages/agent-core/src/policy-regex.test.ts; parity fixtures for every matrix form and generated authority/priority combinations.

No baseline entries retire until legacy policyComposition is deleted P28. Pseudocode 08, pure evaluation portion. P05b owns the dispatch integration and remaining S9/S16 scenarios.

### PR

One short-lived PR from current main. Write failing behavior and integration tests first, then implement the numbered pseudocode. Record red/green evidence. Use `Refs #3980` and `Fixes #<this-slice-issue>`; retain every existing check and merge only after G0 passes. Never merge without Andrew's explicit instruction.

## P05b: Integrate typed decisions, grants and headless behavior

**Plan:** PLAN-20261112-AGENT-API.P05b. **Dependencies:** P05a and a recorded Q5 disposition before implementing this slice's chosen decision/dispatch behavior. Q5 remains open in this plan; no option is assumed. **Magnitude:** 2,000-3,200 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Wire P05a's sole evaluator into the prepared-tool loop. Implement decision lifecycle, typed replies, edited/stale approval, grant ranking/expiration/revalidation, plan mode and built-in ask_user/propose_plan. Add constrained interceptor execution at policy-sensitive points; host hook translation comes later. No compatibility path or executor-side evaluator.

Complete policy command timing with P02: set-preferences changes independently editable layers and approvalMode atomically; set-source-stacks replaces paired restrictions/ranked source copies and removals in one revision while preserving independent authority. Only after installation may pending decisions and grants be re-evaluated against that revision before dispatch. Apply the recorded Q5 disposition to approval of compound calls without weakening destructive deny or independent authority.

### Packages and files

**New:** packages/agent-core/src/decisions.ts, src/interceptors.ts, src/decisions.test.ts and src/testing/turn-scenarios.ts. **Modify:** src/loop.ts, src/tools.ts, src/mailbox.ts and src/policy.test.ts under packages/agent-core. **Read:** packages/core/src/policy/policy-owner.ts and packages/policy/src/confirmation-bus/message-bus.ts.

### Public contract

Grant, GrantScope, DecisionRequest, Resolution, ToolApproval, PlanApproval and DecisionPort use the amended P01a types. Decision replies are request-scoped and abortable; grants cannot exceed offered scopes or override effective authority. Interceptor patches revalidate and re-prepare before P05a evaluation.

### Tests first

1. Complete S9.1-S9.3, S16.1 authority against grants and S16.4 stale previews through the real loop. Denied calls never execute; approval produces ordered audit events and actual settled results.
2. Edited approval re-prepares and rechecks without an approval loop. Stale execute requires a fresh ask. Exact/prefix grants cover the prepared call and every allowed segment, expire by turn/session and rank at 2.95 without bypassing higher restrictions.
3. Through the real mailbox/loop/evaluator, test authority and approval-mode changes in both directions while decisions wait and between compound evaluations. Recheck stale approvals/grants, use one revision across segments and re-evaluate before dispatch after any revision change. Include turn-end application without another evaluation, cancel settlement, close rejection and already dispatched effects settling unchanged. Move an admin exception from operation A to B while an independent ask keeps calls pending, then remove its source rule/group. Assert exactly the complete old or complete new outcome, never a hybrid evaluation or irreversible decision settlement. An invalid replacement changes neither revision nor pending requests; independent authority still applies.
4. Headless human tools are absent and denied at dispatch; plan mode rejects headless. Exercise onAsk deny/fail/explicit approve through a real DecisionPort adapter fixture, comparing completed denial with today's nonInteractive behavior rather than confusing ask with denial.
5. Interceptor timeout reports continue as specified; patches revalidate and redaction preserves raw audit data when the store supports blobs. Credential prompts stay outside tool decisions.
6. Keep Q4's old-result/authority-conflict fixture distinct from parity without selecting its still-open release disposition. Q5 must be recorded before implementing this slice: assert the selected timing (initial ask then pre-dispatch segment check, or deny before asking) against the old short circuit in separate contract tests. A compound call with any denied segment cannot dispatch after approval; no tool is executed to discover whether it is safe.
7. Through pinned descriptors and prepared calls, use catalog IDs different from policyIdentity.name and assert original-name exact matching, literal stars, exact OR prefix matching, and rejection of a nonempty mismatched server identity before any execute. Model arguments/description cannot override the pinned identity; edited approval retains the same trusted descriptor.

### Exit criteria

All decision scenarios produce ordered audit events, consistent tool results and correct outcomes. Effective authority denial never reaches execute under any mode, exact/session grant or child grant. The full core path uses P05a exactly once per required evaluation, with no host policy callback. G0 passes independently before P06; no host switch occurs here.

### Deletions

No old policy bus removal yet; new handles never delegate decisions to it.

### Risks

Grants broader than offered scopes; confusing credential prompts with tool decisions; treating unavailable as ordinary denial; reentrant port callbacks; dispatch using facts or revision from an obsolete approval.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + bun test packages/agent-core/src/decisions.test.ts packages/agent-core/src/policy.test.ts packages/agent-core/src/shell-policy.test.ts; all completed S9/S16 cases and generated authority/grant combinations through the loop.

No baseline entries retire until legacy policyComposition is deleted P28. Pseudocode 08-12, integrating P05a evaluation with approval and dispatch.

### PR

One short-lived PR from current main. Write failing behavior and integration tests first, then implement the numbered pseudocode. Record red/green evidence. Use `Refs #3980` and `Fixes #<this-slice-issue>`; retain every existing check and merge only after G0 passes. Never merge without Andrew's explicit instruction.

## P06: Publish ordered events, atomic snapshots and replay cursors

**Plan:** PLAN-20261112-AGENT-API.P06. **Dependencies:** P05b. **Magnitude:** 1,000-1,600 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

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

**Plan:** PLAN-20261112-AGENT-API.P07. **Dependencies:** P06. **Magnitude:** 2,200-3,500 LoC added/changed, including tests. **Requirements:** REQ-CORE, REQ-VERIFY; preserve REQ-PORTS and REQ-DELETE.

### Scope

Implement append-before-effect journal semantics, checkpoint consistency, transcript, resume, fork and rewind. Persist sequence allocation metadata and distinguish abandoned branches. The physical store follows P14.

Persist D14 committed replay and D15 reserved/settled attempt accounting, plus D16 recovery invalidation facts. History remains agent-owned and restart never needs a provider conversation cache.

### Packages and files

**New:** packages/agent-core/src/journal.ts, src/recovery.ts, src/transcript.ts, src/journal.test.ts, src/recovery.test.ts. **Modify:** packages/agent-core/src/create-agent.ts, src/tools.ts, src/events.ts, src/testing/fake-ports.ts. **Read:** packages/core/src/recording/types.ts, ReplayEngine.ts, RecordingIntegration.ts and packages/agents/src/api/control/sessionControl.ts.

### Public contract

JournalRecord and durable metadata, CheckpointId, TranscriptEntry, StoreError; Agent.transcript(range), createAgent resume/fork options, rewind/clear commands.

### Tests first

A valid imported-history record plus imported terminal/indeterminate results resumes without dispatch, has no restored grants and preserves uncertainty notices. Reject an old recording at the store boundary with import-required rather than accepting it as empty new history. No synthetic tool-started proof is required or invented for imported content.

S16.5 crash after tool-started becomes indeterminate without repeated file effects. Unfinished turn closes cancelled/closing; pending decision is not reissued. Restore session grants only under current authority, drop turn grants. Failed append prevents dispatch and ends the turn failed; creation load/corruption fails typed. Rewind never creates unmatched calls; compacted-range rewind rejects; fork preserves source and yields independent identity. Resume increases event sequence above persisted watermark. No-store resume/fork fails explicitly.

Resume/fork/rewind preserve replay targets and bytes at retained checkpoints; compaction does not inherit signatures. Crash after reservation settles it conservatively without resend. Duplicate usage records cannot inflate totals. A rejected parent recorded before retry stays invalid after restart. A discarded attempt contributes accounting but neither transcript content nor replay.

### Exit criteria

Fault-injected MemorySessionStore demonstrates recovery at every record boundary and does not hide append failures. Complete transcript and checkpoint tests before physical store implementation.

Schema versions, checkpoint replay references, usage completeness and abandoned branch handling are validated before an agent is published.

### Deletions

None yet; do not reuse old RecordingIntegration as the journal.

### Risks

Persisting every event versus reserving sequence ranges has different write costs; choose and test a durable watermark strategy. Approved offline import is implemented in P14; core recovery reads only new journals.

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

**Plan:** PLAN-20261112-AGENT-API.P12. **Dependencies:** P11. **Magnitude:** 2,700-4,300 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Implement workspaceCatalog from real builtin tool operations. Remove Config and old confirmation dependencies from shared tool composition, assign host-trusted effect/concurrency metadata, and enforce prepared-token preconditions at execution. Keep filesystem, shell, sandbox, IDE/LSP, memory and network execution in host-kit-backed adapters.

Include trusted shell preparation and TodoRead/TodoWrite/TodoPause. Shell preparation emits facts bound to final args/token; no approval or destructive-policy evaluator runs in prepare/execute. Todo failures remain typed error outcomes, and a pause is successful only after its durable task-store write.

### Packages and files

**New:** packages/host-kit/src/tools/workspace-catalog.ts, prepared-call.ts, resource-locks.ts, workspace-catalog.test.ts. **Modify:** packages/core/src/config/toolRegistryFactory.ts; packages/core/src/tools-adapters/CoreToolHostAdapter.ts, CoreShellToolHostAdapter.ts, CoreToolRegistryHostAdapter.ts; packages/tools/src/tools/tools.ts, edit.ts, write-file.ts, shell.ts and any invocation whose preview currently mutates; packages/tools/src/interfaces/IToolHost.ts, IToolRegistryHost.ts; packages/tools/src/tools/tool-registry.ts. Inventory any additional touched invocation at slice preflight; do not copy tool implementations.

**Modify/extract also:** packages/tools/src/tools/todo-read.ts, todo-write.ts, todo-pause.ts, todo-store.ts and reusable shell parsing helpers. Add task-tool and shell-fact cases to workspace-catalog.test.ts; keep parsing separate from permission decisions.

### Public contract

workspaceCatalog(explicitWorkspaceInputs): ToolCatalog; immutable ToolDescriptor/ToolHandle with required policyIdentity populated from the trusted builtin registration name, not qualified ToolId parsing or model arguments; host executor lifecycle close remains separate. Prepared tokens bind final args plus file preconditions; resource-lock acquisition is abortable.

### Tests first

Prepared-call tests through core match original builtin names even when catalog IDs differ, preserve literal stars and exact-or-prefix semantics, and reject forged nonempty server identity before execute. Fake descriptors and registration fixtures carry required policyIdentity; tool input cannot replace it.

D18 facts retain exact raw final command, whole/segment redirection and policySplit output from the current policy shell helpers, separately from argv parse success/failure. Test quotes, whitespace, separators and redirects before and after edited approval; serialize args in core, not the adapter. No preparation result contains a policy decision or compiled regex.

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

mcpCatalog(explicitMcpInputs): ToolCatalog; composeToolCatalogs(catalogs); fetchMcpPrompt and fetchMcpResource returning UserInput/ContentPart values. Connections and authentication remain host-owned. Populate required ToolDescriptor.policyIdentity from the trusted connection server namespace and registered source-tool name (including the current server prefix), independently of qualified/versioned catalog IDs and untrusted MCP descriptions/annotations.

### Tests first

Prepared-call/core tests cover original-name exact matches, literal stars, exact OR server-prefix matching and a mismatched nonempty server identity denied before execute. Rediscovery/edited arguments cannot substitute model-provided identity for the pinned descriptor.

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

## P14: Implement durable SessionStore and explicit offline conversation import

**Plan:** PLAN-20261112-AGENT-API.P14. **Dependencies:** P13. **Magnitude:** 3,600-5,800 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Implement approved Q2 Option A and `llxprt sessions import <old-file>` as specified in the decisions record. Keep it within P14 because conversion publishes through the same journal writer, validation and atomic index/receipt transaction. The CLI handler runs before agent/model/tool acquisition. No runtime fallback, permissive ReplayEngine reuse, dual-format writer or original-file mutation.

Implement a versioned physical journal store and blob operations with durable append, explicit errors, bounded acquisition and exclusive writer ownership. Reuse storage path/media/lock mechanisms after extracting their owner-neutral inputs. Keep legacy logging distinct from the agent journal.

Store D14-D16 replay/accounting/recovery records losslessly. Expose task snapshot blob/index operations so P17 can bind todo/pause snapshots to core checkpoints and fork a separate task namespace without aliasing the live source file.

### Packages and files

**New:** packages/host-kit/src/store/import-conversation.ts, import-conversation.test.ts, historical-recording-schema.ts; packages/cli/src/commands/sessions.ts, sessions.test.ts. **Modify:** packages/cli/src/config/cliArgParser.ts for subcommand registration. **Read:** packages/core/src/recording/types.ts, ReplayEngine.ts, recording-pending-record.ts, refusalPayload.ts, refusalRewritePayload.ts and packages/core/src/services/history/IContent.ts. Extract needed pure format schemas without importing old session owners or retaining the runtime replay module. The audit blob is inert source evidence, not an executable replay envelope or restored grant store.

**New:** packages/storage/src/journal/journal-file.ts, journal-file.test.ts; packages/host-kit/src/store/journal-store.ts, journal-store.test.ts. **Modify:** packages/storage/index.ts; reuse or relocate mechanisms from packages/core/src/recording/SessionLockManager.ts, packages/core/src/storage/SessionPersistenceService.ts and session-media-owner.ts. **Read:** packages/core/src/recording/SessionRecordingService.ts, ReplayEngine.ts, CheckpointService.ts; packages/storage/src/conversation/ConversationFileWriter.ts.

### Public contract

Host-only `importConversation({ sourceFile, destinationStore, expectedProjectHash }, signal): Promise<ImportReport>` returns the new session ID, source digest and typed notices. ImportReport reports grants dropped, indeterminate calls, compression and replay exclusions, with refusal/rewrite audit references. Implement the exhaustive SessionEventType folding table from the decisions record, including validated refusal audit and refusal_rewrite history replacement. Validate envelopes/payloads in sequence, replace active pairing state with each validated snapshot, then check active pairs and subsequent content without confusing replayed IDs with duplicate active results. Reject malformed replacements before publication. ImportError distinguishes malformed/unsupported/active-source/changed-source/storage failures with source line or record ID. Only the importer accepts old bytes; SessionStore.load returns import-required for recognized old recordings.

journalStore(explicitStoreInputs): SessionStore plus separate host-owned close/index/retention operations. Storage package deals in opaque versioned record bytes and media, not imported agent-core state or Config.

### Tests first

Add these behavior fixtures before implementation, using physical source/destination stores and public CLI/host-kit entry points:

1. Old session with completed tool calls: preserve paired IDs, arguments and terminal results, publish a usable new journal, perform zero tool/model/hook/network work and compare source bytes before/after.
2. Interrupted call or isComplete false response: import an indeterminate terminal result and audit notice; resume and a later user turn never replay that operation automatically. No invented PreparedToken/tool-start proof.
3. Session accompanied by old grants/recognized approval metadata: new journal and resumed agent have no imported grants; report the drop. The current recording schema has no grant event, so model this fixture using real saved-approval artifacts/metadata, not a fabricated accepted event type. Current external policies remain a separate startup source.
4. Malformed file: invalid JSON including the tail, invalid sequence/version/payload, orphan/duplicate results and contradictory rewind data fail with provenance, leaving source unchanged and no published destination. A well-formed unmatched call follows case 2 instead.
5. Compressed session: preserve the recorded summary and surviving tail, respect rewind/media purge and unavailable history, and attach no pre-compression replay to summary text. Do not assert original missing messages were recovered.
6. Provider replay present or missing: preserve valid signed/encrypted/AFC content for audit; enable an envelope only with complete proven scope and target; missing principal/endpoint or expired connection means replay-excluded, not a guessed identity. Missing replay still imports ordinary content, and responsesStored never revives a parent chain.
7. Refusal rewrite: begin with a completed tool call/result pair and refused text, record an audit-only refusal, then a valid refusal_rewrite whose resultingHistory repeats that pair and replaces the text, followed by later content. Assert the exact rewritten active transcript plus tail, no false duplicate-ID rejection, preserved original/new text and reviewer/prompt/operation metadata in audit only, zero reviewer/model/tool/hook/network execution and unchanged source bytes. Malformed payload/history, orphan or duplicate results within the replacement, and a duplicate result in the later active tail fail before publication; a later valid rewrite cannot hide earlier malformed records.

Require exhaustive accepted/rejected payload coverage for every event type in the folding table, including multiple replacements and rewind/compression/media-purge interactions. Also test active-source lock refusal, source digest changes, collision/repeated import receipts, write/sync failure, abort before atomic publication, media integrity and discovery of no partial session. All hosts requesting the old ID receive import-required and never an empty successful session; the printed new ID resumes normally.

SessionStore conformance: acknowledged append survives process termination/reopen; fail writes/sync and verify no acknowledgement; truncated final record vs interior corruption; concurrent append ordering and writer-lock conflict; aborted queued I/O settles; blob publication/refcounts survive cancellation. Drive S16.5 through a real store and real tool effect, kill between durable start and finish, resume indeterminate without repeating. Fork leaves source bytes unchanged and sequence advances on resume.

Run real provider converters through a physical-journal model/tool/model round trip, close/reopen with fresh adapters, resume and fork. Verify signed thinking, encrypted reasoning/IDs and AFC metadata on the next native request; mismatched scopes are excluded, compacted text never inherits signatures, and source branch bytes remain unchanged. Crash/resume preserves conservative failed-attempt charges and rejected-parent invalidation. Capture task-state snapshots by checkpoint and prove fork mutation/pause cannot modify source task state.

### Exit criteria

File and directory flush strategy documented for supported OSes; durable acknowledgement has explicit platform semantics. Corrupt/unknown versions fail with StoreError. The approved offline command passes all seven import fixtures before host session resume is enabled. Old format returns import-required; the imported ID loads the new journal without old-runtime dependencies.

Physical durability covers replay and accounting as well as tool-started records. No recovery path reads a provider-local conversation cache or the source session live todo file when forking an older checkpoint.

### Deletions

At P28 delete the old runtime reader/writer and all automatic legacy resume paths after the final host moves. Keep only the isolated offline data-format reader and the new-format writer; its import graph cannot reach old Agent, HistoryService or ReplayEngine.

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

**Plan:** PLAN-20261112-AGENT-API.P16. **Dependencies:** P15, transitively P05b's recorded Q5 disposition; Q4 disposition before affected release flows switch. **Magnitude:** 4,000-6,400 LoC added/changed, including tests. **Requirements:** REQ-PORTS, REQ-VERIFY; preserve REQ-CORE and REQ-DELETE.

### Scope

Move shared settings/profile/argv/environment/trust resolution into host-kit, preserving observed precedence and profile/auth semantics. Separate pure definition building from source I/O and adapter acquisition. Include narrow host profile/session/catalog/IDE utility APIs needed by all four hosts; no new service locator.

Implement every row of the Policy source translation matrix, retaining exact source-path transformations, provenance, priorities, authority-owned exceptions and all mode filters. No regex or exemption form is rejected merely because of its kind. Translate getMaxSessionTurns into host-only HostAdmissionLimits, never maxStepsPerTurn; carry todo enablement into host continuation inputs.

### Packages and files

**New:** packages/host-kit/src/sources/load-host-sources.ts, build-definition.ts, profile-service.ts, source-precedence.test.ts, build-definition.test.ts. **Modify/extract:** packages/cli/src/config/configBuilder.ts, profileBootstrap.ts, settings.ts, cliArgParser.ts; packages/agents/src/api/profile-preflight.ts; packages/settings/src/settings/SettingsService.ts. **Read:** packages/core/src/config/configConstructor.ts, configTypes.ts, configBaseCore.ts and packages/zed-acp/src/zed-session-config.ts. CLI rendering/argv syntax stays at host entry; source resolution is shared.

**New:** packages/host-kit/src/sources/policy-translation.ts, policy-translation.test.ts and host-admission-limits.ts. **Read/extract loader mechanics:** packages/policy/src/toml-loader.ts, types.ts, utils.ts and stable-stringify.ts, plus actual saved approval sources in packages/core/src/policy/policy-owner.ts. Read packages/core/src/policy/config.ts for settings and persistence priority/regex differences. Extract source expansion into plain PolicyRegexInput values. Use P01a's pure normalizePolicyRegex helper to reproduce native-source normalization and exact validation stages, returning effective strings plus input evidence, never RegExp instances. Definition validation repeats those checks. Do not reuse buildArgsPatterns as a host compiler or copy the native-source transform into a second implementation. Do not import PolicyEngine into host-kit production; only the temporary parity test harness may import the old engine.

### Public contract

HostSourceInput, HostSources, DefinitionSources, loadHostSources, buildDefinition; typed builders for approval preferences, trust authority, model selection and instructions. Profile save/delete/default/catalog operations stay on an explicit host profile service. A profile update creates a validated definition delta and sends permitted commands at their timing points. Admin source refresh/removal sends one set-source-stacks command with validated paired copies for the entire admin priority domain; ordinary preference/mode and independent authority changes use their separate commands and cannot edit these copies.

PolicySourceError carries source kind/file/rule/field and the invalid value explanation. Core definition validation resolves its opaque source ID through the host diagnostic map, without receiving a file-reading capability. HostSources includes HostAdmissionLimits.maxSessionSubmits and built-in continuation options outside DefinitionSources. Source policy provenance never becomes credentials or mutable Config.

### Tests first

Source-builder conformance: system/user/project settings, profile and argv precedence match existing behavior; invalid profile/model/required limits fail before side effects; source cancellation releases acquisitions. No credentials, functions, environment objects or source paths in definition. Folder trust cannot be widened by YOLO or project settings. Same source fixture yields identical definition for CLI/ACP/a2a after explicit protocol differences. Profile change during active turn cannot rewrite request history. Skills/memory/IDE context respect trust and lifetime. Browser/profile management works before any agent exists.

Write a parity test that feeds the same real shipped and temporary admin/user/default policy files to the current loaders plus PolicyEngine and to the new translator plus agent-core evaluator. Use a fixed versioned corpus of tool identities and JSON calls with exact expected allow/ask/deny, including nested/escaped argsPattern, commandRegex anchors/alternation, both commandPrefix transforms, camel-case exemptions, actual shipped snake-case YOLO behavior, priority tiers/overlapping ties, admin allow/ask exceptions, inactive/active mode-restricted authority and mode switches. Exercise loadPoliciesFromToml and loadPolicyFromToml separately because their transforms differ. Compare the same settings, CLI allowlist, trusted/excluded MCP, dynamic confirmation and persisted-reload cases at their actual priorities; include base-before-overlay ordering.

Run the corpus through real preparation/core for compound mixed matches, fallback/redirection, destructive deny under YOLO and mode changes while a decision is pending, admin exceptions moving from operation A to B under a pending independent ask, and source-rule/group removal. Observe complete policy revisions and decision settlement to prove no hybrid stack is visible. Each test asserts decisions/results and absence of denied effects, not just emitted definitions. Q5 cases assert the old result and its prerequisite selected new behavior in separate contract tests. Q4 retains the old-result/independent-authority conflict fixture without assuming its open release choice; add the chosen source-migration assertions before affected host switches. Neither conflict can be silently excluded or counted as a parity pass. Compare raw interactive decisions and then completed headless onAsk-deny decisions separately. P28 retains all corpus fixtures/results while deleting the old executable test oracle.

Invalid syntax, flags, existing source-length violations, bad priorities and malformed files fail with file/rule/field provenance before agent creation, including inactive modes. Include ordinary 1,024/1,025 checks, the 1,024-unit commandRegex accepted by the directory path but rejected at the 1,035-unit single-file wrapper, and 513 slashes accepted by single-file argsPattern but rejected at the 1,026-unit directory native-source check. Cover prefix expansion/heuristic stage differences and input/effective-pattern mismatch too. No partial loading or fallback to ask/allow; valid regex/exemption/authority-mode forms compile. Verify definition-validation errors from P01a/P05a propagate without permissive recovery. Distinguish session-submit ceiling from per-turn steps in built sources.

### Exit criteria

Every Config/preflight group in mapping has a concrete owner; no AgentProfilePreflight is used by new hosts. All host-only settings remain usable without exposing them to core. Both old/new composition use shared extracted resolution where practical; no duplicated precedence logic.

Every matrix form has a tested exact translation and the fixed corpus matches old decisions under the existing regex/subject handling. Q5 chosen-contract assertions use the prerequisite recorded before P05b; Q4 changed-outcome contracts require recorded disposition before affected switches; do not report them as parity. No unsupported-form rejection list, silent source correction or second evaluator remains.

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

**Plan:** PLAN-20261112-AGENT-API.P19. **Dependencies:** P18. **Magnitude:** 700-1,200 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Create the test infrastructure for each host cutover and enforce that only host entrypoints may read LLXPRT_EXPERIMENTAL_AGENT_CORE. Do not ship a flag that selects an unimplemented path. The actual temporary read/branch is introduced and removed within each host switch PR; this slice provides the behavior matrix and location guard.

### Packages and files

**New:** packages/test-utils/src/agent-host-contract.ts; scripts/check-agent-host-import-boundary.ts; scripts/tests/agent-host-import-boundary.test.ts; scripts/tests/agent-host-flag-location.test.ts. **Modify:** packages/test-utils/index.ts, package.json, .github/workflows/ci.yml; scripts/check-cli-import-boundary.ts, scripts/cli-boundary/config.ts, scripts/check-a2a-import-boundary.ts and scripts/a2a-boundary/a2aBoundary.ts to compose stricter checks without widening existing allowlists. **Allowed future readers:** packages/cli/src/cli.tsx, packages/zed-acp/src/zedIntegration.ts, packages/a2a-server/src/http/server.ts.

### Public contract

Test-only HostScenarioRunner accepts external input and returns wire output, exit/task state and observable effects. No production legacy-Agent compatibility type. The env flag accepts only absent/0 or 1 and is not exposed in help, settings or AgentDefinition.

### Tests first

Shared host fixtures include import-required on old IDs versus explicit import then new-ID resume, plus the P16 fixed policy corpus and D19 atomic mode changes. Distinguish approved contract changes and Q4/Q5 conflict fixtures from equality assertions.

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

**Plan:** PLAN-20261112-AGENT-API.P20. **Dependencies:** P19; Q1/Q4/Q5 release dispositions before affected flows switch; approved P14 import and P16 parity are prerequisites. **Magnitude:** 1,600-2,600 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Migrate the first host. Branch before old foreground preflight/Config/provider activation, not after constructing both runtimes. Load host sources/adapters, submit input, consume events/result and close in finally. Preserve stdin/prompt combination, slash input handling, text/json/stream-json presentation, exit mapping, auth errors, signals and session management.

### Packages and files

**New:** packages/cli/src/session/headless-agent-session.ts and headless-agent-session.test.ts; temporary packages/cli/src/session/legacy-interactive-entry.tsx (delete P27); packages/host-kit/src/decisions/headless-decisions.ts and headless-decisions.test.ts. **Modify:** packages/cli/src/cli.tsx, cliBootstrap.tsx, cliSessionBootstrap.ts, nonInteractiveCli.ts, nonInteractiveBindings.ts, session/nonInteractiveSession.ts, session/signalHandlers.ts; existing nonInteractiveCli\*.test.ts suites. **Delete obsolete portions:** nonInteractiveCliAcquisition.ts and legacy headless branch/bindings only after checking remaining callers.

### Public contract

headlessDecisions({onAsk: deny|fail|approve}): DecisionPort with presence none; host session runner returns exit/result output. Internal host-only functions do not become Agent methods.

### Tests first

Requesting a pre-migration session must return a visible import-required failure with `llxprt sessions import <old-file>` guidance, without model/tool dispatch, a successful empty transcript or an automatic import. Import explicitly, then resume the printed new ID and retain its uncertainty/grant-drop/replay notices. Apply P16 parity policies through this host, including mode-filtered restrictions, priority exceptions, regex errors, compound checks and redirection exemptions. An approval-mode change sends one set-preferences command with independently editable layers plus approvalMode and re-evaluates pending decisions. Admin-source refresh/removal sends one set-source-stacks command; verify both source-owned copies change together without replacing independent trust restrictions. Q4/Q5 assertions follow the recorded choice, never a host-side evaluator.

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

**Plan:** PLAN-20261112-AGENT-API.P21. **Dependencies:** P20. **Magnitude:** 2,000-3,300 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Replace Config/SettingsService injection and old callback bundles with host-kit source/adapter acquisition and one Agent per ACP session. Keep ACP filesystem, terminal transport, protocol mapping, authentication UI, session discovery and deletion in the host. Wire human DecisionPort to permission requests.

### Packages and files

**New:** packages/zed-acp/src/acp-decisions.ts, acp-decisions.test.ts. **Modify:** packages/zed-acp/src/zedIntegration.ts, zed-session-agent.ts, zed-session.ts, zed-session-lifecycle.ts, zed-session-loader.ts, zed-session-replay.ts, zed-session-events.ts, zed-config-options.ts, zed-initialize.ts, fileSystemService.ts, zed-terminal-manager.ts; packages/cli/src/cli.tsx and cliProviderInit.ts for ACP dispatch. **Tests:** existing zed-session-lifecycle.test.ts and zedIntegration tests plus new dual-path ACP contract fixture.

### Public contract

ACP host session composition accepts explicit source/credential/workspace/connection inputs, not Config or SettingsService. acpDecisions(connection, sessionId): DecisionPort; all control uses submit/cancel/command/events/snapshot/transcript.

### Tests first

Requesting a pre-migration session must return a visible import-required failure with `llxprt sessions import <old-file>` guidance, without model/tool dispatch, a successful empty transcript or an automatic import. Import explicitly, then resume the printed new ID and retain its uncertainty/grant-drop/replay notices. Apply P16 parity policies through this host, including mode-filtered restrictions, priority exceptions, regex errors, compound checks and redirection exemptions. An approval-mode change sends one set-preferences command with independently editable layers plus approvalMode and re-evaluates pending decisions. Admin-source refresh/removal sends one set-source-stacks command; verify both source-owned copies change together without replacing independent trust restrictions. Q4/Q5 assertions follow the recorded choice, never a host-side evaluator.

Shared external ACP protocol suite: initialize/authenticate, new/load/resume/list/delete sessions, two cwd/profile-isolated sessions, tool update ordering, requestPermission approve/reject/edit, cancel pending permission, retry discard, reconnect/replay, and terminal/file operations. Failed startup closes unpublished session and terminals; connection shutdown joins accepted work. DecisionPort conformance handles disconnect/abort promptly. Resume cannot reuse event sequence or reissue stale permissions.

Carry the P18 session-admission fixture through this host: two multi-step submits fit a ceiling of two, the third is stopped without a generation, reconnect retains the count and fresh resume starts a new live counter. Keep an independent per-turn max-step assertion. No submit-limit value is translated into maxStepsPerTurn.

### Exit criteria

ACP passes shared suites on both implementations; switch default, delete old callback construction and ACP flag read in same PR, rerun strict all-package host graph. CLI ACP dispatch does not construct foreground preflight/Config solely to seed ACP.

### Deletions

Delete captureZedHostInputs/captureZedSessionParameters/captureZedAgentDeclaration and old Agent acquisition route in zed-session-agent.ts. Retain reusable protocol/filesystem/terminal implementations with narrow inputs. Remove settings-clone factory from CLI-to-ACP handoff and old ACP test factory.

### Risks

Current disposal starts terminal disposal before retiring agent; new contract requires settled agent work before shared ports close. Preserve remote process cancellation without retaining this ordering defect. Session file import uses the approved P14 command; ACP load never performs conversion implicitly.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + all packages/zed-acp suites and ACP protocol conformance fixture; packages/cli ACP dispatch tests; installed ACP handshake/session smoke against local transport.

Target exact runtime-ambient-delegation findings initializeZedAgent and ZedAgent.admitWork (2 sites) through explicit ownership, listed in baseline ledger. Other zed module state remains #4037. Pseudocode 17-19.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.

## P22: Switch a2a tasks to core agents and typed decisions

**Plan:** PLAN-20261112-AGENT-API.P22. **Dependencies:** P21. **Magnitude:** 1,400-2,400 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Replace Task stream/confirmation callback injection with one core agent per task. Preserve task states/artifacts and request identity while DecisionPort pauses for client input. A disconnect cancels the turn under the approved design. Host owns settings, authentication and HTTP lifecycle.

### Packages and files

**New:** packages/a2a-server/src/agent/a2a-decisions.ts, a2a-decisions.test.ts. **Modify:** packages/a2a-server/src/http/server.ts, agent/task-session-owner.ts, task.ts, executor.ts, task-support.ts, config/config.ts; packages/a2a-server/src/agent/task-owner.behavior.test.ts, task-ports.behavior.test.ts, task.approval-semantics.test.ts, task.provider-neutral.test.ts and task.test.ts.

### Public contract

a2aDecisions(taskIdentity, clientChannel): DecisionPort; request-scoped pending decisions map to input-required, replies resolve by request identity. Core Agent remains private to the Task host composition, not a getter bag handed through protocol layers.

### Tests first

Requesting a pre-migration session must return a visible import-required failure with `llxprt sessions import <old-file>` guidance, without model/tool dispatch, a successful empty transcript or an automatic import. Import explicitly, then resume the printed new ID and retain its uncertainty/grant-drop/replay notices. Apply P16 parity policies through this host, including mode-filtered restrictions, priority exceptions, regex errors, compound checks and redirection exemptions. An approval-mode change sends one set-preferences command with independently editable layers plus approvalMode and re-evaluates pending decisions. Admin-source refresh/removal sends one set-source-stacks command; verify both source-owned copies change together without replacing independent trust restrictions. Q4/Q5 assertions follow the recorded choice, never a host-side evaluator.

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

**New:** packages/cli/src/session/host-operation-handlers.ts and host-operation-handlers.test.ts; add narrow modules under packages/host-kit/src only for operations not already present. **Modify:** packages/cli/src/session/interactiveUI.tsx, ui/AppContainerRuntime.tsx, affected ui/commands/\*.ts and host-only contexts/hooks. **Read:** the 33-member mapping and P16 profile/session/catalog APIs.

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

**Plan:** PLAN-20261112-AGENT-API.P27. **Dependencies:** P26; P23 view reducer, P24 DecisionPort and P25 host operations already green. **Magnitude:** 2,200-3,500 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

### Scope

Migrate the final host by wiring the tested P23 view store, P24 DecisionPort and P25 host handlers to core input/commands and ready-agent lifecycle. P26 has already completed pure-value/import cleanup. Replace the remaining execution bindings and props; UI never sequences model/tool work. Keep the actual execution switch, interactive flag removal and deletion of all displaced execution wiring in this one PR.

### Packages and files

**Reuse unchanged contracts:** packages/cli/src/session/agent-view-store.ts and ink-decisions.ts from P23/P24, host-operation-handlers.ts from P25. **Modify:** packages/cli/src/session/interactiveUI.tsx, foregroundOwner.ts; packages/cli/src/cli.tsx, cliBootstrap.tsx, cliSessionBootstrap.ts, cliProviderInit.ts, cliTerminalSession.ts; packages/cli/src/ui/AppContainerRuntime.tsx; packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts; packages/cli/src/ui/containers/AppContainer/hooks/useSteer.ts, useSessionInitialization.ts, useIdeContextBridge.ts, useExitHandling.ts; only remaining conversation-command handlers and execution contexts; host-only command extraction is already complete in P25. **Tests:** interactiveUI.startup.transaction.behavior.test.ts, interactive-owner-startup.test.tsx and scripts/tests/interactive-ui.test.ts.

### Public contract

Host-only subscribeView(agent), inputPort(agent), inkDecisionQueue(): DecisionPort. UI receives view snapshots/events and narrow host command handlers, not Agent fields or Config. Slash model/compress/plan/approval commands use AgentCommand; auth/profile/catalog/IDE administration uses host-kit.

### Tests first

Requesting a pre-migration session must return a visible import-required failure with `llxprt sessions import <old-file>` guidance, without model/tool dispatch, a successful empty transcript or an automatic import. Import explicitly, then resume the printed new ID and retain its uncertainty/grant-drop/replay notices. Apply P16 parity policies through this host, including mode-filtered restrictions, priority exceptions, regex errors, compound checks and redirection exemptions. An approval-mode change sends one set-preferences command with independently editable layers plus approvalMode and re-evaluates pending decisions. Admin-source refresh/removal sends one set-source-stacks command; verify both source-owned copies change together without replacing independent trust restrictions. Q4/Q5 assertions follow the recorded choice, never a host-side evaluator.

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

**Plan:** PLAN-20261112-AGENT-API.P28. **Dependencies:** P27. **Magnitude:** 1,000-1,700 LoC added/changed, including tests. **Requirements:** REQ-HOST, REQ-DELETE, REQ-VERIFY; preserve REQ-CORE and REQ-PORTS.

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

Delete PolicyEngine and automatic old recording replay/writers when their last production/test-oracle consumers move. Preserve the P16 fixed corpus and expected decisions against new core; remove the old executable parity oracle, not its behavioral assertions. The only pre-migration data reader that survives is P14's explicit offline importer. Assert its dependency closure cannot load old runtime code; no dual-format writer survives.

Expected deletion magnitude is 12,000-25,000 LoC of legacy source/tests/assembly, an estimate to replace with actual diff counts. Do not delete behavioral tests: move their assertions to new public/integration suites; delete only obsolete implementation-specific scaffolding. Remove old RetryOrchestrator path if all generation consumers have migrated, preserving reusable error/auth utilities.

### Risks

Unseen non-host or plugin consumers can keep an old export alive; use compiler/import graph and installed-package tests, not grep alone. Retiring the old API scanner without equivalent new-surface assertions weakens enforcement and is forbidden.

### Verification and boundary retirement

Shared G0 commands, scenario IDs and numbered pseudocode are specified in `project-plans/issue3980/adaptation-plan.md` under Verification and PR protocol, Required behavioral fixtures, and Numbered integration algorithm. G0 includes full test/lint/typecheck/format/build, existing plus new boundary checks, test-audit/property/mutation gates and the lunahigh smoke.

G0 + every workspace/host/conformance suite; all boundary scanner fixtures; full build/bundle and installed CLI/ACP/a2a smoke; current nightly/release integration checks. Re-run after all deletions, not just before them.

Remove exact P28 entries in baseline ledger, never regenerate an arbitrary baseline. Replace old API-surface targets with stricter new public-surface tests in the same PR; scanner rule families remain. Pseudocode 01-19 end-to-end.

### PR

One short-lived PR from current main. Test both paths while both exist; final cutover commit removes that host flag and old route, then verifies the remaining new path. Use `Refs #3980`, `Fixes #<this-slice-issue>`, and `Refs #4037` for baseline changes. Only P28 may also use `Fixes #3980`, after every exit criterion passes. Never merge without Andrew's explicit instruction.
