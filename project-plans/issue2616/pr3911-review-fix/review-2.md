# Verdict: needs rework

The plan accounts for every feedback item, but it is not ready for task-by-task implementation. The proposed port contracts do not all pass the existing scanner, the composition design retains the assembly through live closures, and several prescribed tests cannot reach the code they are meant to characterize or repair. There are also ownership and execution-protocol conflicts that would force coding agents to stop or invent designs outside their scopes.

**Findings: 5 high, 8 medium, 1 low.**

Reviewed against worktree HEAD `3984a8773ee78c4614d1922da8cb917f6bdb1834`, branch `issue2616-consumer-closure-combined`, and the local `origin/main` reference `85fdd73b1d09671b5ce11bbfce72080a662d5ac4`. Paths below are relative to `/Volumes/XS1000/acoliver/projects/llxprt/branch-2/llxprt-code/tmp/w2616k`. Plan references mean `project-plans/issue2616/pr3911-review-fix/PLAN.md`; companion references are in that directory.

## Numbered findings

### 1. High: the specified B6 contract already violates its scanner acceptance rule

**Plan/task:** T5.6; `ports-B6-B3.md:125-155`, particularly `ChildAgentAcquisition` at lines 131-140; plan lines 212 and 551.

**Problem:** The companion says `ChildAgentAcquisition` reaches only `SettingsService`. Its `scopeFactory: typeof SubAgentScope.create` also returns a `SubAgentScope` whose public `runtimeContext` exposes `HistoryService`. Callable return types count. This object therefore carries two service roots and cannot pass the mandatory boundary gate. Grouping construction arguments into this object does not meet B6. Separating assembly inputs from operational inputs does not exempt either from scanning.

**Evidence:** A memory-only TypeScript program importing the actual `SettingsService` and `SubAgentScope`, analyzed with `serviceAnalyzer` and the service symbols from `productionPolicy`, produced:

```text
ChildAgentAcquisitionProbe {"roots":["SettingsService","HistoryService"],"bundle":true,"incomplete":false}
```

The probe interface contained only `createChildSettings(): SettingsService` and `scopeFactory: typeof SubAgentScope.create`. No source file was written. The exposed result is visible at `packages/agents/src/core/subagent.ts:149-172`; the proposed members are in the companion at lines 136 and 140. T5.4 changes the factory's arguments, not that returned public surface. T8.3 only narrows three other consumers and does not remove this exposure before T5.6.

**Concrete change:** Split these acquisitions into contracts that each pass the real analyzer, or give the scope factory a deliberately narrow returned launch/run/dispose contract and update its consumers in a bounded preparatory task. Audit every proposed interface's transitive callable returns before declaring the contracts settled. Commit the resulting exact member lists to the companion; do not defer this known failure to the coder's acceptance check or add an exemption.

### 2. High: B3's live ports retain the assembly, and the operation contracts omit required responsibilities

**Plan/task:** B3 design at plan line 209; T7.1, T7.2a-c and T7.8; `ports-B6-B3.md:160-208`.

**Problem:** The plan says the assembly must not be reachable from the live agent, but specifies late-bound closures over that assembly for both `SessionProviderReads` and `AgentOperations`. The resulting graph is `AgentImpl -> AgentOperations/SessionProviderReads -> closure -> ForegroundAssembly`. Making assembly fields private or replacing `.bind(this)` with arrows does not remove that graph. The same contract also does not provide enough operations to move the current turn bodies unchanged: stream admission, recording, hooks, discovery, tool notifications and coordinator operations are not represented by the stated `session` and generic `admission` ports.

**Evidence:** The companion explicitly requires closures over the foreground's fields at lines 162 and 178, while plan line 209 requires an unreachable assembly. Current `stream` uses settings/provider admission, recording, hook ownership, profiles, coordinator admission/release, execution resolution, MCP discovery and tool notifications at `packages/agents/src/api/foreground-agent-assembly.ts:458-479`. `generate` additionally constructs recording and provider admission at lines 551-565. The proposed `AgentTurnSession` is described only as the seven client calls at companion line 182. The proposed read views also must support profile preparation, publication and provider switching, not merely reads: `session-provider-reads.ts:263-305,311-348` performs those operations and mutates provider/auth state.

