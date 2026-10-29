# Verdict: needs rework

## 1. High: retained client-release failures would be reported twice during shutdown

**Plan section/task:** A5 design decision; T3.1.

**Problem:** The proposed ledger records every rejection of `disposeClientAndFiles` in `#releaseFailures`, then returns both the settled results of disposing remaining clients and one rejected result per retained failure. A client still registered when `settleOwnedClients()` starts is disposed by that method itself. Its failure therefore appears in both collections. This recreates duplicate disposal reporting for owner cleanup errors while fixing duplication for request aborts.

**Evidence:** `packages/agents/src/session/session-client-cleanup.ts:99-109` has `settleOwnedClients()` call `this.dispose(client)` for every remaining client. PLAN.md's A5 design explicitly makes that same `dispose(client)` retain its rejection and makes settlement append retained failures. T3.1(f) tests only a temporary client released before shutdown, which does not cover this overlap.

**Concrete change:** Specify one consumption rule for ledger release failures. For example, drain failures from releases completed before settlement separately from failures returned by the current settlement batch, without appending that batch's failures again. Add a test with a registered client whose release fails during `settleOwnedClients()`, asserting the sentinel occurs exactly once, alongside the already-planned previously released temporary-client case.

## 2. High: the child network is built from a proxy value the child never inherits

**Plan section/task:** Phase 2 transport ownership table; T1.7, T2.3b, T2.3d.

**Problem:** The child row says `this.config.getProxy()` is inherited, and T2.3b constructs the child's root network from it. The child Config has no proxy input. T1.7 changes only its two directory inputs, so executing those instructions still constructs a direct child network. Forwarding that fetch in T2.3d cannot restore the parent's proxy.

**Evidence:** `packages/agents/src/api/child-agent-assembly.ts:194-201` constructs Config with session id, directories, debug mode, model and initial settings only. `packages/core/src/config/configBaseCore.ts:391-392` returns the Config's own proxy field; it does not consult the parent or initial settings. The parent `foregroundConfig` is already available to the child assembly.

**Concrete change:** Add `proxy: this.foregroundConfig.getProxy()` to the explicit child Config construction in the scoped transport task, or explicitly acquire the child network from that parent proxy value. Preserve a separate child lifetime. Name this missing propagation step in the task and require the existing planned two-root public child-request test to fail on direct routing and pass through each parent's proxy.

## 3. High: moving MCP dispose does not delay the physical shutdown that admission already starts

**Plan section/task:** E2; T3.6.

**Problem:** T3.6 preserves `closeMcpAdmission` at the beginning of shutdown and moves only `disposeMcpRuntime` behind the workspace/skills facade joins. That admission method already starts connection teardown. The requested guarantee that connections stay usable until accepted borrower work settles cannot follow from moving the later dispose call.

**Evidence:** `foreground-agent-assembly.ts:663-678` invokes `closeMcpAdmission` in the admission stage. The preferred leaf forwards it directly to `McpRuntimeOwner.closeAdmission` (`agentRuntimeAssembly.ts:722-723`); the adopted path does the same when owned (`adopted-agent-assembly.ts:627-631`). `mcpRuntimeAssembly.ts:723-735` starts `cancelDiscovery`, `catalogs.dispose()` and `manager.stop()` from that method. None of these sites is in T3.6's scope. Its proposed real stdio fixture also does not identify which facade operation reaches a server request: workspace profile/subagent reads are definition reads, while skill reload follows policy/filesystem discovery and tool publication (`workspace-skill-assembly.ts:32-91`), not a generic stdio read.

**Concrete change:** Separate admission closure from physical retirement in the MCP owner, with the relevant owner and leaf wiring explicitly in scope. Keep admission closure synchronous, then join accepted borrowers before starting the dependency teardown that those borrowers need. Specify the actual operation and external barrier used by the regression, tracing it through its real implementation. If the underlying owners already join the relevant operation safely, characterize that instead of prescribing a failing test on an unrelated stdio request.

## 4. High: final qualification omits the required frozen S1/S2 behavioral gate

**Plan section/task:** F; T10.1.

**Problem:** The final command list never runs the frozen conformance file. Root workspace tests and `test:scripts` do not select this root-level integration file. After the assembly and admission rewrites, the plan could report final qualification without rerunning the issue's explicit behavioral acceptance gate on the final commit.

**Evidence:** Issue #2616 acceptance criterion 7 requires S1 and S2 per the frozen definitions. The actual entries are `integration-tests/conformance/scenarios.s1-s12.test.ts:45-49,64-70`. Root `package.json` defines `test` as workspace test scripts, while `test:scripts` selects the scripts shard. Neither T10.1's commands nor another final-phase task names this file. The current PR body names a separate explicit invocation for it, which confirms it was not supplied by the root test command.

