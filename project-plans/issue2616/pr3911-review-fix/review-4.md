# Verdict: needs rework

**Findings: 1 high, 2 medium, 0 low.**

The plan covers every feedback item and makes the construction and test migrations substantially more explicit than the current implementation. Three changes are needed before execution: complete the Vertex credential transport design, settle the execution-error reporting contract, and retain the existing native Windows hook acceptance check in final delivery.

Reviewed against worktree HEAD `3984a8773ee78c4614d1922da8cb917f6bdb1834` and `origin/main` at `85fdd73b1d09671b5ce11bbfce72080a662d5ac4`. Paths below are relative to this worktree. Only this review file was edited; no source or plan files were changed.

## 1. High: A7's transporter fix leaves default credential discovery and metadata token acquisition on global transport

**Plan section/task:** A7 design decision; T2.7, PLAN.md:504-511.

`googleAuthOptions.clientOptions.transporter` reaches the JWT credential client used by the proposed service-account fixture, but does not control all credential acquisition performed by the installed GoogleAuth. With neither explicit credentials nor an ADC file, `getApplicationDefaultAsync` calls `_checkIsGCE()`, which calls `gcpMetadata.isAvailable()` directly. The resulting Compute credential client also obtains tokens through `gcpMetadata.instance()`, outside its configured transporter. The service-account fixture bypasses both branches, so it can pass while supported default credentials still bypass the owner's transport and cancellation.

**Evidence:**

- `plugins/google-gemini/src/gemini/geminiApiClientFactory.ts:67-82` preserves the default-credentials path alongside explicit credential options.
- `plugins/google-gemini/node_modules/google-auth-library/build/src/auth/googleauth.js:244-284,302-307` performs metadata discovery outside `clientOptions.transporter`.
- `plugins/google-gemini/node_modules/google-auth-library/build/src/auth/computeclient.js:44-57` obtains a token through `gcpMetadata.instance(instanceOptions)`.
- `plugins/google-gemini/node_modules/@ai-sdk/google-vertex/src/google-vertex-auth-google-auth-library.ts:11-14` invokes `auth.getClient()` before requesting a token.
- A bounded probe using the installed real GoogleAuth, an empty temporary HOME, a loopback metadata responder, and a supplied Gaxios transporter that throws if invoked returned:

  ```text
  DIRECT /computeMetadata/v1/instance
  DIRECT /computeMetadata/v1/instance/service-accounts/default/token
  {"client":"Compute","token":"fixture-token","direct":2,"owner":0}
  ```

  The child exited 0. Both requests bypassed the proposed owner transporter. Environment overrides were confined to that probe child.

**Concrete change:** Specify owner-bound discovery and metadata token acquisition as well as the JWT token transporter, preserving supported ADC behavior without changing global GoogleAuth/gcp-metadata defaults. Add a real no-file/default-credential regression with two owner transports and held discovery/token cancellation. Keep the proposed service-account exchange regression too. Identify the actual library injection or credential-construction point before handing the task to a coder; split discovery and exchange into separate tasks if needed. A passing JWT-only test cannot close A7.

## 2. Medium: T1.9c delegates its required error sink to a channel that does not exist

**Plan section/task:** T1.9c, E6 execution-owner errors; PLAN.md:345-353.

The proposed error union preserves the cause internally, but the task then requires the run lifecycle to record it in its existing failure channel while forbidding a public error-type change. There is no such channel in `ForegroundRunLifecycle`. Its only initialization-failure report is the yielded error event. The plan explicitly tells the coder to stop if no sink exists, so this is an unresolved design choice already visible in the cited source.

**Evidence:** `packages/agents/src/api/foregroundRunLifecycle.ts:38-52,104-109` has no failure reporter or reporting dependency and reports `init.error` only through the event. `packages/core/src/core/turn.ts:115-120` defines `StructuredError` without a cause. The current message-only catch is `packages/agents/src/session/session-execution-owner.ts:218-236`.

**Concrete change:** Choose and name the error contract before execution. Specify a narrow owner-supplied failure-reporting operation, its producer and a real observation, or explicitly change the event contract and enumerate its consumers. If preserving the cause at the domain result is sufficient for E6, state that limit and remove the nonexistent sink requirement. Add the corresponding regression and exact file scope rather than leaving the decision to the coder.

## 3. Medium: final nightly acceptance omits the outstanding native Windows physical-hook proof

**Plan section/task:** T10.2, PLAN.md:908-918; F and issue #3841 platform acceptance.

T10.2 requires executed credential-delivery cases and both plugin groups, but does not require the physical hook cases whose native Windows execution remains an explicit outstanding acceptance condition in PR #3911. Overall workflow success does not establish that these particular cases executed. The plan recognizes this distinction for the new cases but drops it for the existing hook requirement.

**Evidence:**

