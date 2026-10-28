# Verdict: needs rework

**Findings: 1 high, 2 medium, 0 low.** The plan covers the binding feedback, and its composition, narrow-port, per-owner OAuth, scanner and final-verification directions are consistent with the requested outcome. Correct the external-account exchange specification and the two execution/test gaps below before sending these tasks to coding agents.

Reviewed `PLAN.md`, `ports-B6-B3.md` and `inventory-phase7.md` against `tmp/feedback.txt`, the issue/PR context, the worktree at `3984a8773ee78c4614d1922da8cb917f6bdb1834`, `origin/main` at `85fdd73b1d09671b5ce11bbfce72080a662d5ac4`, and the installed Google dependencies. This was a plan/code inspection, not an implementation or a full test run. Only this review file was changed.

## 1. Medium: T2.7a requires a quota header that its specified integration cannot emit

**Plan:** `PLAN.md:207,210,531-534`, A7 / T2.7a(c).

The credential selector applies `quotaProject` to the auth client and the test requires `x-goog-user-project: quota-a` on the model request. Passing that client only as `googleAuthOptions.authClient` cannot produce this header. The installed Vertex adapter calls `client.getAccessToken()` and keeps only `token`; it never calls `getRequestHeaders()`. Its request headers are the bearer token plus `options.headers`. The plan changes neither header construction nor the model fetch to carry the selected client's quota project. A coder following the design will pass token routing and still fail the required quota assertion.

**Evidence:** `plugins/google-gemini/node_modules/@ai-sdk/google-vertex/src/google-vertex-auth-google-auth-library.ts:9-12`; `plugins/google-gemini/node_modules/@ai-sdk/google-vertex/src/google-vertex-provider.ts:43-48`; `plugins/google-gemini/src/gemini/geminiApiClientFactory.ts:72-80` forwards only the existing HTTP headers.

**Concrete change:** Specify the factory's owner-local header projection, including where the selected client's quota project enters Vertex `headers` and how explicit HTTP headers are merged. Keep T2.7a(c)'s assertion and add the factory change to the task's steps. Do not assume the SDK forwards auth-client request headers.

## 2. High: the replacement external-account exchange uses the wrong workforce options field

**Plan:** `PLAN.md:209,546-552`, A7 / T2.7c.

The proposed RFC 8693 request sends `options` containing `workforce_pool_user_project`. That is the credential-file field, not the exchange option sent by the installed library. The existing implementation translates it to `options={"userProject":"..."}` when client authentication is absent. Replacing the exchange as specified changes workforce identity authentication, while none of T2.7c's required fixtures includes a workforce user project or checks this translation.

**Evidence:** `plugins/google-gemini/node_modules/google-auth-library/build/src/auth/baseexternalclient.js:347-356` constructs `{ userProject: this.workforcePoolUserProject }`; `.../auth/stscredentials.js:63-81` JSON-encodes that object into the form's `options` field.

**Concrete change:** Require the outgoing `options` JSON to use `userProject`, sourced from `json.workforce_pool_user_project`. Add a two-owner workforce fixture asserting the actual form body and a client-authentication control asserting that `options` is omitted when Basic client authentication applies. Keep both tests in T2.7c's real factory path.

## 3. Medium: T2.3d(b)'s required red does not establish network borrowing and can depend on the later A5 fix

**Plan:** `PLAN.md:490-495`, T2.3d(b), with A5 deferred to T3.1.

The required test assumes that an extra, private dispatcher is observable as a second proxy connection during a single held session request. An idle root dispatcher creates no connection. Conversely, multiple connections do not establish multiple dispatchers. The stated observation therefore cannot establish the proposed ownership change. If the coder uses the public `agent.generate` path shown in the surrounding transport tasks, the requirement that disposal fulfills also depends on A5: its accepted generation is tracked by `AuxiliaryWork`, whose close rethrows the abort. Replacing the session's network with a borrowed fetch does not remove that reporting. T2.3d is required to commit green before T3.1 changes it.