**Concrete change:** Add `bun test ./integration-tests/conformance/scenarios.s1-s12.test.ts` to T10.1 after the required builds, with the existing timeouts and assertions unchanged. Require S1/S2 to execute and pass, preserve the ten existing out-of-scope skips, and repeat this command with the complete final cycle after any repair. Include its actual result in the rewritten PR body.

## 5. Medium: the required CLI contributions input has no mapped production producer

**Plan section/task:** T5.3; `ports-B6-B3.md:36`.

**Problem:** The contract declares `contributions` required because production callers supposedly already have one. Both production calls omit it, and neither caller's current input exposes it. The task therefore cannot perform the stated mechanical mapping without inventing a registry or expanding upstream wiring. With preflight required, the current contributions parameter only feeds a bootstrap fallback that should no longer be reachable.

**Evidence:** `cliSessionBootstrap.ts:140-151` and `cliSandbox.ts:194-205` stop at positional argument 10, credential authority. `config.ts:105-120` consumes contributions only when constructing a missing preflight; `loadCliConfig` forwards it into that helper at `config.ts:341-349`. The port contract's row instead asserts that positional 11 already exists at production callers.

**Concrete change:** Resolve this before delegating T5.3. Prefer deleting the redundant contributions input and missing-preflight construction path when preflight becomes required. If it has a remaining responsibility, name its existing producer and include the entire upstream parameter path in the task scope. Do not create an empty registry merely to satisfy the required field.

## 6. Medium: T5.4c requires a grep result incompatible with unchanged child runtime use

**Plan section/task:** T5.4c acceptance, PLAN.md:637.

**Problem:** The task requires zero `.runtimeContext` occurrences anywhere in `child-agent-assembly.ts`, although its intended change removes only access through the returned scope. The child still legitimately uses the loaded runtime for identity, model admission, tools and hooks. Obeying the acceptance command would force unrelated edits beyond the bounded change.

**Evidence:** `child-agent-assembly.ts:167-170,393,404-408,424,438` reads `this.loaded.runtimeContext`; the scope-history fallback targeted by this task is the separate `this.scope.runtimeContext.history` at line 468. The companion contract also retains `this.loaded.runtimeContext` in the input mapping.

**Concrete change:** Narrow the absence check to scope access, such as `this.scope.runtimeContext`, and keep the existing loaded-runtime reads. Keep the typecheck and factory-return scanner probe as the checks that the returned scope no longer exposes runtime authority.

## 7. Medium: the Windows capability test would retain a POSIX directory expectation

**Plan section/task:** E9c; T1.12(b).

**Problem:** Removing the Windows skip and separating permission assertions is insufficient. The first selected case also expects capability files under the mocked `os.tmpdir()`, although this fixture supplies `LOCALAPPDATA` and the real Windows producer intentionally uses that directory instead. The resulting failure would be a test-porting error, not the product bug the plan tells the worker to infer from a Windows failure.

**Evidence:** `sandbox-capability.test.ts:80-89` sets `runtimeRoot` to `<temp>/runtime`, overrides `os.tmpdir()` to it, and sets `LOCALAPPDATA` to the different `<temp>/local-app-data` directory. The case to be unskipped asserts `path.dirname(hostDir) === runtimeRoot` at line 108. `sandbox-capability.ts:51-62` correctly selects `<LOCALAPPDATA>/llxprt-code` on Windows. The existing platform-specific test at `sandbox-capability.test.ts:171-182` already documents that expectation.

**Concrete change:** Include the platform-specific expected root in T1.12, while preserving content, mount isolation, cleanup and argument assertions. On native Windows assert the `LOCALAPPDATA/llxprt-code` root, not the POSIX temporary root. Keep permission-bit assertions POSIX-only as planned; do not change production placement to make an incorrect test pass.

## 8. Medium: transport regressions name an unavailable preflight operation and the wrong model-list outcome

**Plan section/task:** A3; T2.3b(c-d), T2.3c(a-c).

**Problem:** T2.3c requires a public preflight model-list request before Config exists, but that public preflight has no model-list operation. T2.3b also requires an aborted OpenAI-compatible model-list call to reject, whereas the real provider catches model-list failures and returns fallback models. Workers cannot implement these tests as specified without bypassing private state, adding an unrelated API, or changing existing provider semantics outside the task.

**Evidence:** `profile-preflight.ts:426-429` exposes only the synchronous `readProviderDefaultModel`, which calls `getDefaultModel`, not a network model list; its manager is private. The available post-config profile/history/image operations have explicit preparation prerequisites (`profile-preflight.ts:351-370,639-645`). `ProviderManager.getAvailableModels` delegates to `resolveAvailableModels`, whose first operation is `provider.getModels()` (`packages/providers/src/modelResolver.ts:29-34`). `openai/OpenAIProvider.ts:334-392` catches all listing errors, including transport aborts, and returns fallback models. Phase 2 does not remove that catch.

