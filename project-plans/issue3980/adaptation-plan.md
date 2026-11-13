# Adapt llxprt to the approved agent API

Plan ID: PLAN-20261112-AGENT-API. Target: 0.12.0. Status: adaptation plan updated; P01 implemented and merged in PR #4076; remaining implementation and feasibility probe not run here.

## Verdict and scope

Implement the approved design in `packages/agent-core` and wrap the existing infrastructure in `packages/host-kit`. Switch hosts in this order: non-interactive CLI, zed-acp, a2a, interactive Ink CLI. Each completed switch deletes that host's old path and its flag branch in the same PR. Do not retain compatibility facades.

This plan follows the supplied approval, including the two-package decision, even though the HTML still labels itself a proposal. Source inspected: worktree HEAD `855e233478172a9b5859b8a5701412b72f8fabe4`, the merge of main `7cc8fd788d` into `issue3980-agent-api-design`. Q2/Q3 amendments were checked against `cd2a9d2bbe866e666e4ca55d4f1dc253aa55576c` on `issue3980-agent-api-design`; the earlier inventories below retain their recorded revision. References below are worktree-relative. Future paths are explicitly marked **new**. Line references describe this revision, not future code.

The #3980 comment requires the #3911 regression fixes and green nightlies before implementation. Main's `7cc8fd788d` contains PR #4038 with that stated purpose; current nightly results are **unverified** in this planning run. Verify them at implementation preflight. This task changes planning documents and explicitly listed design amendments only; it does not change production source, commit, push, or post issues.

## Slice roadmap

P01 is implemented and merged in PR #4076 (`issue4039`); retain its original scope below as delivery history. Implement P01a next, then P02-P04, P05a, P05b and P06-P28 in order, with one short-lived PR per remaining slice. The suffixes preserve existing downstream slice IDs. All magnitudes are estimates of added/changed production and test lines, not scope caps. Mechanical relocation (P05a: 4,600-6,000 LoC; P26: 2,000-5,000 LoC; combined 6,600-11,000 LoC) and final deletions are reported separately, outside the authored-change totals. The total is **50,400-81,300 LoC added/changed** including P01's historical 1,400-2,200 estimate; remaining planned work is **49,000-79,100 LoC added/changed**, plus an estimated **12,000-25,000 LoC removed** in final cleanup. A later source discovery changes the estimate, not the quality gate.

| Slice | Scope                                                                    | Authored LoC |
| ----- | ------------------------------------------------------------------------ | ------------: |
| P01   | Delivered contracts/import boundary, PR #4076 (historical estimate)      |   1,400-2,200 |
| P01a  | Amend delivered policy/shell and offline-import contracts                |     800-1,300 |
| P02   | Implement synchronous mailbox admission and command timing               |   1,300-2,000 |
| P03   | Run model attempts, context management and budgets in agent-core         |   2,600-4,000 |
| P04   | Schedule prepared tools with pinned catalogs and bounded output          |   1,800-2,800 |
| P05a  | Policy matcher/evaluator with parity on every form                       |   2,600-4,000 |
| P05b  | Typed decisions, grants and headless behavior                            |   2,000-3,200 |
| P06   | Publish ordered events, atomic snapshots and replay cursors              |   1,000-1,600 |
| P07   | Journal turns and recover without repeating uncertain effects            |   2,200-3,500 |
| P08   | Run turn-owned subagents with intersected policy and budgets             |   1,400-2,200 |
| P09   | Finalize shutdown and complete the executable core scenarios             |     900-1,500 |
| P10   | Probe adapter feasibility before building host-kit                       |   1,100-1,800 |
| P11   | Adapt provider attempts and authentication to ModelPort                  |   2,800-4,600 |
| P12   | Adapt builtin tools with effect-free preparation and resource locks      |   2,700-4,300 |
| P13   | Adapt MCP discovery, execution, revocation and content                   |   1,500-2,500 |
| P14   | Implement durable SessionStore and explicit offline conversation import  |   3,600-5,800 |
| P15   | Route diagnostics through one host-owned sink                            |     700-1,200 |
| P16   | Load host sources and build closed AgentDefinition values                |   4,000-6,400 |
| P17   | Adapt user hooks and built-in continuation without a host model loop     |   1,900-3,000 |
| P18   | Manage background agents and borrowed host resources explicitly          |   1,200-2,000 |
| P19   | Prepare hidden host-entry selection and shared external behavior tests   |     700-1,200 |
| P20   | Switch non-interactive CLI to agent-core and delete its old path         |   1,600-2,600 |
| P21   | Switch zed-acp to one core agent per session                             |   2,000-3,300 |
| P22   | Switch a2a tasks to core agents and typed decisions                      |   1,400-2,400 |
| P23   | Build and test the Ink snapshot/event view reducer                       |     900-1,400 |
| P24   | Build and test the Ink DecisionPort and dialog queue                     |     800-1,300 |
| P25   | Extract Ink host-only operations from execution bindings                 |   1,300-2,200 |
| P26   | Remove Ink infrastructure imports and isolate remaining execution wiring |   1,000-1,800 |
| P27   | Switch the interactive Ink CLI to snapshot and event-driven presentation |   2,200-3,500 |
| P28   | Delete the old Agent API, preflight and unread Config surface            |   1,000-1,700 |

The revised magnitudes include the explicit P01a contract delta, D19 timing, native-regex parity in P05a, decisions/grants in P05b, offline import in P14, full source parity in P16 and regression coverage at every host switch. The combined authored policy evaluator and decision-lifecycle estimate is 4,600-7,200 LoC with native RegExp: P05a (2,600-4,000) and P05b (2,000-3,200), each independently green. P05a also relocates 4,600-6,000 LoC, counted once as moved content rather than as both added and deleted lines. P01a rises to 800-1,300 for path/input validation, paired source-stack contracts and trusted identity fixtures; P05b includes live atomic replacement tests; P14 rises to 3,600-5,800 for complete event folding and refusal-rewrite validation; P16 rises to 4,000-6,400 for source-update and path-boundary parity. P01 retains its original estimate rather than counting later amendments as delivered work. Import remains in P14; no downstream IDs change.

Context preparation and budgets are combined with model attempts in P03 because compaction, retries and children must share the same accounting. Tools and MCP are split because effect-free preparation and external discovery/revocation need different probes. Hooks and host-owned background agents are separate slices because their old ownership crosses the new boundary. Diagnostics and source building each keep independent conformance suites. P10 is the first host-kit slice and the executable feasibility decision point. Host switches remain sequential to carry shared regression fixes forward. P23-P26 are separately green preparatory PRs for the view reducer, DecisionPort, host-only operations and imports; P27 alone performs the Ink execution switch, flag removal and displaced-path deletion.

Each P section below is duplicated in `slices.md`; P01 records its completed issue, and the remaining sections are directly fileable issue bodies. References to G0, scenario IDs and pseudocode resolve to named sections in this document; they are part of each slice's contract. P01-P09 build a tested core but do not claim user-facing completion. P10-P19 prove and assemble adapters. P20-P22 switch the first three hosts; P23-P26 prepare Ink independently while its execution stays unchanged; P27 switches Ink and deletes its old route. P28 removes shared legacy ownership.

## Requirements and planning method

- **REQ-CORE:** The agent owns conversation state, mailbox, loop, model attempts, scheduling, policy, context, journal, children and shutdown. Its dependency graph contains no host packages or I/O capabilities.
- **REQ-PORTS:** Adapters preserve the design's abort, error, ownership, durability and no-re-entry contracts. Credentials, workspace access and configuration sources stay outside the core.
- **REQ-HOST:** Hosts send commands and input, render events and snapshots, and answer decisions. They do not sequence the loop or reach into agent state.
- **REQ-DELETE:** Remove each switched host's old execution path immediately; remove the old Agent API, preflight and unused Config members after the last consumer moves.
- **REQ-VERIFY:** Write failing behavior tests before production implementation. Define integration scenarios before narrower unit tests, use real code across the boundary, and fake only external infrastructure. Keep every existing quality gate.

`dev-docs/PLAN.md`, `PLAN-TEMPLATE.md`, `RULES.md` and the TypeScript test skill supply the preflight, contract, test-first, implementation and semantic-verification stages. This multi-PR plan embeds those stages in each slice rather than generating separate phase files. The two new packages and temporary parallel host paths are expressly approved exceptions to the template's no-parallel-version default. Examples in the planning template that use `any`, mock-call assertions or older runners are not instructions to violate RULES: use strict TypeScript and `bun:test`.

Each slice uses the sequence: inspect current main and prerequisite results; write its contract and numbered pseudocode; write the failing integration behavior; add failing unit/property cases; implement only that behavior; run slice and repository verification; record observable results in the PR. Never merge an intentionally failing stub phase. Plan markers identify `PLAN-20261112-AGENT-API.PNN` and the requirements in test descriptions and implementation traceability where appropriate.

## Evidence status

The approved HTML source, including its `text/plain` code blocks, issue #3980 and comments, issue #4037, planning documents and root package scripts have been read. The dependency inventories, complete member mappings, 30 slices, boundary retirement ledger and remaining product choices below record the source inspection. Execution evidence remains a requirement for implementation, not an assertion made here.

## Source findings that change the adaptation work

The issue describes an earlier surface. At this revision, a TypeScript AST inventory finds **56 public declarations** on `AgentProfilePreflight` (including two static factories), **64 directly declared members** on `Agent`, and **33 bindings** in `bindApplicationOperations`. Do not invent four preflight members to reach the issue's historical 60, or nineteen Agent members to reach 83. The complete current inventories are mapped below. Sources: `packages/agents/src/api/profile-preflight.ts:85-716`, `packages/agents/src/api/agent.ts:1070-1215`, and `packages/cli/src/session/interactiveUI.tsx:817-894`.

`Config` is now a four-level hierarchy: `config.ts:66`, `configBase.ts:14`, `configBaseCore.ts:42` and `configMediaDefaults.ts:7`. Counting only `config.ts` would miss most reads. Tool implementations live predominantly in `packages/tools`, the policy evaluator and confirmation bus in `packages/policy`, and the session recorder still in `packages/core/src/recording`. In particular, `packages/storage/src/conversation/ConversationFileWriter.ts:41-68` swallows write failures and is a diagnostic log, not an implementation of durable `SessionStore.append`.

The checked-in #4037 baseline contains **251 identities representing 427 sites**, not the issue body's earlier 412. Identities are `(file, rule, declaration)` with a count, not source lines. Deletions must reduce the actual current baseline, never replace it with the issue's older numbers.

## Adapter feasibility: feasible with bounded extraction, not drop-in wrappers

The inspected seams support a TypeScript adaptation without rewriting most of the provider transports, built-in tools, MCP transport, or storage primitives. This is a **source-inspection verdict**, not a successful executable probe. P10 must prove it before the host-kit implementation proceeds. The highest risks are duplicated retry ownership, tool preparation/approval separation, and journal durability. A wrapper that merely hides a whole session owner behind a port fails the probe.

Reopen the Rust question only if P10 demonstrates that satisfying a port requires replacing most of a subsystem's substantive implementation rather than its composition, input contracts and result translation. Examples of that threshold: every provider's request/stream machinery must be rewritten to isolate attempts, most tools cannot separate preview from effects, or MCP transport must be replaced to support revocation and bounded output. A new journal format and writer are expected work; they do not by themselves amount to rewriting the storage subsystem. If the threshold is reached, report the affected modules, retained versus replaced behavior, and LoC before implementing the adapter. Do not quietly proceed with a disguised rewrite.

### Reproducible direct-dependency census

Scope: production `.ts`/`.tsx` under each named root; exclude `.test.*`, `.spec.*`, `__tests__`, `testing`, `test-support`, `test-utils` and named test helpers. Parse named imports with TypeScript and count identifier references to imported `Config` and `Session*Owner`, including the imports. These are lexical identifiers, **not runtime call counts**, and do not count comments. Counts distinguish a dependency declaration from live use. Transitive/session composition seams are listed separately below.

