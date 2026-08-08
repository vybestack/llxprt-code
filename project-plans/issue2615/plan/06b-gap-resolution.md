# P06b — Gap Resolution (inserted after P06)

Plan ID: PLAN-20260808-ISSUE2615.P06b

## Why this phase exists

P06 built `RuntimeDependencies` and the adapter, and migrated exactly one root
of twenty. That is not a failure of the record — the record works, proven by
`mcp-client-manager` dropping its `Config` import entirely. It is a discovery
about **order**.

The plan assumed migrating roots first would free the leaves. The opposite is
true: a root cannot drop `Config` while it still passes `Config` into a
downstream function that demands one. Migration must run **bottom-up**, leaves
first, roots last.

P07-P10 are re-specified accordingly. Before they can run, three gaps that P06
surfaced must be closed.

## Gap 1 — setters

`RuntimeDependencies` is read-only. Several roots use only setters:
`postConfigRuntime.ts` (setProviderManager, setRuntimeMessageBus,
setRuntimeOAuthManager, setImageBackendResolver, setRunImageOperation),
`providerSwitch.ts` (setBucketFailoverHandler), `runtimeContextFactory.ts`
(setProfileManager, setSubagentManager, setToolSchedulerFactory,
setAgentClientFactory).

Resolution: add `RuntimeMutations` in core — a separate, explicitly-named
interface carrying only the setters that cross-package code performs, and a
`runtimeMutationsFromConfig(config)` adapter. Keep it separate from
`RuntimeDependencies` so a reader can see at a glance which call sites mutate
runtime state. Do not merge the two.

## Gap 2 — lifecycle

`dispose`, `initialize`, `ensureInitialized`, `disposeScheduler`,
`shutdownLspService` are used by roots, are not role members, and are not
service locators. They are the `unassigned` members from P01.

Resolution: add an eleventh role, `RuntimeLifecycle`, containing exactly these.
This exceeds the "ten roles" budget in REQ-002 by one; update REQ-002 to eleven
and update the budget test. Lifecycle is a genuine concern, not a dumping
ground — anything that is not start/stop/dispose does not go in it.

## Gap 3 — `instanceof Config`

`agents/src/tools/task.ts` and `agents/src/api/runtimeFactories.ts` use
`instanceof Config` as a runtime type check, which needs the concrete class.

Resolution: replace with a structural predicate exported from core,
`isRuntimeDependencies(value): value is RuntimeDependencies`, or a branded
marker if the check is genuinely about identity. Do not keep `instanceof` and do
not add these two files to an exemption list.

## Acceptance

- `RuntimeMutations` + adapter exist in core, exported via `./config/roles.js`
- `RuntimeLifecycle` role exists; REQ-002 and the budget test say eleven
- Neither of the two `instanceof Config` sites remains
- Full verification green
