# Verdict: needs rework

**Findings: 12 high, 9 medium, 0 low.**

Reviewed `PLAN.md` against `tmp/feedback.txt`, the planning/testing methodology, issues #2616/#3841 and PR #3911, and the worktree at `3984a8773ee78c4614d1922da8cb917f6bdb1834`. References to main below mean the local `origin/main` at `85fdd73b1d09671b5ce11bbfce72080a662d5ac4`. Paths are relative to this worktree; plan references use the 633-line document.

Every feedback ID has a nominal task assignment, including all E bullets and F. The problems are incorrect confirmations, tests that do not establish the claimed failure, incomplete ownership designs, and task boundaries that do not support the promised green commits. C1's distinction between encapsulated private ownership and exposed capabilities is consistent with #2616. C3's proposed implementation does not resolve the actual package-export behavior.

This was a source-grounded plan review, not implementation qualification. No full build, suite, lint, typecheck or production boundary gate was run. Read-only probes of the real trust lifecycle and TypeScript package resolution are identified below. No source or plan changes were made.

## 1. High: A6 is incorrectly confirmed, and T1.5 adds a second lifetime owner

**Plan:** findings table line 125; T1.5, lines 226-232.

The presence of `void trust.setTrustedFolderLive(...)` does not establish the alleged unhandled rejection or missing disposal join. The called lifecycle already owns that work. `WorkspaceTrustLifecycle.reconcile` submits transitions to `TrustTransitionLifecycle`; `apply` attaches a rejection handler, and `whenSettled` reports retained transition failures. `WorkspaceTrustLifecycle.dispose` closes admission and awaits that settlement. The assembly registers this disposal and then the parent unsubscribe in a rollback scope, so unsubscribe executes first.

**Evidence:** `packages/agents/src/api/agentRuntimeAssembly.ts:393-413`; `packages/core/src/services/workspace-trust-lifecycle.ts:78-96,145-154`; `packages/core/src/services/trust-transition-lifecycle.ts:33-46,58-78,106-139`. A read-only Bun probe registered a held asynchronous transition subscriber that threw a sentinel error. Disposal remained pending until release and rejected with that exact error: `disposePendingBeforeRelease=true`, then `sameError=true`.

The proposed unreadable trust-file trigger also does not match this implementation: this lifecycle changes in-memory state and invokes subscribers, rather than reading a trust file. Adding another accepted-promise set and rethrow step before `trust.dispose()` can duplicate reporting or prevent the existing disposal from running.

**Change:** mark the normal-transition allegation unsubstantiated/wrong as written. Retain a public inherited-trust regression as characterization of the existing join and failure behavior. Only authorize a production change if a distinct reachable failure is first demonstrated, with its actual dependency and cancellation ordering. Do not add the proposed second tracker merely to satisfy the original wording.

## 2. High: E1's proposed failing test already uses a trust-filtered preferred path

**Plan:** findings table line 139; T7.3, lines 492-497.

There is duplicated facade acquisition code, but the claim that the preferred path exposes untrusted subagents omits the getter it calls. The preferred path passes `this.mcpRuntime.subagentDefinitions` to `WorkspaceControl`. That getter itself calls `projectTrustedSubagents` using the runtime's current trust. The foreground path's extra projection does not establish a missing preferred-path filter.

**Evidence:** `packages/agents/src/api/agentRuntimeAssembly.ts:667-682`; `packages/agents/src/api/mcpRuntimeAssembly.ts:158-161`; `packages/agents/src/api/foreground-agent-assembly.ts` and `foreground-workspace-control.ts` contain the additional projection. There is already a shared `AgentImpl` publication in `foreground-agent-assembly.ts:784-842`; the two earlier blocks duplicate acquisition and initialization, not two independent `new AgentImpl` publication sites.

T7.3's acceptance criterion of one production `new AgentImpl` site is therefore already true, and its untrusted-listing test does not demonstrate the claimed divergence.

**Change:** classify E1 as duplication with an unproven behavioral divergence. Run preferred/foreground trust parity tests before the refactor and keep them unchanged. Specify the actual duplicated acquisition/control-building blocks to consolidate and a structural acceptance criterion that is false at the starting head. Do not require an invented behavioral RED result.