| File                                                            | Imported dependency and identifier count     | Exact lines                                               | Cut                                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/providers/src/IProviderManager.ts`                    | Config: 2                                    | 9, 19                                                     | Replace `setConfig` with explicit provider inputs; migrate old callers at the same time.                                  |
| `packages/providers/src/auth/types.ts`                          | Config: 2                                    | 10, 53                                                    | OAuth runtime inputs receive endpoint, profile reads, interaction and credential authority explicitly.                    |
| `packages/providers/src/LoggingProviderWrapper.ts`              | Config: 2                                    | 18, 106                                                   | Use its existing explicit redactor and diagnostics reader; remove Config constructor alternative.                         |
| `packages/providers/src/providerCapabilitiesService.ts`         | Config: 6                                    | 14, 69, 136, 155, 180, 205                                | Pass selected model/provider values. Lines 165-168 currently consult Config for model identity.                           |
| `packages/providers/src/BaseProvider.ts`                        | Config: 2                                    | 50, 147                                                   | Remove unused `globalConfig` constructor parameter; retain explicit authentication/settings owner construction.           |
| `packages/providers/src/composition/runtimePlugins/types.ts`    | Config: 2                                    | 11, 31                                                    | Plugin factories receive explicit provider construction inputs, not Config. Update actual plugin consumers in P11.        |
| `packages/providers/src/composition/providerManagerInstance.ts` | Config: 12                                   | 22, 108, 388, 427, 457, 496, 517, 528, 529, 532, 591, 674 | Source selection moves to definition builder; provider construction gets the resolved selection, network and credentials. |
| `packages/providers/src/composition/aliasProviderFactory.ts`    | Config: 2                                    | 14, 572                                                   | Remove threaded Config argument from alias composition; retain alias capabilities and transport factories.                |
| `packages/providers/src/ProviderManager.ts`                     | Config and SessionSettingsOwner: 11 combined | 7, 20, 94, 96, 151, 154, 206, 276, 291, 293, 385          | Capture explicit invocation/settings facts, diagnostics and invalidation subscriptions. No session owner in ModelPort.    |
| `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts`  | Config: 3                                    | 24, 44, 78                                                | Replace Config with shell options and workspace operations; keep execution in the host.                                   |
| `packages/core/src/config/toolRegistryFactory.ts`               | Config: 5                                    | 79, 160, 378, 396, 424                                    | Build tools from workspace, shell, memory, key and network inputs; no legacy scheduler or decision bus in new handles.    |

Totals: providers **9 files / 41 identifiers**; tools package **0 direct files**; MCP package **0 direct files**; storage package **0 direct files**; core tool-adapter/factory bridge **2 files / 8 identifiers**. Zero direct Config imports does not mean zero host dependencies.

### Counted composition dependencies

The package census above does not cover the legacy composition in agents. The same AST identifier method gives the following exact bridge counts. Config/session-owner identifiers total **25** across these five files; MCP policy and history dependencies are additional and listed separately.

| File                                                        | Dependency                    | Identifiers | Lines                   | Cut owner                                                      |
| ----------------------------------------------------------- | ----------------------------- | ----------: | ----------------------- | -------------------------------------------------------------- |
| `packages/agents/src/api/mcpRuntimeAssembly.ts`             | Config                        |           5 | 106, 220, 274, 438, 476 | P13 host connection/catalog composition                        |
| `packages/agents/src/api/mcpRuntimePorts.ts`                | Config                        |           3 | 19, 108, 160            | P13 explicit options and lifecycle inputs                      |
| `packages/agents/src/session/session-tool-catalog-owner.ts` | Config                        |           2 | 32, 165                 | P12/P13 host catalog replaces session-owned registry           |
| `packages/agents/src/session/session-client-owner.ts`       | SessionClientAcquisitionOwner |           3 | 29, 90, 303             | P11-P18 separate adapter acquisition; old owner deleted P28    |
| `packages/agents/src/session/session-client-owner.ts`       | SessionToolCatalogOwner       |           3 | 58, 220, 297            | P12/P13 host catalog                                           |
| `packages/agents/src/session/session-client-owner.ts`       | SessionPolicyOwner            |           5 | 62, 84, 96, 228, 468    | P05a/P05b core policy and per-host DecisionPort                |
| `packages/agents/src/session/session-execution-owner.ts`    | Config                        |           2 | 11, 76                  | P02/P03 replace execution ownership                            |
| `packages/agents/src/session/session-execution-owner.ts`    | SessionSettingsOwner          |           2 | 16, 77                  | P16 definition/typed commands                                  |
| `packages/agents/src/api/mcpRuntimeAssembly.ts`             | McpApprovalPolicy             |           2 | 76, 247                 | Remove duplicate tool approval in P13                          |
| `packages/agents/src/session/session-tool-catalog-owner.ts` | McpApprovalPolicy             |           3 | 51, 91, 103             | Same P13 cut                                                   |
| `packages/core/src/recording/RecordingIntegration.ts`       | HistoryService                |           5 | 20, 150, 310, 428, 556  | Core journal replaces history subscription; physical store P14 |

`packages/agents/src/api/control/sessionControl.ts` and `packages/core/src/storage/session-media-owner.ts` contain no named imported Config/Session\*Owner/HistoryService references under this method, despite being part of the ownership chain. They receive operations and explicit data. This distinguishes their composition coupling from a nonexistent Config import.

`ToolRegistry` itself is in `packages/tools/src/tools/tool-registry.ts`, not core. Its host interface is `packages/tools/src/interfaces/IToolRegistryHost.ts:21-43`: settings/tool selection, discovery/call commands and trust reads. `IToolHost` (`packages/tools/src/interfaces/IToolHost.ts:62-110`) still exposes approval-mode reads/writes. These structural dependencies are not counted as direct Config imports and must still be cut in P12. In `packages/tools/src/tools/edit.ts:550-645`, confirmation calculates a diff, initiates IDE review and changes approval preferences in its callback. Reuse the edit calculation, extract a separate effect-free prepared-call function, and move IDE review/approval into the host decision presenter. Calling shouldConfirmExecute as prepare would violate the new contract.

### Behavioral dependencies outside the direct census

| Subsystem and evidence                                                                                                                                                                    | Current dependency                                                                                                                                                 | How the adapter cuts it; probe obligation                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers: `ProviderManager.ts:206-253, 346-415, 470-486, 548-564, 846-885`                                                                                                               | Diagnostics/settings subscriptions use SessionSettingsOwner; wrapping always adds RetryOrchestrator; stateless admission explicitly demands Config.                | Refactor shared construction to explicit request facts and lifecycle subscriptions. Expose one attempt to ModelPort, without stripping transport cleanup or credential ownership. Prove partial output followed by a retryable error reaches the core as one discarded attempt and no tools execute.                                            |
| Provider contract: `packages/providers/src/IProvider.ts:57-100, 121-151`                                                                                                                  | GenerateChatOptions accepts invocation, parameters, system instruction, media/auth facts and retry operations; legacy positional overload coexists.                | Translate core requests to the object contract. Core owns semantic retry/fallback; adapter owns transport and credential refresh that does not conceal an additional model attempt. Count actual usage from failed attempts. Preserve Claude Code's required system prompt in the Anthropic adapter.                                            |
| Tools: `packages/core/src/tools-adapters/CoreToolHostAdapter.ts`; `toolRegistryFactory.ts:157-182, 507-546, 678-744`                                                                      | Structural host getters, workspace services, message bus, output summarization and task registration are assembled outside tools.                                  | Reuse tool operations, replace the composition inputs. Extract effect-free preview/precondition checking where invocation APIs currently mix confirmation and preparation. Tool handles never receive DecisionPort. Core owns output caps and schedules calls; adapter enforces resource locks and stops production at the bounded writer.      |
| Tool/session bridge: `packages/agents/src/session/session-tool-catalog-owner.ts:164-177`; `session-client-owner.ts:127-175, 214-240`; `session-execution-owner.ts:84-120`                 | Config, session policy, scheduler channels and the client own catalog/execution/confirmation wiring.                                                               | New catalog is host-owned and independently usable. Keep these old owners only for unswitched hosts, then delete them in P28. Never wrap SessionClientOwner as the new ToolCatalog.                                                                                                                                                             |
| MCP: `packages/mcp/src/host/hostInterfaces.ts:14-34, 61-73`; `client/mcp-client-manager.ts:125-144`                                                                                       | McpHostConfig and McpApprovalPolicy already narrow the package boundary, but still expose host getters and old approval semantics.                                 | Host-kit implements these from explicit captured source data/trust lifecycle for connection management. New execution handles use the transport operation, not a second policy evaluator. Pin immutable descriptors, qualify/version IDs and revoke active sets on trust withdrawal or disconnect.                                              |
| MCP approval/transport: `packages/mcp/src/client/mcp-tool.ts:69-134`; `mcp-callable-tool.ts:28-135`                                                                                       | Invocation calls approval policy; transport accepts a signal, bounds aggregate response bytes, then converts errors to result content.                             | Split transport result normalization from legacy confirmation; retain aggregate acquisition bounds and authorization checks. Normalize abort, revoked and failed outcomes instead of losing them in string errors. Do not pretend post-allocation truncation is streaming backpressure. SDK-level allocation bounds remain a probe measurement. |
| MCP composition: `packages/agents/src/api/mcpRuntimeAssembly.ts:274-364, 438-479`; `mcpRuntimePorts.ts:106-160`                                                                           | Whole Config identity, SessionClientOwner publication, policy owner and memory/filesystem ownership converge here.                                                 | Host-kit owns connection/workspace lifetimes and publishes catalogs/content directly. Remove session-client binding from the new route. Hosts dispose shared MCP connections only after all borrowing agents close.                                                                                                                             |
| Storage location: `packages/storage/src/config/storage.ts`; `packages/storage/src/session/sessionTypes.ts`                                                                                | Paths and persisted value types, no imported Config/session owner.                                                                                                 | Reuse path resolution, secure-store and filesystem primitives behind explicit store paths. No source or path object enters agent-core.                                                                                                                                                                                                          |
| Actual recorder: `packages/core/src/recording/SessionRecordingService.ts:143-175, 439-484, 523-544`; `RecordingIntegration.ts:142-150, 310-321, 506-517`                                  | Recorder queues legacy events; integration subscribes to HistoryService and joins persistence finalizers. File writes use appendFile, with no fsync contract here. | Add a versioned journal writer in storage with durable-on-resolve append, explicit errors and abort. Reuse locking/media primitives after decoupling their owner inputs. Do not delegate durability to legacy recorder flush or ConversationFileWriter.                                                                                         |
| Session facade: `packages/agents/src/session/session-client-owner.ts:155-190`; `packages/agents/src/api/control/sessionControl.ts`; `packages/core/src/storage/session-media-owner.ts:17` | Session identity adoption, recording, native history and media store are owned across session/client controls.                                                     | Agent owns transcript/checkpoint state; host-kit SessionStore owns file/media retention. Move only reusable storage mechanisms, not HistoryService event semantics, behind the store.                                                                                                                                                           |

The probe must instantiate real provider translation against a controlled HTTP server, real read/edit/shell tools in a temporary workspace, a local MCP fixture server, and a physical journal store. It must perform one submit/tool/result path, abort in-flight operations, withdraw trust, and restart after a tool-started record. Assert requests, files, journal content and observable outcomes, not mock invocation counts.

## Complete current-to-new mapping

### Preflight: all 56 current public declarations

The issue's 60-member description is historical. This table covers every public declaration at HEAD; no unverified historical names are substituted. Line numbers are in `packages/agents/src/api/profile-preflight.ts`.

| Current member                   | Line | New owner and removal slice                                                                                                                                              |
| -------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create`                         |  124 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `retainProviderFile`             |  170 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `captureProviderFiles`           |  177 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `retryProviderFileCleanup`       |  181 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `captureInput`                   |  192 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `readDefaultProfileName`         |  197 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `logUserPrompt`                  |  201 | Host diagnostics owner (P15); emit is borrowed, flush/update/close remain host operations; old member removed in P28.                                                    |
| `logSlashCommand`                |  207 | Host diagnostics owner (P15); emit is borrowed, flush/update/close remain host operations; old member removed in P28.                                                    |
| `isTelemetryEnabled`             |  213 | Host diagnostics owner (P15); emit is borrowed, flush/update/close remain host operations; old member removed in P28.                                                    |
| `flushTelemetry`                 |  216 | Host diagnostics owner (P15); emit is borrowed, flush/update/close remain host operations; old member removed in P28.                                                    |
| `readTelemetrySettings`          |  219 | Host diagnostics owner (P15); emit is borrowed, flush/update/close remain host operations; old member removed in P28.                                                    |
| `updateTelemetrySettings`        |  224 | Host diagnostics owner (P15); emit is borrowed, flush/update/close remain host operations; old member removed in P28.                                                    |
| `readConversationLoggingEnabled` |  229 | Host diagnostics owner (P15); emit is borrowed, flush/update/close remain host operations; old member removed in P28.                                                    |
| `subscribeModelChanges`          |  232 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `readSelectedEndpoint`           |  245 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `getActiveProviderName`          |  248 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `hasActiveProvider`              |  251 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `setActiveProvider`              |  252 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `getCurrentProfileName`          |  258 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `forkSandboxPreflight`           |  261 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `captureSettingsSnapshot`        |  272 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `load`                           |  277 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `applySnapshot`                  |  281 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `isApplying`                     |  287 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `cancelAndJoin`                  |  290 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `listProfiles`                   |  293 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `runImageOperation`              |  297 | Host image operation via tools/model adapter (P11/P12); direct image CLI stays host-owned; old member removed in P28.                                                    |
| `captureHistory`                 |  303 | Agent transcript reader and host session index (P07/P14); old member removed in P28.                                                                                     |
| `isTrustedFolder`                |  307 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `getIdeTrust`                    |  310 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `setTrustedFolderLive`           |  313 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `setIdeTrustLive`                |  316 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `whenSettled`                    |  319 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `subscribeTrustTransition`       |  322 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `subscribeTrustRevocation`       |  329 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `subscribeTrustChange`           |  336 | Host trust lifecycle to set-authority plus catalog revocation (P12/P13/P16); never a preference override; old member removed in P28.                                     |
| `bindMcpSettings`                |  341 | Host catalog settings publication (P13), no binding to agent session owners; old member removed in P28.                                                                  |
| `captureSettings`                |  351 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `readProviderDefaultModel`       |  356 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `chooseProviderModel`            |  362 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `readSetting`                    |  367 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `writeSetting`                   |  372 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `applyArgumentOverrides`         |  377 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `prepareConfiguredWorkspace`     |  440 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `preparePostConfiguration`       |  500 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `writeUserParameter`             |  547 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `readNamedParameter`             |  554 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `chooseModel`                    |  561 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `preflight`                      |  568 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `captureSwitchOperation`         |  577 | Model adapter and credential/file lifecycle (P11); selection goes through set-model and observed snapshot (P16); old member removed in P28.                              |
| `captureProfileOperation`        |  582 | Host source resolution and profile management (P16); values become definition fields, never settings accessors in core; old member removed in P28.                       |
| `transferActivation`             |  587 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `finishPostConfiguration`        |  598 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `createForegroundAgent`          |  677 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `admitForegroundAgent`           |  686 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |
| `dispose`                        |  716 | Host acquisition and close; replace phased activation with loadHostSources, explicit adapter acquisition and ready createAgent (P16/P20-P28); old member removed in P28. |

### Agent and the 33 bound UI members

All 64 directly declared Agent members are covered. **UI** marks exactly the 33 members bound at `interactiveUI.tsx:817-894`. Agent member line numbers refer to `packages/agents/src/api/agent.ts`. Nested controls follow their domain row, rather than being copied into a replacement facade.

| Current member                  | Line | UI  | New home                                                                                                                                |
| ------------------------------- | ---: | --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `modelParameters`               | 1071 |     | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `settings`                      | 1072 |     | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `toolFormat`                    | 1073 |     | Host model catalog/auth (P11); provider-native formats do not enter the core.                                                           |
| `providerReads`                 | 1074 | UI  | Host model catalog/auth (P11); provider-native formats do not enter the core.                                                           |
| `sessionClient`                 | 1075 | UI  | Delete the service exposure; core mailbox/loop owns execution, host adapters own acquisition.                                           |
| `captureProfile`                | 1081 |     | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `saveProfileSnapshot`           | 1082 | UI  | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `deleteProfileByName`           | 1086 | UI  | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `getActiveProfileName`          | 1087 | UI  | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `setDefaultProfileName`         | 1088 | UI  | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `getRuntimeDiagnosticsSnapshot` | 1089 |     | Push-only DiagnosticSink plus host metric projection from event usage (P15).                                                            |
| `chat`                          | 1097 |     | submit returns a Turn; consume turn.events and result; no host-driven loop.                                                             |
| `stream`                        | 1098 | UI  | submit returns a Turn; consume turn.events and result; no host-driven loop.                                                             |
| `injectSteer`                   | 1106 | UI  | steer(UserInput) at the next boundary.                                                                                                  |
| `getProvider`                   | 1108 | UI  | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `setProvider`                   | 1109 | UI  | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `getProviderStatus`             | 1114 |     | Host model catalog/auth (P11); provider-native formats do not enter the core.                                                           |
| `hasActiveProvider`             | 1115 |     | Host model catalog/auth (P11); provider-native formats do not enter the core.                                                           |
| `getProviderContextLimit`       | 1116 | UI  | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `listAvailableModels`           | 1117 |     | Host model catalog/auth (P11); provider-native formats do not enter the core.                                                           |
| `getModel`                      | 1118 | UI  | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `setModel`                      | 1119 |     | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `getCurrentSequenceModel`       | 1120 | UI  | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `getApprovalMode`               | 1126 | UI  | snapshot.policy and set-preferences; trust stays in set-authority.                                                                      |
| `setApprovalMode`               | 1133 | UI  | snapshot.policy and set-preferences; trust stays in set-authority.                                                                      |
| `getRuntimeId`                  | 1139 |     | Agent.id and Agent.session value identities; journal transcript/checkpoints in P07/P14.                                                 |
| `getEphemeralSetting`           | 1154 |     | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `setEphemeralSetting`           | 1156 |     | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `getEphemeralSettings`          | 1158 |     | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `getModelParams`                | 1159 |     | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `setModelParam`                 | 1160 |     | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `clearModelParam`               | 1161 |     | Definition model.parameters; set-model applies at turn end; snapshot.model is the read surface.                                         |
| `profiles`                      | 1163 | UI  | Host settings/profile service in P16, with typed commands only for live agent behavior; no free-form settings bag crosses core.         |
| `execution`                     | 1165 |     | Delete the service exposure; core mailbox/loop owns execution, host adapters own acquisition.                                           |
| `tools`                         | 1169 | UI  | Host ToolCatalog metadata/administration, core snapshot.tools for advertised tools; no imperative tool channel bypass.                  |
| `mcp`                           | 1170 | UI  | Host MCP connection/catalog administration and content fetching (P13).                                                                  |
| `auth`                          | 1171 | UI  | Host credential authority/auth flow (P11); failures are typed ModelError, no auth control on Agent.                                     |
| `authentication`                | 1172 |     | Host credential authority/auth flow (P11); failures are typed ModelError, no auth control on Agent.                                     |
| `ide`                           | 1173 | UI  | Host IDE/workspace/LSP services (P12/P16); fetched material enters as ContextItem or UserInput.                                         |
| `session`                       | 1174 | UI  | Agent.id and Agent.session value identities; journal transcript/checkpoints in P07/P14.                                                 |
| `metrics`                       | 1175 | UI  | Push-only DiagnosticSink plus host metric projection from event usage (P15).                                                            |
| `hooks`                         | 1176 | UI  | Host hook runner plus six Interceptors and event observers (P17); unsupported response mutations are Q1.                                |
| `policy`                        | 1177 | UI  | snapshot.policy and set-preferences; trust stays in set-authority.                                                                      |
| `tasks`                         | 1179 | UI  | Turn-owned children in P08; detached/background jobs are host-managed agents/jobs in P18.                                               |
| `memory`                        | 1181 |     | Host memory/skills loading to InstructionBlock/ContextItem; writes through catalog policy (P12/P16).                                    |
| `skills`                        | 1183 |     | Host memory/skills loading to InstructionBlock/ContextItem; writes through catalog policy (P12/P16).                                    |
| `workspace`                     | 1185 | UI  | Host IDE/workspace/LSP services (P12/P16); fetched material enters as ContextItem or UserInput.                                         |
| `lsp`                           | 1187 |     | Host IDE/workspace/LSP services (P12/P16); fetched material enters as ContextItem or UserInput.                                         |
| `getHistory`                    | 1189 | UI  | transcript(range); never mutable native history exposure.                                                                               |
| `setHistory`                    | 1190 |     | Remove arbitrary history mutation. Use submit/steer/context, or createAgent resume/fork; offline data-format import is approved in P14. |
| `addHistory`                    | 1194 | UI  | Remove arbitrary history mutation. Use submit/steer/context, or createAgent resume/fork; offline data-format import is approved in P14. |
| `restoreHistory`                | 1195 |     | Remove arbitrary history mutation. Use submit/steer/context, or createAgent resume/fork; offline data-format import is approved in P14. |
| `resetChat`                     | 1196 |     | command clear/rewind; workspace file restoration remains a host operation.                                                              |
| `updateSystemInstruction`       | 1197 |     | command set-instructions; applies at turn end.                                                                                          |
| `addDirectoryContext`           | 1198 | UI  | Host workspace expansion plus context publication and catalog/authority update, not a Config mutation.                                  |
| `compress`                      | 1199 | UI  | command compact and ContextStrategy (P03/P07).                                                                                          |
| `getStats`                      | 1200 |     | Push-only DiagnosticSink plus host metric projection from event usage (P15).                                                            |
| `onStats`                       | 1201 |     | Push-only DiagnosticSink plus host metric projection from event usage (P15).                                                            |
| `generate`                      | 1204 | UI  | Host utility-generation functions over ModelPort (P11), not extra Agent methods; callers needing tools submit to a separate agent.      |
| `generateJson`                  | 1205 |     | Host utility-generation functions over ModelPort (P11), not extra Agent methods; callers needing tools submit to a separate agent.      |
| `generateEmbedding`             | 1210 |     | Host embedding adapter over providers; not conversation behavior (P11).                                                                 |
| `listProviders`                 | 1212 | UI  | Host model catalog/auth (P11); provider-native formats do not enter the core.                                                           |
| `listTools`                     | 1213 |     | Host ToolCatalog metadata/administration, core snapshot.tools for advertised tools; no imperative tool channel bypass.                  |
| `dispose`                       | 1215 | UI  | agent.close followed by host-owned adapter shutdown (P09/P18).                                                                          |