**Concrete change:** Specify which persistent operational owners hold mutable session/provider/lifecycle state after construction, and have the live controls close over those owners, not the acquiring assembly. List every operation required by the moved bodies, including admission, recording, hooks, discovery, notifications and profile publication. Define the missing view members and mutation responsibilities explicitly. Add a review acceptance criterion covering captured receivers and object reachability; the current grep for inheritance and `.bind(this)` cannot prove B3.

### 3. High: the phase-7 inventory omits a production subclass that depends on the fields being removed

**Plan/task:** T7.0, T7.4-T7.8; `inventory-phase7.md:265-276,299-305`.

**Problem:** The inventory follows only six chain files. `profile-preflight.ts` contains another production subclass, `PreparedActivation extends AgentActivationBootstrap`, which writes inherited activation and foreground fields. T7.4 makes fields private, and T7.7b replaces inheritance with held instances, but neither task includes this subclass or gives it replacement inputs. A compiler-green edge change needs this caller in the same migration, rather than an unplanned scope expansion after implementation starts.

**Evidence:** `packages/agents/src/api/profile-preflight.ts:688-719` constructs `PreparedActivation` and assigns `activationSettings`, `activationManager`, `activationOAuth`, settings ownership, files, bus, trust, memory, `foregroundPolicy`, `foregroundSettings`, `foregroundManager`, `foregroundOAuth`, authority, runtime context and provider release callbacks. It then calls `acquireActivation` and `initializePreparedActivation` at lines 720-727. The companion's bootstrap view does not replace these writes. The inventory script's `chain` list and reader loop exclude this file. T7.7b's scope is only `adopted-agent-assembly.ts` and `activationPreflightState.ts` at plan line 718.

**Concrete change:** Include all production subclasses and inherited-member users in the inventory, especially this nested subclass. Specify its replacement construction/transfer API and assign its edits to the exact tasks that remove the old fields. Also settle the release-transfer implementation before T7.7a: `packages/core/src/lifecycle/acquisition-release.ts:16-63` has acquisition, close and rollback, but no operation to remove or transfer entries as prescribed at plan line 713. Either transfer a single owned release capability using the existing lifecycle model, or plan and scope the necessary lifecycle API explicitly.

### 4. High: the root-transport decision is not executable for preflight and leaves borrowed transport release unresolved

**Plan/task:** Phase 2 ownership decision at plan line 391; T2.3, lines 414-420.

**Problem:** The required instruction to construct every transport from its `Config` before its manager cannot apply to pre-config preflight, where Config does not yet exist. More importantly, replacing the session's transport with the root's transport changes ownership, but the plan does not define its transfer, rollback, admission-close and final-release boundaries. Keeping the session's existing release sites closes a borrowed shared transport; removing them without moving admission closure can leave held network work running during shutdown. A transport released immediately after the manager also needs to remain usable until OAuth work that borrows it has joined.

**Evidence:** Preflight construction uses `AgentPreflightHostInput.proxy`, not Config, at `packages/agents/src/api/profile-preflight.ts:113-124`; its manager and OAuth are acquired before Config at lines 174-210. Foreground transfer deliberately keeps the provider release scope alive at lines 763-818. Session acquisition currently creates its own network at `session/session-client-acquisition-owner.ts:94-109`, disposes it on binding failure at lines 123-130, and disposes it again through `disposeClientNetwork` at lines 140-141. `session-client-owner.ts:507-545` invokes that release before closing the provider lifetime. `OwnedFetch.dispose` only closes its dispatcher; owner abort is a separate method in `packages/core/src/utils/fetch.ts:121-127`. Normal `AcquisitionRelease` order is manager before OAuth at `packages/core/src/lifecycle/acquisition-release.ts:36-49`.

**Concrete change:** Give preflight the explicit `host.proxy` construction rule. For each of the four manager roots, state who owns the network, who borrows its fetch, when admission is aborted, when OAuth/model work is joined, and who closes the dispatcher on construction failure, successful transfer and final disposal. Name the session cleanup sites to delete or change. Divide manager-root wiring and preflight-to-foreground lifetime transfer into separate compiling tasks if necessary. Add held-request transfer/rollback tests, not only successful proxy receipts.

### 5. High: blanket settlement-only joins lose temporary-client cleanup failures, and the proposed failure fixture does not inject that failure

**Plan/task:** A5 decision at plan line 199; T3.1, lines 457-466.

**Problem:** Ignoring every result from tracked generation promises removes abort duplication, but those promises also contain owner cleanup. A temporary client's cleanup failure can disappear from the ledger before final disposal and then be discarded by the new join. The plan demands that disposal still report such a failure without giving it an independent retention path. Its proposed fixture, a fake provider whose `dispose` throws, does not represent temporary `AgentClient` release.

