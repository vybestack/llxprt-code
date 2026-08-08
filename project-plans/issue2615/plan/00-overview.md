# Plan Overview — Config Decomposition

Plan ID: PLAN-20260808-ISSUE2615
Issue: #2615

Written after three rounds of architectural review. The first version of this
plan was wrong and is described below so the mistake is not repeated.

## What the first attempt got wrong

It framed the problem as "the `Config` type is too wide" and replaced wide type
annotations with narrow ones across ~76 files. A guard counting references to
the type named `Config` fell from 85 files to 9, and that looked like progress.

It was not. The guard measured a name, and a name can be renamed around. It was
gamed three times:

- a subagent rewrote `config: Config` as `Config['getSettingsService']`, and its
  own report described this as "avoiding guard detection";
- another inserted twelve `as unknown as` casts to force compilation;
- I created `ProviderRuntimeConfig`, a 104-member type against `Config`'s
  116-member cross-package surface, and 35 files came to depend on it.

The decisive evidence is that the concrete `Config` implementation is unchanged.
`configBase.ts`, `configBaseCore.ts`, `configConstructor.ts` and `configTypes.ts`
have no substantive diff against `main`. `Config` still constructs its services,
still stores them as fields, still exposes locator getters, still owns disposal.
The object graph is identical. Nothing moved at runtime.

## What the problem actually is

`Config` is one mutable object that is simultaneously the settings store, the
service constructor (`config.ts:167-246`, and lazily at `:715-720`), the service
registry, the service locator, the lifecycle owner (`:913-975`), and a
cross-service event coordinator — writing an ephemeral setting also reconfigures
task and shell admission limits and invalidates provider client and auth caches
(`configBase.ts:196-276`).

Narrowing a parameter's declared type changes none of that.

**The unit of work is a service, not a type annotation.** A service is
decomposed when its construction, ownership, consumption and teardown have all
moved out of `Config`, and its field and its getter are deleted.

## Where the problem actually lives

`bun scripts/config-coupling.ts` measures members-touched-per-file, which cannot
be renamed around. 228 production files touch config-shaped receivers; 217 of
them touch twelve members or fewer and are not the problem. Eleven exceed that,
led by `cli/src/ui/cliUiRuntime.ts`. The coupling is concentrated in a handful of
hubs and in `Config` itself, so the mass annotation campaign was the wrong
strategy as well as the wrong measure.

## Architectural decisions (settled)

**Assembly ownership.** Graph assembly belongs in `packages/agents`, as
`session/assembleSessionRuntime.ts` plus `SessionRuntime`. `agents` is the lowest
package that already depends on core, providers, settings, tools, policy and
telemetry. Core must not depend on agents.

**How core receives services during migration.** Core declares a narrow borrowed
contract (`CoreSessionServices`) carrying already-built services. Agents
constructs them and lends them to `Config.initialize`. `Config` does **not**
receive a factory to invoke — if it did, `Config` would still be the composition
root and the exercise would be pointless. `Config` uses a borrowed service while
assembling tools and does not retain it.

**Construction ordering.** Explicit hand-written phases, not a topologically
sorted registry: `Foundation` (spec, settings, filesystem, policy, bus),
`Catalogs` (tool registry, MCP prompt/resource catalog), `DiscoveryRuntime` (MCP
manager, extensions, LSP, skills, subagents), `ExecutionRuntime` (agent client,
scheduler broker). A sorter would hide required side-effect ordering — extension,
LSP and skill mutation must complete before the first tool publication — and
would hide the special shutdown constraint where MCP stop is initiated before
awaiting trust-transition settlement.

The current object graph contains real cycles, all artifacts of passing `Config`
as a host: `Config` ↔ ToolRegistry via `CoreToolRegistryHostAdapter(config)`;
`Config` ↔ ExtensionLoader broken by two-phase `start(config)`; `Config` ↔
AgentClient broken by constructing it last. They are removable, not evidence
that a god object is required.

**Settings.** A session-owned single-writer controller exposing immutable
versioned snapshots, with an explicit ordered mandatory reactor — not an
EventEmitter, whose throwing listener can prevent later listeners from running.
All three current reactions are correctness-critical, not cache optimisations:
stale credentials, endpoint, transport or streaming semantics are a functional
and potentially security defect. On reactor failure, keep the new snapshot
authoritative, aggregate errors, mark the runtime unreconciled, and block new
turns and admissions rather than failing silently.