### Config members by group

Complete public-name inventory across ConfigMediaDefaults, ConfigBaseCore, ConfigBase and Config: **164 distinct names**, counting overridden methods once at their most-derived declaration. Paths in parentheses are under `packages/core/src/config/`. Protected backing fields are implementation state of these groups, not additional API. ConfigParameters in `configTypes.ts` and `configConstructor.ts` must be pruned with their last readers in P28.

| Group                                    | Current public names and locations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Destination                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paths, filesystem and session storage    | `getSessionRecordingQueueByteLimit` (configBase.ts:108); `getSessionPersistenceQueueByteLimit` (configBase.ts:115); `getMediaStoreQuotaByteLimit` (configBase.ts:101); `storageRoot` (configBaseCore.ts:126); `globalConfigRoot` (configBaseCore.ts:127); `globalDataRoot` (configBaseCore.ts:128); `globalLogRoot` (configBaseCore.ts:129); `globalAgentsRoot` (configBaseCore.ts:130); `projectTempDir` (configBaseCore.ts:131); `projectHistoryDir` (configBaseCore.ts:132); `projectChatsDir` (configBaseCore.ts:133); `projectCheckpointsDir` (configBaseCore.ts:134); `historyFilePath` (configBaseCore.ts:135); `projectCommandsDir` (configBaseCore.ts:136); `projectSkillsDir` (configBaseCore.ts:137); `projectAgentSkillsDir` (configBaseCore.ts:138); `userCommandsDir` (configBaseCore.ts:139); `userSkillsDir` (configBaseCore.ts:140); `userAgentSkillsDir` (configBaseCore.ts:141); `customExcludes` (configBaseCore.ts:142); `getTargetDir` (configBaseCore.ts:211); `getProjectRoot` (configBaseCore.ts:214); `getConfiguredIncludeDirectories` (configBaseCore.ts:217); `getLlxprtDir` (configBaseCore.ts:359); `getProjectTempDir` (configBaseCore.ts:362); `getEnableRecursiveFileSearch` (configBaseCore.ts:365); `getFileFilteringDisableFuzzySearch` (configBaseCore.ts:368); `getFileFilteringRespectGitIgnore` (configBaseCore.ts:371); `getFileFilteringRespectLlxprtIgnore` (configBaseCore.ts:374); `getFileFilteringOptions` (configBaseCore.ts:377); `getCustomExcludes` (configBaseCore.ts:383); `getCheckpointingEnabled` (configBaseCore.ts:386); `getWorkingDir` (configBaseCore.ts:395); `getUseRipgrep` (configBaseCore.ts:477); `profileDirectory` (config.ts:69); `subagentDirectory` (config.ts:70) | Host-kit workspace/store options (P12/P14/P16); explicit paths stay outside AgentDefinition.                                                                                                                   |
| Model, parameters and utility generation | `setContentGeneratorConfig` (configBaseCore.ts:183); `getContentGeneratorConfig` (configBaseCore.ts:191); `isInFallbackMode` (configBaseCore.ts:196); `setFallbackMode` (configBaseCore.ts:199); `getMaxSessionTurns` (configBaseCore.ts:202); `getEmbeddingModel` (configBaseCore.ts:205); `getProvider` (configBaseCore.ts:435); `getChatCompression` (configBaseCore.ts:465); `getSkipNextSpeakerCheck` (configBaseCore.ts:495); `getContinueOnFailedApiCall` (configBaseCore.ts:498); `getImagePayloadBudgetBytes` (configBase.ts:87); `getRequestImagePayloadBudgetOverrideBytes` (configBase.ts:94); `getUtilityModel` (configBaseCore.ts:516); `getModel` (config.ts:84)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Definition model/retry/per-turn limits/context, except getMaxSessionTurns: host admission counter in P16/P18, never maxStepsPerTurn. ModelPort owns auth/media transport; utility generation stays host-owned. |
| Policy, trust, tool selection and output | `truncateToolOutputThreshold` (configBaseCore.ts:145); `truncateToolOutputLines` (configBaseCore.ts:146); `enableToolOutputTruncation` (configBaseCore.ts:147); `getCoreTools` (configBaseCore.ts:244); `getAllowedTools` (configBaseCore.ts:247); `getToolDiscoveryCommand` (configBaseCore.ts:250); `getToolCallCommand` (configBaseCore.ts:253); `getApprovalMode` (configBaseCore.ts:273); `getPolicyEngineConfig` (configBaseCore.ts:293); `getDisableYoloMode` (configBaseCore.ts:308); `getSummarizeToolOutputConfig` (configBaseCore.ts:445); `getFolderTrust` (configBaseCore.ts:453); `addAlwaysAllowedCommand` (configBaseCore.ts:468); `isCommandAlwaysAllowed` (configBaseCore.ts:471); `getAlwaysAllowedCommands` (configBaseCore.ts:474); `getUseWriteTodos` (configBaseCore.ts:546); `getExcludeTools` (config.ts:105); `setApprovalMode` (config.ts:130); `initialWorkspaceTrust` (config.ts:71)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Authority/preference data and toolOutput in definition; catalog has immutable selection and trusted metadata (P04/P05a/P05b/P12/P16).                                                                          |
| MCP, extensions, skills and memory       | `shouldLoadMemoryFromIncludeDirectories` (configBaseCore.ts:174); `getDisabledSkills` (configBaseCore.ts:220); `setDisabledSkills` (configBaseCore.ts:223); `isAdminSkillsEnabled` (configBaseCore.ts:226); `setAdminSkillsEnabled` (configBaseCore.ts:229); `getMcpServerCommand` (configBaseCore.ts:256); `getMcpServers` (configBaseCore.ts:259); `getAllowedMcpServers` (configBaseCore.ts:262); `getBlockedMcpServers` (configBaseCore.ts:265); `setMcpServers` (configBaseCore.ts:270); `isJitContextEnabled` (configBaseCore.ts:287); `getExtensionContextFilePaths` (configBaseCore.ts:404); `getListExtensions` (configBaseCore.ts:410); `getExtensionManagement` (configBaseCore.ts:413); `getExtensions` (configBaseCore.ts:416); `setExtensions` (configBaseCore.ts:419); `getActiveExtensions` (configBaseCore.ts:422); `isExtensionEnabled` (configBaseCore.ts:425); `getEnableExtensionReloading` (configBaseCore.ts:432); `isSkillsSupportEnabled` (configBaseCore.ts:549); `getMemorySettings` (config.ts:118); `getProvidedInstructions` (config.ts:126); `updateSystemInstructionIfInitialized` (config.ts:134)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Host-kit source loaders and catalog lifecycle (P13/P16); instructions/context are values; no connection, settings or extension loader enters core.                                                             |
| Telemetry, logging and host metrics      | `getDebugMode` (configBaseCore.ts:232); `getShowMemoryUsage` (configBaseCore.ts:305); `getTelemetryEnabled` (configBaseCore.ts:311); `getTelemetryPerfEnabled` (configBaseCore.ts:318); `getTelemetryPerfMemory` (configBaseCore.ts:326); `getTelemetryLogPromptsEnabled` (configBaseCore.ts:329); `getTelemetryOutfile` (configBaseCore.ts:332); `getResponseLoggingEnabled` (configBaseCore.ts:335); `getMaxConversationHistory` (configBaseCore.ts:338); `getConversationRetentionDays` (configBaseCore.ts:341); `getMaxLogFiles` (configBaseCore.ts:344); `getMaxLogSizeMB` (configBaseCore.ts:347); `getDataRetentionEnabled` (configBaseCore.ts:350); `getConversationExpirationDays` (configBaseCore.ts:353); `getMaxConversationsStored` (configBaseCore.ts:356); `getDumpOnError` (configBaseCore.ts:389); `getUsageStatisticsEnabled` (configBaseCore.ts:401); `getConversationLoggingEnabled` (config.ts:144); `getTelemetryLogApiBodiesEnabled` (configBase.ts:40); `getTelemetryLogApiBodyMaxChars` (configBase.ts:46); `getTelemetryOutfileMaxBytes` (configBase.ts:52); `getTelemetryOutfileMaxFiles` (configBase.ts:58); `getConversationFileWriter` (config.ts:158); `setGitStatsService` (config.ts:165); `getGitStatsService` (config.ts:169); `getConversationLogPath` (config.ts:173); `getRedactionConfig` (config.ts:189); `getTelemetrySettings` (config.ts:201)                                                                                                                                                                                                                                                                                                                                                    | DiagnosticSink plus host lifecycle, redaction and retention options (P15); usage comes from core events.                                                                                                       |
| Shell, sandbox and network               | `getSandbox` (configBaseCore.ts:208); `getProxy` (configBaseCore.ts:392); `getShouldUseNodePtyShell` (configBaseCore.ts:480); `getAllowPtyThemeOverride` (configBaseCore.ts:483); `getPtyScrollbackLimit` (configBaseCore.ts:486); `getPtyTerminalWidth` (configBaseCore.ts:489); `getPtyTerminalHeight` (configBaseCore.ts:492); `getEnableShellOutputEfficiency` (configBaseCore.ts:507); `getEnableInteractiveShell` (configBaseCore.ts:537); `getSanitizationConfig` (configBaseCore.ts:552); `getShellReplacement` (configBase.ts:122); `isRestrictiveSandbox` (config.ts:88); `setPtyTerminalSize` (config.ts:212); `getShellExecutionConfig` (config.ts:229)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Host-kit executor/network options (P11/P12/P18); core sees effect metadata and result data only.                                                                                                               |
| Hooks                                    | `getEnableHooks` (configBaseCore.ts:528); `getEnableHooksUI` (configBaseCore.ts:531); `getHooks` (configBaseCore.ts:534); `getProjectHooks` (configBaseCore.ts:540); `setDisabledHooks` (configBase.ts:65); `getDisabledHooks` (config.ts:253)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Host runner and validated interceptor contracts (P17); reject unsupported hook outputs per Q1.                                                                                                                 |
| Session identity and lifetime            | `isContinueSession` (configBaseCore.ts:171); `getSessionId` (configBase.ts:19); `adoptSessionId` (configBase.ts:28); `getContinueSessionRef` (config.ts:136); `dispose` (config.ts:257)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Agent session/close and createAgent start options; host session index resolves latest before creation (P07/P09/P14).                                                                                           |
| Presentation, input and host protocol    | `setTerminalBackground` (configBaseCore.ts:177); `getTerminalBackground` (configBaseCore.ts:180); `getOutputFormat` (configBaseCore.ts:235); `getQuiet` (configBaseCore.ts:238); `getQuestion` (configBaseCore.ts:241); `getAccessibility` (configBaseCore.ts:290); `getBugCommand` (configBaseCore.ts:398); `getExperimentalZedIntegration` (configBaseCore.ts:407); `getNoBrowser` (configBaseCore.ts:439); `isBrowserLaunchSuppressed` (configBaseCore.ts:442); `getIdeMode` (configBaseCore.ts:450); `getComplexityAnalyzerSettings` (configBaseCore.ts:456); `isInteractive` (configBaseCore.ts:459); `getNonInteractive` (configBaseCore.ts:462); `getScreenReader` (configBaseCore.ts:510); `getEnablePromptCompletion` (configBaseCore.ts:513); `getInitialSettings` (configBaseCore.ts:525); `getOutputSettings` (configBaseCore.ts:543); `getLspConfig` (configBase.ts:69)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Host-only UI/process options, never AgentDefinition. LSP/IDE context is fetched in host-kit (P16/P20-P27).                                                                                                     |

### Remaining concepts and ownership