## 3. Medium: E4's public streaming test does not reach the obsolete fallback

**Plan:** T1.6, lines 234-240; findings table line 142.

The obsolete Config duck type exists, but public streaming with an admitted active profile already supplies the profile name. `buildModelInfo` uses its Config fallback only when the explicit argument is `undefined`. Replacing the fallback with the settings owner's current profile also risks replacing an admitted request snapshot with later mutable state.

**Evidence:** `packages/agents/src/core/modelInfoHelpers.ts:60-98`; `packages/agents/src/core/MessageStreamOrchestrator.ts:906-914`; `packages/agents/src/api/directProviderAdmission.ts:95-103`. `emitModelInfoForNewSequence` at `modelInfoHelpers.ts:111-118` calls the fallback, but repository search finds no production caller of that helper. `git show origin/main:packages/agents/src/core/modelInfoHelpers.ts` contains the same legacy getter.

**Change:** separate deletion of dead fallback/helper code from a demonstrated live metadata bug. Name the live caller that actually omits admitted profile data, if one exists, and test that path. Preserve the admitted route's profile identity when settings change during a held request. For pure dead-code removal, use characterization tests rather than asserting the ordinary active-profile stream fails before the change.

## 4. Medium: E5's marker-file test can pass without fixing the child Config

**Plan:** T1.7, lines 242-248.

The child Config does use `process.cwd()`, but the proposed relative-file read does not isolate that Config. Child scope construction receives the foreground Config and inherited workspace/tool operations. A child reading a parent-workspace file through those already-correct ports is not evidence that its separately constructed Config has the right directory.

**Evidence:** `packages/agents/src/api/child-agent-assembly.ts:194-201,391-418`; `packages/agents/src/core/subagent.ts:245-275`. The scope uses `this.foregroundConfig`, inherited `workspacePaths`, and the loaded child tool selection.

**Change:** identify a real child operation whose result depends on `this.config.getTargetDir()` or `getCwd()` from `acquireWorkspace`, and specify the assertion and fixture for that operation. Keep the public task integration test as additional coverage, but do not assume it is RED. The parent Config is already a constructor input, so state why new duplicated directory fields are necessary instead of deriving the two values from that existing input.

## 5. High: T2.1 does not exercise wrapper-created invocation, and its proxy fixture cannot serve the specified requests

**Plan:** T2.1, lines 295-301; T2.2 and T2.4 reuse its fixture.

`agent.generate` supplies a complete invocation before entering the provider wrapper. It consequently does not test the branch where the logging wrapper creates an invocation without fetch. The prescribed initial RED case can pass despite leaving the identified wrapper bug intact.

The named proxy helper also implements CONNECT tunneling only, accepts only hostname `127.0.0.1`, and counts tunnels. It does not serve canned absolute-form HTTP requests for `model-a.invalid` or `compress-a.invalid`. Those are two separate fixture mismatches.

**Evidence:** `packages/agents/src/api/foreground-agent-assembly.ts:551-565`; `packages/agents/src/session/session-text-generation.ts:164-175` passes `this.fetch`; `packages/providers/src/logging/optionsNormalizer.ts:50-66` uses `invocation ??=`. `packages/agents/src/api/__tests__/helpers/local-connect-proxy.ts:10-49` rejects non-loopback destinations and has no ordinary request responder.

**Change:** give the wrapper regression a real entry point that reaches the wrapper without a prebuilt invocation, using real provider/manager construction rather than mocking normalization. Separately retain public generation and profile-compression integration cases. Specify a loopback proxy that actually handles the transport used by `OwnedFetch`, records destination and request headers, serves the chosen fake endpoints, and closes held tunnels deterministically. Include that helper's exact path in scope. Prove the fixture works with a transport-bearing control before accepting the intended failing case.

## 6. High: required transport changes are not split into compiling, complete commits

**Plan:** A3 design line 165; T2.1-T2.4, lines 295-324.

T2.1 removes `captureProviderInvocation`'s sixth argument and makes `ProviderInvocationData.fetch` required, while `SessionSettingsOwner.prepareProviderInvocation` still accepts an optional fetch. Some existing production callers omit it. This is a different dependency from the optional `RuntimeInvocationContext.fetch` that T2.3 prepares. The listed production scope misses the child runtime loader, and a later generic 'remaining compile failures' task does not make T2.1 green.