**Evidence:** `packages/core/src/utils/fetch.ts:104-118` constructs a dispatcher and only dispatches from `fetch`; `packages/agents/src/api/foreground-agent-assembly.ts:551-565` delegates `generate` to `generateText`; `packages/agents/src/session/session-text-generation.ts:142-155` tracks that call in the acquisition owner's auxiliary lifetime; `packages/agents/src/core/auxiliary-work.ts:31-44` aggregates the resulting abort. The plan itself reserves that behavior change for `PLAN.md:557-565`.

**Concrete change:** Replace the second-connection claim with a specified behavioral lifetime test that distinguishes ownership without inferring dispatcher identity from socket counts. State the public entry explicitly. Keep held-request cancellation as characterization where it already works, and do not require abort-free disposal for standalone generation before T3.1. If that exact disposal assertion is retained, move its acceptance to T3.1 and let T2.3d preserve the existing caller/cleanup result until then. T2.3d(a) can remain its failing-first transport regression.

## Coverage and remaining assessment

No feedback item is omitted from the task map. The findings above concern the correctness and sequencing of specified fixes, rather than missing feedback coverage.

| Feedback | Planned disposition checked |
| --- | --- |
| A1, A2 | T1.3 extension-selection precedence and T1.4 runtime-free skills discovery, using real bootstrap/subcommand paths. |
| A3, A7 | Phase 2 owner networks, all invocation producers, required-fetch transition and Vertex credential transport. Findings 1-3 apply here. |
| A4, A5 | T3.1-T3.5 separate caller outcomes from cleanup failures, retain underlying auth/handler work, address the acquired-lock abort window and close the token store last. |
| A6 | T1.5 characterization is justified: the existing trust transition lifecycle handles rejection and retains failures for disposal; the release scope unsubscribes the parent before disposing trust. A second tracker is unnecessary. |
| B1-B6 | Config credential locator deletion, production-entry fixture migration, inheritance removal by composition, consumer projections, per-manager OAuth UI state, and named required input records are assigned across phases 4-8. The companion contracts and inventory account for inherited responsibilities and preflight transfer. |
| C1-C4 | T9.1-T9.3 add workspace source resolution, relocated scan roots and public/protected class controls; T1.2 removes stale CLI allowlist entries. Keeping genuinely private owner storage distinct from an exposed bundle is consistent with object-owned composition. Production findings become fixes, not exclusions. |
| D1, D2 | T1.1 deletes the installer and replaces CI downloads with pinned Bun setup and explicit plugin installs. T10.3 discloses the local-model nightly/eval change. |
| E: duplicated facades; MCP shutdown | T7.3 shares construction, with trust parity characterization; the existing preferred path already filters definitions. T3.6 separates admission from physical connection retirement and joins refresh/reload/borrowers first. |
| E: dead helpers; model metadata; child cwd | T1.13/T6.D2 delete unused construction paths; T1.6 deletes the dead Config fallback while preserving admitted profile metadata; T1.7 observes the child Config's media/storage root rather than an already-correct inherited file port. |
| E: swallowed errors; file lifecycle typing; stale flags | T1.8-T1.9d, T5.7 and T1.10 address the respective contracts without a catch-all replacement or compatibility alias. |
| E: prototype/positional test capture; misplaced tests; Windows capability coverage | Phase 6 conserves scenarios while moving to production entries; T1.11 relocates the two named tests; T1.12 tests native capability-file delivery on Windows and retains the product-based POSIX fd distinction. |
| F | T10.0 freezes tracked changes before full verification. T10.1 includes root checks, separate plugin checks, conformance and lunahigh smoke. T10.2 requires the pushed head's CI/nightly and executed native Windows cases. T10.3 rewrites the stale PR claims. Any code fix restarts the final cycle. No merge is authorized. |

The start/handoff protocol names the absolute worktree, rejects unrelated dirty paths, forbids destructive Git cleanup and limits each agent's edit scope. Inventory-generated tasks have bounded file/scenario budgets and explicit acceptance rules. The package verification commands named in the plan exist. Apart from finding 3's local dependency problem, no additional ordering defect was confirmed. The plan's final-head verification and no-merge requirements need no additional receipts, manifests or evidence machinery.