| Current concept and source                                                                                                                                      | New home                                                                 | Treatment                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgenticLoop` (`packages/agents/src/core/agenticLoop/AgenticLoop.ts:150`) and `AgentExecutionCoordinator` (`api/agentExecutionCoordinator.ts:24`)               | Core loop/mailbox in P02-P04 and P05a/P05b                               | Replace their state machines, do not forward to them. Current loop uses core turn/scheduler types and Node crypto; coordinator gates legacy safe-boundary operations.                                                                                                   |
| SessionClientOwner, SessionExecutionOwner, SessionSchedulerOwner, SessionToolCatalogOwner (`packages/agents/src/session/`)                                      | Core behavior plus individually owned host adapters                      | No replacement session service bag. Reusable tool/provider mechanisms are extracted in P11-P13, then old owners disappear in P28.                                                                                                                                       |
| PolicyEngine (`packages/policy/src/policy-engine.ts`), RuntimePolicyOwner (`packages/core/src/policy/policy-owner.ts:48,269`)                                   | Core policy evaluator                                                    | P05a/P05b implement D19 evaluation and decisions; P16 translates every policy form under the matrix below. Q4/Q5 isolate behavior conflicts, not unsupported syntax. No executor policy engine; sandbox enforcement remains external.                                   |
| Confirmation MessageBus (`packages/policy/src/confirmation-bus/message-bus.ts:37,86-182`)                                                                       | DecisionPort plus core decision state                                    | Tool decisions are request-scoped promises with abort, typed replies and grant bounds. Credential consent belongs to host auth, not the tool DecisionPort. Remove bus exposure from tools and hosts on their new path.                                                  |
| DEFAULT/AUTO_EDIT/YOLO and saved tool/MCP approvals (`CoreToolHostAdapter.ts:70-97`, `mcp-tool.ts:91-134`)                                                      | Preference layers plus offered grants                                    | Folder trust and organization restrictions become authority rules. Saved approvals become host-persisted preference rules, not immortal core grants. Cross-server identity is qualified.                                                                                |
| WorkspaceTrustLifecycle (`packages/core/src/services/workspace-trust-lifecycle.ts`)                                                                             | Host lifecycle publishing set-authority and revoking catalog sets        | Preserve withdrawal during running calls, not just on the next submitted turn.                                                                                                                                                                                          |
| BeforeAgent, BeforeModel, BeforeTool, AfterTool, PreCompress, AfterAgent (`packages/core/src/hooks/types.ts:38-49`)                                             | beforeTurn, beforeModel, beforeTool, afterTool, beforeCompact, afterTurn | Preserve only permitted add-context/block/patch/redact/continuation behavior. Arguments are re-prepared and policy checked after patches.                                                                                                                               |
| SessionStart/SessionEnd hooks                                                                                                                                   | Host acquisition/finalization hooks                                      | Run start before the first submit and end after agent close, while host resources still exist. Start context is loaded before creation. Never revive the old activation API.                                                                                            |
| Notification and observational AfterModel hooks                                                                                                                 | Host event subscribers                                                   | They cannot alter committed attempts. Subscriber failures go to diagnostics; slow observers cannot block the loop.                                                                                                                                                      |
| BeforeModel synthetic responses/request rewrites, AfterModel response replacement, BeforeToolSelection toolChoice (`hooks/types.ts:306-409,708-750`)            | **No approved interceptor home: Q1**                                     | Do not hide these mutations inside ModelPort or silently ignore them. Explicitly reject unsupported configured behavior until the product disposition is recorded.                                                                                                      |
| HistoryService, RecordingIntegration and SessionControl                                                                                                         | Core journal plus host SessionStore/session index                        | One conversation source of truth. Approved Q2 imports old records explicitly offline in P14; no automatic compatibility path remains. Workspace rollback remains separate from transcript rewind.                                                                       |
| TaskTool/SubagentOrchestrator (`packages/agents/src/core/subagentOrchestrator.ts`, `api/child-agent-assembly.ts`)                                               | Core start_subagent for turn-owned work                                  | Intersect tools and full parent policy; share budget reservations. Child grants stay local.                                                                                                                                                                             |
| Detached async tasks and shell jobs (`packages/agents/src/session/task-launch-owner.ts`, `shell-job-owner.ts`; `packages/tools/src/tools/check-async-tasks.ts`) | Host-managed agents and process jobs in P18                              | Each background agent is an independent conversation with explicit host policy/limits. A core child is never detached. Host job registry supplies status/cancel tooling; process jobs are not invented as agents.                                                       |
| Memory, skills, MCP prompts/resources, IDE selection                                                                                                            | Host loaders to InstructionBlock, ContextItem or UserInput               | Trust and lifetime are explicit; untrusted content is never promoted to system instructions. Memory writes remain policy-controlled tools.                                                                                                                              |
| Direct image CLI and utility generation                                                                                                                         | Host adapter operations                                                  | Existing API includes generate/generateJson/generateEmbedding; these are not reasons to add methods to the conversation Agent. Call ModelPort for utility text/JSON, retain an explicit provider embedding/image service where the approved ModelPort has no operation. |
| Old text/thinking/retry/attempt-boundary events (`packages/agents/src/api/event-types.ts:105-242`)                                                              | Core attempt-scoped events; host presentation reducers                   | Discarded provisional output is removed. A continuation after an already committed response must not be treated as a discarded retry. Keep #3840 host behavior tests for paragraph separation where committed continuations remain.                                     |
| Old usage/model-info/tool-status/compression/done/error events                                                                                                  | AgentEvent, AgentSnapshot and TurnResult                                 | Host protocol serializers project external wire behavior; they never recreate the old Agent interface. Refusal/citations remain content and finish metadata, with typed value definitions completed in P01/P03.                                                         |
| Provider replay fields (`IContent.ts:761-794`, AnthropicMessageNormalizer, OpenAIResponsesInputBuilder, geminiResponseMapper)                                   | Core model entries and journal; provider schemas in P11                  | D14 envelopes flow ModelChunk -> committed TranscriptEntry -> SessionStore -> ModelRequest; scope-filter across model/endpoint changes, no adapter history cache.                                                                                                       |
| Early/failed usage (`AnthropicStreamProcessor.ts:159-166,297-334`)                                                                                              | Core per-attempt accounting P01/P03/P07; normalization P11               | D15 cumulative usage/error reports survive discarded content; unknown charges retain reservations and are labelled estimated.                                                                                                                                           |
| Provider-internal image/parent/SDK/transport recovery                                                                                                           | Core retry admission; single-dispatch provider primitives P10/P11        | D16 recovery values replace hidden second sends; legacy callers retain shared transport orchestration only until cutover.                                                                                                                                               |
| getMaxSessionTurns (`configBaseCore.ts:202`, `MessageStreamOrchestrator.ts:410-426`)                                                                            | Host admission P16/P18 and every cutover                                 | Counts live-conversation accepted submits, resets on fresh host creation/resume, not per-turn steps; see session decision.                                                                                                                                              |
| Thinking-only continuation (`MessageStreamOrchestrator.ts:657-707`)                                                                                             | P03 candidate boundary plus P17 built-in interceptor                     | D17 read-only view, at most two follow-ups, same turn budgets/cancel; no discard of committed thinking.                                                                                                                                                                 |
| Todo continuation/reminders (`MessageStreamOrchestrator.ts:710-765`, `TodoContinuationService.ts`)                                                              | P12 task tools/store; P17 built-in interceptor                           | Pending todos and reminder state continue with user hooks disabled; state is per-turn plus durable session-keyed todos, not a host model loop.                                                                                                                          |
| todo_pause (`packages/tools/src/tools/todo-pause.ts:110-158`)                                                                                                   | P12 typed tool outcomes; P17 pause semantics; P14 fork storage           | Successful persisted pause suppresses continuation; failed pause does not. New explicit input unpauses, resume alone does not; fork state is independent.                                                                                                               |
| AppContainerRuntime props and React contexts                                                                                                                    | Host view store, input handlers and decision queue                       | P23 view reducer, P24 DecisionPort, P25 host-only handlers and P26 import cleanup prepare the switch; P27 deletes the remaining 33-bind bridge execution wiring. Preserve genuinely presentational contexts; no requirement to reduce arbitrary React context counts.   |
| DebugLogger, root telemetry, perf observers                                                                                                                     | DiagnosticSink and host event consumers                                  | Root ownership, bounded buffering, redaction and flush are host responsibilities. Core receives no logging settings.                                                                                                                                                    |

## Contract completion and implementation decisions

The HTML is the behavioral specification, not a fully compiling package. It references undeclared value types such as Usage, TranscriptEntry, SubagentTemplate, CloseReport, Sequence and DiagnosticRecord. P01 completed those types from their described behavior in PR #4076 without importing old core types; P01a owns the subsequent amendments. Keep the public methods and port directions shown in the design:

```ts
declare function createAgent(
  definition: AgentDefinition,
  host: AgentHost,
  start?:
    | { resume: SessionId }
    | { fork: { from: SessionId; at: CheckpointId } },
  signal?: AbortSignal,
): Promise<Agent>;

declare function loadHostSources(
  input: HostSourceInput,
  signal: AbortSignal,
): Promise<HostSources>;
declare function buildDefinition(sources: DefinitionSources): AgentDefinition;
```

The last two signatures are new host-kit contracts. HostSourceInput contains captured argv/env/cwd plus explicit host capabilities. HostSources separates DefinitionSources, workspace/catalog options, model/credential inputs, persistence, diagnostics and presentation. `buildDefinition` receives only the plain-data definition projection, not credentials or adapter objects. Host sources are never passed to createAgent. Required values are validated; do not invent a provider/model fallback when the selection is missing.

Implementation decisions, not questions for Andrew:

1. Use the existing TypeScript/Bun workspace and `bun:test`. Root package currently requires Node >=24.22.1 and Bun >=1.4.4 and declares TypeScript 5.8.3, Zod and fast-check 4.5.3. Use existing libraries only after verifying their pure entrypoint dependency graph. Agent-core does not borrow value types from legacy core.
2. Permit only non-I/O language/platform primitives in core: AbortController, Promise, byte arrays, time/timers behind Clock, and Web Crypto IDs. No Node crypto import, environment, process, filesystem, fetch, sockets, terminal, telemetry exporter or dynamic host loader. FakeClock supplies deterministic deadlines; fake-port fixtures compare identity relationships rather than random ID literals.
3. The design's path matcher values are declarative policy data, as section 8 explicitly shows. The ban on paths in the definition forbids configuration/workspace-location service inputs, not the policy selectors explicitly defined there. The adapter supplies real paths and parsed argv in prepared data, and core evaluates selectors without touching the filesystem.
4. Required adapter inputs have no ambient fallback. The approved optional store, diagnostics, clock and interceptors retain their specified semantics. No store means a deliberately in-memory conversation; resume/fork fail at creation, never silently start fresh.
5. Core owns model retry/fallback, compaction and limits. Remove a second semantic retry layer on the new invocation route. Credential refresh may happen inside auth, but a second model request must be visible and budgeted as a new attempt.
6. Every journal append that precedes an external action is awaited. The persistent envelope needs a version, durable sequence watermark, session identity and checkpoint/branch metadata so event sequence never resets after resume. Complete these omitted representation details in P07 without changing SessionStore's ownership contract. Progress stays lossy and unpersisted; a restart need not replay provisional text, but cannot reuse its sequence numbers.
7. `TurnResult` includes a count of dropped steering on cancellation, because section 6 requires reporting it although the displayed type omits the field. That value-type completion belongs to the delivered P01 scope. Unknown protocol/error values are validated at adapter boundaries, not caught and disguised as success.
8. Split tools and MCP adapters: builtin preparation/preconditions and external discovery/revocation have different conformance risks. Keep a separate hook slice because current mutating hooks exceed the six approved points. Keep host-managed background work separate from core children because the design assigns different owners. These choices account for the extra slices.
9. Host-owned utility operations, profile persistence, browser/session metadata, IDE and terminal services are explicit host-kit APIs with narrow input/result types. Do not pass a catch-all host object to UI components or create a new Agent getter bag under another name.

### Provider replay and attempt accounting

P01 delivered the completed model port; P03 implements budgets against it. `ProviderReplayData` is a versioned JSON envelope scoped by provider, model, opaque endpoint and principal identities, plus connection identity only for connection-bound material. It targets a model entry or a stable part ID. Text/thinking chunks carry that part ID; a tool-call part uses its call ID. Replay chunks replace the same envelope ID within one provisional attempt. Only finish commits the complete entry and envelopes together. A failed attempt never contributes replay to later prompts.

P11 schemas cover Anthropic `sourceField`, signed/redacted thinking and stream block identity, Responses encrypted reasoning and genuine reasoning/response IDs, and Gemini automatic-function-calling metadata. Reuse the real converters listed in the evidence table. Store data, not SDK instances, closures or credential-bearing request objects. AFC history can describe prior content but cannot cause SDK-side tool execution; core owns all calls. Native response IDs must not be synthesized as if issued by the provider.

P07/P14 journal the committed envelope unchanged and validate record/version/target integrity. Resume and fork restore it from core history, not an adapter-local cache. Core filters request replay against `ModelClient.info.replayScope`: provider/model/endpoint/principal must match; an envelope carrying a connection ID additionally requires that connection. Durable signed/encrypted reasoning omits connection identity, while connection-bound parent IDs expire on reconnect. Resolve a new immutable client info snapshot before an attempt after a scope change. Keep parent IDs in separate envelopes from durable reasoning, so invalidating a parent does not discard its encrypted content. Preserve the original entry for audit and switching back to a compatible durable scope. Do not attach signed/encrypted payloads to compacted or edited text. The current request uses only replay attached to its surviving history entries; compaction summaries have no inherited replay. Invalid payloads for a matching scope fail typed rather than being silently omitted. On a foreign scope, omit provider-only thinking from native requests where it cannot be represented safely, retain ordinary text/tool content, and keep the original thinking in the journal. Record replay exclusions in diagnostics without logging payloads.

`UsageReport` is noncommitting and cumulative per attempt. Omitted counters mean unknown, not zero; a complete report must supply every counter. Normalize provider units so input includes cache read/write subsets and output excludes reasoning; never add the cache subsets again. A finish carries the final UsageReport, marked complete only when all counters are known; content completion does not invent missing usage. Incomplete finish accounting retains the same conservative charge as an incomplete sent failure. `ModelError.usage` can carry the last or complete totals on failure/cancel. Merge partial reports by replacing present counters, validate monotonicity, and reconcile duplicate final reports once by attempt ID. Never invent finish to carry usage.

Before dispatch reserve input/output/reasoning upper bounds and their price. On complete accounting, charge actual totals and release the unused reservation even when content failed. On sent/unknown failure with incomplete accounting, retain component-wise max(reservation, reported) as an estimated charge. For a proven not-sent failure, release the reservation except any reported charge. Unknown cost retains the reserved price and adds known overshoot through `price`; it never becomes free. Token and cost admission use this conservative ledger. TurnResult/snapshot Usage totals contain only reported usage; separate accounting events and journal records expose charged usage, estimation and completeness, so a reservation is never presented as measured billing. Compaction, retry and children use the same ledger and each attempt is charged once.

P07 journals `attempt-budget` reserved before dispatch and settled after it; crash recovery settles unmatched reservations conservatively and never retries them. Reported usage may be incomplete after transport loss, which is explicitly represented rather than deferred as an undefined channel. P03 tests early input/cache usage then truncation, abort after usage, duplicate error/finish totals, no-report sent failure, proven pre-dispatch failure, pricing and a retry denied because the failed attempt exhausted the budget.

### Provider-internal recovery census and cut

This extends the earlier Config census; those lexical counts do not measure transport requests.

| Source verified in this worktree                                                                                                                                                                   | Hidden or existing behavior                                                                                      | New-route decision and executable evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/providers/src/anthropic/AnthropicProvider.ts:730-841`                                                                                                                                    | Image-dimension rejection can sanitize and issue a second call; recovery state is shared with RetryOrchestrator. | Extract single dispatch plus pure recovery description. Return a versioned ModelRecovery containing image part IDs/budget facts, not a retained request body. Core accepts at most one image-repair cycle and retains the validated instructions for all remaining attempts of the same logical request and compatible scope. Every retry rebuilds the repaired payload and requires separate admission within normal maxAttempts and budgets. Test a dimension-error 400, a retryable transport failure on the repaired successor and a further repaired retry, including cancellation and exhausted limits before the final send. |
| `packages/providers/src/openai-responses/openAIResponsesExecutor.ts:270-322`                                                                                                                       | Rejected previous_response_id invokes retryWithoutStatefulness before yielding content.                          | Return rejected-parent recovery data and stop. Core records parent invalidation, then may admit a full-history successor. Rebuild from core transcript and replay. Resume honors the invalidation and never repeats the dead parent automatically.                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/providers/src/openai-responses/openAIResponsesStreaming.ts:42-163` and `openAIResponsesWebSocketTransport.ts`                                                                            | WebSocket renewal and fallback can rebuild and issue another generation over WebSocket or HTTP.                  | Each generation send is one core attempt. A connection handshake alone is not a model attempt; any generation resend is. Return transport/parent recovery facts instead of invoking a fallback closure. Test a local WebSocket fixture plus HTTP server, including partial-output failure and reconnect.                                                                                                                                                                                                                                                                                                                            |
| `packages/providers/src/anthropic/AnthropicProviderInternals.ts:78`, `packages/providers/src/openai/OpenAIClientFactory.ts:197`, `packages/providers/src/openai-vercel/vercelRequestParams.ts:142` | These SDK paths already set maxRetries to zero.                                                                  | Keep zero on both routes. Verify 429/5xx/truncation with actual server request counts; checking a constructor option alone is insufficient. Inventory Responses client creation and the Gemini plugin transport/SDK options in P10, then prove the same property.                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/providers/src/RetryOrchestrator.ts`, ProviderManager and credential-bucket composition                                                                                                   | Outer retries, credential rotation and failover can dispatch again.                                              | New ModelPort does not use RetryOrchestrator. Refreshing credentials may perform auth I/O, but another generation is a new core attempt. A failed bucket produces a scoped recovery description or typed error, not a concealed generation.                                                                                                                                                                                                                                                                                                                                                                                         |

`ModelError.recovery` and `ModelRequest.recovery` are a plain-data, versioned, scope-checked pair. Core owns the recovery value and its explicit invalidates list of entry/envelope IDs, validates those references against the failed request and scope, discards provisional output, and journals invalidation facts. The adapter validates and applies reconstruction instructions; it never chooses when to send. Dispatch authorization covers one attempt only. Core retains validated reconstruction instructions for every remaining attempt of the same logical request and compatible scope, including ordinary retries after a repaired successor fails. Each later request is rebuilt from core history plus those instructions, without an adapter conversation/request cache or another repair cycle. Core clears the retained reconstruction state when the logical request ends or its scope becomes incompatible; it cannot transfer to a fallback model. Before every stream call, core separately checks abort, retry kind, maxAttempts and budgets, admits the attempt and charges its usage once. Retained instructions grant no extra retry. Core applies invalidation by ID without inspecting provider JSON. Recovery envelopes for reconnect use the durable provider/model/endpoint/principal scope and name the old connection-bound envelopes to invalidate. Pure validation failures are not retryable. Image repair and rejected-parent recovery can be retryable invalid-request errors only when a valid reconstruction exists. Unrelated 400 responses remain terminal. Repeated repair of the same condition is rejected; reapplying retained instructions during request reconstruction is not a new repair cycle, and the value records the attempted repair.

Legacy callers retain their existing recovery orchestration over the extracted single-dispatch functions until their host switches. This is shared transport extraction, not a legacy-Agent facade or a new-path compatibility wrapper. P10 measures the retained/replaced code including these branches before declaring extraction bounded; P11 completes every family's wire-count matrix. One port call means at most one generation dispatch, including failure paths, and each core retry has a new attempt ID and its own usage.

### Decisions record: saved conversations and policy forms