**Concrete change:** Name an existing reachable preflight network entry, or use the real manager domain entry with explicitly owned dependencies for pre-config transport coverage. Specify the external request barrier and how the operation is started before transfer. For public model-list cancellation, assert the existing fallback outcome plus socket/transport retirement, or test rejection at the actual owner-fetch boundary separately. Do not require a rejection from an API that deliberately converts it to a result.

## 9. Medium: the scope-test migration replaces receiver observations with assertions on fixture inputs

**Plan section/task:** T5.4c; `ports-B6-B3.md`, returned-contract test migration.

**Problem:** The plan preserves the old runtime/history assertions by pointing them at the runtime bundles supplied to scope creation. Those bundles are constructed and frozen by the fixture. Checking their model, frozen state and distinct histories says nothing about which runtime or history the real scope actually uses. A scope that ignores the supplied runtime or shares another history would still pass the proposed replacement.

**Evidence:** `core/__tests__/subagent.stateless.test.ts:177-199` constructs the frozen input runtime. Its current assertions inspect the scope's retained runtime at lines 446-451,479-485,537-547,588-598,641-646 and 686-693. The companion contract explicitly replaces those reads with assertions on the input bundles. That removes the receiver-use check rather than preserving it.

**Concrete change:** Replace the internal-field assertions with behavior through `ChildAgentScope` execution: capture the model/context used at a real content-generation boundary and the writes observed by each supplied history, including a second live scope. Assert input immutability separately if useful, but do not count assertions on fixture-created objects as conservation of runtime-use or history-isolation coverage. Name those replacement tests before delegating the signature migration.


## Coverage and overall assessment

**Counts: 4 high, 5 medium, 0 low findings.** Fix findings 1-4 before treating the plan as ready for execution. Findings 5-9 need explicit task/contract corrections so workers can follow the instructions without inventing APIs, changing behavior outside scope, or weakening tests.

All feedback items have a named disposition: A1-A7; B1-B6; C1-C4; D1-D2; E1-E8 and the three test concerns grouped as E9a-E9c; and F. The problems above concern fix completeness and executability rather than an entirely unmapped feedback item. A1's selection/disabled separation and A2's runtime-free skills path address the reported CLI regressions. The transport and join designs need the corrections above. A4's retained authentication flights/handlers, owner signal propagation and lock-acquisition `finally` correction address the identified lifetime gaps; A7's credential transporter design matches the installed Google auth/Gaxios delegation. B1's explicit key-handle transfer and rollback responsibilities, B2's per-scenario conservation, B3's persistent controls and module-level publication, B4's consumer projections and alias deletion, and B5's per-manager UI state address the respective architectural findings in principle. B6 has the concrete mapping and test problems called out above.

The disputed verdicts are mostly supported by code. A6 already reaches tracked trust transitions: `TrustTransitionLifecycle.apply` attaches a rejection handler and retains failures, and `WorkspaceTrustLifecycle.dispose` joins settlement. Characterization is appropriate. E1's preferred path already gets trust-filtered subagent reads from the MCP owner, although duplicated construction remains. E4's bad Config fallback exists, but the live stream supplies admitted profile metadata, making deletion and characterization appropriate. The E5 directory change targets the child Config's actual directory-dependent resources. E9c correctly distinguishes the POSIX fd reader from native Windows env-file production, subject to finding 7. C1's distinction between private owner resources and exposed/protected bundles is reasonable; the planned class/protected/CliUiRuntime controls must remain detection tests without new exclusions.

C2 follows the moved directories, C3 specifies source-aware cross-package resolution with export-order controls, and C4 deletes the stale entries. D1 removes the installer and restores explicit CI dependency installation; D2 is expressly disclosed in the final PR rewrite. The remaining E items have tasks for cleanup ordering, dead helpers, error causes, lifecycle typing, stale flags and test relocation/conservation. No additional material omission was established for those tasks.

The ordering generally protects behavioral fixes before signature and composition changes. Inventory-driven slicing, explicit paths, closed stdin, unique logs, exit-code checks, handoffs and clean green commits are suitable safeguards for the intended workers. The final freeze, full rerun after repairs, SSH fast-forward push, checks/nightly on the pushed commit, PR rewrite and no-merge boundary are specified. Finding 4 supplies the missing conformance command in that final cycle.

## Review scope

Reviewed `feedback.txt`, the main plan and both companion files against the worktree at `3984a8773ee78c4614d1922da8cb917f6bdb1834`, local `origin/main` at `85fdd73b1d09671b5ce11bbfce72080a662d5ac4`, issue/PR context, package scripts, relevant production callers and installed library code. This was a static plan review; no test suite, build, smoke test, CI run or Windows execution was performed. Existing probe results in the plan are not claimed as independently rerun. Only this new review file was written; source and plan files were not edited.