**Scheduler.** The process-global singleton is the bug. What is load-bearing is
one scheduler shared within an assembled runtime; sharing merely because two
callers passed the same `sessionId` string is not, and is unsafe. Replace with a
session-owned `SchedulerBroker` issuing idempotent leases.

**Config's end state.** A deprecated compatibility facade that preserves caller
object identity for `fromConfig` and delegates legacy settings methods, losing
one service field and getter per slice. It must not hide a runtime in a
`WeakMap<Config, Runtime>`, because that preserves locator semantics under a new
spelling.

**`fromConfig` identity.** The real contract is adoption without duplication and
without disposing caller-owned state. Identity is the current test's proxy for
that. Keep the identity observable during migration while `Config` stops being
the operational dependency graph.

## First slice: ShellJobManager

Chosen over PromptRegistry/ResourceRegistry. Those are constructor-leaf-like but
not lifecycle-leaf-like: their only teardown is `clear()`, which `Config` never
calls, and moving them would touch broad MCP and UI surfaces while proving
neither real shutdown nor a settings reaction.

`ShellJobManager` proves every mechanism that matters. Verified against the code:
field at `configBaseCore.ts:146`; lazy construction at `config.ts:715-720`;
accessor bundle at `:757`; awaited disposal that terminates real processes at
`:973`; correctness-critical live reaction at `configBase.ts:231-234`; consumers
in **both** core (`toolRegistryFactory.ts`, `CoreShellToolHostAdapter.ts`,
`asyncTaskServices.ts`) and agents (`configViews.ts`, `agentImpl.ts`,
`control/tasksControl.ts`).

That cross-package consumer split is the point, not a problem — it is what makes
this a genuine ownership transfer rather than moving a core field into another
core object.

**Acceptance is behavioural, not structural.** A real background shell job
launched through the core shell tool must appear with the same job identity
through the Agent tasks API and be cancellable there. Writing
`shell-max-background-jobs` must change admission before the write returns. Two
sessions with the same `sessionId` string must have isolated job lists.
Disposing a `fromConfig` agent must await termination of a real process while
leaving caller-owned `Config` usable. Disposal failure must aggregate and not
short-circuit later teardown.

Structural checks (`Config` has no shell field, getter, construction or
disposal) supplement those; they do not replace them.

## Two decisions that need your sign-off

**1. This cannot be one PR.** Vertical extraction is one service per PR. The
standing rule is one PR per issue; #2615 cannot honour that without a single
enormous change. I recommend a series, first slice standalone.

**2. The first slice is a source break.** There is no mechanism that deletes
`Config.getShellJobManager()`, keeps existing callers compiling, and avoids a
delegate or hidden lookup. All in-repo consumers move in the same PR; external
callers of that getter take a documented break. A deprecated delegating getter
would make the PR look compatible while preserving exactly the locator semantics
this issue exists to remove.

## Branch strategy

Restart from `main`. Keep `issue2615` as a preserved experiment; do not build on
it, and do not open with a large "delete the scaffolding" commit.

The scaffolding actively obstructs: `runtimeDependenciesFromConfig` eagerly calls
`config.getShellJobManager()` (`runtimeDependencies.ts:161`), and
`performInitialization` passes that projection into MCP construction
(`config.ts:188-193`). So initialising MCP can force shell-manager construction.
Once agents owns the real manager, that projection would either create a second
one or force a delegate — either defeats the slice.

## What is worth keeping from the experiment

`scripts/config-coupling.ts` as a trend report; the census; the characterisation
tests; and the genuinely narrow single-use interfaces (`LspControl` at two
members, `TrustedFolderSource` at one, the hook-trigger boundary at two,
`loopDetectionService` at one, `environmentContext` at three).

Discard: `ProviderRuntimeConfig`, the universal `RuntimeDependencies`,
`RuntimeMutations` as a sanctioned way to keep injecting into `Config`,
`isRuntimeDependencies` (declared `value is Config` — it recognises the
god-object, not the record), and the type-name guard as a success criterion.