**Evidence:** `packages/core/src/session/session-settings-owner.ts:404-427`; `packages/agents/src/core/subagent-runtime-loader.ts:42-49` omits request fetch. Its production caller is `packages/agents/src/api/child-agent-assembly.ts:349-374`, with an existing test in `packages/agents/src/core/subagent-runtime-loader.test.ts`. The current manager invocation-data builder at `packages/providers/src/ProviderManager.ts:439-458` also has no fetch member. Session client binding and standalone generation have separate builders.

T2.4's proposed Vercel RED test is also not guaranteed to fail at that stage: T2.1 has already repaired the wrapper injection path on which its explanation relies.

**Change:** inventory all invocation-data producers, capture callers, context builders and standalone/child entry points before the first transport signature change. First move callers to explicit owner transport under the old signature, then atomically change the data/signature and delete the old path. Give each public path a before/after behavioral case at the point it is actually broken. Explicitly cover manager use before session-client binding, when the plan's removal of ambient fetch changes authentication behavior.

## 7. High: T2.5's service-account token endpoint fixture is invalid

**Plan:** A7 design line 168; T2.5, lines 326-332.

The proposed service-account JSON `token_uri` does not control this installed JWT token exchange. The JWT client extracts key/email/project fields and creates a `GoogleToken`; that implementation posts to its fixed Google token URL. A proxy expecting a request for `oauth-a.invalid/token` will not establish the intended transport or owner-isolation behavior.

**Evidence:** `plugins/google-gemini/node_modules/google-auth-library/build/src/auth/jwtclient.js:205-214,226-242`; the resolved dependency is `node_modules/gtoken/build/src/index.js`, whose lines 33 and 241-246 use `https://www.googleapis.com/oauth2/v4/token`. The Vertex SDK calls `GoogleAuth.getClient().getAccessToken()` separately from model fetch in `plugins/google-gemini/node_modules/@ai-sdk/google-vertex/dist/index.js:5-15`.

**Change:** choose a refreshable credential type whose endpoint is actually honored, or have distinct owner-bound transports route the real fixed token URL to isolated local responders. Supply a valid credential fixture, explicit project/location, forced non-cached refresh, a successful token/model control, and a held exchange for cancellation. Verify the actual `clientOptions.transporter` path through these installed versions. No real credential or outbound Google call should be needed to pass the test.

## 8. High: deleting the acquisition owner's AuxiliaryWork also removes text-generation ownership

**Plan:** A5 design line 167; T3.1, lines 336-343.

The acquisition-level tracker is redundant for JSON/embedding, but it is also passed into `SessionTextGeneration`. That path acquires/initializes temporary clients and performs standalone text requests without going through `AgentClient.generateJson` or `generateEmbedding`. Deleting the entire tracker and keeping only `AgentClient`'s tracker drops the owner of this distinct work unless it is deliberately relocated.

**Evidence:** `packages/agents/src/session/session-client-acquisition-owner.ts:97-109` constructs `SessionTextGeneration` with `this.auxiliary`; `packages/agents/src/session/session-text-generation.ts:148-175` admits work through it before building requests; acquisition owner's JSON/embedding wrappers are at lines 291-302. `packages/agents/src/core/client.ts:893-913` tracks its own JSON work, not all of that outer text-generation lifecycle.

**Change:** remove only the duplicate JSON/embedding layer, or assign standalone text generation an explicit retaining owner before deleting the shared tracker. Add held ordinary text generation, held temporary-client initialization, late-admission rejection and cleanup-failure tests. Specify which owner aborts and joins each path. Do not delete the field while one of its distinct production responsibilities remains unmapped.

## 9. High: joining OAuth flights does not by itself release a lock acquired during cancellation

**Plan:** A4 design line 166; T3.4, lines 360-366.

The proposed design assumes joining the flight releases its auth lock. Current cancellation can occur while `waitForAuthLockOrToken` is pending. After that function acquires a lock, `throwIfAborted` runs before entering the `try/finally` that releases it. Joining the resulting rejection cannot repair the skipped release. Adding an owner signal makes this ordering particularly relevant.