**Evidence:** `packages/agents/src/session/session-text-generation.ts:65-108` disposes the temporary client inside the tracked operation and combines generation and cleanup errors. Initialization failure has the same combined outcome at lines 129-138. `session-client-cleanup.ts:105-109,145-151` releases that client and deletes its ledger entry before file-scope cleanup finishes. Later `settleOwnedClients` only visits remaining entries at lines 99-102. `core/client.ts:332-348` releases listeners, media/history and auxiliary work; it does not call a provider's `dispose`. ProviderManager disposal is a separate root lifetime. The proposed change scopes neither `session-text-generation.ts` nor `session-client-cleanup.ts`.

**Concrete change:** Define a separate retained outcome for owner cleanup, without reinstating the redundant JSON/embedding operation wrapper. Scope the temporary-client/ledger changes explicitly. Keep caller request errors out of shutdown reports, but retain genuine release failures after ledger retirement. Replace case (f) with an external failure that actually occurs during temporary client or file/history cleanup, and prove that its caller path, root disposal and independent peer behavior have the intended outcomes.

### 6. Medium: T1.6's required passing characterization violates current profile admission

**Plan/task:** T1.6, plan line 288(b).

**Problem:** A public ordinary stream cannot remain held while a different profile successfully loads through that agent's public profile operation. The operation is rejected as busy before profile loading. This is supposed to be a passing characterization, so following the instructions either stops the task or tempts an agent to weaken admission.

**Evidence:** `packages/agents/src/api/session-provider-reads.ts:263-305` supplies `coordinator.assertIdle` to profile application. `profileApplicationAssembly.ts:225-232` checks it before enqueueing work, and `agentExecutionCoordinator.ts:54-56` throws `AgentBusyError` for a live run. Model info is already read from admitted parameters at `core/MessageStreamOrchestrator.ts:906-924`.

**Concrete change:** Keep the public profile-name/no-profile characterizations and add the expected public busy result while a stream is held. Test snapshot-versus-later-state behavior through the real model-info/orchestrator domain entry with explicitly admitted parameters if public mutation is prohibited. Name that entry and fixture. Do not change profile admission to manufacture the characterization.

### 7. Medium: T1.9c's proposed failures miss the resolve catch, and its mandatory cause type omits legitimate absence

**Plan/task:** T1.9c, plan lines 332-335.

**Problem:** A provider failing client initialization or an MCP server failing tool listing is not a defined route into `SessionExecutionOwner.resolve`'s catch. That catch surrounds `assertOpen` and synchronous loop reconstruction; client initialization and discovery occur elsewhere. In addition, changing every error result to require `cause` leaves the genuine no-execution branch without a cause and does not explicitly update the intermediate types that erase it.

**Evidence:** `packages/agents/src/session/session-execution-owner.ts:210-228` shows both the narrow catch and the separate `Agent loop is not initialized` result. Its loop constructor at lines 316-341 builds `AgenticLoop`/tool execution state; it does not initialize the provider or list MCP tools. `session-client-acquisition-owner.ts:220-227` and `api/foregroundRunLifecycle.ts:45-47` both declare message-only error types before the value is emitted at `foregroundRunLifecycle.ts:104-107`.

**Concrete change:** Name and demonstrate the actual external dependency and public sequence that reaches reconstruction failure, or characterize the real owner entry if no public sequence can reach it. Include both intermediate declarations in scope. Specify an error union distinguishing a captured initialization failure from legitimate absence, preserving the original cause only where one exists. Require the red output to show the initialization-failure branch, not just any stream error.

### 8. Medium: T1.9a's file fixture fails in earlier load-balancer validation, not in the targeted loader

**Plan/task:** T1.9a, plan lines 317-319.

**Problem:** Loading a load-balancer profile from disk with a missing or malformed member fails in ProfileManager's reference validation before activation calls `loadReferencedSubProfile`. The prescribed regression therefore does not establish the target catch's behavior. Its expected direct parse-error cause also skips ProfileManager's existing corruption wrapper.

**Evidence:** `packages/agents/src/api/profileApplicationAssembly.ts:256-258` loads the enclosing profile before applying it. `packages/settings/src/profiles/ProfileManager.ts:245-246` validates load-balancer references; lines 185-208 check member existence and read/parse member files. For a directly loaded malformed member, lines 254-261 wrap `SyntaxError` in a profile-corruption error. Missing profiles are converted to a message-only not-found error at lines 250-252, so an `ENOENT` predicate in the downstream loader is insufficient. The targeted catch is `packages/agents/src/api/profile-application/loadBalancerProfile.ts:51-61`.

