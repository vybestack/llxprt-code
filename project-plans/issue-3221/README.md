# Issue #3221 — Interface-neutral Agent control surface: A2A adapter conversion, CLI dep removal, host-boundary enforcement

Part of #2619. Focused completion slice for the thin-interface objective in #1595.

## Problem being solved

Hosts (CLI, A2A, future UIs/SDKs) must perform normal operations (chat, tool
approval, config changes, lifecycle) by submitting typed intent to the public
Agent API and consuming its events — never by constructing Config, wiring
provider/scheduler/MCP factories, or reaching into runtime internals. Today the
A2A server hand-assembles the entire runtime per task and the CLI still carries
provider-SDK dependencies it does not use.

## Accepted behavior (shaped acceptance criteria)

### AC-A — Inventory (issue scope 1)
`project-plans/issue-3221/inventory.md` classifies every production CLI and A2A
reach-through site as presentation-only / typed host input / public Agent
operation needed / obsolete internal reach-through, including provider-SDK
dependency findings.

### AC-B — A2A becomes an adapter (issue scope 5)
- B1: A2A production code no longer constructs runtime objects: no `new Config`,
  no `new MessageBus`, no `createAgentRuntimeState`, no `createAgentClient`,
  no `getOrCreateScheduler` reach-through, no `config.initialize`/`config.refreshAuth`
  orchestration, no deep subpath imports from
  `@vybestack/llxprt-code-core/*`/`-agents/*`/`-mcp/*` implementation paths.
  Agent creation goes through public `createAgent(AgentConfig)` built from
  declarative env/settings/extensions input (interface input parsing stays in A2A).
- B2: Turns consume `agent.stream()` public AgentEvents; tool confirmations use
  `agent.tools.onConfirmationRequest` / `respondToConfirmation`; session bus
  comes from `agent.getMessageBus()`; model/tier/MCP status come from Agent
  accessors/controls. HTTP transport, request scoping, task persistence, and
  a2a protocol mapping stay in A2A.
- B3: Protocol-observable behavior is preserved and pinned by Bun tests driving
  the Agent boundary (not mocked Config call sequences): task lifecycle states
  (working / input-required / completed / failed / canceled), buffered
  publication with Retry clearing, auto-approval under autoExecute/YOLO,
  cancellation + socket-close abort, refusal notice, metadata model/tier,
  MCP server metadata.

### AC-C — Declarative surface additions only where a real host needs them (scope 3)
AgentConfig gains only fields real hosts require (e.g. activation auth-method
coverage if the a2a env-auth matrix cannot be expressed today). No Config,
SettingsService, ProviderManager, OAuthManager, credentials, registry IDs,
service bags, or concrete factories enter public contracts. Profile/provider
transactional semantics stay with #2635/#2643; the trusted plugin seam (#2758)
is untouched.

### AC-D — CLI provider-SDK dependency removal (scope 4, CLI slice)
`packages/cli/package.json` no longer declares `@anthropic-ai/sdk` or `openai`
(verified: zero imports anywhere in CLI source/bundle config). Lockfile
regenerated. The remaining CLI runtime-assembly removal (configBuilder Config
construction + factory registration) is owned by sibling #3222 and is
deliberately not taken here (see Coordination).

### AC-E — Non-CLI host replaceability fixture (scope 5)
A Bun test fixture in `packages/agents` (no CLI imports) that starts an Agent
via `createAgent`, performs a representative configuration change, runs a
chat/tool flow through `stream()`, observes typed events, and disposes it.

### AC-F — Fail-closed host boundary enforcement (scope 6, coordinated with #2618)
The existing `scripts/check-cli-import-boundary.ts` checker family (not a new
parser) is generalized to also scan `packages/a2a-server/src` production code:
deep-import bans and construction-pattern bans (the exact symbols A2A must no
longer use after AC-B). Wildcard TypeScript path aliases in a2a-server are
removed for migrated packages when resolution no longer needs them. The
generalized #2618 manifest machinery (export maps, full tsconfig bypass
removal, cycle enforcement) stays with #2618.

### AC-G — Verification
Full verification cycle passes: `npm run test`, `lint`, `typecheck`, `format`,
`build`, and the StepFun smoke profile `stepfun-37`. No CLI visual/UI code
changes are in scope, so the tmux harness is not required (revisit only if UI
code changes).

## Boundary cases

- A2A auth matrix: USE_CCPA / GEMINI_API_KEY / vertex creds / explicit gemini
  provider / unconfigured — each must reach the same refresh outcome through
  declarative activation, or a typed field is added (AC-C).
- YOLO mode: A2A sets ApprovalMode.YOLO from env; `createAgent` harness
  defaults differ (confirmation forcing) — A2A must pass harness flags that
  preserve current behavior.
- Cancellation: a2a socket-close → abort → tool cancellation → input-required
  must survive the conversion to stream()/confirmation APIs.
- All-tools-cancelled path (no LLM re-feed) must not regress.
- Task reconstruction (hydration) must rebuild a usable Agent without redoing
  interactive auth.

## Coordination (explicit non-goals here)

- #3222 owns: deleting provider-held `registerAgentRuntimeFactories` /
  `attachAgentRuntimeFactories`, CLI configBuilder factory-binding removal, and
  the CLI Config-construction teardown. Taking it here would break subagent /
  isolated-runtime creation before #3222 fixes providers' isolated path.
- #2618 owns: core export-map trimming, generalized package API manifests,
  package-cycle enforcement, and full wildcard-alias removal. This PR only
  extends the existing checker to a2a and drops a2a aliases it no longer needs.
- #2615 owns Config decomposition; #2616 ambient runtime removal; #2320 exact
  MessageBus propagation; #2635/#2643 profile/provider transactions.
- CLI RuntimeContext providers/runtime bridge and the P2 gap list (model list,
  diagnostics, quota/usage surfaces) are classified in the inventory and left
  to the owning siblings/follow-ups.

## Test plan (behavior-first)

1. Before conversion: keep/pin a2a behavior with tests driving the executor +
   Task public surface under `LLXPRT_FAKE_RESPONSES` (FakeProvider) — task
   states, buffered publication, Retry clearing, auto-approve, cancel, refusal,
   metadata, MCP metadata.
2. Convert a2a onto Agent API; migrate the factory-migration tests to the
   createAgent boundary; delete tests that pinned hand-assembly wiring if their
   behavior is covered by the new boundary tests.
3. Add the non-CLI host fixture (AC-E).
4. Checker: extend synthetic-fixture tests for the a2a rules (fail-closed both
   directions: violations rejected, legitimate public usage allowed).
5. Full verification cycle + smoke.

## Review gates

- deepthinker compliance review (issue intent + verification cycle), max 2
  rounds.
- OCR final review (`zai` profile), max 2 rounds.
- Every finding classified Blocker-Fix / In-scope-Fix / Reject / Defer.