**Q2 decided, Option A approved:** 0.12.0 ships a one-time, explicit offline import into a new journal/session. Leave the old file untouched; import only provable content, drop old grants, label uncertain effects and never repeat them, and reject malformed histories. P14 includes implementation and tests. There is no automatic old-format resume, old runtime or dual-format writer.

**Entry point chosen:** `llxprt sessions import <old-file>`. A subcommand isolates migration from normal conversation startup and cannot accidentally combine import with a prompt, model invocation or resume. `packages/cli/src/config/cliArgParser.ts` already registers host subcommands for hooks/extensions/skills/MCP; P14 adds the sessions command there, dispatched before agent/model/tool acquisition. It accepts one source file, obtains an offline source lock, validates into a private destination, durably publishes one new session and prints its ID and import notices. Refuse an active source, a changed source digest, destination collision or unsupported format. Import receipts keyed by source digest make a repeated explicit invocation return the already-published destination, not append a second copy. A crash before publication leaves no discoverable partial session; source bytes never change. Normal resume does only format recognition and returns `import-required` with this command, not legacy replay or an empty conversation. ACP, a2a and both CLI hosts surface the same failure.

**Source evidence and import rules:** `packages/core/src/recording/types.ts` defines v1/v2 event envelopes (the supported set is in ReplayEngine), content, compression, rewind and metadata, but no durable per-call start or session-grant event. `ReplayEngine.ts` skips malformed interior records and drops an invalid final line, resets history to `[summary]` on `compressed`, and invalidates `responsesStored` because parent lifetime is unproven. The importer must not call that permissive runtime replay function. Extract only format schemas/pure folding where suitable into a host-kit offline reader; validate every record and its sequence, reference and payload. Reject corrupt tails as well as interior corruption, unknown event versions/types and contradictory chronology. Validate record envelopes and replacement payloads in sequence, then check call/result pairing and uniqueness within each resulting active history, not against an append-only set of all historical IDs. Duplicate or orphan results in an active history are errors; an ID repeated by a replacement snapshot is not itself a duplicate. Known missing tool outcomes are uncertainty, not malformed syntax. Respect valid rewind cuts, compression, semantic-media-purge and refusal-rewrite history replacements; do not resurrect removed content/media. Validate/copy referenced media into the new store without mutating old media or retaining a dependency on the source runtime.

The offline reader handles every current `SessionEventType` explicitly. This table is also P14's exhaustive format contract; unknown types are errors, not ignored metadata.

| Event type | Offline fold and audit treatment |
| ---------- | -------------------------------- |
| `session_start` | Validate source session/project identity and header ordering; retain source metadata, allocate a new destination ID. |
| `content` | Append validated content to active history. |
| `compressed` | Replace active history with the recorded summary, mark the unavailable range; preserve source evidence separately. |
| `rewind` | Apply the validated history cut and retain the rewind record for audit. |
| `semantic_media_purge` | Validate the recorded history and frontier, install the replacement, and do not restore purged media. |
| `refusal` | Validate its payload and preserve it as audit only; never append it to model history. |
| `refusal_rewrite` | Validate the complete payload and `resultingHistory`, then replace active history. Retain operation/prompt/reviewer metadata, explanation and original/new text in audit only. No reviewer, hook or model runs. |
| `provider_switch` | Fold recorded provider/model metadata; it does not prove replay principal/connection scope. |
| `session_event` | Preserve the validated diagnostic event separately from active history. |
| `session_metadata` | Fold recorded session metadata, subject to replay-scope exclusions. |
| `directories_changed` | Fold recorded workspace metadata; do not change live cwd or grant workspace authority. |
| `checkpoint_created`, `checkpoint_renamed`, `checkpoint_deleted` | Fold validated checkpoint metadata separately; no model content or historical durability is invented. |
| `session_forked`, `session_named` | Fold lineage/title metadata separately, without reusing old runtime ownership. |

For `refusal_rewrite`, verify the schema in `refusalRewritePayload.ts` and the speaker/content structure, then validate converted content and active call/result relationships before publication. The source sequence IDs remain unique even when a replacement repeats content call IDs. Reset active pairing/uniqueness state to the replacement history, validate its internal pairs and subsequent tail, and retain the displaced source records in audit. A malformed replacement fails the entire import rather than being skipped as by permissive runtime replay. Earlier malformed records cannot be hidden by a later valid replacement. Audit text is never appended to active model history.

`IContent.ts` supplies tool_call.id/parameters, tool_response.callId/result/isComplete, thinking signatures/encrypted content and provider/model/baseURL metadata. Pair completed calls with validated terminal results, preserving recorded outcomes without claiming independently verified effects. An unmatched call or explicitly incomplete response becomes an imported indeterminate result and notice; never synthesize a historical PreparedToken or claim a durable tool-started record existed. Close the imported turn without execution. Preserve a compressed summary and surviving tail, mark the unavailable pre-summary range, and never transfer signatures to summary text. Missing grant data means no grants, not permission to recover approvals from policy files. Any recognized approval metadata or adjacent saved-approval artifact is reported and ignored; do not load `auto-saved.toml` as imported session authority.

Provider replay present in old content is retained in the imported-history audit blob and activated only if the adapter validates payload, target and the full D14 provider/model/endpoint/principal scope from recorded evidence. Old metadata has no guaranteed principal or connection identity: do not fill it from current credentials. Without proof, omit it from native replay and report `replay-excluded`; ordinary text and tool content remain usable. Missing replay is valid and produces no fabricated signature, parent ID or AFC state. Always discard old `responsesStored` chain eligibility, matching the existing replay rationale. An incompatible historical thinking block stays in the audit transcript, not an invalid native request.

**Q3 decided:** retain every existing policy form. D19 extends the plain-data matcher and the core evaluator. There is no source-feature removal list, executor-side evaluator or legacy PolicyEngine behind a port. The exact translation matrix below records current behavior, including source-path differences. Q4 and Q5 isolate actual conflicts between old outcomes and the authority/compound-dispatch guarantees; they do not reopen Q2 or Q3.

### Policy source translation matrix

P05a owns the single evaluator, reusing P01a regex compilation; P05b owns decision/dispatch integration. P16 loads and translates plain data, never permission outcomes. Provenance includes source kind, opaque source ID (resolved to file path by host diagnostics), rule/expansion index, original tier/priority and observed insertion order. `PolicyRule.priority` is the effective finite number; missing old priority becomes zero. Equal priorities retain insertion order, including base rules before evaluation-overlay rules. Do not sort filenames anew: `scanTomlDir` preserves readdir order and `getPolicyDirectories` supplies admin/user/default directory order. Capture that order in the definition.

| Existing form/provenance                                                             | Exact plain-data representation                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner and tests                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing tool name, exact tool name, toolName array, mcpName, explicit toolNamePrefix | Missing matcher means all; arrays expand in source order. `PolicyMatch.sourceTool` retains exact OR startsWith matching against a host-resolved source identity. A literal `*` in toolName stays literal, not a glob; mcpName-only expands to the `${server}__` prefix. Qualified catalog identity and server spoofing checks remain mandatory.                                                                                                                                                   | P16 TOML fixtures and P05a/P05b identity tests; toml-loader.test.ts tests literal trailing star and explicit MCP prefix separately.                                                                                                                  |
| Priorities and tiers, including ties                                                 | Preserve `tier + priority/1000`, integer source priority 0..999, tier 1 default/2 user/3 admin. Core ranks descending effective priority then ascending order. Direct rules retain finite numeric priority and default zero.                                                                                                                                                                                                                                                                      | P05a/P05b ties for overlapping allow/deny, base versus overlay and later additions; P16 boundary priorities 0/999 and tier-overflow validation.                                                                                                      |
| Admin priority-dependent allow/ask/deny exceptions                                   | Place the full sorted admin source stack in PolicySourceStack.preferences, separate from independently editable preferences. Derive each admin deny/ask into that same stack's restrictions with `match.unless` containing complete predicates of all earlier admin rules, including modes; same-priority earlier declarations count. An admin allow excludes its scope from lower admin restrictions but grants no exception to independent trust/organization restrictions.                                                                                                                       | P05a/P05b/P16 high allow or ask over lower deny, reverse priorities, ties and admin ask over lower user deny; atomic source replacement/removal while decisions wait. Genuine preference-over-authority overrides remain Q4, not an untranslatable syntax form.                                              |
| Settings and remembered approvals                                                    | Preserve MCP excluded 2.9, tools excluded 2.4, tools allowed/CLI allowed 2.3, trusted MCP 2.2, MCP allowed 2.1 and runtime confirmed 2.95. These are ranked preference decisions unless an independently supplied host authority restricts them. Saved approval TOML uses its actual written priority, not 2.95: config.ts writes 100 for tools and 200 for MCP (2.1/2.2 on reload).                                                                                                              | P16 exercises both settings config and config-source overloads, ShellTool(args), persisted reload versus live confirmation, and trust withdrawal. P05a/P05b grants cannot defeat authority but do not gain blanket precedence over a user 2.99 deny. |
| modes on any rule, including authority and exceptions                                | `PolicyMatch.modes`; absent/empty means all. Keep inactive rules and their compiled patterns. One set-preferences command updates layers and PolicyDocument.approvalMode atomically at section 10's policy point.                                                                                                                                                                                                                                                                                 | P05a/P05b mode changes in both directions while waiting for a decision and between calls; P16 uses the same files for default/autoEdit/yolo without reloading or filtering away rules.                                                               |
| Directory TOML argsPattern                                                           | `ArgMatcher.serializedArgs: PolicyRegex` with effective source from buildArgsPatterns: replace every literal `.*` source occurrence with `[^"]*`, flags ''. This is a source-string replacement, even inside escaped/class text. Preserve stableStringify's sorted-key whole-object subject.                                                                                                                                                                                                      | P05a/P05b regex semantics and P16 quoted/backslash/nested/array/empty argument corpus; do not reinterpret as a field selector. Empty TOML argsPattern gives no pattern.                                                                              |
| Directory TOML commandRegex                                                          | Effective source is `"command":"(?:PATTERN)` with flags ''; test against the complete stable serialized args. Do not strip anchors, add an end anchor, decode JSON text or rewrite dot-star.                                                                                                                                                                                                                                                                                                      | P16 uses utils.test.ts and toml-loader.test.ts cases plus alternation, anchors, quotes and newlines. Empty commandRegex gives no pattern.                                                                                                            |
| Directory TOML commandPrefix string/array                                            | JSON-escape backslashes then quotes, regex-escape that result, prepend `"command":"` and append the existing `(?:[\s"]\|$)` boundary. Expand pattern first, then tool-name array, preserving order.                                                                                                                                                                                                                                                                                               | P16 quoting/operator/whitespace fixtures; P05a/P05b existing parsed-argv commandPrefix remains a distinct new authored form, never a guessed translation.                                                                                            |
| Single-file loadPolicyFromToml and dynamic runtime regex rules                       | Emit their actual effective source/flags without the directory loader's dot-star rewrite. The single-file commandRegex wrapper is `"command":"PATTERN` without a noncapturing group; its commandPrefix only regex-escapes text, and its expandTomlRule drops modes/allowRedirection. Dynamic confirmed prefixes also only regex-escape, and direct RegExp rules preserve flags with fresh lastIndex zero. These differences remain explicit source-reader transformations, not another evaluator. | P16 compares both entry paths separately; P05a/P05b backreferences/lookaround/flags and repeated matching. Invalid source combinations produce errors before agent effects; no partial loading.                                                      |
| allowRedirection true/false/omitted                                                  | Field on PolicyRule. Only the winning allow for the current simple command exempts its redirection ask; outer compound permission is not inherited by different segment winners. No-match fallback allow bypasses the simple-command redirection check today.                                                                                                                                                                                                                                     | P05a/P05b/P16 explicit true/false/omitted, competing winners and fallback-only fixtures. Preserve facts from hasRedirection, where pipes are not redirects.                                                                                          |
| Shipped yolo.toml and source spelling                                                | File uses `allow_redirection = true`, but PolicyRuleSchema accepts `allowRedirection`; Zod strips the snake-case field. Its effective rule has no exemption today, unlike manually constructed overlay tests with allowRedirection true. Translate the actual effective rule and report the ignored field in host diagnostics; no silent correction to shipped policy.                                                                                                                            | P16 parity reads the real shipped file as well as a camel-case fixture. This documents existing behavior without changing that file in this task.                                                                                                    |
| Destructive hard deny                                                                | Core-owned pure classifier before rule selection and grants, using exact raw command on descriptors for current shell identities. No source rule can remove it.                                                                                                                                                                                                                                                                                                                                   | P05a migrates classifier tests and proves no dispatch under YOLO, high allows, exemptions or grants. P12 supplies facts only.                                                                                                                        |
| Compound command and parse behavior                                                  | Preserve evaluateMatchingRule/evaluateCompoundCommand/evaluateDefault branches detailed below, with unchanged non-command args, same mode/revision, same splitter and strictest segment result.                                                                                                                                                                                                                                                                                                   | P05a/P05b mixed allow/ask/deny, pipeline/background/quoted separators, empty split, preserved dir_path and no-rule fallback. Q5 isolates the existing matched-ask early return before later segments.                                                |
| Noninteractive decision mapping                                                      | Core returns ask; the headless DecisionPort with onAsk deny yields the existing external denial. Test the old nonInteractive true result against that completed decision, not against an untranslated intermediate ask.                                                                                                                                                                                                                                                                           | P16 evaluator parity uses interactive mode for raw decisions, then separate headless integration fixtures; P20 tests deny/fail/explicit approve distinctions.                                                                                        |

**Priority versus authority, evidence and reconciliation.** `policy-engine.ts` compareRulePriority/findMatchingRule uses one descending sort and first match; source is not consulted, specificity does not win ties, and constructor/addRule impose no tier cap. `policy-engine.test.ts` tests "uses first matching rule by priority", "specific tool rule with higher priority overrides wildcard" and "pattern-specific rule overrides general tool rule when higher priority". Its equal-priority test uses different tools, so P05a adds overlapping ties. `toml-loader.test.ts` validates tier bounds and rejects >=1000; `core/src/policy/policy-owner.test.ts` proves priority-3 deny beats a 2.95 session allow in YOLO. Thus normal user TOML cannot outrank admin TOML. An admin allow at 3.9 beating admin deny at 3.1 is expressible without preference overriding authority: the authority owner defines the deny's effective domain to exclude that earlier rule. Copy its full match predicate into source-owned restrictions, not a live reference to a mutable preference rule. Removing or changing ordinary preferences alone cannot alter that exclusion. Independent authority domains still intersect strictly.

**Atomic source-stack updates.** `PolicyDocument.sourceStacks` contains `PolicySourceStack { id, restrictions, preferences }` pairs. All admin files in the same priority domain form one group, including cross-file ordering and exceptions. `authority` remains independent trust/organization restrictions, while top-level `preferences` excludes the paired source-owned copies. Evaluate restrictions from both locations, and rank all preference rules by the original global priority/order, not by container concatenation. P01a supplies a pure derivation/validation helper: each pair must carry the complete ranked source rules and exactly their derived deny/ask domains with earlier-rule predicates. No authority-allow rule is introduced.

The trusted builder sends one `set-source-stacks({stacks})` command to replace the complete collection, including both copies and removals, at one policy application point/revision. Validate all pairs and compile their regexes before installation. Duplicate IDs, inconsistent derivation or invalid regex reject the entire command without changing policy or settling pending decisions. Publish the new immutable snapshot before rechecking grants, evaluating or settling pending decisions, or admitting dispatch. This matches the atomic visibility of `PolicyEngine.replaceRules` rather than exposing two updates. `set-authority` only changes independent authority; `set-preferences` only changes independently editable layers and approvalMode. Neither command can mutate a source-owned copy. Source replacement preserves those independent fields. P02 tests snapshot installation; P05b and P16 test live moves of an exception from operation A to B and source-rule/group removal, with no hybrid evaluation or irreversible settlement.

A raw runtime allow at 4 and admin-labelled deny at 3 instead returns allow under today's source-blind engine, by the same first-match code. No inspected test specifically labels that pair admin/user; the priority tests establish the mechanism, not that stronger coverage claim. Q4 requires an explicit disposition for such externally supplied cross-authority stacks. Preserve their values and provenance for the decision; do not silently cap, demote, drop or reclassify them. Standard TOML, settings and within-admin exceptions have exact representations now.