**Concrete change:** Drive the real exported sub-profile resolution entry with a real ProfileManager and temporary member files, or use an existing public snapshot-application route that bypasses enclosing-file validation. State the exact route. Specify the actual not-found condition and preserve the complete cause chain instead of asserting that an intermediate wrapper vanishes. Keep separate public enclosing-profile validation controls.

### 9. Medium: T1.1 does not create the workflow execution that T10.2 requires

**Plan/task:** T1.1, lines 242-247; T10.2, lines 815-816.

**Problem:** T1.1 adds plugin dependency installation only to nightly jobs selected from historical missing-dependency failures. T10.2 requires plugin suites to have run on both Windows and macOS. Installing plugin dependencies does not run their suites, and the existing nightly shard command does not include these non-workspace plugins. The final gate therefore mandates evidence for work no earlier task installs into the workflow. The CI edit instructions also need to explicitly replace the existing downloader copies, rather than leave that to the conditional investigation.

**Evidence:** `.github/workflows/nightly.yml:106-142` installs root dependencies and runs `bun scripts/test.ts --shard ...`; the Google plugin is outside root workspaces, as the plan itself notes at line 139. No nightly Google-plugin suite step exists. PR CI separately has explicit plugin execution, while `.github/workflows/ci.yml:497-505,1198-1207` still downloads and executes the bun.sh installer.

**Concrete change:** Make nightly's explicit frozen plugin install and plugin test execution required workflow edits, with named Windows and macOS jobs/steps. Use the existing pinned setup-bun action. Explicitly replace both CI downloader copies within T1.1's scope. Preserve required checks and shard coverage. Then make T10.2 check the named steps that the plan actually adds.

### 10. Medium: T7.0's supplied inventory command reads the wrong directory

**Plan/task:** T7.0; `inventory-phase7.md:258-276`.

**Problem:** The supplied script is saved under `W/tmp/pr3911/T7.0/`, but its relative root climbs only three parents. It resolves `W/tmp/packages/agents/src/api`, not `W/packages/agents/src/api`. The mandatory regeneration fails before producing an inventory.

**Evidence:** Companion line 258 prescribes `tmp/pr3911/T7.0/inv7.ts`; line 265 uses `join(import.meta.dir, '../../../packages/agents/src/api')`. Resolving those paths requires four parent traversals to reach W. Independently of the path typo, its reader loop only checks the fixed chain list, which is the missing-caller problem in finding 3.

**Concrete change:** Correct the root calculation or pass the absolute worktree root as an explicit argument. Run the prescribed command once against the current worktree before assigning T7.0, and extend caller discovery as described in finding 3. No hash manifest or additional verification machinery is needed.

### 11. Medium: T6.0's exhaustive scenario inventory is an unbounded single-agent task

**Plan/task:** T6.0, plan lines 617-621; task sizing claim at line 14.

**Problem:** Migration batches have size limits, but the task that must read every importing file, summarize every scenario/assertion and propose every conservation outcome has no such subdivision. It is much larger than the subsequent batches and has no completed per-directory checkpoint. A context-limited agent would have to hand off a partially written inventory without a defined coverage boundary, or quietly sample the work.

**Evidence:** The plan's own inventory search across packages currently returns **346 files**:

```text
git grep -l -E 'adoption-fixture|agent-resource-capture|activation-acquisition-capture|caller-fixture|skills-fixture-caller|createAgentRuntimeFactoryBindings' -- packages | wc -l
346
```

Some matches are definitions rather than importers, but filtering them does not turn the required per-scenario audit into a bounded task. T6.0 requires all scenario names, assertion summaries, outcomes, workload classification, field writers/readers and batch generation in one assignment.

**Concrete change:** Split inventory creation into fixed directory/file-list tasks before migration starts. Each task commits a complete bounded inventory section; a final aggregation task verifies file coverage and produces the migration batches. Apply the same bounded-task rule to any other generated inventory whose actual search results exceed one task's scope. Keep the existing exhaustive conservation requirement.

### 12. Medium: UI key ownership has two rollback closers without an explicit handoff

**Plan/task:** B1 release rule at plan line 207; T5.2a, lines 536-540.