**Evidence:** `packages/providers/src/auth/auth-flow-orchestrator.ts:369-385,424-425,430-447`. T3.4's gate holds `initiateAuth`, which is reached after the vulnerable acquisition window, so that test does not cover it.

**Change:** put the post-acquisition cancellation check within the lock's release ownership, preserving the no-lock/token-already-available branches. Add a second test that holds lock acquisition, aborts the owner, then lets acquisition succeed. Assert release precedes token-store close and a peer/later legitimate acquisition is not blocked. Require cleanup steps to continue and aggregate their own failures if another retirement step rejects.

## 10. High: T3.5 does not require retention of handlers already removed from the session map

**Plan:** A4 design line 166; T3.5, lines 368-373.

Waiting for handler promises belonging to active sessions is insufficient. `settleSession` removes a session immediately and aborts its controller, while the host handler may still be running. Manager disposal unbinds the host before coordinator disposal, which can remove those sessions before the join begins. The plan explicitly accounts for orphaned auth flights but does not give interactive handlers the equivalent retention contract.

**Evidence:** `packages/providers/src/auth/interactive-auth-coordinator.ts:271-275,373-395,434-455`; `packages/providers/src/auth/oauth-manager.ts:435-445` unbinds first. The current handler promise is local to `startSession` and detached from the logical waiter outcome.

**Change:** require an independently retained set of every started host-handler promise, removed only on physical settlement. Close handler admission before cancellation/unbinding and join that set regardless of whether the logical session still exists. Test cancellation, timeout and host replacement before `dispose`, with the old handler still held, as well as the currently active-handler case and an independent second manager.

## 11. High: C3's proposed condition does not resolve workspace imports to source

**Plan:** findings table line 135; T9.1, lines 532-537.

Adding `customConditions: ['bun']` leaves imports pointing to declaration files when the export map puts `types` first. The planned fixture specifically puts `types` before `bun`, so it does not support the stated fix. A scanner following a declaration without a body still cannot inspect the mutator.

**Evidence:** `scripts/runtime-state-scan.ts:48-59`; `scripts/tests/runtime-state-structure-guard.ts:276-281`. A read-only `ts.resolveModuleName` probe using Bundler resolution, both with and without `customConditions: ['bun']`, resolved the core package root, `core/session/session-settings-owner.js`, and the settings package root to `dist/*.d.ts` in both cases. Only the tested `core/runtime/RuntimeInvocationContext.js` subpath changed to source. These differences follow the actual export maps in `packages/core/package.json` and `packages/settings/package.json`.

**Change:** specify source-aware workspace resolution that works with the existing export order, using verified project/source mappings or an explicit resolver. Do not reorder a fixture to avoid the problem or change exports merely to satisfy the scanner. Add controls for root exports, subpaths, reexports and a non-relative imported mutator with `types` first, plus a non-mutating import. Identify any newly exposed production findings and their repair order before requiring a zero gate.

## 12. High: T1.8 cannot surface malformed alias errors within its allowed scope

**Plan:** E6; T1.8-T1.9, lines 250-263.

The required malformed-alias RED case is real in principle, but deleting the agents' outer catches cannot make it green. The provider alias loader catches JSON/read errors internally and returns `null`; directory failures also become `null`, and collection silently omits those entries. Those provider files are outside T1.8's allowed scope.

Other E6 sites are delegated with 'likewise surface a non-absence failure' or 'as T1.8', without identifying the dependency that can fail through a real entry point. That is insufficient for the stated no-self-mocking test requirement.

**Evidence:** `packages/providers/src/composition/providerAliases.ts:393-415,428-456`; `packages/agents/src/api/providerMutations.ts:184-192`; `packages/agents/src/api/provider-switch/provider-switch.ts:46-55`. The remaining sites have different contracts: `chatSessionProviderRuntime.ts:121-139` converts reads to absence, while `session-execution-owner.ts:210-228` converts execution errors to message-only results.

**Change:** include the actual alias loader and its tests in an explicitly bounded task, with a decision for missing directories versus malformed/unreadable selected aliases. Give every E6 catch site its own caller, external failure fixture, expected error/cause, and handling of legitimate absence. Split the work by error contract rather than leaving weak agents to invent mocks or widen scope.

