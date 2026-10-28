# Message bus and policy ownership

Tool authorization combines workspace policy, session rules and a confirmation
bus. Agent composition supplies these operations to schedulers, tools and host
adapters. `Config` carries policy inputs, not live services that consumers can
look up.

## Owners and package boundaries

`PolicyEngine` in `packages/policy/src/policy-engine.ts` evaluates tool requests
against ordered rules. Rule decisions are `ALLOW`, `DENY` or `ASK_USER`. The policy
package also owns message contracts, TOML parsing, stable argument serialization
and approval-mode migration.

`WorkspacePolicyOwner` in `packages/core/src/policy/policy-owner.ts` owns the
workspace engine and trust subscription. It exposes policy inspection and reload
operations. Trust changes update the workspace's trusted-MCP rules. The owner
closes admissions and removes its subscription during disposal.

`SessionPolicyOwner` owns the session rules and confirmation lifecycle. Its
`decisions` port evaluates through workspace policy with the current session
approval mode and session rules. Its `confirmation` port adds and removes
session rules. The session owner constructs a `MessageBus` from decision
operations, or adopts an explicitly supplied bus. It also owns policy-update
subscriptions and pending persistence work.

`RuntimePolicyOwner` composes workspace and session policy for callers that need
the combined lifecycle. Composition passes the relevant operations onward;
ordinary consumers do not receive this owner as a service locator.

The concrete `MessageBus` is in
`packages/core/src/confirmation-bus/message-bus.ts`. Tool consumers use contracts
from tools and policy rather than acquiring a core configuration object. The
tool registry lives in `packages/tools/src/tools/tool-registry.ts`; the production
scheduler lives under `packages/agents/src/core/`.

## Authorization flow

A scheduler submits the tool request and arguments to the supplied policy and
confirmation operations. An allow decision permits execution. A deny decision
rejects it. An ask decision publishes a confirmation request with a correlation
identifier and waits for the matching response.

The host adapter presents the request and responds through its supplied
confirmation port. CLI presentation uses the interactive agent and injected
operations. It does not obtain a bus or engine from configuration. A request
response must preserve the correlation identifier so it cannot authorize a
different pending invocation.

The bus releases pending subscriptions when the response arrives, the request
is cancelled or its confirmation deadline expires. An unanswered confirmation
must not authorize execution. Session shutdown closes admissions and cancels
pending confirmations before releasing the remaining resources.

## Policy data

The CLI loads policy configuration while building configuration data. Workspace
policy construction receives that data explicitly. Approval modes and
allowed/excluded-tool settings are converted into rules by the policy migration
functions. Message bus integration is always enabled; there is no feature flag
that bypasses policy evaluation.

Policy rules are evaluated in priority order. TOML validation constrains priority
bands and rejects malformed patterns. Stable argument serialization prevents
object key order from changing argument-pattern matching. MCP tool names and
server identity are validated together before authorization.

A user's persistent allow decision is handled by the session policy-update
subscription. The owner persists the policy change and tracks the pending write.
Shutdown waits for that work and exposes persistence failures rather than
silently losing the change.

## Consumer construction

Constructors require the specific operations used by a consumer. A component
that requests confirmation needs confirmation operations, not a policy engine.
A policy inspector needs rule reads, not mutation authority. A component that
needs neither should not retain the bus merely because another part of the
application uses it.

Tools, schedulers and UI adapters must not use configuration getters to recover
these services. The composition site supplies the port and owns its lifetime.
Borrowed policy engines or buses remain subject to their declared ownership;
adoption does not grant permission to dispose another owner's resources.

## Verification

Behavior tests cover allow, deny and ask decisions, correlated responses,
cancellation, trust transitions, runtime rule changes and disposal. Integration
tests exercise actual tool execution through the policy path. The production
runtime-boundary analysis separately rejects configuration service locators and
whole-runtime service bags.

## Related documentation

- [Runtime ownership](runtime-ownership.md)
- [Tool permissions](../../docs/tool-permissions.md)
- [Policy configuration](../../docs/policy-configuration.md)
- [Approval-mode migration](../../docs/migration/approval-mode-to-policies.md)