**Shell branch details.** The current engine hard-denies destructive raw commands first. A matching deny or ask returns immediately. A matching allow splits commands: zero segments for nonempty input asks; more than one evaluates trimmed segments other than the original recursively, preserving other args; one segment checks redirection against the matching rule. Segment deny wins; otherwise ask wins; all allow permits. With no matching rule and non-deny fallback, it checks compound segments but retains fallback ask even when every segment allows. Default deny returns immediately. A simple fallback allow does not perform the redirection or empty-split ask check. `utils/shell-utils.ts` is a quote-aware lightweight splitter, not an AST validator: unmatched quotes are not automatically parse errors, and the malformed-command safety test can pass through an unknown-segment ask. Carry its exact policySplit facts separately from richer argv parsing. A matched whole-call ask can mask a later segment deny; Q5 addresses the conflict rather than quietly replacing this branch with unconditional strictest aggregation.

**Regex decision: native parity.** Core compiles PolicyRegex with native JavaScript `RegExp`, the same flavor and flags used today (`packages/policy/src/utils.ts:15,62-77`, `toml-loader.ts:284,584`, `policy-engine.ts:19`). Native RegExp is pure computation and satisfies agent-core's import rule without an added dependency or a host callback. Keep flags from each source path and reset lastIndex to zero for each test, matching the current fresh-RegExp behavior. Keep stableStringify, whole-object subjects and every wrapper/rewrite in the matrix above.

Retain `MAX_POLICY_REGEX_SOURCE_LENGTH = 1,024` UTF-16 units and the adjacent-quantifier heuristic at every existing path-specific invocation of `validatePolicyRegex`, without adding checks to paths that have none:

| Input path | Validation and transformation order |
| ---------- | ----------------------------------- |
| Directory argsPattern | Validate authored text; compile native RegExp with empty flags; validate normalized `.source`; replace literal dot-star source occurrences; compile the effective pattern. No post-rewrite cap. |
| Directory/utils commandRegex | Validate authored text; build the grouped command wrapper; compile. No generated-wrapper cap. |
| Directory/utils commandPrefix | JSON-escape then regex-escape each expanded prefix, add the boundary wrapper, compile. No length/heuristic check. |
| Single-file argsPattern | Validate authored text, compile; no second native-source check and no dot-star rewrite. |
| Single-file commandRegex/commandPrefix | Build the ungrouped regex wrapper or regex-escaped prefix wrapper first, validate that generated pattern, then compile. No separate authored check. |
| Direct utils argsPattern | Validate the supplied native `.source`, rewrite dot-star, compile with preserved flags; there is no loader-authored check. |
| Direct/dynamic regex and dynamic commandPrefix | Compile the supplied regex or regex-escaped prefix wrapper; preserve direct flags. No length/heuristic check. |

`PolicyRegex.input: PolicyRegexInput` records the path and original selected/expanded text, or native source/flags for utils/direct RegExp inputs. P01a's pure `normalizePolicyRegex(input): PolicyRegex` performs those stages, retaining input evidence alongside effective source/flags. Definition and command validation rerun the stages and reject any effective source/flags mismatch. Normalize native `.source` when comparing effective patterns, preserving its escaping; never treat an arbitrary caller-supplied list of checks as proof of validation. Empty optional scalar TOML fields yield no matcher; preserve array expansion, including empty array elements, exactly as each loader does. No RegExp instance crosses the plain-data boundary. Definition validation compiles all patterns, including inactive rules and exception predicates; syntax/flags, staged validation and evidence mismatch errors report sourceId/ruleIndex/field before publication or any effects. No invalid pattern becomes a non-match or permissive fallback.

Required boundary probes: a 1,024-unit commandRegex yields a 1,035-unit single-file wrapper and is rejected there, but remains accepted by the directory path. An argsPattern of 513 forward slashes passes authored validation but its native `.source` has 1,026 units and fails the directory's second check; the single-file path accepts it. Retain ordinary 1,024/1,025 tests, prefix expansion boundaries and heuristic-stage cases. These differences come from `toml-loader.ts:280-305,540-584` and `utils.ts:48-77`, not a universal pre-wrapper rule.

**Possible follow-up issue, outside this plan:** catastrophic backtracking remains possible and behaves as today. The existing source cap and heuristic do not guarantee execution time; synchronous native matching can delay cancellation. A separate regex resource-safety proposal may address that risk. No custom interpreter, step budget, subject limit, new pattern limit or interruptibility guarantee is part of D19 or these slices. Parity fixtures use benign inputs and do not run catastrophic workloads.

**Mode timing.** `setApprovalMode` and the optional PolicyEvaluation.mode currently choose filters dynamically; overlay tests cover default/autoEdit/yolo and mode-specific deny plus argsPattern. The new mode is a rule input, not an extra authority capability. `set-preferences({layers, approvalMode})` atomically changes that input for authority, its exception predicates and preferences at the next policy evaluation, including pending decisions; if none occurs, at turn end before idle. Cancel delays application until settlement; close rejects queued commands. One evaluation uses one revision for the whole call and all segments. Before dispatch, a changed revision forces re-evaluation; an in-flight tool is not retroactively undone. Recheck grants on mode activation/deactivation just as on authority replacement. `set-mode normal/plan` stays a separate boundary-timed execution command.

**Parity boundary.** Every existing form translates, including regex and exemptions. No partial policy load, default allow on error or fallback evaluator is permitted. P16 runs the same policy files through the old loader/engine and the new translator/core over a fixed corpus, comparing allow/ask/deny and mode transitions. Treat Q4/Q5 conflict cases as separately asserted old/new contracts pending Andrew's choice, never as waived mismatches in the equality corpus. Invalid-pattern and existing source-validation failures have explicit definition-error tests. P28 removes the old executable oracle after freezing its corpus inputs/expected results, so no old runtime survives release.

### Session admission and built-in continuation

**Session ceiling decision:** `getMaxSessionTurns` becomes `HostAdmissionLimits.maxSessionSubmits` in host-only sources, not AgentDefinition.Limits. P16 translates the existing setting (nonpositive means unlimited); P18 provides a narrow `admitSessionInput` helper used by every host. The counter belongs to the live host conversation, increments exactly once after a top-level submit is synchronously accepted, and counts failed/cancelled accepted turns. Busy/closed/rejected submissions do not consume it. At the ceiling the host emits its existing MaxSessionTurns presentation/protocol outcome without calling submit. Queue draining uses the same gate; steering, model/tool steps, retries, compaction and afterTurn continuation do not consume extra submits. There is no host-driven continuation loop.

The old counter is an in-memory AgentClient field (`client.ts:111,269-272`), not journal state. Preserve that lifetime: opening/resuming/forking a new live host conversation starts at zero; reconnecting to an existing host conversation retains it; clear/rewind/profile changes do not reset it. Document the counting unit as accepted top-level input, rather than reproducing recursive legacy stream callbacks as extra user turns. The helper owns no transcript and exposes no replacement Agent API. P18 and all cutovers test two submits at ceiling two with several model/tool steps in the first, then denial of a third; independently maxStepsPerTurn stops a single long turn. Add cancel/busy, queue, reconnect and fresh-resume cases.

**Continuation decision:** P17 supplies a built-in continuation interceptor independently of optional user hooks. P03 invokes afterTurn at a candidate done boundary, before emitting turn.completed or applying turn-end commands. Its completed port view provides committed thinking-only status, settled tool outcomes for this turn and continuationPass. Built-in reducers inspect that plain data and a host-owned todo snapshot; they never receive an Agent, call submit/steer, or fetch native model history. P12 adapts TodoRead/TodoWrite/TodoPause and the task store, with typed successful/error outcomes. P16 includes the existing todo-tools enablement setting in host continuation options.

Order: a successful persisted todo_pause stops automatic continuation, including a pending reminder; a failed/rejected/stale pause does not. Otherwise a committed thinking-only response requests the existing concrete-action follow-up; otherwise pending/in-progress todos or pending tool-activity reminders request the corresponding reminder. No active todos and no reminder ends normally. Preserve the existing bound of three no-tool completion passes (initial plus at most two continuations, `MAX_RETRIES = 3`); also apply core steps, tokens, cost, timeout, loop detection and cancellation without resetting any of them. This is committed continuation, not failed-attempt retry: keep prior committed output and replay, and do not emit attempt.discarded for it.

Compute reminder level from settled tool outcomes in AfterTurnView, preserving the existing four-call base and subsequent escalation behavior and the last successful todo update boundary. This per-turn derived state cannot leak between agents and needs no global registry. Todo list and paused status remain durable task-store data, keyed by session; a fork copies the checkpoint's task snapshot into a new namespace in P14/P17 and never shares mutable pause state. An explicit new user submit clears pause through beforeTurn; resume alone does not. Task-store read/write errors surface as typed interceptor/tool failures, never an empty-list success. The core journals successful tool outcomes; restart does not rerun todo_pause or a pending continuation. An interrupted turn ends cancelled under existing recovery rules, and a later submit starts a new bounded continuation sequence.

The built-in interceptor composes before user afterTurn hooks in one host-kit interceptor composition. A pause suppresses automatic continueWith for that candidate; otherwise concatenate permitted built-in and user input into at most one continueWith, preserving their data trust labels. User hooks cannot reset the built-in pass count or bypass turn limits. P17 tests with user hooks disabled: thinking-only then text, pending todos, pending reminder without active todos, successful pause, failed pause, next explicit input unpauses, restart/fork isolation, cancellation and budget exhaustion during continuation. P20/P27 repeat the externally visible cases.

## Design amendments

D14-D18 complete ports; D19 adds the approved policy forms, path-specific native RegExp validation, trusted policy identity, atomic source-stack replacement and approval-mode input. P01 is delivered in PR #4076 with pre-D19 policy/shell types; P01a amends those contracts and adds Q2 value types before runtime work. Approved Q2 adds a host-only offline importer and imported-history provenance, not a new Agent method or compatibility runtime. No session-wide core limit was added.

| Amendment and design location                                               | Change                                                                                                                                                                                                                                                                                                                                                                 | Reason and implementation owners                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D14, section 15 ModelClient/ModelChunk and TranscriptEntry                  | Scoped/versioned JSON replay envelopes, stable part IDs, client replay scope and transcript replay field. Section 13 entry records persist the completed entry type unchanged.                                                                                                                                                                                         | Signed thinking, encrypted reasoning, provider IDs and AFC metadata must survive model/tool/model, resume and fork without an adapter history cache. P01/P03/P07/P10/P11/P14.                                                                                                                     |
| D15, sections 13 and 15 UsageReport/ModelError/JournalRecord                | Cumulative noncommitting usage chunks, final UsageReport on finish/error, dispatch certainty, explicit Usage counters and reserved/settled attempt-budget records.                                                                                                                                                                                                     | Early usage survives truncation and cancel; unknown final usage consumes a visible conservative charge rather than disappearing. P01/P03/P07/P10/P11/P14.                                                                                                                                         |
| D16, sections 13 and 15 ModelRecovery/ModelRequest/ModelError/JournalRecord | Versioned scoped recovery input/error data, explicit entry/envelope invalidation IDs and durable model-recovery records. Separate one-attempt dispatch authorization from core-owned validated reconstruction instructions retained for the remaining attempts of the same logical request and compatible scope, then cleared at request end or scope incompatibility. | Image repair must survive ordinary retries without an adapter cache or another repair cycle. Every generation for image repair, rejected parent IDs, WebSocket renewal and transport failover is separately admitted and charged once; invalidation must survive resume. P01/P03/P07/P10/P11/P14. |
| D17, section 15 Interceptors.afterTurn/AfterTurnView                        | Replace the candidate result-only argument with a read-only view of result, thinking-only state, settled tool outcomes and continuation ordinal.                                                                                                                                                                                                                       | Built-in continuation needs these facts without reading agent internals; terminal results remain single and budgets stay turn-owned. P01/P03/P12/P17.                                                                                                                                             |
| D18, section 7 ToolDescriptor/PreparedCall/PreparedShell                    | Trusted ToolDescriptor.policyIdentity; exact raw command, whole-command redirection, current policySplit text/facts and separate parsed argv/failure, bound to the prepared token.                                                                                                                                                                                                                            | Regex subjects and existing shell traversal require lossless text and splitter facts; no adapter permission decisions. P01a/P05a/P05b/P12/P13/P16.                                                                                                                                                    |
| D19, sections 8/10/15                                                       | PolicyRegex/PolicyRegexInput with staged validation, serializedArgs, priority/order/provenance, RestrictionRule/unless, paired PolicySourceStack and atomic set-source-stacks, mode filters and atomic set-preferences approvalMode, redirection exemptions and provenance-bearing definition errors.                                                                                                                       | Retain all Q3 forms in one core evaluator, preserving within-admin exceptions while isolating Q4/Q5 conflicts. P01a/P02/P05a/P05b/P12/P16 and host switches.                                                                                                                                      |
| Approved Q2, D10 and sections 13/15                                         | imported-history/ImportNotice, StoreError import-required and offline sessions import command.                                                                                                                                                                                                                                                                         | Content migration without grants, invented durability or old runtime. P01a/P07/P14 and host switches.                                                                                                                                                                                             |

D19 and Q2 apply Andrew's two decisions. The earlier D14-D17 contracts remain unchanged. D18 now carries the facts needed for exact source semantics. Q1 stays open without changes; Q4/Q5 identify newly exposed outcome conflicts, with options below.

### Numbered integration algorithm

These lines are shared pseudocode for the slice issue bodies. Each implementation PR expands its referenced range into detailed error paths before tests, with plan/requirement traceability. No reference authorizes skipping a failing behavior test.

```text
01 VALIDATE the closed definition and required port capabilities before any port effects.
02 RESOLVE the primary model; validate modality and budget capabilities; load/reconcile an explicit start.
03 PUBLISH a ready idle Agent with one mailbox and independent event subscriptions.
04 ADMIT input synchronously; reserve the turn before any await; reject closing before busy.
05 PIN tool metadata; append input; prepare trusted instructions, context and history.
06 AT preparation only, compact if needed; reserve and journal budget before each attempt or child.
07 STREAM one provisional attempt with scoped replay and cumulative usage; finish commits content/replay, failure discards content but settles accounting and recovery instructions.
08 FOR committed calls: validate, prepare, intercept, re-prepare patches, apply policy commands atomically, snapshot mode/revision, enforce destructive deny and D19 authority plus ranked preferences/grants with native RegExp and existing shell traversal.
09 AWAIT typed decisions without blocking mailbox admission; edits re-prepare; authority, source-stack or mode changes re-evaluate waits and grants before dispatch.
10 APPEND tool-started durably; execute ordered segments; preserve each started call's actual settled outcome.
11 AT every boundary append results, apply boundary commands then steering, check limits, checkpoint.
12 AFTER settled work, evaluate bounded built-in/user continuation inside the same turn; only then apply turn-end commands, publish the single terminal result and return idle.
13 SNAPSHOT state and cursor atomically; replay exclusively after cursor; fail expired/lagging subscriptions explicitly.
14 RECOVER unfinished tool starts as indeterminate; never replay effects; restore only authority-compatible session grants.
15 CLOSE admission, fulfill accepted queued commands with rejected/closing results, abort work/decisions/children and join started operations.
16 FINALIZE under a distinct deadline signal, durable append, release owned subscriptions, emit terminal events and end iterators.
17 HOST loads sources, acquires adapters, builds definition and calls createAgent; on failure rolls back acquired host resources.
18 HOST checks session submit admission, translates inputs/decisions/events at its protocol boundary; it never schedules model/tool steps or continuations.
19 HOST awaits agent.close before closing borrowed ports; collect failures while completing later cleanup.
```

## Required behavioral fixtures

Use complete type-checked fixtures, not assertions against the HTML's abbreviated events. Fake ports model external responses; tests run the real mailbox, loop, policy, journal and reducers and assert transformations, causal ordering, files/results and usage. A hardcoded response must not satisfy the test.