## 13. High: Config key-storage deletion lacks a complete CLI producer and release path

**Plan:** B1 design line 169; T5.1-T5.2, lines 403-416.

T5.2 says UI consumers get storage from the host credential authority, but its scope omits the host-to-interactive-startup wiring. Neither `App` nor the slash-runtime builder currently receives that authority. Removing Config's getter eliminates the current producer without specifying how the replacement reaches those consumers. `createProviderKeyStorage()` also returns an owned handle whose proxy transport needs closing; the design does not assign that release.

**Evidence:** `packages/cli/src/session/interactiveUI.tsx:588-604` passes `args.config` to `buildSlashRuntime`; `packages/cli/src/ui/cliUiRuntime.ts:426-432,812-854` reads the Config-shaped source getter; `packages/cli/src/ui/App.tsx:692-730` uses that slash runtime. `packages/providers/src/auth/proxy/credential-store-factory.ts:179-209` constructs local/proxy key-storage handles; proxy handles own a client close operation.

**Change:** enumerate the host authority producer, the exact startup args/props it traverses, and the narrow key read/write/completion port delivered to the UI. Include those production files in T5.2's scope and assign the storage handle to an existing owner with rollback and normal release. Test two UI roots with distinct stores and disposal of one root's proxy handle while the other remains usable. Do not resolve this omission with an optional getter or a Config fallback.

## 14. Medium: B6/B3 name port objects without defining whether they are narrow or replacement bags

**Plan:** designs lines 171 and 174; T5.4-T5.6; T7.1-T7.6.

Replacing positional arguments with a single object does not establish the narrow-port requirement. The plan leaves fields as 'and the rest named', 'required fields for exactly what it reads', and unspecified `AgentOperationPorts`/`AgentFacadeInput`. Existing arguments include whole runtime, settings and manager objects. A mechanical record containing all of them can reproduce the prohibited graph under another name.

**Evidence:** `packages/agents/src/core/subagent.ts:197-223`; `packages/agents/src/session/session-tool-catalog-owner.ts:196-213`; `packages/agents/src/api/session-provider-reads.ts` retains the original broad collaborators. The boundary policy exempts only named top-level functions `createAgent` and `assembleFacade` in `createAgent.ts` (`scripts/check-runtime-state-boundary.ts:206-215`); a new facade function or class constructor is not automatically exempt (`scripts/tests/runtime-service-shape-guard.ts:91-104,389-400`).

**Change:** write the actual interface members and caller mappings before assigning these tasks. Separate assembly-only acquisition inputs from operational collaborators, project the latter to operations, and specify ownership/lifetime and receiver binding for each field. Show how the existing scanner accepts the intended interfaces without any new exemption. Add numbered algorithm/contract references for these rewrites as required by `dev-docs/PLAN.md` and `PLAN-TEMPLATE.md`, rather than leaving their architecture to the coding session.

## 15. High: phase 7's scopes do not cover the inheritance edges they remove

**Plan:** T7.1-T7.6, lines 480-515; promise of a green commit after every task.

For example, T7.4 removes `AdoptedSessionAssembly` and its inherited fields but allows only `fromConfig-session.ts` and `adopted-agent-assembly.ts`. `AgentActivationBootstrap` directly consumes those inherited fields in `activationPreflightState.ts`, which is outside that task. T7.5 then removes the bootstrap's inherited access to the foreground publication and lifetime state, although its scope omits the foreground implementation. The plan provides no replacement call/data contract for those uses. A coder must either violate scope, leave a bridge, or commit compilation failures.

**Evidence:** `packages/agents/src/api/activationPreflightState.ts:125-150,397-445,547-593,608-657` accesses inherited manager/settings/session/MCP/resource and publication behavior. `packages/agents/src/api/fromConfig-session.ts:68-99` and `adopted-agent-assembly.ts:124-178` define the current inheritance links. `session-provider-reads.ts:212-245` also initializes closures over fields populated later, so replacing them with eager port snapshots changes initialization semantics.