**Problem:** The plan assigns handle closure to `commitInteractiveStartup` rollback and to `launchInteractive` when `startInteractiveUI` rejects before commit. Its suggested caller-side rejection `finally` cannot distinguish a pre-commit rejection from a rejection after commit rollback without a specified ownership-transfer protocol. Implementing both stated closers directly closes the same handle twice on a commit-stage failure. Only testing `commitInteractiveStartup` rollback misses the earlier failure window.

**Evidence:** `packages/cli/src/session/interactiveUI.tsx:415-426` performs presentation initialization, previous-instance replacement and perf-owner acquisition before calling commit. Commit has its own rollback at lines 676-692. The caller awaits the whole `startInteractiveUI` promise at `packages/cli/src/cli.tsx:455-474`; no current return or handoff value distinguishes those failure stages.

**Concrete change:** Choose one rollback authority for the newly acquired key handle until successful instance publication, or define an explicit synchronous transfer that both sides observe. State the transfer point in the design. Add tests for failure before commit and after commit starts, plus normal replacement, each asserting exactly one close. Preserve independent cleanup failures rather than using an idempotent close as a substitute for ownership.

### 13. Medium: the final-phase task-ticking rule invalidates the final-head freeze

**Plan/task:** Coder protocol lines 60-61, commit rule line 110, task index lines 822-824, T10.0-T10.3.

**Problem:** Every task must tick its index entry and commit after verification. T10.0 says every plan tick is already committed before recording the final head, but T10.1-T10.3 are still pending. Following the universal rule after T10.1 creates a new unverified commit; following it after push or PR-body editing also changes HEAD without rerunning the mandated final cycle. This is a protocol contradiction, not a request for stricter verification receipts.

**Evidence:** Plan lines 789-807 freeze HEAD and prohibit later edits without repeating the full cycle. Lines 811-820 then push, watch workflows and edit the PR. The universal completion instruction at lines 61 and 824 still requires edits and commits for those tasks.

**Concrete change:** Explicitly exempt the verification/push/reporting tasks from source-tree task ticks and commits after the freeze. Record their completion using the existing unique logs and PR status/body, or finish all planned checklist edits in T10.0 and keep subsequent operational status outside the tracked tree. Keep the final-SHA rerun rule for actual code changes.

### 14. Low: the bootstrap whitelist will reject this requested review artifact

**Plan/task:** Start check and T0.1, plan lines 49 and 233-234.

**Problem:** The only permitted bootstrap files are the five existing planning files. The requested `review-2.md` becomes a sixth untracked file. With the plan unchanged, T0.1 must stop, and committing only its five listed files cannot leave the required clean tree.

**Evidence:** The whitelist at line 49 and T0.1 scope at line 233 omit `review-2.md`. The initial worktree status contained the five listed untracked files; this review is the only new file written by this review task.

**Concrete change:** Once the review is accepted and the plan is updated, include this review in the approved bootstrap planning-file list, or have the orchestrator commit the complete approved planning set before delegating tasks. Do not delete the review, ignore unrelated dirty paths or relax the start check generally.

## Coverage and verdict checks

All binding feedback IDs have a planned disposition. No additional coverage finding is raised merely because an item predates this PR.