| ID    | Required scenario                                   | Observable assertions                                                                                                                                                                                      | First completed slice                        |
| ----- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| S9.1  | Interactive: read, then an edit that needs approval | Read allowed, prepared edit prompts once, chosen file/session grant is narrower than repo, edited content reaches next model request, turn completes with checkpoint.                                      | P05b, strengthened with durable ordering P07 |
| S9.2  | Headless, onAsk: deny                               | No human tools advertised; write never executes; rejection is tool result; model can finish successfully explaining it.                                                                                    | P05b                                         |
| S9.3  | Headless, onAsk: fail                               | Unavailable gives failed/decision-unavailable, not rejection followed by another model call.                                                                                                               | P05b                                         |
| S9.4  | Steer, then cancel                                  | Steering applies only at boundary; cancel blocks next admission until started work settles; partial effects are reported and next turn sees consistent history.                                            | P04/P05b                                     |
| S9.5  | close() while a decision is pending                 | Decision aborts, tool not-run, queued commands rejected, separate finalization signal writes closing records, terminal events ordered and iterators end.                                                   | P09                                          |
| S16.1 | Authority against grants                            | Authority deny beats exact/wide grants and YOLO; new authority revokes incompatible grants and re-evaluates pending decisions.                                                                             | P05b                                         |
| S16.2 | Competing commands                                  | Same-tick submit exclusion; policy/boundary/turn-end timing; close rejects all pending work; no mid-attempt history edit.                                                                                  | P02, full integration P09                    |
| S16.3 | Cancel settlement                                   | Never admit a new turn while a started operation can still mutate; unstarted/waiting/running outcomes differ.                                                                                              | P04/P09                                      |
| S16.4 | Stale previews                                      | Mutation between prepare and execute returns stale, causes fresh preview/approval, never applies old token.                                                                                                | P05b/P12                                     |
| S16.5 | Crash recovery with an indeterminate call           | Restart after durable tool-started but before finish preserves uncertainty and never repeats effects.                                                                                                      | P07/P14                                      |
| S16.6 | A child outruns the budget                          | Shared reservations prevent competing children over-admitting; reported overshoot ends turn and appears in usage.                                                                                          | P08                                          |
| S16.7 | Replay across an expired cursor                     | Explicit CursorExpired, fresh snapshot plus exclusive replay produces no gap/duplicate; lagging subscriber does not stall others.                                                                          | P06/P07                                      |
| R1    | Provider replay round trip                          | Native signed/encrypted reasoning, IDs and AFC survive model/tool/model, fresh-adapter resume and fork; model/endpoint switch excludes incompatible envelopes.                                             | P10/P11/P14                                  |
| R2    | Policy-file translation                             | Real user/admin/default files either produce exact approved policy or fail with source/rule diagnostics; no dropped regex/mode/redirection rule. Core denies destructive and restricted compound segments. | P05a/P05b/P12/P16                            |
| R3    | Failed-attempt accounting                           | Early usage survives truncate/cancel; cumulative reports reconcile once; conservative unknown charge can prohibit retry.                                                                                   | P03/P07/P11                                  |
| R4    | Internal recovery counts                            | Image/parent/WebSocket/SDK cases show at most one generation per stream call; successor is core-admitted and budgeted.                                                                                     | P10/P11                                      |
| R5    | Session ceiling                                     | Multiple multi-step submits consume one admission each; third submit at ceiling two is stopped; fresh resume versus reconnect is explicit.                                                                 | P18/P20/P21/P22/P27                          |
| R6    | Built-in continuation                               | With user hooks disabled, thinking/todo/reminder continue; successful pause stops, failed pause does not; same budget/deadline and one terminal result.                                                    | P03/P12/P17/P20/P27                          |
| R7    | Closing command settlement                          | All accepted queued command promises fulfill with rejected/closing results; post-close admission throws ClosedError separately.                                                                            | P02/P09                                      |
| R8    | Independent Ink preparation                         | Reducer, DecisionPort, host handlers and import cleanup each pass G0 and unchanged legacy execution suites before final switch/delete.                                                                     | P23/P24/P25/P26/P27                          |

Additional cases in slices cover creation errors, attempted tool spoofing, modality rejection, output bounds, retry-after, command timing, abort propagation, corrupt journals and host presentation. Section 9's HTML animation must be generated from these fixtures in P09 so documentation and tests describe the same sequence.

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

## Hidden flag and cutover contract

**Name:** `LLXPRT_EXPERIMENTAL_AGENT_CORE`. This is a temporary environment flag, not a settings key, public CLI option or AgentDefinition property. `1` selects the new route; absent or `0` selects the old route while that host is under development. Other values fail at that host entry. There is no catch-and-fall-back route when construction, model access or storage fails.

Read it only in the selected host entry: CLI dispatch in `packages/cli/src/cli.tsx`, ACP startup in `packages/zed-acp/src/zedIntegration.ts`, and a2a startup in `packages/a2a-server/src/http/server.ts`. CLI reads it only for the mode currently being migrated. Once non-interactive CLI has switched, that mode is unconditional and does not honor the flag even while Ink is under development. ACP selection is owned by ACP, not duplicated by the CLI launcher. No read in host-kit, agent-core, an adapter or a React component.

P19 installs the test harness and location guard, not an unused production route. Each host-switch PR introduces its temporary flag/route in development commits, retains it until the shared contract suites pass, then switches unconditionally and deletes the old path and flag read in that **same PR**. The final post-deletion commit must pass again. This keeps work on main through short-lived PRs without leaving a production compatibility branch. If a host's switch cannot meet its criteria, it does not merge as a completed switch; do not hide failure by routing back to the old engine.

The current CLI statically shares preflight and `ForegroundSessionHost` across modes (`cli.tsx:319-571,744-821`). P20 must split that composition before testing the new route: move the still-required old interactive composition into **new temporary** `packages/cli/src/session/legacy-interactive-entry.tsx` and keep `cli.tsx` as the mode dispatcher. Load the old interactive entry only for the still-unswitched interactive mode. P27 deletes that temporary file. No old runtime is constructed before selecting a new host route, and none of its module initialization is required by the new route.

During that interval, the stricter graph scanner checks each migrated composition root separately, plus a thin dispatcher whose only runtime handoffs are the explicitly named host entry roots. It does not follow an unswitched host root and then pretend that host is already migrated. Freeze the finite unswitched-root list, remove its entries at each switch, and delete the special dispatcher treatment after P27. This is migration scope for the new rule, not an expansion of the existing CLI allowlist, which stays empty. Fixtures prove a migrated root cannot import an unswitched root, an old runtime or an arbitrary bypass module.

### Shared external behavior while both paths exist

Use one scenario function per external behavior with two real host factories. The harness accepts stdin/argv, ACP messages, a2a requests or UI actions and observes protocol output, exit/status, file effects and cleanup. It must not require the old Agent type, method names or new internal mailbox shape. Normalize nondeterministic IDs/timestamps only. Serialize new events to existing host output contracts rather than retaining the old API internally.

Every outside-facing bug fix on main gets a regression scenario in both active factories before either route is deleted. A shared adapter bug is fixed once. Contract differences explicitly required by the approved design, such as headless human-tool exclusion, get new API tests. Unsupported hook mutation requires Q1 disposition; Q2 offline import and Q3 policy-form support are approved. Q4/Q5 changed-outcome cases need their own recorded disposition, not relaxed parity assertions. At cutover remove the obsolete factory, keep the scenario against the new host, and retain its strength.

Deletion gate per host: all shared scenarios pass on both paths, all relevant real port-conformance tests pass, installed host smoke passes, no old imports or mutable owner exposure remains in the migrated graph, then the old route/flag/factory is deleted and the full verification cycle passes again.

## Boundary enforcement and existing rule retirement

### New rules

1. **P01 core graph:** resolve imports, exports, import types, dynamic imports, require forms, aliases, relative paths and conditional package exports to actual source. Fail on unresolved/dynamic dependency edges rather than assuming they are harmless. Traverse transitive production dependencies. Core may use its own pure modules and audited pure library entries only. Reject legacy Config/settings types, every other llxprt runtime package, host-kit, Node/Bun I/O, process/env, fetch/sockets, workers, shell execution and telemetry exporters. Pure shell parsing/classification is allowed; process access is not. Test-only Bun imports stay in test entry graphs; exported fake ports remain pure. Also check ambient I/O globals so a no-import fetch is caught. Negative fixture compilation and graph traversal prevent a rename/barrel from evading the rule.
2. **P10 host-kit graph:** host-kit may import the core's public API and existing provider/auth/tool/MCP/settings/storage/telemetry/infrastructure modules. It cannot import CLI, zed-acp, a2a, legacy agents or their session owners. Extract reusable mechanisms instead. Host-kit exports contracts/operations, never Config, provider managers, legacy Agent controls or a barrel that exposes all infrastructure internals.
3. **P19-P27 host graph:** repository-level dependencies of switched hosts are limited to `@vybestack/llxprt-code-agent-core`, `@vybestack/llxprt-code-host-kit` public exports and an explicit list of pure value exports owned by those packages. Local UI/protocol code and their existing third-party presentation/protocol libraries are allowed. Host entry I/O is intentional, not prohibited by the pure-core rule. No deep imports into either new package and no legacy package re-exports masquerading as values. Move genuinely shared value definitions, do not add exceptions for whole old barrels.
4. **P19 flag location:** only the current host entry may read the flag; fail reads in any other production file. After each host switches, its read is forbidden. P28 expects zero production reads. Tests may inject a captured value but never mutate process.env to select paths.
5. **P28 public surface:** check emitted declarations for exactly the approved Agent methods, completed ports and listed values, plus the documented pure shell-safety export shared with the remaining legacy evaluator, no getters/control groups and no leaked infrastructure types. Keep the existing internal-name bans where relevant; deletion of a target module is not permission to delete protection.

### Existing checks