**Change:** inventory every inherited member reader/writer and design the transfer/publication/admission contracts first. Partition by a complete dependency edge: prepare the operational collaborators while inheritance remains, then remove one edge together with all of its direct consumers in an atomic green commit. Explicitly preserve late-bound reads, native receivers, repeated disposal, construction rollback, and transferred preflight resources. Do not defer compile repairs to later tasks or allow temporary aliases.

## 16. Medium: several tasks are still open-ended multi-package projects rather than bounded agent work

**Plan:** T1.4, T5.5, T6.Bxx, T7.2, T8.1-T8.7; summary line 14.

T5.5 includes roughly 55 callers plus complete agents/CLI suites in one atomic signature migration. T7.2 moves turn, settings and disposal operations together. T8.6/T8.7 leave roughly 46 CLI consumers in only two batches, whose file lists are not written until a previous commit body. T8.1-T8.5 restrict scope to consumers while their producers/callers must supply the new projections. A count of ten test files per T6 batch also ignores whether those files have one scenario or a large acquisition/rollback harness.

The escape hatch 'hand off if it does not fit' preserves unfinished work but does not satisfy the request for independently executable green tasks. Many task verifications still say only 'focused test' rather than naming it.

**Evidence:** `PLAN.md:434-442,455-462,486-490,519-527`; current runtime producers include `session/interactiveUI.tsx:588-604`, the CLI bootstrap chain, and inherited publication callers in `activationPreflightState.ts`.

**Change:** add a pre-implementation inventory with committed exact file/scenario lists, producer-to-consumer projections and package commands. Split behavior-neutral call-site preparation from the atomic signature/deletion step without keeping a second public API. Divide migrations by scenario complexity and collaborator responsibility, not file count alone. Every task should list its RED/control path, exact test command, affected producer files, exit criteria, and the next task's required state. Store batch scopes in the plan artifacts, not only in commit prose.

## 17. Medium: B2 test deletion lacks behavioral conservation and a recoverable fix path

**Plan:** T6.0/T6.Bxx/T6.D2, lines 452-474.

A fixture's use of an unreachable field proves that construction route is invalid; it does not prove all scenarios and assertions in its test file are obsolete. The current D classification permits file deletion by naming the field, while the inventory receives only a five-file spot check. Conversely, a migrated public-entry failure must stop, but there is no defined task-generation and preservation protocol for that failure. This invites deletion of genuine rollback/isolation coverage or repeated stalled batches.

**Evidence:** `packages/agents/src/api/__tests__/helpers/adoption-fixture.ts:56-83` exposes many unrelated resource inputs through a shared fixture. The qualification discussion in #2616 already treats preserved scenarios, assertions, timers and failed receipts separately, rather than treating fixture removal as behavior proof. `dev-docs/RULES.md` requires behavior tests and forbids weakening them to make code pass.

**Change:** inventory scenarios/assertions, not only importers. Every deleted scenario needs either a mapped public/domain replacement with preserved expected behavior or a precise explanation of why the behavior itself is impossible/unsupported. Review all D/S classifications. Define how a public-path failure creates a bounded production-fix task and retains the original failing assertion/log before the migration resumes. Add a final conservation check before deleting the shared fixtures.

## 18. Medium: the start and handoff protocols prevent both initial execution and normal recovery

**Plan:** start check lines 38-44; handoff lines 90-92; T0.1.

The actual starting status is `?? project-plans/issue2616/pr3911-review-fix/`, so T0.1 fails its own clean-tree prerequisite before it can commit the plan. After an interrupted implementation, the handoff protocol deliberately leaves edited source files. The next agent's start check permits only an untracked handoff, so it must refuse the very recovery state the protocol creates. `ls .../handoff` also exits nonzero when the directory does not exist.

**Evidence:** `git status --porcelain=v1` at the reviewed head printed the untracked plan directory; the scope and recovery rules are in the cited plan lines.

**Change:** provide a narrow T0 bootstrap exception listing the approved untracked planning artifacts. For recovery, require the orchestrator to record the expected base SHA, exact dirty-path list/status and next command, then allow the same task to resume only if that manifest matches. Treat an absent handoff directory as normal without hiding unrelated filesystem errors. Keep the bans on stash/reset/clean and unrelated-file changes.

## 19. Medium: verification templates can accept stale completion and lose test isolation