- The PR's current body explicitly requires eight physical native cases across four suites on the final pushed SHA, and states that a green job alone is insufficient.
- Issue #3841 section 4 identifies physical lifecycle-hook subprocess coverage on Windows as a gap.
- The real native-shell fixture is `packages/core/src/hooks/__tests__/physical-hook-command.ts:12-16`; it selects PowerShell invocation rather than Bash on Windows.
- The relevant production-path suites are `packages/core/src/hooks/hook-runner-lifetime.test.ts`, `hooks/hook-system-lifetime.test.ts`, `hooks/session-hook-owner.test.ts`, and `core/lifecycleHookTriggers.test.ts`. Their native-shell groups and physical cases are present and are not platform-skipped.
- T10.2's explicit log acceptance list checks T1.12 and plugin installation/testing only. It does not require these four core suites or the eight physical cases.

**Concrete change:** Add the existing eight physical case names and four suite paths to T10.2's native Windows acceptance list. Require their executed/pass results from the final pushed head's Windows core job, using the normal job log or published Actions summary. Preserve the existing assertions and timeouts; no workflow weakening or new receipt/manifest mechanism is needed. Include that result in T10.3 instead of silently dropping the outstanding platform condition.

## Coverage and design assessment

Every binding feedback item has a planned disposition:

| Feedback | Assessment |
| --- | --- |
| A1-A2 | Covered by T1.3-T1.4 through real bootstrap/subcommand paths. The extension override inversion and missing skills authority are confirmed. |
| A3 | Covered by phase 2: root transport ownership, invocation producers, child propagation, compression, required fetch types and removal of ambient fallbacks. The inventory and caller batches account for the signature cutover. |
| A4-A5 | Covered by phase 3, including orphaned auth flights, physically outstanding handlers, lock-release ordering, caller-owned outcomes and separately retained cleanup failures. |
| A6 | The plan's disputed verdict is supported: `TrustTransitionLifecycle.apply` observes its returned rejection, retains transition failures, and `WorkspaceTrustLifecycle.dispose` joins settlement. Characterization rather than a redundant tracker is appropriate. |
| A7 | Incomplete design, finding 1. |
| B1 | Explicit credential operations and deletion of the new Config locator are covered, including CLI key-handle transfer and rollback. |
| B2 | Inventory, scenario-level conservation, migration batches, production-failure tasks and deletion of unreachable fields/options are covered. |
| B3 | Composition, module-level facade publication, inherited-member inventory and assembly-reachability checks are specified. The nested preflight subclass is accounted for before its inherited fields move. |
| B4 | Consumer narrowing, producer projections and deletion of the wide UI types/alias are covered. The cited runtime-context consumers are explicitly scoped. |
| B5 | Per-manager dialog/outcome state and deletion of singleton/global callers are covered across providers and CLI. |
| B6 | Named contracts and required dependencies are specified, with separate callable-return narrowing and caller-preparation tasks. |
| C1-C4 | Covered by class/protected-surface detection, moved roots, source-aware cross-package mutator resolution and removal of stale boundary entries. Keeping genuinely private owner storage is consistent with the ownership target; it does not excuse protected or public carriers. |
| D1-D2 | Installer removal and explicit CI plugin installation are covered; the local-model workflow change is disclosed in the final PR rewrite. |
| E facade duplication; MCP disposal | Covered by T7.3 and T3.6, including separation of admission closure from physical retirement. |
| E dead helpers; model-info fallback; child cwd | Covered by T1.13/T6.D2, T1.6 and T1.7. The model-info fallback is dead on the live admitted-profile path; deleting it while preserving snapshot behavior is appropriate. |
| E swallowed errors | Each listed family has a task. T1.9c still needs the decision in finding 2. |
| E provider-file typing; stale flags | Covered by T5.7 and T1.10. |
| E test-capture migration; moved specs; Windows credentials | Covered by phase 6, T1.11 and T1.12. Testing the actual Windows env-file producer rather than inventing native Windows fd delivery is appropriate. |
| F | Final-head freeze, full local verification, fast-forward push, pushed-head CI/nightly, PR rewrite and no merge are covered. Restore the existing platform acceptance in finding 3. |

The worktree/start/handoff protocol, explicit paths, no-stash/reset rules, unique logs and exit-code checks address the stated weak-agent failure modes. Root verification scripts named by the plan exist in package.json. The non-workspace Google plugin is explicitly included in later phase gates and final verification. Inventory-generated tasks have bounded file lists and conservation rules rather than permitting arbitrary test deletion.

The major refactors depend on those inventories being completed before their implementation tasks start. Their prescribed scope checks and handoffs are appropriate; they do not resolve the known missing error contract or the incomplete A7 library design identified above.

This was a plan and source/dependency review, with the focused GoogleAuth probe described above. No full build or repository test-suite result is claimed.