| Existing scanner                                                                                                                           | Current concern                                                                                                                                                                      | Slice treatment                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-runtime-state-boundary.ts` and `runtime-entry-manifest.ts`                                                                  | Production dependency closure; compiler projects; global state, service bags/bundles, ambient delegation and environment mutation; original roots zero-tolerance and widened ratchet | P01/P10 add the new packages to source/project/entry discovery. Every slice preserves rules. P21/P27/P28 remove only ledger entries whose declarations disappear. No rule family is retired.                                                                                                                                                                                                               |
| `scripts/check-cli-import-boundary.ts`, `scripts/cli-boundary/config.ts`                                                                   | Internal imports/assembly/getConfig and thin-entry constraints; current allowlist empty                                                                                              | P19 composes stricter host rule; P20/P27 migrate graph roots. Keep zero allowlist and existing line/function limits. P28 removes only checks tied to deleted exports when replacement negative fixtures cover the same forbidden reach-through.                                                                                                                                                            |
| `scripts/check-a2a-import-boundary.ts`, `scripts/a2a-boundary/a2aBoundary.ts`                                                              | Public package roots and bans on Config/AgentClient assembly                                                                                                                         | P19/P22 add agent-core/host-kit scope and prohibit old-package imports. Keep no-assembly intent and tests; no blanket removal.                                                                                                                                                                                                                                                                             |
| `scripts/check-agents-api-surface.ts`                                                                                                      | Exact old declaration snapshot and internal-name bans                                                                                                                                | Update intentional old export removals with their PRs; P28 moves the active public-surface target to agent-core/host-kit and retains negative leak tests. Do not remove the guard without replacement.                                                                                                                                                                                                     |
| `scripts/check-storage-import-boundary.ts`                                                                                                 | Moved storage symbols must not be imported from old core locations; parameterized moved-symbol/deep-path list                                                                        | P14/P28 extend the actual moved-symbol invocations for extracted storage primitives; no re-export shims. Existing script alone is not the new transitive core guard.                                                                                                                                                                                                                                       |
| `scripts/check-settings-boundary.ts`                                                                                                       | Settings independence, anti-shim/deleted ambient helpers, a specific settingsRuntimeAdapter seam                                                                                     | P16 keeps settings independent. P28 updates any actively enforced seam-location assertion if ownership moves, retaining prohibition on ambient helpers. Its full default set includes an old `no-storage-package` check, inconsistent with today's workspace. Invocation/enforcement of that old default is **unverified**; do not add it blindly to the new CI gate or weaken a currently enforced check. |
| `scripts/check-runtime-dependency-declarations.ts`, `check-test-shards.ts`, `check-affected-test-shards.ts`, `check-gemini-containment.ts` | Declared runtime dependencies, complete test partition, provider plugin containment                                                                                                  | P01/P10 register packages; P11 preserves Gemini plugin isolation; P28 prunes only deleted roots. All existing constraints remain.                                                                                                                                                                                                                                                                          |

The widened baseline now totals module-mutation 299, runtime-service-bundle 50, runtime-service-bag-parameter 27, runtime-ambient-delegation 25, process-environment-mutation 20, mutable-state 6. Planned definite source-removal targets are **79 sites**: P21 two ACP delegation sites, P27 four interactive delegation sites, P28 all 73 legacy agents sites. The other **348 sites** remain assigned to #4037 unless a slice genuinely removes their underlying state. Adding a new package does not reduce debt, and moving a finding to another filename is a new violation.

### Exact retirement ledger

This ledger is generated from the current baseline. The source declaration and rule are the identity; counts can shrink earlier if a shared extraction removes them. In that case the earlier PR owns the deletion and updates this ledger, never leaves a stale baseline entry. None of P01-P20, P22 or P23-P26 has a promised baseline reduction. These slices must still remove any stale entries they actually cause.

| Slice | File                                                              | Rule                          | Declaration                         | Sites |
| ----- | ----------------------------------------------------------------- | ----------------------------- | ----------------------------------- | ----: |
| P28   | `packages/agents/src/api/activationPreflightState.ts`             | runtime-service-bag-parameter | `providers`                         |     2 |
| P28   | `packages/agents/src/api/activationPreflightState.ts`             | runtime-service-bundle        | `#providers`                        |     1 |
| P28   | `packages/agents/src/api/activationPreflightState.ts`             | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/api/activationPreflightState.ts`             | runtime-service-bundle        | `PreflightProviderInput`            |     1 |
| P28   | `packages/agents/src/api/activationPreflightState.ts`             | runtime-service-bundle        | `providers`                         |     4 |
| P28   | `packages/agents/src/api/adopted-agent-assembly.ts`               | runtime-service-bag-parameter | `providers`                         |     2 |
| P28   | `packages/agents/src/api/adopted-agent-assembly.ts`               | runtime-service-bundle        | `<anonymous>`                       |     2 |
| P28   | `packages/agents/src/api/adopted-agent-assembly.ts`               | runtime-service-bundle        | `providers`                         |     1 |
| P28   | `packages/agents/src/api/agentRuntimeAssembly.ts`                 | runtime-service-bag-parameter | `provider`                          |     1 |
| P28   | `packages/agents/src/api/agentRuntimeAssembly.ts`                 | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/api/agentRuntimeAssembly.ts`                 | runtime-service-bundle        | `PreferredProvider`                 |     1 |
| P28   | `packages/agents/src/api/agentRuntimeAssembly.ts`                 | runtime-service-bundle        | `provider`                          |     1 |
| P28   | `packages/agents/src/api/child-agent-assembly.ts`                 | runtime-service-bag-parameter | `loaded`                            |     3 |
| P28   | `packages/agents/src/api/child-agent-assembly.ts`                 | runtime-service-bag-parameter | `provider`                          |     5 |
| P28   | `packages/agents/src/api/child-agent-assembly.ts`                 | runtime-service-bundle        | `<anonymous>`                       |     2 |
| P28   | `packages/agents/src/api/child-agent-assembly.ts`                 | runtime-service-bundle        | `ChildProvider`                     |     1 |
| P28   | `packages/agents/src/api/child-agent-assembly.ts`                 | runtime-service-bundle        | `loaded`                            |     6 |
| P28   | `packages/agents/src/api/child-agent-assembly.ts`                 | runtime-service-bundle        | `provider`                          |     4 |
| P28   | `packages/agents/src/api/foreground-agent-assembly.ts`            | runtime-service-bag-parameter | `providers`                         |     1 |
| P28   | `packages/agents/src/api/foreground-agent-assembly.ts`            | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/api/foreground-agent-assembly.ts`            | runtime-service-bundle        | `providers`                         |     1 |
| P28   | `packages/agents/src/api/fromConfig-session.ts`                   | runtime-service-bag-parameter | `providers`                         |     5 |
| P28   | `packages/agents/src/api/fromConfig-session.ts`                   | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/api/fromConfig-session.ts`                   | runtime-service-bundle        | `providers`                         |     3 |
| P28   | `packages/agents/src/api/policyComposition.ts`                    | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/api/profile-preflight.ts`                    | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/core/chat-system-prompt.ts`                  | runtime-service-bag-parameter | `deps`                              |     1 |
| P28   | `packages/agents/src/core/ChatSessionFactory.ts`                  | runtime-service-bag-parameter | `deps`                              |     3 |
| P28   | `packages/agents/src/core/ChatSessionFactory.ts`                  | runtime-service-bundle        | `CreateChatSessionDeps`             |     1 |
| P28   | `packages/agents/src/core/ChatSessionFactory.ts`                  | runtime-service-bundle        | `deps`                              |     3 |
| P28   | `packages/agents/src/core/ChatSessionFactory.ts`                  | runtime-service-bundle        | `runtimeBundle`                     |     1 |
| P28   | `packages/agents/src/core/client.ts`                              | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/session/session-client-acquisition-owner.ts` | runtime-service-bag-parameter | `factories`                         |     1 |
| P28   | `packages/agents/src/session/session-client-acquisition-owner.ts` | runtime-service-bundle        | `factories`                         |     1 |
| P28   | `packages/agents/src/session/session-client-acquisition-owner.ts` | runtime-service-bundle        | `SessionClientFactories`            |     1 |
| P28   | `packages/agents/src/session/session-client-binding.ts`           | runtime-service-bag-parameter | `construction`                      |     1 |
| P28   | `packages/agents/src/session/session-client-binding.ts`           | runtime-service-bundle        | `<anonymous>`                       |     1 |
| P28   | `packages/agents/src/session/session-client-binding.ts`           | runtime-service-bundle        | `SessionClientConstruction`         |     1 |
| P28   | `packages/agents/src/session/session-client-owner.ts`             | runtime-service-bag-parameter | `factories`                         |     2 |
| P28   | `packages/agents/src/session/session-client-owner.ts`             | runtime-service-bundle        | `factories`                         |     2 |
| P27   | `packages/cli/src/session/interactiveUI.tsx`                      | runtime-ambient-delegation    | `buildAndStartPerfOwner`            |     1 |
| P27   | `packages/cli/src/session/interactiveUI.tsx`                      | runtime-ambient-delegation    | `commitInteractiveStartup`          |     1 |
| P27   | `packages/cli/src/session/interactiveUI.tsx`                      | runtime-ambient-delegation    | `initializeInteractivePresentation` |     1 |
| P27   | `packages/cli/src/session/interactiveUI.tsx`                      | runtime-ambient-delegation    | `prepareInteractiveStartup`         |     1 |
| P21   | `packages/zed-acp/src/zed-initialize.ts`                          | runtime-ambient-delegation    | `initializeZedAgent`                |     1 |
| P21   | `packages/zed-acp/src/zedIntegration.ts`                          | runtime-ambient-delegation    | `admitWork`                         |     1 |

Retained debt by package (complete remainder, not waived):

| Package              | Sites |
| -------------------- | ----: |
| auth                 |     8 |
| cli                  |   142 |
| core                 |   108 |
| ide-integration      |     4 |
| lsp                  |     2 |
| providers            |    20 |
| storage              |    29 |
| telemetry            |    11 |
| tools                |    16 |
| vscode-ide-companion |     5 |
| zed-acp              |     3 |

Keep the exact remaining identities in `scripts/runtime-state-widened-baseline.json`. For each retirement, run the scanner, inspect its removal-only drift, remove precisely the disappeared identity/count, and run again. Tests must reject both a new finding and a stale baseline entry. Never regenerate a permissive baseline or disable a rule to make the port adaptation pass.

## Verification and PR protocol

### G0: required on every implementation slice

Run the slice's named tests first, then the full repository cycle. These are future implementation gates, not claims that this planning run executed them:

```text
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
npm run check:runtime-boundary
npm run lint:cli-boundary
npm run lint:a2a-boundary
npm run lint:agents-api-surface
npm run lint:runtime-deps
npm run lint:test-shards
npm run lint:affected-shards
npm run lint:no-vitest
npm run lint:no-new-js
npm run lint:doc-placement
bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"
```

From P01, run `bun scripts/check-agent-core-import-boundary.ts` and its negative fixtures. P10 extends that enforcement to host-kit. From P19, also run `bun scripts/check-agent-host-import-boundary.ts` and the flag-location fixtures. Retain all CI checks not enumerated here. A package build must exercise both source/Bun exports and emitted declarations/installed imports. P01/P10 update test roots, shard coverage and affected-shard mapping so these suites actually run in CI, not only locally.

Use `bun scripts/test-audit/scan.ts` with a unique gitignored directory under this checkout's `tmp/` for each implementation verification run. Compare changed tests with current main and reject new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT findings. Do not test private methods or mock-call counts. Fake ports are scripted external capabilities around the real agent; network/filesystem fixtures test the real adapters and transformations.

Follow PLAN.md's property/mutation requirements: at least 30% property-based cases in each new behavior suite, using the existing fast-check dependency and `fc.assert` inside Bun tests; target complete behavior coverage. Mutation verification must kill at least 80% of executed non-equivalent mutants in changed behavior. The repository does not declare a Stryker package or a Bun Stryker runner in the inspected root manifest; do not pretend that command is available. At slice preflight establish a Bun-compatible targeted mutation run using isolated source copies and explicit mutation operators, validate mutants compile, run the real suites, and record killed/survived/invalid/equivalent classifications. An untested or unavailable mutation harness is an unmet gate, not a reason to lower the threshold. Keep the ordinary tests unchanged while implementing their specified behavior.

Every slice PR records: baseline commit; input contracts; numbered pseudocode range and expansion; exact test command and red result before implementation; green result after; behavior demonstrated; source-to-output trace; failure/cancellation/cleanup evidence; changed public surface; dependency graph changes; baseline identities retired; and unresolved external constraints. Structural markers alone never establish success.

### Port conformance matrix

| Contract               | Implementations required                                                          | Required observations                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ModelPort/ModelClient  | ScriptedModel; every provider family and installed plugin behind providerAdapters | Abort before/during resolve/stream/countTokens; typed errors/retryAfter; ordered fragments/finish; cumulative early/error usage, conservative unknown charges and pricing; scoped replay round trips/resume/fork/switch; actual image/parent/WebSocket/SDK generation counts; no hidden generation retries; no credentials leaked; no re-entry. |
| ToolCatalog/ToolHandle | MemoryTools; builtin families; MCP; filtered child catalog                        | Pin immutability, qualification/version identity, prepare without effects, stale tokens, bounded output during acquisition, abort/revocation, explicit result errors, resource-lock behavior and no decision bypass.                                                                                                                            |
| SessionStore           | MemorySessionStore; journalStore                                                  | Ordered append/load, durable-on-resolve, failure before effects, corruption detection, cancellation, blob lifecycle and crash reconciliation. Memory store supplies logical persistence only; real-file tests prove physical behavior.                                                                                                          |
| DecisionPort           | ScriptedDecisions; headlessDecisions; Ink; ACP; a2a                               | Typed request/response relationship, exact headless scopes, immediate headless settlement under a fake-clock deadline, human abort/timeout, stale/duplicate response handling, no method re-entry into agent.                                                                                                                                   |
| DiagnosticSink         | In-memory capture sink; debugSink                                                 | Synchronous/nonblocking/nonthrowing emission, bounds, redaction, agent attribution; explicit host flush failures.                                                                                                                                                                                                                               |
| Clock                  | FakeClock; default clock                                                          | Monotonic elapsed-time behavior for deadlines, abortable sleeps, no live timers after close. Wall-clock event timestamps may differ from monotonic elapsed accounting.                                                                                                                                                                          |
| Interceptors           | Scripted fixtures; hookInterceptors                                               | Deadline/abort, allowed output schema only, argument revalidation and policy checks, audit-preserving redaction, bounded continuation with user hooks disabled, thinking-only/todo/reminder and success-versus-failed pause.                                                                                                                    |
| Source builder         | Pure fixtures; real loadHostSources with temporary source files                   | Source precedence, required inputs, trust restrictions, secret exclusion, cancellation and equivalent definitions across hosts. This is a builder contract suite, not a new core port.                                                                                                                                                          |

No-re-entry is primarily an ownership constraint: adapters are never passed an Agent reference. Integration traces exercise supplied progress/catalog callbacks and prove they queue data rather than synchronously running another turn. A method-call spy is not a substitute.

### Delivery rules

All implementation starts from current main and returns through one short-lived PR per slice. P01 is already merged; remaining dependency order is P01a, P02-P04, P05a, P05b and P06-P28. This planning worktree is not an implementation integration branch. Rebase/update before each PR, preserve unrelated ongoing fixes, and run outside-behavior regressions on every route that still exists. Shared adapters are maintained once.

Titles use `Refs #3980` plus a specific slice title; bodies use `Fixes #<filed-slice-issue>`. Include `Refs #4037` with exact retirement evidence when applicable. Do not close #3980 with the first package PR. Only P28 closes the parent after all host switches and removals. Do not close #4037 while its unrelated baseline remains. No commit/push/comment was requested or performed by this planning task.

No weakening lint limits, scanner rules, assertions, mutation/property thresholds or required checks. Follow the project's review policy; OCR review is skipped per Andrew's standing instruction. At most one initial code/design review and one findings-focused follow-up during implementation, with the original scope intact. No merges without Andrew's explicit instruction.

### Failure recovery

A failing slice does not advance its dependent slice. Fix the cause in that slice and rerun the full cycle. No runtime fallback to the old engine and no broad source revert as a planning default. A broken already-merged shared adapter is fixed on main through a targeted PR and exercised against all remaining host routes. Do not keep a compatibility branch as an emergency escape. Preserve failed-run evidence in unique workspace-local verification directories.

## Open product questions for Andrew

Q1 remains unchanged. Q2 and Q3 are decided above. Q4 and Q5 are narrower outcome conflicts exposed by inspecting the current evaluator; all policy forms already have representations. P01a, P02 and pure P05a can proceed without selecting Q4 or Q5. Q5 must be recorded before P05b implements decision/dispatch integration, so its downstream slices, including P10, inherit that prerequisite. Q4 remains a gate on affected host switches; no affected release flow may claim parity before its disposition is recorded.

### Q1. How should 0.12.0 handle existing model-mutating hooks?

Evidence: `packages/core/src/hooks/types.ts:306-409` and `708-750` support BeforeModel synthetic responses/full request replacement, AfterModel response replacement and BeforeToolSelection toolChoice. `packages/agents/src/core/chatSession.issue1749.test.ts` explicitly tests modified response preservation. The six approved interceptors deliberately do not provide those powers.

- **Option A, recommended:** remove the unsupported hook capabilities in 0.12.0, reject their configured/returned unsupported mutations with an actionable error, and document how supported block/context/patch/redaction behaviors migrate. This preserves the approved core boundary but is a user-visible feature removal.
- **Option B:** provide explicit host-side commands or registered tools for the affected workflows before switching their hosts. They produce normal UserInput/ContextItem or tool results and remain policy-controlled. This preserves some workflows without transparent response interception, at the cost of new host UX and changed invocation semantics.

Neither option adds a hidden model-replacement interceptor or reopens authority ownership. Do not silently ignore an old hook output. The product choice is whether to remove those workflows or replace them explicitly, not whether to preserve the old engine API.

### Q4. What happens to raw priority overrides of an independent authority restriction?

Evidence: `policy-engine.ts` sorts only numeric priority, including runtime/overlay rules; source is diagnostic text, not authority. `policy-engine.test.ts` first-match and pattern-specific-over-general cases prove a higher allow beats a lower deny. The exact admin-labelled 3 versus caller allow 4 pair is a code-derived case, not an existing labelled regression. Ordinary TOML tiers prevent it; `core/src/policy/policy-owner.test.ts` confirms 3 deny beats 2.95 confirmation under YOLO. Within-admin exceptions are already preserved by D19 and are not this question.

- **Option A, recommended:** keep independent authority non-overridable. A formerly successful out-of-tier preference/confirmation override now denies or asks as authority requires. Retain both rules, diagnose the changed outcome with provenance, and document this specific behavior change. No policy syntax is removed.
- **Option B:** require the authority owner to encode an explicit, fixed exception predicate in authority for each approved override. This can reproduce the old allow for that scope without letting future preference/grant changes weaken authority. Until such an exception is authored, the affected setup cannot cut over with a claim of parity.

Do not silently treat admin restrictions as preferences or let source labels grant authority. P05a adds the conflict fixture and P16 identifies affected raw-policy inputs before host switches. Neither option restores a second evaluator.

### Q5. Should an initial compound-command ask conceal a later deny?

Evidence: `PolicyEngine.evaluateMatchingRule` returns a matched ASK_USER without calling evaluateShellCommand; only a matched ALLOW or a non-deny no-match fallback traverses segments. A whole-call ask for `echo ok && restricted-command` therefore wins before a higher-priority regex matching only the later command can deny that segment. Existing shell-safety.test.ts covers mixed segments reached through allow/fallback paths, not this early-ask case. An explicit approval can otherwise dispatch the whole command. This conflicts with requiring every subcommand to pass before dispatch.

- **Option A, recommended:** preserve the initial ask for presentation, but after approval and before dispatch evaluate every segment with the same mode/revision. Deny any forbidden segment; approval satisfies only asks for that prepared compound call. This strengthens old post-approval behavior while retaining the initial evaluator result.
- **Option B:** evaluate every segment before presenting the first decision and return deny immediately if any segment denies. This also prevents dispatch but changes the initial decision from ask to deny.

Both options keep a single core evaluator, and neither reruns a tool to discover effects. Q5 remains open. Record its disposition before implementing P05b, not merely before a host release: Option B may require completing P05a's evaluator traversal in the P05b slice. P01a and pure P05a can validate contracts and pin the old short circuit without choosing a dispatch outcome. P05b/P16 assert the old result and selected new contract separately; downstream host flows inherit the decision. No option preserves execution of a compound call with a denied segment.

## Verification status of this plan

Source and AST inventories were performed against HEAD 855e233478 with main 7cc8fd788d included. The approved design, issues/comments, planning/test rules, current entrypoints and boundary scripts informed the plan. Existing source paths and the exact baseline identities were checked. P01 paths are delivered by merged PR #4076; other new paths are proposals, not claims of implementation.

**Unverified:** executable adapter feasibility; transport allocation bounds under large MCP replies; every provider's failed-attempt usage completeness and pricing; cross-platform physical journal durability; execution of the approved offline-import corpus; native regex/source-translation parity fixtures; Q4/Q5 dispositions; current CI/nightly health; all implementation test/build/smoke outcomes. No production implementation or full test/build/smoke cycle was part of this planning task. Read-only Bun probes against cd2a9d2bbe source confirmed raw allow-4 over admin-labelled deny-3, whole-command ask versus later-segment deny, the loaded YOLO redirection ask, dropped modes on the single-file loader, and the directory dot-star rewrite. These observations do not prove the new evaluator or importer; their implementation gates remain unrun.

The earlier supplied review at tmp/plan3980-review-1.md was read in full and its eight findings were checked against the cited production/design code. The Q2/Q3 review at tmp/keep/plan-q2q3-review-1.md was also read in full; its six findings were verified against loader/utils, PolicyEngine, delivered ToolDescriptor, recording schemas/replay and slice contracts. This amendment adds atomic source-stack replacement, exact regex validation evidence, trusted identities, refusal-rewrite folding, earlier Q5 gating and separate relocation counts. This revision performs documentation consistency checks and the bounded source probes listed above, not an additional independent review or executable adapter feasibility run. OCR remains disabled.

### Documentation checks performed

- TypeScript AST check confirmed coverage of all 56 public preflight declarations, 64 direct Agent members, 164 inherited Config public names and 33 UI bindings. JavaScript private identifiers were excluded from the public census.
- Q2/Q3 are in the decisions record; the Q1 section is unchanged from cd2a9d2bbe. Q4/Q5 have explicit source evidence and options. Q5 is now an explicit prerequisite of P05b, not only a host-release gate. The declared slice dependency order remains acyclic.
- Both documents contain the same 30 complete slice bodies (one delivered and 29 remaining), with scope, paths, contracts, tests-first, exits, deletions, risks, verification and PR instructions.
- All five section-9 scenarios and seven section-16 scenarios have named tests and slice assignments.
- Baseline JSON confirmed 251 identities/427 sites; the exact retirement ledger has 46 identities/79 sites, leaving 348 sites outside the committed adaptation targets.
- Referenced existing full source paths and shorthand existing filenames were checked against the worktree; proposed files are marked new or are introduced by an earlier slice.
- Policy types in HTML were syntax-checked with TypeScript; roadmap magnitudes match the 30 slice bodies and sum to 50,400-81,300 LoC, including the historical P01 estimate; remaining work sums to 49,000-79,100 LoC. Mechanical relocation is separate: P05a 4,600-6,000 plus P26 2,000-5,000, totaling 6,600-11,000 LoC.
- Effect-free Bun probes on e3c1782b96 verified the 1,035-unit single-file commandRegex wrapper rejection and the 1,026-unit directory native-source rejection for 513 slashes. These probes use the existing validation/utils code, not a proposed implementation. All 16 current recording event types appear in the offline folding contract.
- Both Markdown files were formatted using the repository's Prettier configuration. The prose scan found no prohibited words or em dashes.
- Scope is restricted to adaptation-plan.md, slices.md and the stated design amendments in agent-api-design.html. No production source, commits, pushes or GitHub writes were made.