**Plan:** command patterns lines 55-78; T6 batch verification; checkpoints.

The suite log names are reused for resumed/fix runs. The poll checks only for an `EXIT=` line and can consume an older run's completed file before the newly backgrounded command truncates it. The polling command itself exits successfully even when the recorded value is `EXIT=1`; the plan relies on the agent noticing text. There is no per-attempt PID/run binding or missing-marker termination condition. This matters for the specified agents that skip verification or claim unrun results.

The focused `bun test <path> ...` template also encourages running several files in one Bun process, contrary to the agents package runner's explicit isolation requirement for process-global module mocks.

**Evidence:** `PLAN.md:66-75`; `packages/agents/run-bun-tests.ts:10-22` states that per-file processes are required and explains mock leakage. The package's actual suite script exists (`packages/agents/package.json:34-37`), but direct multi-file invocations are not equivalent.

**Change:** use attempt-unique paths and bind command, task, source SHA/diff state, PID and exit status in the receipt. Make completion checking return failure for nonzero status, missing output after process exit, or source drift. Close stdin for verification children and poll with bounded, emitting shell calls. Run focused agent files separately using the package preloads; retain the package runner for full suites. Record RED and GREEN receipts for the same test rather than accepting an unbound log name.

## 20. Medium: the final phase omits plugin qualification and can report commands from different heads

**Plan:** checkpoints; T10.1-T10.3, lines 554-570; A7/D1.

`plugins/google-gemini` is not a root workspace. Root `npm run test` and root workspace typechecks therefore do not provide its full suite/build evidence. T2.5 runs only its new test and a typecheck; the final unchanged-head list never explicitly runs the plugin suite. The transport repair consequently lacks full affected-plugin qualification after subsequent changes.

T10.1 also runs build/typecheck before `npm run format --write`; if formatting changes and commits files, it reruns only lint, so its earlier commands no longer bind the claimed unchanged head. T10.2 allows affected-area reruns after CI fixes despite F requiring the full final-head cycle. Watching a nightly by an unbound run ID is insufficient to establish the same-head native execution discussed in #2616 and the PR.

**Evidence:** root `package.json` workspace list and scripts; `plugins/google-gemini/package.json` has its own build/typecheck/test commands. `scripts/bun-test-roots.ts` does not supply a root Google plugin test lane. The plan's own lines 558 and 566 conflict on final-source verification.

**Change:** explicitly add plugin dependency setup and full affected plugin test/build/typecheck commands to the final cycle and relevant checkpoints. Finish all writing/formatting/commits before qualification, then use `format:check` and bind every receipt to one unchanged source/head. Any subsequent code change must produce a new full final qualification before PR claims are rewritten. Bind CI/nightly run and attempt/job evidence to that exact pushed SHA and verify required Windows cases actually executed, not just that a workflow or skipped job is green. Retain the planned D2 disclosure, stale-claim removal, and no-merge restriction.

## 21. Medium: T1.12 describes a Windows FD mechanism the existing tests do not use

**Plan:** E9c; T1.12, lines 279-284.

The task says the existing cases spawn with an extra stdio pipe on fd 3 and proposes just removing `skipIf(win32)`. They actually launch Bash with a here-string and `exec bun`. Removing the skip tests Bash's platform behavior, not a native Windows inherited capability channel. The fallback proposal to reject the feature on Windows also changes the product contract instead of adding equivalent-path coverage.

**Evidence:** `packages/providers/src/auth/proxy/credential-authority.test.ts:29-58,143-195,233-269` uses `bash --noprofile --norc -c`, `exec 3<<<...`, and child stdio `['ignore', 'pipe', 'pipe']` for the main case. The FD is created by the shell, not an extra native spawn pipe.

**Change:** first specify the supported Windows host/sandbox capability-delivery mechanism and its actual producer/reader contract. Add a shell-independent subprocess fixture using that mechanism, with successful token/key/broker requests, malformed capability, scrubbing and handle-close assertions. Keep POSIX coverage for POSIX delivery. If native FD delivery is unsupported, test the real supported Windows equivalent rather than declaring success because unsupported input is rejected. Include the producer/reader files in a bounded fix task if required and require final-SHA native execution evidence.