| Feedback | Review of planned disposition |
| --- | --- |
| A1 | Confirmed. Selection override and disabled-list separation addresses the actual inversion; T1.3 uses real bootstrap/config rather than the mocked loader. |
| A2 | Confirmed. Declarative discovery is an appropriate fix, and the real CLI subprocess is the right regression. The runtime-dependent provider/model synchronization must remain outside the extracted discovery path. |
| A3 | Confirmed. Required owner fetch and deletion of ambient fallbacks are appropriate; findings 1 and 4 identify contract/lifetime blockers. |
| A4 | Confirmed. Admission closure, independent retained flights, retained host-handler promises, lock release and store-last cleanup are necessary. The plan correctly distinguishes logical cancellation from physical handler/flight settlement. |
| A5 | Confirmed. Settlement-only joining is appropriate for caller outcomes; finding 5 identifies the missing separation of cleanup outcomes. |
| A6 | The plan's disagreement is justified. `TrustTransitionLifecycle.apply` attaches rejection handling and retains failures (`packages/core/src/services/trust-transition-lifecycle.ts:32-45`), and the workspace lifecycle owns transitions and joins disposal. Characterize this; do not add another tracker solely for the `void` call. |
| A7 | Confirmed. Model fetch injection alone does not transport Google credentials. The chosen real service-account/JWT flow, fixed token URL and owner-backed Gaxios transporter are consistent with the installed library path. Generated credentials avoid committed secrets. |
| B1 | Confirmed. Delete the Config locator and pass owner key operations directly; finding 12 addresses the new UI handle's rollback ownership. |
| B2 | Confirmed. Test-only field injection is not production behavior. Preserve scenarios through real public paths before deleting the unreachable fields/options. Finding 11 addresses inventory executability, not a relaxation of conservation. |
| B3 | Confirmed. Composition is required, but findings 2 and 3 prevent the proposed design from satisfying it as written. |
| B4 | Confirmed. Consumer-specific ports and producer projections are appropriate; neither a renamed flattened bag nor a deprecated alias is acceptable. |
| B5 | Confirmed, including inherited global behavior. Manager-local bridge/outcomes/dialog state and deletion of singleton/global callers address it. |
| B6 | Confirmed. Required named inputs are appropriate only when the resulting types are actually narrow; finding 1 disproves one supplied contract. |
| C1 | The partial verdict is justified: public/protected exposure needs detection; private storage of an owner's resources is not itself prohibited. Keep genuine-private positive controls and detect the real CLI shape without exclusions. |
| C2 | Confirmed. Both mutable and ALS roots must follow agents/settings code. |
| C3 | Confirmed. Types-first package exports can resolve to declarations without mutator bodies. Source resolution plus cross-package/reexport negative controls is appropriate; simply adding a Bun condition is insufficient. |
| C4 | Confirmed. Remove the seven stale entries, preserving the boundary guard. |
| D1 | Confirmed. Remove checkout download/execution, not merely disable it. Finding 9 supplies missing workflow edits needed by the plan's own acceptance. |
| D2 | Confirmed. Explicit disclosure of the local gemma4/nightly/eval change is appropriate; no paid Z.ai substitution is required. |
| E1 | The partial verdict is justified. Preferred subagent definitions are already trust-projected by `McpRuntimeOwner.subagentDefinitions` (`mcpRuntimeAssembly.ts:158-161`). Unify duplication without inventing a missing-filter regression. |
| E2 | Confirmed. Borrowing workspace/skills work must settle before MCP release; preserve the held-operation test and cleanup error ownership. |
| E3 | Confirmed. Delete helpers with only test callers after preserving their reachable rollback/cleanup behaviors. |
| E4 | The partial verdict is justified. The ordinary stream supplies admitted profile metadata; the duck-typed Config fallback/dead caller should be deleted. Finding 6 corrects the proposed characterization. |
| E5 | Confirmed. Child Config uses process cwd, while inherited file ports already use the correct workspace. Observing media/storage effects is more relevant than relying on relative-file reads alone. |
| E6 | Confirmed. The sites have different absence/error contracts, so separate repairs are appropriate. Findings 7 and 8 correct two prescribed failure paths. |
| E7 | Confirmed. Use the actual ProviderFileLifecycle type or the operations consumed; delete object erasure/downcasts. |
| E8 | Confirmed. Delete false disposal flags/docs without replacing them with markers. |
| E9a | Confirmed. Public behavior migration must replace prototype/index capture; finding 11 bounds the preparatory audit. |
| E9b | Confirmed. Move the two named specs to agents and preserve assertions. Other cross-package test imports remain disclosed follow-ups. |
| E9c | The changed fix is justified. Product fd delivery is POSIX/container-based; Windows needs actual host capability-file producer coverage, not a fabricated native fd mechanism. |
| F | Confirmed. The PR body is stale. Final verification, normal push, pushed-head CI/nightly, disclosure and no merge are required. Findings 9 and 13 make that phase executable. |

## Checks performed and limits

This was a plan/code review, not implementation qualification. I read the binding feedback, the plan and both companions, project planning/testing methodology, relevant source and package/workflow definitions, local git references, and GitHub issues #2616/#3841 plus PR #3911. The main/preexisting-code distinction does not waive any binding item.

The only executable analysis beyond read-only inspection was a memory-only TypeScript/service-analyzer probe for finding 1. I did not run the repository test suites, builds, lint, installers, OAuth/network flows or smoke test, and claim no passing implementation gates. No source or existing plan file was edited; no commit, push, workflow dispatch, PR edit or merge was performed. No evidence ledger, PID/SHA receipt scheme or hash manifest is requested. Normal commands, unique logs and exit-code checks remain sufficient.
