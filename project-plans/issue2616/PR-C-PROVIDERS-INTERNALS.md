# Issue #2616: Complete remaining work in existing PR #3741

Parent issue: #2616 (Eliminate ambient runtime global state). Epic #2619.
Branch: `issue2616-pr2`. All remaining #2616 work belongs in existing PR #3741;
there is no new PR C or subsequent split PR. PR #3739 landed by squash as
`bc4753868` on main. The reconciliation merges that main into `d0211cc11`
without rewriting either history. The original document is preserved below as
research, not an approved implementation design.

## Scope reconciliation (2026-09-21)

This section overrides conflicting scope, exclusions, branch names, and design
instructions below. Live issue bodies and human comments take precedence over
bot plans. Earlier line references remain pinned to `d0211cc11`; the evidence
here was checked against the merge of `bc4753868` and `d0211cc11`.

Already landed: #3739 removed core ambient context and settings-singleton paths.
#2643 is closed: PR #3647 (`9355f85ce` merge) supplies reducer/controller and
immutable routing contracts, not full production entrypoint cutover or S1/S2
proof. #3633 is closed: PR #3691 (`fa03eb0c8` merge) supplies
`integration-tests/conformance/scenarios.s1-s12.test.ts` and
`dev-docs/architecture/ownership-inventory.md`; twelve skipped targets are not
passing conformance. #2615 remains open; PR #3710 (`5bcffbc0e` merge) adds session
execution port contracts only. #3222 remains open; its agents-owned assembly
and factory-registration deletion must be coordinated, not duplicated.

The branch already removes AgentRuntimeState globals/subscribers, preserves
immutable create/update validation, and observes actual per-client coreEvents
listener removal on disposal. Its existing correction stands: unsubscribe ran
on dispose; the callback never fired in production.

Remaining acceptance includes providers registry/default identity, identity ALS,
ambient barrels and verbs, provider singleton and OAuth registration state,
agents WeakMaps, CLI latestBridge, complete AST negative controls, mutable-state
and ALS scans/allowlists, explicit consumer execution outside ALS, and direct
S1/S2 and C-scope evidence. None of those exclusions below permits another PR.
Config decomposition and MCP callback replacement stay owned by #2615 E/F;
#3222 G integrates their ports. Record their merged deletion and two-host
notice/auth/disposal evidence here before claiming that inventory resolved.
Current main still has the MCP register/reset dispatch, so contracts alone do
not establish E-ready/F-ready or MCP completion.

Do not implement the owner-services cell proposed below. A RuntimeServices or
RuntimeHandle-style bag under another name, wholesale passing outside agents
assembly, keyed global registry, ambient delegation wrapper, or new identity
ALS scope is prohibited. Ordinary consumers receive only their used ports.
The agents assembly may hold its graph internally.

Next bounded implementation slice, within #3741: remove the OAuth registration
WeakMap by using OAuthManager's existing instance-owned provider registry as
the registration source. `oauth-provider-registration.ts:34,46-49,123,130`
tracks duplicate state; `auth/oauth-manager.ts:164-174` already delegates
register/get to its owned registry. Add behavioral tests first for two managers,
repeat registration preserving provider identity, a later UI callback reaching
only its manager, and directly registered providers not being replaced. Preserve
missing-token-store and unsupported-provider behavior. Update registration
callers/tests, delete the global reset helper and its exports/callers, and add a
negative control for restoring this side-channel. This needs no whole-services
bag and does not duplicate #3222's runtime assembly work. It is a work slice,
not a separate PR or a claim of full #2616 completion.

## Preserved providers research scope

The original providers inventory follows; it is a subset of the PR's total scope:

- `providers/src/runtime/runtimeRegistry.ts:107` — the `runtimeRegistry` Map
  (keyed by runtimeId; module-level ambient).
- `providers/src/runtime/runtimeRegistry.ts:115` — the `defaultCliRuntimeId`
  write-once pointer (the #2300 guard) and its setter/getter/clear trio
  (`:128-161`) plus `resetDefaultCliRuntimeIdForTesting` (`:163-165`).
- `providers/src/runtime/runtimeRegistry.ts:167` — `resolveActiveRuntimeIdentity()`
  (ALS scope → registered default → `MissingProviderRuntimeError`; the
  stale-scope refusal throws at `:179-191`), plus the
  `registerActiveRuntimeIdentityResolver(...)` module side effect at `:222-226`
  that feeds `active-runtime-identity.ts`.
- `providers/src/runtime/runtimeAccessors.ts` — the ambient accessor barrel.
  The issue's filing said "22 ambiently-resolving exports"; regenerated census
  at `d0211cc11` counts **28 ambient-resolving function exports** plus
  `NO_ACTIVE_PROVIDER_ERROR_MESSAGE`, `_internal`, and two interfaces
  (`CliRuntimeServices`, `ProviderRuntimeStatus`).
- `providers/src/runtime/runtimeSettings.ts` — the thin barrel over the whole
  runtime cluster, **including its module-load side effect** at `:197-205`
  (`registerIsolatedRuntimeBindings({...})` wiring the activation seam to the
  ambient registry writers; `disposeRuntime: disposeCliRuntime` at `:204`).
- `providers/src/runtime/runtimeLifecycle.ts` — `registerCliProviderInfrastructure`
  (`:112-155`) and `setCliRuntimeContext` (`:202-253`), the two registry
  writers, plus `resetCliProviderInfrastructure` (`:161-184`).
- `providers/src/auth/runtime-accessor-bridge.ts` — the `oauthRuntimeBridge`
  singleton and its registration function
  `registerOAuthRuntimeAccessors()` at
  `runtime/oauth-runtime-accessors.ts:104-106`. **Characterization correction**:
  `registerOAuthRuntimeAccessors` is an EXPLICITLY-CALLED function invoked from
  `setCliRuntimeContext` (runtimeLifecycle.ts:252) on every CLI startup — it is
  NOT an import-time side effect. The import-time side effect in this cluster
  is the `registerIsolatedRuntimeBindings(...)` call in `runtimeSettings.ts`
  above. The deletion list removes both the function (`:104-106`) and its call
  site (runtimeLifecycle.ts:249-252, the registration block) in the same commit
  (see §R1a and the commit ledger).

Known entanglements handled in this plan: stateless-hardening preference
resolution, the OAuth runtime-accessor bridge, the activationBindings indirection
in `runtimeContextFactory.ts`, the #3222 provider-manager singleton side effects
on the dispose path, the per-runtime `ProviderFileLifecycle` lookup from
`OpenAIProvider`, and **ownership across construction, adoption, and transfer**
(§R1g) — the two production paths where the construction owner of providers and
auth collaborators is not their final owner.

## PR shape decision (RESOLVED: one pull request, dependency-ordered commits)

The issue's landing discipline ("an old accessor is deleted in the same PR that
migrates its last caller"; each PR leaves the build green) binds the registry
Map's deletion to the migration of its last reader, because every ambient
accessor resolves identity exclusively through `resolveActiveRuntimeIdentity` →
registry. The census counts **36 production files** outside the deleted cluster
files (15 inside providers, 21 across agents/cli/zed-acp) plus **~100 test
files** (48 external + 52 providers-internal) that import or `vi.mock` the
cluster. That volume was originally sketched as three stacked sub-PRs
(C1/C2/C3 along package lines). **That split is rejected**; this is one PR.

Why the package-shaped split fails:

- The verb implementations are SHARED by the packages the split would
  sequence: `providerMutations.ts:417-420` (`setActiveModel` resolves
  `getCliRuntimeServices()` internally), `providerSwitch.ts:881`
  (`switchActiveProvider`, same), and `profileSnapshot.ts:593-597`
  (`applyProfileSnapshot`, same) each sit in providers but are called by BOTH
  cli (UI bag verbs) and agents (`agentImpl`, `providerActivationExecutor`).
  A C1/C2/C3 boundary between "providers internals", "cli/zed", and "agents"
  would strand each shared verb mid-migration: to compile, the intermediate
  state needs temporary ambient shells, overloaded signatures, or duplicate
  verb copies — exactly the wrapper/alias patterns this lane's no-wrapper rule
  (§Prohibited) forbids, and which the end state would then have to delete
  again.
- A split is only bisectable if every intermediate state compiles AND preserves
  behavior. With shared verbs, the only compiling intermediate states are the
  wrapper-ful ones above; without wrappers there is no valid sub-PR boundary,
  only a work ORDER.
- Precedent: PR A (#3739) landed as a single ~221-file PR with ordered commits
  and passed review with named review sections. Size alone is not a blocker.

What replaces the split:

- **Work order is preserved** (bottom-up: per-owner ownership seams first, then
  verb migrations, then cluster deletion) but it is expressed as an ordered
  COMMIT SERIES within the one PR (§Commit plan), not as PR boundaries.
- **Same-commit rule**: each verb-migration commit moves ALL of that verb's
  callers (cli + zed-acp + agents), deletes the accessor(s) whose last
  production use was that verb, and adds its guard names to
  `ambient-runtime-symbols-guard.ts` — all in the SAME commit, never deferred
  to a final step. Every commit typechecks, leaves affected package tests
  green, and preserves observable behavior (bisectable).
- **Named review sections**: the diff is reviewed in three sections that group
  the commits — §R1 ownership/auth/lifecycle, §R2 verb migrations/UI bindings,
  §R3 cluster deletion — so reviewers get the same framing the sub-PRs were
  meant to provide.

## Census (pinned at d0211cc11, branch issue2616-pr3)

Re-run commands are inline; every number below is their output. **Census
semantics note**: the subpath/file counts below are an IMPORT census (import
statements and `vi.mock` factories that name the cluster). They are NOT an
affected-file census: root-barrel callers (`providers/src/index.ts`
re-exports), prop threading through intermediate components, and UI bag
consumers add files beyond the counted import statements — the UI-bag consumer
inventory (§R2) is the affected-file list for the CLI.

### 1. Cluster exports and their callers

`runtimeRegistry.ts` exports: `runtimeRegistry` (Map), `RuntimeRegistryEntry`,
`RuntimeKind` (types), `setDefaultCliRuntimeId`, `getDefaultCliRuntimeId`,
`clearDefaultCliRuntimeId`, `resetDefaultCliRuntimeIdForTesting`,
`resolveActiveRuntimeIdentity`, `upsertRuntimeEntry`, `requireRuntimeEntry`,
`cleanupProviderFilesForSession`, `disposeCliRuntime`,
`disposeCliRuntimeRegistration`, `resetCliRuntimeRegistryForTesting`.

- **Writers of the Map (production): 4 external upsert callers making 5
  `upsertRuntimeEntry` calls** — `activateIsolatedRuntimeContext`
  (runtimeLifecycle.ts:94), `registerCliProviderInfrastructure` (:125 and :153),
  `resetCliProviderInfrastructure` (:180), `setCliRuntimeContext` (:226). The
  registry module itself also mutates the Map on the delete/clear side:
  `disposeCliRuntimeRegistration` deletes at runtimeRegistry.ts:400 and
  `resetCliRuntimeRegistryForTesting` clears at :428. (Keep the two dispose
  functions distinct: `disposeCliRuntime` :349-374 runs provider-file cleanup
  then delegates to `disposeCliRuntimeRegistration` :376-425, which owns the
  default-pointer handoff and singleton effects at :399-424.)
- **Readers of the Map (production, outside the registry module itself):**
  `runtimeAccessors.ts:93,96,237,350` (identity + entries + size log),
  `statelessHardening.ts:99-101` (identity + entry metadata for the hardening
  preference), `runtimeLifecycle.ts:141` (`runtimeRegistry.size` log) and
  `:176` (`runtimeRegistry.has` reset-target check), `openai/OpenAIProvider.ts:682-684`
  (`requireRuntimeEntry(options.invocation.runtimeId).providerFileLifecycle`
  for Kimi media maintenance), and
  `disposeCliRuntimeRegistration`
  (default-pointer handoff to the provider-manager singleton, `:399-424` —
  note: the REGISTRATION function, not `disposeCliRuntime`).
  This list is the authoritative reader set; §3 repeats it without
  contradiction.
- `cleanupProviderFilesForSession` has exactly one production caller:
  `agents/src/core/chatSession.ts:793` (`clearHistory`), reached via the
  package index (`providers/src/index.ts:137`).
- `disposeCliRuntime` production caller: none outside the cluster; it is wired
  as `activationBindings.disposeRuntime` in the `runtimeSettings.ts:204` side
  effect, so isolated-runtime cleanup reaches it through the bindings seam.
- `disposeCliRuntimeRegistration` production caller:
  `assembleCliProviderRuntime.ts:184` (failure unwind).
- Everything else is test-only (see §Test strategy).

`runtimeAccessors.ts` 28 ambient exports with production caller classes:

| Export family | Direct production callers |
|---|---|
| `getCliRuntimeServices` | providerSwitch.ts:804, profileSnapshot.ts:233,597,681,759,767,772,777, providerMutations.ts:420, settingsResolver.ts:62, profileApplicationRollback.ts:31, oauth-runtime-accessors.ts:65,75; re-exported through the barrel into the CLI `RuntimeContext.tsx` bag (`:96`) and consumed by UI hooks — see the UI-bag inventory in §R2 |
| `getCliRuntimeContext` | oauth-runtime-accessors.ts:56, cli postConfigRuntime.ts:346, CLI `RuntimeContext.tsx` bag |
| `getCliProviderManager` | oauth-runtime-accessors.ts:45, CLI `RuntimeContext.tsx` bag, cli modelIdentity.ts, and the UI/command consumers in §R2 |
| `getCliOAuthManager` / `maybeGetCliOAuthManager` | providerSwitch.ts:549,615, profileSnapshot.ts:602, CLI `RuntimeContext.tsx` bag, and the UI/command consumers in §R2 |
| `isCliRuntimeStatelessReady` | profileApplication.ts:574 |
| `ensureStatelessProviderReady` | internal only (`getProviderManagerOrThrow`, runtimeAccessors.ts:448) |
| `resolveActiveProviderName` | profileSnapshot.ts:241,777, internal (getActiveModelName, getActiveProviderName, getActiveModelParams family) |
| `getActiveModelName` | profileSnapshot.ts:778, CLI `RuntimeContext.tsx` bag, agents createAgent.ts |
| `getActiveProviderStatus` | CLI `RuntimeContext.tsx` bag, cli modelIdentity.ts, and UI consumers SessionController.tsx:89,125,251 / Footer.tsx:365 (§R2 inventory) — ambient reader deleted (guard + acceptance aligned; no retained function of this name) |
| ephemeral/session families, model-param family, provider-query family, `listProviders`, `getActiveProviderName`, metrics/tokenUsage | CLI `RuntimeContext.tsx` bag; the verb writers (`setEphemeralSetting`, `setActiveModelParam`, …) are called by CLI UI through the bag |
| `getActiveRuntimeKind` | providerSwitch.ts:567 (lazy-claudecode-OAuth decision), errors.ts:483 (`buildReauthenticateSuffix`; re-export of `active-runtime-identity.ts` reader) |
| `NO_ACTIVE_PROVIDER_ERROR_MESSAGE` | cli useProviderDialog.ts (pure const — survives, new home) |

Who constructs vs who reads: everything in the registry is constructed by the
CLI bootstrap path (`assembleCliProviderRuntime` → `setCliRuntimeContext` at
:126 + `registerCliProviderInfrastructure` at :171) or the isolated path
(`createIsolatedRuntimeContext` handle → `activateIsolatedRuntimeContext`), and
read ambiently by the accessors. The CLI already holds the same objects
explicitly in `BootstrapRuntimeState` (profileBootstrap.ts:463-468) and agents
hold them in `IsolatedRuntimeContextHandle` — the registry is a second, ambient
copy of state the callers already own. **Ownership correction (§R1g)**: "who
constructs" is not always "who owns" — `createAgent` births providers in a
temporary manager and `fromConfig` adopts a Config's existing manager, so
construction-time ownership capture is unreliable on both production paths.

### 2. External subpath import sites (production, 21 files / ~30 statements)

```
rg -l "from '@vybestack/llxprt-code-providers/runtime" \
  packages/agents/src packages/cli/src packages/cli/test packages/zed-acp/src \
  -g '*.ts' -g '*.tsx' \
  | grep -v -E '(\.test\.|\.spec\.|__tests__|/test/|integration-tests/)' | sort
# 21 files: agents 5, cli 13, zed-acp 3
```

- **agents (5)**: `api/createAgent.ts:20-25` (`createIsolatedRuntimeContext`,
  `IsolatedRuntimeContextHandle`, `getActiveProviderName`, `getActiveModelName`);
  `api/fromConfig.ts:14-15`; `api/agentImpl.ts:31-35` (`switchActiveProvider`,
  `setActiveModel`, `setActiveModelParam`, `clearActiveModelParam`) + dynamic
  imports at `:454,468` (`updateActiveProviderApiKey/BaseUrl`);
  `api/providerActivationExecutor.ts:39-51` (8 verbs);
  `core/subagentOrchestrator.ts:59-66` (`createIsolatedRuntimeContext`,
  `runWithRuntimeScope`, deep `runtime/profileApplication.js` at `:66` — a
  RETAINED focused subpath; see §Guard positive controls).
- **cli (13)**: `ui/contexts/RuntimeContext.tsx:20-99` (36-name bag);
  `config/postConfigRuntime.ts:20-26` (`getCliRuntimeContext`,
  `setCliRuntimeContext`, `applyCliSetArguments`) + dynamic import at `:260`;
  `config/profileBootstrap.ts:24` (`assembleCliProviderRuntime`);
  `config/profileRuntimeApplication.ts:9` (`applyProfileSnapshot`);
  `cliSessionBootstrap.ts:31`, `cliProviderInit.ts:11` (`loadProfileByName`),
  `config/configBuilder.ts:22` (`registerAgentRuntimeFactories` — #3222 seam,
  survives this PR);
  `ui/utils/modelIdentity.ts` (3 ambient reads);
  pure-helper importers that need a new path only: `setCommand.ts`,
  `setCommandSchema.ts`, `toolformatCommand.ts` (type),
  `ModelConfigDialog.tsx`, `useProviderDialog.ts` (const).
- **zed-acp (3)**: `runZedIntegration.ts:12` (`setCliRuntimeContext` with
  `allowDefaultHandoff: true` at `:118-123`), `zed-initialize.ts:9`
  (`loadProfileByName`), `zed-config-options.ts:16`
  (`parseEphemeralSettingValue` — pure).

Test/spec/mock sites: **48 files** outside providers
(`rg -l "llxprt-code-providers/runtime" packages/{agents,cli,zed-acp} -g '*.test.*' -g '*.spec.*' | wc -l`),
**52** inside providers
(`rg -l "runtimeRegistry|runtimeAccessors|runtimeSettings|runtimeLifecycle|statelessHardening|active-runtime-identity" packages/providers/src -g '*.test.*' -g '*.spec.*' | wc -l`)
— **≈100 test files total**. Reminder from the census-semantics note: this
understates the migration surface; helper files
(`profileApplicationTestSetup`, `lbProfileApplicationTestSetup`,
`oauth-manager.issue1468.test-helpers.ts`, …) and root-barrel imports are
counted nowhere in these two numbers.

### 3. runtimeRegistry Map lifecycle

Ambient (module-level `export const ... = new Map()`). Keyed by runtimeId.
Writers and readers exactly as listed in §1. There is **no reader that cannot
be replaced by per-owner state**: every value the Map carries is placed there
by a caller that already holds the same object reference explicitly (bootstrap
state or isolated handle). The non-accessor production readers are
`statelessHardening.ts:99-101`, `runtimeLifecycle.ts:141,176` (size/has),
`OpenAIProvider.ts:682-684` (provider-file lifecycle), and the dispose path's
default-pointer handoff to the provider-manager singleton
(`disposeCliRuntimeRegistration`, runtimeRegistry.ts:399-424) — matching §1's
list.

### 4. defaultCliRuntimeId and resolveActiveRuntimeIdentity

- `setDefaultCliRuntimeId`: production caller `setCliRuntimeContext`
  (runtimeLifecycle.ts:244) only; the `allowReplace` handoff path is exercised
  solely by zed-acp (`runZedIntegration.ts:118-123` → `allowDefaultHandoff:
  true`). All other callers are tests.
- `getDefaultCliRuntimeId` / `clearDefaultCliRuntimeId` /
  `resetDefaultCliRuntimeIdForTesting`: test-only outside the cluster (the
  latter two still join the guard's deleted-name list — see §Guard).
- `resolveActiveRuntimeIdentity`: production callers are the ambient accessors
  (runtimeAccessors.ts:92,155,212,229,269,345), `resetCliProviderInfrastructure`
  (runtimeLifecycle.ts:168), and `statelessHardening.ts:99`.
- If the default disappears: CLI UI consumers must receive services from the
  React bridge — but "receive from the bridge" does NOT mean "stay unchanged":
  the bridge's bag members that AMBIENTLY resolve (the banned accessor names)
  are deleted, and their consumers migrate to narrow operations in the same
  commits (§R2 UI-bag inventory + migration). `useRuntimeApi` has **45 file
  matches total** (`rg -l "useRuntimeApi" packages/cli/src packages/cli/test |
  wc -l`); excluding `*.test.*`/`*.spec.*` that is **22 files, one of which is
  the defining module** (`RuntimeContext.tsx:252`), so ~21 hook consumer files
  keep calling `useRuntimeApi` — yet a subset of them call BANNED names on the
  api and MUST migrate (§R2 inventory). `getRuntimeApi()` (the imperative
  twin, defined at `RuntimeContext.tsx:270`) has **24 production consumer
  files** of its own (the `ui/commands/*` family, `ProfileCreateWizard/utils`,
  `SessionController.tsx`, `RuntimeContext.tsx`) that the `useRuntimeApi`
  census does not cover at all; they migrate with their verb/accessor
  families per §R2. OAuth/auth-cluster consumers receive services from
  per-owner construction (§R1); verbs receive them as ports. Nothing else
  resolves identity ambiently today: agents already scope isolated work via
  `runWithRuntimeScope` and the handle, so "explicit identity" is already true
  everywhere except the accessor internals.

### 5. registerCliProviderInfrastructure

Wires: registry upsert (manager+oauthManager+kind), optional provider-manager
singleton registration (`registerProviderManagerSingleton`, skipped for
isolated runtimes via `registerAsGlobalSingleton: false`), and, when the entry
already carries a Config, `configureProviderRuntimeFactories` + `manager.setConfig`.

Production call order today (CLI): `prepareRuntimeForProfile`
(profileBootstrap.ts:441 `assembleCliProviderRuntime` → step 1
`setCliRuntimeContext` at assembleCliProviderRuntime.ts:126, step 3
`createProviderManager` at :156, step 4 `registerCliProviderInfrastructure`
at :171) → post-config re-seed (postConfigRuntime.ts:251
`setCliRuntimeContext` + `:260` dynamic-imported second
`assembleCliProviderRuntime`) → UI mount (`RuntimeContextProvider` reads
`getCliRuntimeContext`). Isolated path:
`createIsolatedRuntimeContext(...).activate()` → bindings → both writers with
`setAsDefault:false` / `registerAsGlobalSingleton:false`.

Callers: production — `assembleCliProviderRuntime.ts:171` and the CLI bag
re-export (RuntimeContext.tsx:45 imports it, :96 re-exports it into the api).
**Correction of an earlier draft**: no production UI surface CALLS it at this
HEAD (`rg -n "\.registerCliProviderInfrastructure\(" packages/{cli,zed-acp,agents}/src`
returns nothing); `useUpdateAndOAuthBridges` has NO
`registerCliProviderInfrastructure` call. The bag member is dead weight in
production UI (only test helpers stub it: `test-utils/render.tsx:139`,
`StatsDisplay.testHelpers.ts:172`) and is deleted with the bag rebuild — no
"re-seed callback" consumer migration is needed for it. After §R3 the
"registration" concept is gone: `assembleCliProviderRuntime` returns the
assembled bundle (it already does), the isolated handle activates without
registry writes, and `configureProviderRuntimeFactories(config, manager)` runs
directly at the construction sites.

### 6. #2300 write-once guard and its invariant

The guard is `defaultCliRuntimeId` + `setDefaultCliRuntimeId`'s
refuse-overwrite rule (runtimeRegistry.ts:128-146) and the stale-ALS-scope
refusal in `resolveActiveRuntimeIdentity` (`:179-191` throw; the function
spans `:167-220`). Per lane policy the mechanism is deleted WITH the registry;
the invariant keeps behavioral tests.

**Invariant**: operations routed through an isolated/background runtime never
change the foreground runtime's active provider, model, or settings — and a
torn-down runtime's scope never borrows foreground credentials. Today this is
anchored by `isolatedRuntimeDefaultPointer.behavior.test.ts` asserting the
pointer is untouched. After deletion there is no pointer to corrupt, so the
test repoints to ownership: assemble a foreground runtime
(`assembleCliProviderRuntime`), activate an isolated runtime
(`createIsolatedRuntimeContext` + `activateIsolatedRuntimeContext`), run a
provider switch + model set + ephemeral write **through the isolated handle's
own services**, then assert the foreground `SettingsService`/`Config`/manager
state is unchanged. The stale-scope refusal becomes TWO tests: (a) the
ALS-scope-less execution test (acceptance 4 of the issue): a formerly-ambient
consumer runs entirely outside any scope with explicit inputs and succeeds;
(b) **disposed-owner coverage** (new, replaces "unregistered runtimeId fails
fast", which is meaningless once the registry is gone): after an owner's
cleanup/disposal, an operation routed through THAT owner — its handle, bundle,
or auth collaborators — FAILS fast with the owner's disposed/missing-services
error and demonstrably does NOT consult the foreground runtime. Today's analog
is the stale-scope refusal at runtimeRegistry.ts:179-191
(`MissingProviderRuntimeError` with the #2300 message); after deletion the
refusal must come from the owner's own liveness check (§R1h). Coverage includes
auth reads (token-profile resolution incl. the explicitly-requested-profile
branch, ephemeral auth settings through the disposed owner's auth
collaborators), not only provider/model/settings mutations. See §Test strategy.

### 7. Stateless-hardening entanglement

- `statelessHardening.ts:87-116` (`resolveStatelessHardeningPreference`)
  resolves, in order: scope metadata (ALS) → registered-owner entry metadata
  (`resolveActiveRuntimeIdentity()` + `runtimeRegistry.get` at `:99-101`) →
  `statelessHardeningPreferenceOverride` → default `'strict'`. Deleting the
  second SOURCE outright would change behavior for calls WITHOUT
  metadata-bearing ALS scopes — exactly the outside-ALS case this lane
  supports (early bootstrap, tests, unscoped callers). Migration therefore
  **threads the owner's preference/metadata explicitly and PRESERVES the
  precedence behavior**: the resolver gains an owner-metadata (or preference)
  parameter; every production caller passes the metadata its owner already
  holds (the isolated handle's activation metadata for agents; the assembled
  bundle/bootstrap metadata for the CLI). Precedence order stays
  scope-metadata → owner-threaded metadata → override → `'strict'`, with the
  owner-threaded source returning exactly what the registry entry returned
  today. If implementation finds a call path that can no longer reach its
  owner's metadata at all (no scope AND no owner in hand), that residual
  behavior change is CALLED OUT explicitly in the PR description and review —
  never labeled "deletion-only".
- `isStatelessProviderIntegrationEnabled()` consumers inside the cluster die
  with the accessors (runtimeAccessors.ts:109,132,223,265). The surviving
  consumer is `profileApplication.ts:574`
  (`isCliStatelessProviderModeEnabled() && !isCliRuntimeStatelessReady()`) —
  migrated to an explicit readiness check against the caller-supplied services
  (all-required-fields-present predicate over the narrow port), preserving the
  throw-on-incomplete behavior.
- `statelessHardeningPreferenceOverride` is module-level mutable state in
  `providers/src/runtime/` that the issue's criterion 3 sweep must eventually
  reconcile; it is NOT deleted here. Carried in the carry-over register below.
- Test disposition: the hardening spec's normalization/override/precedence
  suites are behavior and STAY (rewritten to thread owner metadata
  explicitly); only its registry-Map-plumbing assertions (assertions that pin
  entry writes/reads through `runtimeRegistry`) are deleted with the registry.
  See §Test strategy.

### 8. Coordination with #3222

`providerManagerInstance.ts:54-57` singletons (`fileSystemInstance`,
`singletonManager`, `singletonOAuthManager`, `openAIContexts`) are **#3222's**
deletion; PR C does not touch them. The boundary runs through call sites PR C
rewrites anyway:

- `registerCliProviderInfrastructure`'s `registerProviderManagerSingleton(...)`
  call (runtimeLifecycle.ts:135-137) moves with the wiring to the construction
  sites (assembled CLI runtime keeps registering its manager; isolated
  activations keep `registerAsGlobalSingleton:false` semantics by simply never
  calling it).
- `disposeCliRuntimeRegistration`'s singleton branch (runtimeRegistry.ts:399-424)
  — accurate mechanics, verified at this HEAD: it revokes scoped tokens
  (log), reads `removedEntry`, deletes the Map entry (:400), reads the default
  entry (:402-404), `clearDefaultCliRuntimeId` (:406, pointer cleared only if
  it pointed at the disposed id), picks `replacementEntry` = the default entry
  iff it has complete infrastructure (`hasProviderInfrastructure`, :89-96, at
  :407-409), logs when the default is partial (`hasPartialProviderInfrastructure`,
  :98-105, at :410-416), then **re-registers the complete default's manager as
  the singleton at :417-421, ELSE resets the singleton at :422-423 iff the
  removed entry carried a manager or oauthManager**. There is NO
  singleton-identity comparison anywhere in today's code.
- **Disposal seam design (OQ2, resolved — characterization, not
  identity-comparison)**. An earlier draft of this plan proposed deciding the
  singleton effects by comparing the disposed manager against the live
  singleton registration ("current-owner identity"). That design is REJECTED
  as NOT behavior-preserving on both sides:
  - Today, direct disposal of a NON-singleton runtime B (whose entry carries a
    manager) while the default entry is absent or partial RESETS the singleton
    (:422-423) even though the singleton points at some other manager A. An
    identity-equal design would do nothing — an observable change.
  - Conversely, normal isolated cleanup nulls the entry's managers FIRST
    (`resetCliProviderInfrastructure` upsert at runtimeLifecycle.ts:180-183,
    reached from the cleanup closure at runtimeContextFactory.ts:469) BEFORE
    `disposeRuntime` → `disposeCliRuntime` (:487-489 → :373), so the removed
    entry carries NO manager and neither branch fires. But an ADOPTED isolated
    handle (§R1g: `fromConfig` adopts the Config's manager, which may BE the
    singleton) holds the actual singleton manager in its closure; comparing
    its captured manager against the live singleton would MATCH and introduce
    a reset that today's code avoids.
  
  The replacement design reproduces today's EXACT decision table, evaluated at
  the disposal seam, with the foreground state passed in per-owner:
  
  | # | Default entry at dispose time | Removed entry carried manager/oauthManager? | Today's observable effect (runtimeRegistry.ts:399-424) |
  |---|---|---|---|
  | 1 | complete | either | re-register the default's manager+oauthManager as the singleton (:417-421) — unconditional on the removed entry, no identity check |
  | 2 | partial | yes | debug log (:410-416) + `resetProviderManager()` (:422-423) |
  | 3 | partial | no | debug log only — no singleton effect |
  | 4 | absent | yes | `resetProviderManager()` |
  | 5 | absent | no | no effect |
  | 6 | any (normal isolated cleanup: managers nulled by reset-first at runtimeLifecycle.ts:180-183) | no (nulled) | row 1 if a complete default exists (re-register it — observably a no-op when it is already the singleton, a CLOBBER when it is not); otherwise rows 3/5 — no reset |
  | 7 | partial (post-Zed-handoff: `runZedIntegration.ts:118-123` writes settings/config ONLY — no manager) | yes (the OLD foreground's entry, carrying its manager) | debug log + `resetProviderManager()` — the handoff does NOT guarantee a complete replacement default, so the old owner's disposal resets |
  
  Where the replacement gets "current complete foreground default" state after
  the pointer is deleted, WITHOUT a new global: **per-owner registration
  passed explicitly at the seams**. The CLI/zed composition layer already owns
  the foreground bundle (`BootstrapRuntimeState`, profileBootstrap.ts:463-468);
  that layer passes the current foreground registration
  (`{ providerManager, oauthManager } | undefined`) INTO every disposal seam
  that might need it (the assembled bundle's unwind, the isolated handle's
  cleanup closure via its construction input, and the Zed handoff's
  re-registration, which updates the composition layer's own registration it
  will pass afterward). "Default complete/partial/absent" becomes
  "foreground-registration complete (both managers) / partial (at most one) /
  absent"; "removed entry carried a manager" becomes "the disposing owner's
  entry carried a manager at dispose time" — a fact the owner's own cleanup
  state carries (the reset-first step nulls the owner's own record of its
  managers exactly as `resetCliProviderInfrastructure` does today). No
  module-level variable is introduced; the foreground registration is ordinary
  state the composition root already holds, threaded as a parameter.
  
  Characterized paths, each asserted against the table: (1) normal isolated
  cleanup (reset-first ⇒ row 6); (2) failed activation / assemble failure
  (unwind at assembleCliProviderRuntime.ts:184 with a possibly-partial or
  complete entry ⇒ rows 1-4 as applicable); (3) absent or partial foreground
  (rows 2-5); (4) old-owner disposal after the Zed handoff (row 7). Any case
  where the plan CANNOT reproduce today's behavior exactly, or where
  implementation confirms today's behavior is a BUG (e.g. row 6's
  clobber-when-not-singleton), is labeled a **bug fix with its own
  justification** and isolated in a separately described change — never
  "behavior-preserving".

`agentRuntimeFactoryBindings` / `registerAgentRuntimeFactories` /
`attachAgentRuntimeFactories` and `sharedTokenStore` / `runtimeCounter` are
#3222/later-lane scope: untouched. `activationBindings` (declared at
runtimeContextFactory.ts:105, registered via `registerIsolatedRuntimeBindings`
at :273-277, consumed by the activation closure :366-437 and cleanup closure
:448-494; fed by the barrel side effect at runtimeSettings.ts:197-205) is the
registry's write path, so §R3 dissolves it: the isolated handle's
`activate`/`cleanup` closures call the remaining steps directly
(`enterRuntimeScope`, `providerManager.setRuntimeContext`,
`configureProviderRuntimeFactories`, `flushRuntimeAuthScope`, lifecycle
cleanup, singleton side effect per the characterization table above).
#3222 later moves the construction itself; PR C changes only who the closure
calls.

### 9. package.json exports

`packages/providers/package.json` publishes `./runtime.js` plus deep subpaths
`./runtime/runtimeSettings.js`, `./runtime/runtimeAccessors.js`,
`./runtime/runtimeLifecycle.js`, `./runtime/runtimeRegistry.js`,
`./runtime/runtimeContextFactory.js`, `./runtime/statelessHardening.js`,
`./runtime/providerSwitch.js`, `./runtime/providerMutations.js`,
`./runtime/providerConfigUtils.js`, `./runtime/profileSnapshot.js`,
`./runtime/profileApplication.js`, `./runtime/settingsResolver.js`, and more.
Every consumer found by the census is inside this monorepo (agents, cli,
zed-acp); repo policy is no backward compatibility, so `./runtime.js` and the
subpaths for deleted modules are removed from `exports` in the same commit
that deletes them, and surviving modules keep or gain subpaths as the focused
import targets (`providerSwitch.js`, `profileSnapshot.js`,
`profileApplication.js`, `providerConfigUtils.js`, `ephemeralSettings.js` via
a new public subpath or the package index — decided at implementation, one
import shape per symbol, no re-export shim).

## Changes (end state), organized as review sections

The three sections below are the PR's review units; §Commit plan maps them to
the ordered commit series. Within a section, each change lists the files it
touches; the same-commit rule (§PR shape decision) governs how they land.

### §R1. Ownership, auth, and lifecycle

**R1a. Per-owner OAuth runtime accessors (redesigned).** Current state, pinned
at this HEAD: `buildOAuthRuntimeAccessors()` (oauth-runtime-accessors.ts:39-94)
returns closures that call `getEphemeralSetting` / `getCliProviderManager` /
`getCliRuntimeContext` / `getCliRuntimeServices` **on every invocation**, and
each of those resolves per-invocation identity via
`resolveActiveRuntimeIdentity` (runtimeRegistry.ts:167-220), which selects the
CALLING async context's scope and rejects stale scopes (:179-191). The
closures are installed by the EXPLICITLY-CALLED registration function
`registerOAuthRuntimeAccessors()` (oauth-runtime-accessors.ts:104-106, invoked
from `setCliRuntimeContext` at runtimeLifecycle.ts:252 — not an import-time
side effect), and `runtime-accessor-bridge.ts:91-111` (`OAuthRuntimeBridge`)
holds exactly one registration. Production readers through the singleton
bridge:
auth-status-service.ts:365-368, token-profile-resolver.ts:35,
auth-flow-orchestrator.ts:787-790, anthropic-oauth-provider.ts:196,271,
codex-oauth-provider.ts:346,460, token-request-args.ts:25,
interactive-auth-request.ts:138.

REJECTED design (do not implement): one global registration of
explicit-service closures, swapped at each runtime's activation with
owner-matched restore. With two live owners — foreground A and isolated B —
whichever activated LAST owns the bridge, so during live-live overlap A's auth
code reads B's settings/profile/manager. That converts today's
per-invocation, calling-scope-correct routing into last-writer-wins global
routing; owner-matched cleanup cannot fix interference while both owners are
live.

Adopted design: **inject each owner's accessor instance into its own auth
collaborators** — no runtime-sensitive reads through the shared singleton at
all:

- `buildOAuthRuntimeAccessors(ownerServices)` takes the owner's
  `{ settingsService, config, providerManager, runtimeId }` explicitly and
  returns closures over THOSE objects. One accessor instance per runtime,
  built at the owner's construction seam.
- Injection seam: `OAuthManager` construction (oauth-manager.ts:117,128,150
  constructs `AuthFlowOrchestrator`, `TokenAccessCoordinator`,
  `AuthStatusService`) gains the accessor instance and threads it into those
  three collaborators; OAuth providers receive it at `registerProvider`
  (anthropic/codex providers read ephemeral settings and browser-profile
  associations through it); `token-request-args.ts`,
  `interactive-auth-request.ts`, and `token-profile-resolver.ts` receive it
  from their callers in the orchestrator chain (they already execute inside
  flows that hold the manager) or as an explicit parameter.
- **Construction sequence per factory (OQ on ordering, RESOLVED — accessor
  wiring is a construction INPUT, never post-return injection)**. An earlier
  draft offered "inject immediately after `createProviderManager` returns at
  assembleCliProviderRuntime.ts:156" as an option. That option is INVALID and
  deleted: `createProviderManager` constructs the OAuthManager at
  providerManagerInstance.ts:571-575 and registers all providers at
  :613-626 (`registerAllProviders`) BEFORE returning at :644 — post-return
  injection lands AFTER provider registration, so providers and auth
  collaborators would run without the owner's accessor. The isolated path has
  the OPPOSITE order today (OAuthManager at runtimeContextFactory.ts:541-545
  before the manager exists at :562-568; supplied OAuth managers registered at
  :333-335), so a single "inject after X" rule cannot fit both. The chosen
  design gives each factory ONE concrete sequence in which the owner's
  accessor exists before ANY auth collaborator or provider uses it:
  1. **CLI/assemble (`createProviderManager` via `assembleCliProviderRuntime`)**:
     `createProviderManager` gains the owner-services cell
     (`{ settingsService, config, runtimeId, runtimeKind,
     providerFileLifecycle, lease }` — everything except the manager itself)
     as a construction INPUT. Inside, after `new ProviderManager(...)` (:557)
     and BEFORE `new OAuthManager(...)` (:571-575), it derives the accessor
     instance from the cell + the now-existing manager, and passes that
     accessor into the OAuthManager wiring (:571-575) and into
     `registerAllProviders` (:613-626). Registration
     (`registerCliProviderInfrastructure` at assembleCliProviderRuntime.ts:171)
     is unchanged in order. `assembleCliProviderRuntime` supplies the cell as
     part of its input; nothing is injected after return.
  2. **Isolated (`createIsolatedRuntimeContext`)**: reorder so the manager is
     resolved BEFORE OAuth construction — adopt `options.providerManager` or
     construct fresh (today's :562-568) FIRST, then build the accessor over
     `{ settingsService, config, runtimeId, providerManager }`, then construct
     the OAuthManager WITH the accessor (moving today's :541-545 construction
     after manager resolution; the session-bus resolution at :538-540 is
     unchanged). Supplied OAuth managers (`options.oauthManager`, adopted at
     :333-335) are NOT rebound: per §R1g's adoption rule they keep their
     construction owner's accessor, and the handle records the adoption.
  3. **`createAgent`'s temporary construction (`registerProvidersOntoManager`,
     createAgent.ts:565-630)**: the temporary `createProviderManager` call
     (:595-602) receives the FINAL owner's owner-services cell (§R1g), so
     providers birthed in the temporary manager bind the final owner's
     accessor from construction; the temporary manager's own wiring is
     otherwise identical to (1).
- The registration function (`registerOAuthRuntimeAccessors`,
  oauth-runtime-accessors.ts:104-106), its call site (runtimeLifecycle.ts:249-252),
  and the `oauthRuntimeBridge` singleton module (runtime-accessor-bridge.ts)
  are DELETED once every production reader above is injected — implementation
  and call site in the SAME commit (ledger, commit 2). The acceptance scan
  `rg -n "oauthRuntimeBridge" packages/*/src` must return nothing. Spec
  helpers that stubbed the bridge (`oauth-manager.issue1468.test-helpers.ts`,
  anthropic-oauth-provider.test.ts, oauth-manager.failover-wiring.spec.ts,
  oauth-manager.logout.spec.ts, codex-per-bucket-browser-profile.behavioral.spec.ts)
  repoint to injected fake accessor instances.
- Required new tests (with the interleaving harness): (i) foreground + two
  isolated owners all live, interleaved reads (ephemeral setting, current
  profile name, provider-manager identity, runtime context id) through each
  owner's auth collaborators — each owner sees only its own services; (ii)
  disposal in both orders (A then B, B then A) with surviving owners still
  correct; (iii) a disposed-owner auth read fails without borrowing
  foreground credentials (§R1h); (iv) each construction branch — CLI/assemble,
  isolated-fresh, isolated-supplied-OAuth, isolated-adopted-manager,
  createAgent-temporary — yields collaborators wired to the CORRECT owner's
  accessor (§R1g tests cover the adoption branches end-to-end).

**R1b. ProviderFileLifecycle single construction owner (corrected census).**
The earlier draft claimed two existing construction sites
(runtimeContextFactory + composition); that is wrong at this HEAD: neither
file has a lifecycle field. The ONLY current allocation is inside
`upsertRuntimeEntry` at runtimeRegistry.ts:258-264 —
`update.providerFileLifecycle ?? current?.providerFileLifecycle ??
new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 512 * 1024 * 1024 })` —
i.e., lifecycle identity is keyed by runtimeId and **preserved across
re-upserts of the same runtimeId** (the CLI post-config re-seed relies on
this). Consumers: `openai/OpenAIProvider.ts:682-684`
(`requireRuntimeEntry(options.invocation.runtimeId).providerFileLifecycle`,
per Kimi-media maintenance call), `kimi/kimiFileUpload.ts` (receives the
lifecycle), `chatSession.ts:793` (`cleanupProviderFilesForSession`), and the
dispose/unwind paths.

Design:

- **Single new construction owner**: the runtime bundle constructors —
  `assembleCliProviderRuntime` (CLI/zed foreground) and
  `createIsolatedRuntimeContext` (isolated runtimes) each construct ONE
  `ProviderFileLifecycle` per runtime identity (same limits: `maxFiles: 100`,
  `maxBytes: 512 MiB`), carry it on the assembled bundle/handle, and thread
  it into `ProviderManager` construction (new manager field).
- **Transition discipline (until the registry is deleted, commit 13)**: the
  bundle's lifecycle instance MUST populate the EXISTING `upsertRuntimeEntry`
  `providerFileLifecycle` field — bundle constructors pass their instance in
  every upsert (`setCliRuntimeContext`/`registerCliProviderInfrastructure`
  inputs gain the field) so the registry's `?? new ProviderFileLifecycle(...)`
  arm at :261-264 never fires for bundle-constructed runtimes. ONE shared
  instance per runtimeId at every intermediate commit — no dual allocation
  (this is a ledger requirement for commit 1; see §Commit plan).
- **Sharing across re-seeds**: lifecycle identity MUST survive the re-seed or
  files orphan. The post-config re-seed reassembles under the SAME runtimeId;
  its caller (which holds the current bundle / `BootstrapRuntimeState`)
  passes the EXISTING lifecycle through `AssembleCliProviderRuntimeInput`,
  reproducing today's `current?.providerFileLifecycle` fallback. Isolated
  runtimes never re-seed under one id; they construct fresh, as a new
  registry entry does today.
- **Transport into OpenAIProvider**: replace the per-invocation registry read
  with the lifecycle owned by the provider's runtime: the manager supplies
  the lifecycle at provider construction (provider instance field), since the
  provider belongs to exactly one manager/runtime — this also removes the
  `invocation.runtimeId` keying at :682-684. For providers COPIED between
  managers (§R1g createAgent path), the lifecycle is the FINAL owner's
  instance, supplied to the temporary construction. Cleanup and upload MUST
  use the same lifecycle instance, including provider aliases and reused
  provider instances under one runtime, so session cleanup sweeps exactly the
  files uploads registered.
- **Preserved behavior**: limits (100 / 512 MiB); `sweepExpired` +
  `retryDeletions` maintenance and its failure message; deferred deletion
  waits; retained-file refusal (deregistration refused while session files
  are retained); assemble-failure unwind (today via
  `disposeCliRuntimeRegistration` at :184 — the bundle constructor owns the
  equivalent unwind). The runtimeRegistry spec's provider-file disposal
  suites re-home against these seams (§Test strategy).

**R1c. Stateless preference threading.** As specified in census §7: the
owner's metadata/preference is threaded explicitly;
`resolveStatelessHardeningPreference` keeps the exact precedence behavior;
only the registry plumbing disappears. No behavior test is deleted for this
change — only Map-plumbing assertions.

**R1d. runtimeKind and runtime-identity threading into errors and auth
requests (OQ3, resolved; sites corrected).**
`buildReauthenticateSuffix` (errors.ts:475-492) currently reads
`getActiveRuntimeKind()` ambiently (:483) and uses "Ask the interactive host session
to authenticate (…); this context cannot open the auth dialog." wording for
kinds `'agent' | 'subagent' | 'cli-bootstrap'` and "Please re-authenticate to
continue. The auth dialog will open on your next message." otherwise.
`getActiveRuntimeIdentity` (active-runtime-identity.ts:33-39) returns
`undefined` when the resolver throws, so **`undefined` is a possible kind
input today** and formats with the interactive wording. Design:
`AllBucketsExhaustedError` (errors.ts:512+; the suffix is built in its
constructor at :549) receives `runtimeKind` explicitly. **Corrected threading
site**: the production construction point is
`RetryOrchestrator.createAllBucketsExhaustedError` (RetryOrchestrator.ts:851-860,
invoked at :727) — NOT a bucketFailover throw site; `formatAllBucketsExhaustedError`
(bucketFailover.ts) has no ambient kind read. `RetryOrchestrator` is owned by
the provider's manager chain, so the kind travels manager → orchestrator
explicitly (construction input or per-call field). Because ACTIVATION can
override `runtimeId`/`runtimeKind` AFTER construction
(runtimeContextFactory.ts:374-387: `activationOptions?.runtimeId ?? runtimeId`,
`activationOptions?.runtimeKind ?? options.runtimeKind ?? 'agent'`), the kind
must be read at USE time from the owner's state cell (updated by activation),
never frozen at manager construction.

Second, corrected threading site: **`buildInteractiveAuthRequester`
(interactive-auth-request.ts:68-79) reads `getActiveRuntimeIdentity()`** to
populate `requester.runtimeId` ONLY when `identity.runtimeKind ===
runtimeKind` (the requested kind, defaulting to `'unregistered'`); on
mismatch or `undefined` identity, `runtimeId` is omitted. Accessor injection
(R1a) does NOT replace that read — the requester must instead receive the
owner's current identity (from the owner state cell) and keep the EXACT
conditional: include `runtimeId` iff `identity.runtimeKind === runtimeKind`;
`undefined` identity ⇒ omit; preserve the `'unregistered'` fallback and
activation overrides (again via the state cell, not a frozen field).

Formatting is preserved EXACTLY: same prose strings, same kind-to-wording
mapping, and the `undefined` branch stays if `undefined` remains a possible
input (it does unless every throw site is proven to have a kind). Never
silently coerce a missing kind to `'agent'`; never reword. Tests: suffix
construction for every kind, for `undefined`, and for `hasAuthReason ===
false` (empty suffix); `AllBucketsExhaustedError` message assertions per kind
THROUGH the RetryOrchestrator:851-860 path; requester `runtimeId`
presence/absence through interactive-auth-request.ts:68-79 for
match/mismatch/undefined identity, and after an activation override.

**R1e. #3222 boundary relocation.** As specified in census §8: the singleton
registration moves to the construction sites; the disposal seam reproduces
the EXACT characterization table of census §8 (complete/partial/absent
foreground registration × disposing owner carried a manager or not ×
adopted-manager case × post-Zed-handoff disposal), with the foreground
registration passed explicitly at the seams — no singleton-identity
comparison, no new global. Every row of the table gets a characterization
test; any deviation from today's observable behavior is a separately
justified bug fix, never "behavior-preserving".

**R1f. activationBindings dissolution (previewed here, landed in §R3's
commit).** The isolated handle's `activate`/`cleanup` closures
(runtimeContextFactory.ts:366-437 activation, :448-494 cleanup) call the
remaining steps directly; the `registerIsolatedRuntimeBindings` side effect
(runtimeSettings.ts:197-205) is deleted in the SAME commit as the
dissolution (the merged final commit of the series deletes
`registerIsolatedRuntimeBindings` at runtimeContextFactory.ts:273-277 AND
the runtimeSettings.ts:197-205 import + call AND the cluster files; if
implementation prefers to split them, the earlier commit of the pair must
carry the runtimeSettings.ts:197-205 removal with it — the series never has
a commit where runtimeSettings imports a dissolved function). Sequencing and cleanup
semantics that MUST be preserved verbatim are listed in §Test strategy
(prepare-before-register, cleanupRequired, auth revocation, onCleanup
ordering, deferred file waits, retry after cleanup failure).

**R1g. Ownership across construction, adoption, and transfer (NEW — the
construction owner is not always the final owner).** Two production paths
break any design that captures the CONSTRUCTION owner's lifecycle/auth
bindings:

- **`createAgent` temporary-manager path** (createAgent.ts:570-630,
  `registerProvidersOntoManager`): the isolated runtime's manager exists
  first; to populate it, `registerProvidersOntoManager` constructs a
  TEMPORARY fully-wired manager via `createProviderManager` (:595-602, with
  `createFileOAuthSettingsProvider()` and `activateConfiguredProvider:
  false`), then COPIES the constructed provider instances onto the isolated
  manager (:603-611) and mirrors the active provider best-effort (:614-629).
  The temporary manager and its OAuthManager exist ONLY to birth providers;
  providers constructed there capture whatever owner bindings their
  construction gave them, but they LIVE in the final isolated runtime.
- **`fromConfig` adoption path** (fromConfig.ts:85-99): the isolated handle
  gets its OWN runtimeId (`options.sessionId ?? generateRuntimeId()`, :72)
  but ADOPTS the Config's existing manager (`config.getProviderManager()`,
  :86-87 → `providerManager: adoptedManager` in
  `createIsolatedRuntimeContext` options, :90-100), which
  `runtimeContextFactory.ts:562-568` explicitly supports. The adopted manager
  was constructed by ANOTHER owner — typically the still-live CLI foreground
  that built the Config — and may ALSO be the registered singleton.

Design:

- **Transfer semantics for birthed providers (createAgent path)**: thread the
  FINAL owner's lifecycle/auth ports into the temporary construction. The
  isolated handle's owner state cell (`settingsService`, `config`,
  `runtimeId`, `runtimeKind`, `providerFileLifecycle`, lease — the same cell
  R1a uses) is passed INTO `registerProvidersOntoManager` and supplied to
  the temporary `createProviderManager` (:595-602) as its owner-services
  input, so providers bind the final owner's accessor and lifecycle from
  construction. The temporary manager carries no independent lifecycle or
  accessor of its own (nothing else is created to be transferred); its
  OAuthManager wiring uses the same cell and dies with the temporary manager
  when `registerProvidersOntoManager` returns. Cleanup responsibility: the
  ISOLATED handle's `cleanup()` owns everything the copied providers touch
  (auth scope flush, provider-file lifecycle, onCleanup); the temporary
  manager has NO cleanup of its own — it registered no runtime, no singleton,
  and owns no files.
- **Adoption semantics for adopted managers (fromConfig path)**: adoption
  does NOT rebind and does NOT overwrite another live owner's bindings. The
  adopting handle gets its OWN accessor (built over the handle's
  settings/config/runtimeId per R1a sequence 2) for collaborators it
  constructs itself, but the ADOPTED manager and any SUPPLIED OAuthManager
  (fromConfig.ts:108 `resolveOAuthManager(config, handle)`) keep their
  construction owner's accessor and lifecycle — the handle records the
  adoption (`adoptedManager: true` on the handle state) so that:
  - the handle's cleanup does NOT dispose, reset, or unregister another
    owner's manager (it revokes its own runtime's auth scope via
    `flushRuntimeAuthScope`, runs its own provider-file lifecycle for files
    ITS sessions uploaded, and calls `onCleanup` — mirroring fromConfig's
    existing caller-owned-Config discipline, REQ-001.3, now extended to the
    manager);
  - verbs executed through the handle against the adopted manager use the
    manager itself (it is in hand) plus the HANDLE's settings/config for
    identity-resolution reads — exactly what the ambient registry produced
    today, where the isolated entry carried the adopted manager under the
    ISOLATED runtimeId while the foreground entry carried the same manager
    under its own;
  - the foreground owner that built the Config keeps working: its manager is
    not reset by the adopting handle's cleanup (this is census §8 row 6's
    no-reset outcome, now guaranteed structurally rather than by
    reset-first ordering).
  When the Config has NO manager, the isolated runtime constructs its own
  (fresh ownership, §R1a sequence 2).
- **Cleanup responsibility, per case**: (a) fresh isolated runtime (manager
  constructed by the handle): handle cleanup owns manager teardown effects
  per the §8 table rows keyed to the disposing owner's own entry;
  (b) adopted manager (fromConfig): handle cleanup owns ONLY its own scope
  and files, never the adopted manager; (c) birthed-then-copied providers
  (createAgent): final handle owns everything; temporary manager owns
  nothing; (d) CLI foreground: `assembleCliProviderRuntime` bundle owner
  owns registration, re-registration (post-config re-seed), and disposal
  per the §8 table.

Required tests (REAL production entry points, not independently constructed
runtimes — extend `providerManagerAdoption.behavior.test.ts` and the agent
API suites): (i) `createAgent(...)` end-to-end: a Kimi-style upload through
a provider that was birthed via the temporary manager registers files on the
FINAL owner's lifecycle; session cleanup through the agent's chatSession
sweeps them; auth reads through the agent's OAuth flows resolve the FINAL
owner's accessor (ephemeral setting + profile name isolation against a
concurrently live foreground); after `agent.dispose()`/cleanup, further
operations fail fast per §R1h. (ii) `fromConfig(...)` with a Config carrying
a live manager: isolated auth reads use the adopting runtime's accessor;
cleanup of the adopting agent leaves the FOREGROUND owner's manager usable
(surviving foreground ownership — a provider call through the foreground
succeeds after the agent is disposed; no singleton reset); repeated
create/dispose cycles of adopting agents do not disturb the foreground.
(iii) The same suites against a Config WITHOUT a manager (fresh-construction
branch).

**R1h. Disposed-owner liveness and revocation (NEW — fail-fast needs a
mechanism).** Today nothing makes a disposed owner's services fail: closures
over captured services remain callable after disposal;
`buildOAuthRuntimeAccessors`' closures CATCH missing-runtime errors and
supply defaults (oauth-runtime-accessors.ts:43-51 `getProviderManager` →
`undefined`; :60-69 `getCurrentProfileName` → `null`; :73-83
`getInteractiveAuthTimeoutMs` → default; :85-92 browser-profile →
`undefined`); and `resolveCurrentProfileName` (token-profile-resolver.ts:27-43)
BYPASSES the accessor entirely when `requestedProfileName` is set (:31-33)
or catches it returning `null` (:34-42). Cleanup has only `cleanupRequired`
+ reset-after-success (runtimeContextFactory.ts:456-458, :494) — no
liveness/admission contract. Design:

- **Owner-owned lease**: each owner state cell carries a lease
  (`{ state: 'active' | 'cleanup-pending' | 'disposed', generation: number }`).
  `activate()` bumps the generation and sets `active`; successful `cleanup()`
  sets `disposed`; a cleanup that THROWS leaves `cleanup-pending` with
  `cleanupRequired` still true (today's retry semantics, runtimeContextFactory.ts:456-458,
  :494), so cleanup can be re-run; a re-`activate()` after cleanup starts a
  NEW generation and returns the lease to `active` (today the handle is
  re-activatable — preserved). Terminal agent disposal is a separate
  `disposed` state that reactivation of the SAME handle does not clear.
- **Where each operation checks**: at EVERY public auth/token/provider
  operation entry — `OAuthManager` public methods, `TokenAccessCoordinator`
  token operations, `AuthStatusService` status reads, `ProviderManager`
  call/switch/mutation entries, and the per-owner accessor closures (which
  check their captured generation against the lease before touching
  services). The check throws the typed `ProviderRuntimeDisposedError` (new,
  in messages.ts alongside `MissingProviderRuntimeError`, carrying the
  runtimeId and generation).
- **What must ESCAPE the existing catches**: with per-owner accessors the
  leaf closures no longer resolve ambient identity, so their
  missing-runtime try/catch arms are deleted with the ambient design (R1a).
  The disposal error must propagate through the auth cluster: readers that
  keep a catch for VALUE-ABSENT fallbacks (a live owner with no profile name
  → `null`; no timeout setting → default) catch ONLY non-disposal failures —
  the typed disposal error is never swallowed. `resolveCurrentProfileName`'s
  explicit-profile branch (token-profile-resolver.ts:31-33) checks the lease
  FIRST even though it bypasses the accessor — an explicitly-requested
  profile through a disposed owner must fail, not silently succeed off
  captured state.
- **Fallbacks that remain**: only for genuinely-optional reads against LIVE
  owners (setting absent → default; no current profile → `null`), and only
  when the owner is active. No fallback fabricates services for a
  disposed/missing owner (fail-fast rule below).
- **Fail-fast**: where a caller arrives with no explicit service, throw
  `MissingProviderRuntimeError` (messages.ts) — the PR A pattern. No ambient
  probe, no fallback fabrication.

Tests: public auth/token operations through a disposed owner — token-profile
resolution (both branches: ambient-current and explicitly-requested profile),
ephemeral auth settings reads through the owner's collaborators
(`auth.noBrowser`, browser-profile association), auth-status reads, token
request flows — all fail with the typed disposal error, never borrow
foreground credentials, never return value-absent defaults; cleanup-failure →
retry succeeds → then disposed; reactivate → operations succeed again
(generation bump); terminal disposal stays dead. Not just a direct accessor
throw.

### §R2. Verb migrations and UI bindings

**Threading patterns (PR A-consistent):**

- **CLI foreground**: `BootstrapRuntimeState`/assembled bundle already owns
  `settingsService`, `config`, `providerManager`, `oauthManager`,
  `runtimeMessageBus`. `RuntimeContextProvider` gains explicit service props
  threaded from `cliBootstrap.tsx` → `App.tsx` (`:96`); the `runtimeFunctions`
  bag (RuntimeContext.tsx:70-108) is rebuilt as closures over those props.
  **The `useRuntimeApi`/`getRuntimeApi` TRANSPORT signatures are unchanged
  (same hook/function names, same `RuntimeApi` type name), but the API's
  member set shrinks**: every banned accessor name is removed from the api
  and replaced by narrow explicit operations/props (UI-bag inventory below).
  The ~21 `useRuntimeApi` hook consumers and the 24 `getRuntimeApi`
  production consumers do NOT all stay untouched — every one that calls a
  banned name migrates in the same commit that deletes that name.
- **Agents**: verbs (`switchActiveProvider`, `setActiveModel*`,
  `applyCliArgumentOverrides`, `updateActiveProviderApiKey/BaseUrl`,
  `setProviderApiKey/BaseUrl`) gain a required narrow first parameter — the
  fields they actually use, e.g. `{ config, settingsService, providerManager }`
  for switch, `{ config, settingsService }` for the key/base-url mutators.
  Callers pass the handle/config-owned services they already hold
  (`providerActivationExecutor.ts`, `agentImpl.ts`, `subagentOrchestrator.ts`
  via the handle; `profileApplication.ts` via its existing
  `runtimeServices` parameter). No bag type is introduced; `CliRuntimeServices`
  is deleted.
- **Per-owner identity/kind**: `ProviderManager` construction input gains
  `runtimeKind` (+ the R1b lifecycle); the auth-flow-orchestrator and
  token-access-coordinator read kind from their owning manager (`facadeRef`
  chain) instead of `getActiveRuntimeKind()`; `AllBucketsExhaustedError`
  receives the kind from RetryOrchestrator.ts:851-860 (R1d) and the
  interactive-auth requester receives the owner identity
  (interactive-auth-request.ts:68-79, R1d) — both read at use time from the
  owner state cell because activation overrides runtimeId/kind after
  construction (runtimeContextFactory.ts:374-387).
  `active-runtime-identity.ts` (the resolver seam registered at
  runtimeRegistry.ts:222-226) is deleted.
- **Fail-fast**: where a caller arrives with no explicit service, throw
  `MissingProviderRuntimeError` (messages.ts) — the PR A pattern. No ambient
  probe, no fallback fabrication.

**UI-bag consumer inventory + migration (NEW — the guard matches property
names, so "UI consumers stay unchanged" was false).** The guard builds
`BANNED_PATTERN = new RegExp(BANNED_AMBIENT_SYMBOLS.join('|'))`
(scripts/tests/ambient-runtime-symbols-guard.ts:47) and flags per-line
matches INCLUDING property accesses (`runtime.getCliRuntimeServices()` —
matcher at :93-99). Deleting `getActiveProviderStatus`/`getCliRuntimeServices`/
manager accessors from the bag while leaving their callers would trip the
guard and violate the issue's bag prohibition. Production consumers at this
HEAD (verified by rg over `packages/cli/src`, excluding tests):

| Banned member | Production consumers (file:line) | Narrow replacement |
|---|---|---|
| `getActiveProviderStatus` | `ui/containers/SessionController.tsx:89,125,251`; `ui/components/Footer.tsx:365`; `ui/utils/modelIdentity.ts` (imports + :43,191) | a narrow `activeProviderStatus()` read on the bridge api returning the fields those callers destructure (provider name, model, auth state) — new name, no ambient resolution, closure over service props |
| `getCliRuntimeServices` | `ui/hooks/useResolvedWorkspaceDirectories.ts:24,31,37`; `ui/hooks/useProfileManagement.ts:161`; `ui/hooks/useOpenAIProviderInfo.ts:38` | `workspaceDirectories()` (settings/config read), explicit profile ops, `openAIProviderInfo()` — each hook gets ONLY the operation it used the bag for |
| `getCliProviderManager` | `ui/commands/authCommand.ts:554`; `ui/commands/aboutCommand.ts:29,109`; `ui/commands/diagnosticsCommand.ts:262`; `ui/commands/statsQuota.ts:154`; `ui/hooks/useWelcomeOnboarding.ts:87,305,360` (+ `useWelcomeOnboarding.bun.tsx:16,29`); `ui/components/LBStatsDisplay.tsx:230-232`; `ui/utils/modelIdentity.ts:48,130,199` | explicit `providerManager` prop on the React bridge for the few surfaces that legitimately need the manager itself (modelIdentity, LB stats), narrow auth/provider operations elsewhere (`providerLabel()`, `providerConfig()`, `runAuthStatus()`) |
| `getCliOAuthManager` / `maybeGetCliOAuthManager` | `ui/commands/authCommand.ts:86`; `ui/commands/logoutCommand.ts:63`; `ui/commands/quotaCommand.ts:85`; `ui/commands/statsCommand.ts:171`; `ui/commands/diagnosticsCommand.ts:32,488`; `ui/commands/diagnosticsTokens.ts:167`; `ui/commands/statsQuota.ts:26,334`; `ui/containers/AppContainer/hooks/useUpdateAndOAuthBridges.ts:66` (receives the getter as a PARAMETER in `UseUpdateAndOAuthBridgesParams`, uses it at :156-250); `ui/hooks/useAppBootstrap.ts:252` (passes it down); `ui/hooks/useAppInput.ts:306`; `ui/hooks/useWelcomeOnboarding.ts:369`; `ui/components/AuthDialog.tsx:175,270` | narrow auth operations: `getAuthStatus(provider)`, `authenticate(provider)`, `logout(provider)`, `getOAuthConnections()` — command files and dialogs call operations, not the manager; `useUpdateAndOAuthBridges`/`useAppBootstrap` thread an `oAuthOps` object instead of the getter |

Migration rule: each consumer above migrates **in the SAME commit that
deletes the accessor it calls** (the verb-migration commits and the
bag-rebuild commit are where these land — mapped in the commit ledger). The
bag's whole-services getters (`getCliRuntimeServices`, `getCliRuntimeContext`)
are NOT renamed into new bag-shaped getters — wholesale bag access actually
disappears; the replacements are narrow operations or explicit props closed
over the current service props. `getRuntimeApi` consumers (the 24
`ui/commands/*` files, `ProfileCreateWizard/utils.ts`, `SessionController.tsx`)
are covered by the same commits: a command migrates when its verb/accessor
family's commit lands. `NO_ACTIVE_PROVIDER_ERROR_MESSAGE` (useProviderDialog)
is a pure const and moves to a focused module.

**Verb-migration commits.** One commit per verb family; each moves ALL of its
callers (cli + zed-acp + agents), deletes the accessor(s) whose last
production use was that family, and adds its guard names — same commit:

1. `switchActiveProvider` family (providerSwitch.ts:881 entry, ambient reads
   at :549,567,615,804): cli bag consumers + agents
   `agentImpl`/`providerActivationExecutor`; deletes the family's last
   ambient reads; context gains `oauthManager?` + `runtimeKind` fields
   populated by its callers. (Correction: `useUpdateAndOAuthBridges` surfaces
   are NOT in this commit for `registerCliProviderInfrastructure` — no
   production call exists; they are in the OAuthManager-accessor migration
   per the inventory above.)
2. `setActiveModel` / `setActiveModelParam` / `clearActiveModelParam` /
   `applyCliArgumentOverrides` / `updateActiveProviderApiKey/BaseUrl` /
   `setProviderApiKey/BaseUrl` family (providerMutations.ts:417-420 & kin):
   cli bag verbs, agents `agentImpl` incl. dynamic imports at `:454,468`.
3. `applyProfileSnapshot` / `loadProfileByName` family
   (profileSnapshot.ts:593-597 & the :233,241,602,681,759-777 ambient reads):
   `profileRuntimeApplication.ts`, `cliProviderInit.ts`, `profileBootstrap.ts`,
   `zed-initialize.ts`, isolated-path callers via handle services.
4. Ephemeral/session/model-param-read/provider-query/listProviders/metrics
   families: cli bag closures rebuilt over service props; `modelIdentity.ts`
   consumes the bridge api; `postConfigRuntime.ts:346` reads
   `runtimeState.runtime`; the second `setCliRuntimeContext` folds into the
   `assembleCliProviderRuntime` re-seed it already performs (:251,:260).
5. zed-acp handoff (`runZedIntegration.ts:118-123`): the
   `allowDefaultHandoff` pointer swap becomes an explicit re-register of the
   bridge accessors/re-seed callback from the new config — explicit
   replacement, no pointer. `cliSessionBootstrap.ts` follows the same shape.
6. Pure importers repoint to focused modules (`setCommand`,
   `setCommandSchema`, `toolformatCommand`, `ModelConfigDialog`,
   `useProviderDialog`, `zed-config-options`); `package.json` exports trimmed
   for exactly the modules whose last import this commit migrates.

**RuntimeContext bag rebuild.** `RuntimeContext.tsx`: provider takes service
props; bag closures built at the composition site;
`registerCliProviderInfrastructure` drops out of the bag — it has NO
production UI caller at this HEAD (census §5), so nothing needs the
"re-seed callback" replacement in the UI; the non-UI re-seed (post-config)
folds into the reassembled bundle per verb commit 4. Today's bag api is
derived by `makeRuntimeApi` (`:139-167`) wrapping every `runtimeFunctions`
entry in `runWithRuntimeScope`; the rebuild must preserve that scoping while
closing over the CURRENT props (no stale closures across re-seed — see §Test
strategy bag tests). The module-level `latestBridge` pointer
(RuntimeContext.tsx:187) is later-lane scope (carry-over register), unchanged
here.

### §R3. Cluster deletion

1. Delete `runtimeRegistry.ts`, `runtimeAccessors.ts`, `runtimeSettings.ts`
   (its remaining re-exports; the `registerIsolatedRuntimeBindings` side
   effect at :197-205 is deleted in this SAME commit together with the
   `activationBindings` dissolution — see the commit plan),
   `active-runtime-identity.ts`, and `runtime-accessor-bridge.ts` (R1a);
   delete `registerCliProviderInfrastructure`, `setCliRuntimeContext`,
   `resetCliProviderInfrastructure` from `runtimeLifecycle.ts`
   (`activateIsolatedRuntimeContext` keeps scope+activate, minus the upsert);
   dissolve `activationBindings` in `runtimeContextFactory.ts` per R1f
   (the merged final commit); drop the deleted exports from `providers/src/index.ts`
   (`cleanupProviderFilesForSession` is replaced by the bundle-owned
   lifecycle method) and from `packages/providers/package.json` exports.
2. `runtime/index.ts` (`export * from './runtimeSettings.js'`) is replaced by
   exports of the surviving focused modules or removed with `./runtime.js`
   from `package.json` — no re-export shim either way.
3. Guard extension (§Guard) lands its final pieces with this commit (the
   deleted-specifier bans; per-verb name additions already landed with their
   verb commits), plus the acceptance scans.

## Commit plan (dependency-ordered; the one PR's bisectable series)

Each commit typechecks and leaves affected package tests green; guard names
and accessor deletions land with the verb commit that obsoletes them
(same-commit rule). Full cycle + smoke at the PR head (and per review
section where feasible).

**Per-commit caller/export/side-effect ledger (binding)**. Every commit
below carries a ledger entry naming: (a) files/exports deleted, (b) every
production caller moved and where to, (c) every side effect deleted
(module-load side effects, registration functions AND their call sites,
`package.json` export entries), (d) guard names added, (e) why the
intermediate state typechecks and tests green. Before a commit adds a global
name ban, it re-runs the name scan for that symbol over ALL production
sources (including property-name usage and UI bag re-exports — the guard's
substring matcher at scripts/tests/ambient-runtime-symbols-guard.ts:47,93-99
flags both) and the commit message records the scan's empty result. A side
effect is deleted in the SAME commit as its target implementation, or the
commits merge.

1. **R1b** — lifecycle ownership: bundle constructors own
   `ProviderFileLifecycle`; manager field; OpenAIProvider reads it from the
   manager; `chatSession.ts:793` via the bundle; kimi suites repoint.
   LEDGER: during the transition the bundle's lifecycle instance populates
   the EXISTING `upsertRuntimeEntry` `providerFileLifecycle` field (the
   bundle constructors pass their instance through the writer inputs), so
   runtimeRegistry.ts:258-264's `new ProviderFileLifecycle(...)` arm never
   fires for bundle-constructed runtimes — ONE shared instance per
   runtimeId, no dual allocation, until commit 13 deletes the upsert.
2. **R1a** — OAuth per-owner accessors: builder rewrite, OAuthManager
   injection chain (construction-input ordering per the three sequences),
   all bridge consumers migrate, bridge + registration function deleted
   (oauth-runtime-accessors.ts:104-106 AND its call at
   runtimeLifecycle.ts:249-252 in THIS commit), spec helpers repoint,
   interleaving/disposal/construction-branch tests added.
3. **R1c** — stateless preference threading; behavior tests rewritten, only
   Map-plumbing assertions deleted.
4. **R1d** — runtimeKind/identity threading (errors.ts via
   RetryOrchestrator.ts:851-860; interactive-auth-request.ts:68-79
   requester; token-access-coordinator, auth-flow-orchestrator reading the
   owner state cell); kind/undefined/no-auth/match-mismatch tests.
5. **R1e** — #3222 boundary: singleton registration at construction sites;
   disposal seam per the census §8 characterization table with the
   foreground registration passed explicitly; one characterization test per
   table row.
6. **R1g/R1h** — ownership/adoption (owner-services cell into
   `registerProvidersOntoManager` + fromConfig adoption semantics + lease)
   and the liveness/revocation contract; real createAgent/fromConfig
   adoption tests and disposed-owner public-operation tests. (May split into
   two commits at implementation if the lease lands before the cell threading;
   the ledger records which tests ride with which.)
7. **R2.1** — switch family (all callers cli+zed+agents; last ambient reads
   deleted; guard names added).
8. **R2.2** — model/key/base-url mutation family (same rules).
9. **R2.3** — profile snapshot/load family (same rules).
10. **R2.4** — ephemeral/query/metrics families + bag rebuild +
    `modelIdentity` + `postConfigRuntime` re-seed fold (guard names added;
    bag tests added; the §R2 UI-bag inventory rows for
    `getActiveProviderStatus`/`getCliRuntimeServices` migrate here or with
    their family's commit — per the ledger's same-commit mapping).
11. **R2.5** — zed handoff + `cliSessionBootstrap` explicit registration
    shape.
12. **R2.6** — pure importers repoint; `package.json` exports trimmed for
    fully-migrated modules.
13. **R3.1+R3.2 (merged)** — `activationBindings` dissolution AND cluster
    file deletion in one commit: deleting `registerIsolatedRuntimeBindings`
    (runtimeContextFactory.ts:273-277) while runtimeSettings.ts:197-205
    still imports and calls it would be a non-green intermediate, so the
    runtimeSettings.ts:197-205 import+call, the activationBindings
    dissolution, the cluster file deletions, `index.ts`/`package.json`
    cleanup, deleted-specifier guard bans, and acceptance scans all land
    together (or 12/13 split ONLY if the runtimeSettings side-effect removal
    moves into the earlier commit). `#2300` invariant test, no-ALS test, and
    disposed-owner tests finalized here (they may land earlier where the
    seams exist).

## Guard extension

`scripts/tests/ambient-runtime-symbols-guard.ts`. Correction of the record:
the existing guard does NOT match "exact identifiers" — it builds
`BANNED_PATTERN = new RegExp(BANNED_AMBIENT_SYMBOLS.join('|'))`
(scripts/tests/ambient-runtime-symbols-guard.ts:47), i.e. **substring
matching** evaluated per line (:93-99), which catches property-name usage
(`runtime.getCliRuntimeServices()`), not just imports. PR C's additions
inherit that semantics, which drives several rules below — and is why the
UI-bag inventory (§R2) must land its migrations before/with each ban.

**Name list** — join `BANNED_AMBIENT_SYMBOLS` (the `it.each` negative-control
fixture generation picks each up automatically, as PR B's names did):

```
'runtimeRegistry', 'defaultCliRuntimeId', 'resolveActiveRuntimeIdentity',
'upsertRuntimeEntry', 'requireRuntimeEntry', 'disposeCliRuntimeRegistration',
'resetCliRuntimeRegistryForTesting',
'clearDefaultCliRuntimeId', 'resetDefaultCliRuntimeIdForTesting',
'getCliRuntimeServices', 'getCliRuntimeContext', 'getCliRuntimeConfig',
'getCliProviderManager', 'getCliOAuthManager', 'maybeGetCliOAuthManager',
'isCliRuntimeStatelessReady', 'ensureStatelessProviderReady',
'getActiveProviderStatus',
'setDefaultCliRuntimeId', 'getDefaultCliRuntimeId',
'registerCliProviderInfrastructure', 'setCliRuntimeContext',
'resetCliProviderInfrastructure', 'CliRuntimeServices',
'registerActiveRuntimeIdentityResolver', 'getActiveRuntimeIdentity',
'getActiveRuntimeKind', 'activationBindings', 'registerIsolatedRuntimeBindings'
```

Deltas vs the guard as it stands after PR B, with reasons:

- ADDED `clearDefaultCliRuntimeId`, `resetDefaultCliRuntimeIdForTesting`
  (test-only outside the cluster today; deleted with the registry, and the
  substring matcher should keep them from creeping back via test helpers in
  production paths).
- ADDED `getActiveProviderStatus` — aligning the guard with acceptance scan 1,
  which already bans it in production sources; no retained function of this
  name exists in the end state (its callers migrate per the §R2 inventory:
  bridge api / explicit services).
- REMOVED from the earlier draft's list: `resolveActiveProviderName`. A pure
  port function of that exact name is RETAINED (the #2534 settings-store-wins
  order, as a pure function of `{ settingsService, providerManager }`), so a
  blanket name ban would flag legitimate code. Instead the AMBIENT
  implementation disappears with `runtimeAccessors.ts`, enforced by the
  deleted-specifier import ban below plus a positive control proving the pure
  port's import passes.
- `getActiveRuntimeKind` stays on the list: the ambient reader is deleted even
  though the concept (per-owner kind field) survives.
- Do NOT add the surviving verb names (`switchActiveProvider`, `setActiveModel`,
  `setEphemeralSetting`, …) — they survive as port-shaped functions.
- Keep avoiding the bare words `runtimeSettings` / `runtimeAccessors` in the
  name list: with the substring matcher, `runtimeSettings` would flag core's
  surviving `createRuntimeSettingsService`.
- Per the commit ledger: a name joins the list ONLY in the commit that
  deletes its last production use, after the commit's scan (imports,
  property usage, bag re-exports) returns empty.

**Deleted-specifier ban** (replaces the earlier draft's whole-`/runtime`
import-prefix ban, which would ALSO have banned retained focused subpaths —
e.g. `runtime/profileApplication.js`, used at
agents/src/core/subagentOrchestrator.ts:66 and retained per census §2/§9).
Ban EXACT deleted specifiers only:

- Package specifiers: `@vybestack/llxprt-code-providers/runtime` and
  `@vybestack/llxprt-code-providers/runtime.js` (root barrel) plus the
  deleted deep subpaths `…/runtime/runtimeRegistry`,
  `…/runtime/runtimeAccessors`, `…/runtime/runtimeSettings`, and
  `…/runtime/active-runtime-identity` (note the actual `runtime/` path
  spelling for the last one).
- Relative-import variants within the monorepo (e.g. `./runtimeRegistry.js`,
  `./runtimeAccessors.js`, `./runtimeSettings.js`,
  `./active-runtime-identity.js`, `./runtime.js`, `../runtime/…` forms).
- Matching forms, each with a fixture: single-quoted and double-quoted static
  imports, dynamic `import('…')`, and `export … from '…'`. Exact-specifier
  equality (after optional `.js` normalization) against the quoted source
  text — NOT the substring name regex, so legitimate deep paths cannot
  collide.
- Positive controls (must PASS, added to the guard's spec): allowed deep
  subpaths (`@vybestack/llxprt-code-providers/runtime/profileApplication.js`,
  `runtime/providerSwitch.js`, `runtime/profileSnapshot.js`,
  `runtime/providerConfigUtils.js`) and core's
  `createRuntimeSettingsService`.

Update the list-alignment test at the bottom of the guard's spec for both the
name additions and the new specifier list.

## Test strategy

**Deleted (mechanism-pinning only)**: `runtimeRegistry.spec.ts`
(registry/identity/pointer suites; the provider-file disposal suites migrate —
see below), `runtimeIdentityResolution.behavior.test.ts`,
`explicitRuntimeId.behavior.test.ts` (explicit-id-through-ambient-registration
plumbing — obsolete when identity is always a parameter),
`isolatedRuntimeDefaultPointer.behavior.test.ts` (replaced, below),
`runtimeLifecycle.spec.ts`'s `setCliRuntimeContext` /
`registerCliProviderInfrastructure` / `resetCliProviderInfrastructure` suites,
`runtimeContextFactory.setRuntimeContext.test.ts`'s registry-write assertions,
`__tests__/issue2891-lazy-oauth-gating.test.ts`'s pointer-reset scaffolding
(behavior repointed to explicit per-owner accessor injection). In
`statelessHardening.spec.ts`, delete ONLY the registry-Map-plumbing
assertions; the normalization/override/precedence behavior suites stay and
are rewritten to thread owner metadata explicitly (census §7).

**Rewritten (observable repoints, PR B disposalProbe-style)**: the registry
spec's provider-file disposal behavior (refuse deregistration while session
files retained; await deferred deletions; per-runtime lifecycle isolation) is
re-homed against the per-owner seams — `assembleCliProviderRuntime` failure
unwind and `createIsolatedRuntimeContext(...).cleanup()` — with the same
assertions minus the Map. `oauth-runtime-accessors.spec.ts` rewritten against
the explicit-closure builder (`buildOAuthRuntimeAccessors(ownerServices)`).
`runtimeAccessors.spec.ts`'s pinned contract — settings-store `activeProvider`
wins over the manager cache (the #2534 C3 order) — survives as a test of the
pure `resolveActiveProviderName({settingsService, providerManager})` port.
The ~48 external + 52 providers-internal `vi.mock` factories and spec
scaffolds (`profileApplicationTestSetup`, `lbProfileApplicationTestSetup`,
`oauth-manager.issue1468.test-helpers.ts`) repoint from ambient accessors and
the bridge singleton to the ACTUAL replacement imports (port-shaped verbs,
injected accessor instances), RETAINING their behavior assertions. Reminder:
the ~100 test-file census undercounts helpers and root-barrel imports; no
speculative broad test deletion — only the named mechanism-pinning suites
above.

**New behavior tests**:

1. The #2300 invariant cross-runtime non-interference test (census §6),
   through `assembleCliProviderRuntime` + `createIsolatedRuntimeContext`
   public entry points.
2. Disposed-owner coverage (census §6 / §R1h): the typed disposal failure
   through the owner's PUBLIC auth/token/provider operations — provider
   switch/model set/ephemeral write AND auth reads (token-profile resolution
   through BOTH branches — ambient-current and explicitly-requested profile —
   plus ephemeral auth settings via that owner's collaborators) — FAILS fast
   without consulting the foreground; assert no foreground credentials are
   borrowed. Cleanup-failure → retry → disposed; reactivate → alive again.
3. No-ALS-scope execution (issue acceptance 4): a formerly-ambient consumer
   runs entirely outside any scope with explicit inputs and succeeds.
4. OAuth per-owner accessor tests (R1a): interleaved foreground/A/B reads
   while all three are active; disposal in both orders; disposed-owner auth
   read borrows nothing; construction-branch wiring for all three sequences
   (CLI/assemble, isolated-fresh, isolated-supplied-OAuth, plus the
   adopted-manager and createAgent-temporary branches under item 6).
5. Adoption/transfer tests (R1g) — REAL production entry points, not
   independently constructed runtimes: `createAgent` uploads/auth/cleanup
   against the FINAL owner's lifecycle and accessor (temp-manager birthed
   providers); `fromConfig` with an adopted manager — isolated auth reads,
   cleanup leaves the foreground owner's manager usable (surviving foreground
   ownership, no singleton reset), repeatable create/dispose; the
   Config-without-manager fresh branch. Extend
   `providerManagerAdoption.behavior.test.ts` and the agent API suites.
6. `RuntimeContext.tsx` bag tests (R2): prop replacement/re-seed (new service
   props replace old closures — no stale-closure reads of replaced
   services); manager replacement under the SAME runtimeId (re-seed builds a
   new manager; bag closures must resolve to the new manager, not a captured
   old one); two mounted `RuntimeContext`s simultaneously (each bridge sees
   its own props); and the UI-bag inventory rows — each migrated hook/command
   (SessionController, Footer, modelIdentity, useResolvedWorkspaceDirectories,
   useProfileManagement, useOpenAIProviderInfo, useWelcomeOnboarding(+.bun),
   LBStatsDisplay, AuthDialog, useAppInput, useAppBootstrap,
   useUpdateAndOAuthBridges, the `ui/commands/*` family) keeps its observable
   behavior against the narrow operations. Preserving `useRuntimeApi`'s NAME
   alone is insufficient: today's derivation is `makeRuntimeApi` at
   `:139-167` wrapping every `runtimeFunctions` entry in
   `runWithRuntimeScope`, and the rebuilt bag must keep that scoping while
   tracking current props — with the banned names GONE from the api type.
7. activationBindings dissolution tests (R1f/R3 final commit), preserving:
   prepare-before-register sequencing (link after registration);
   partial-activation `cleanupRequired` handling; scoped auth revocation
   (`flushRuntimeAuthScope`); `onCleanup` ordering (resetInfrastructure →
   revocation → `onCleanup`); deferred provider-file cleanup waits; retry
   after cleanup failure — grounded at runtimeContextFactory.ts:366-437
   (activation closure), :448-494 (cleanup closure, reset at :469, flush at
   :473-475, onCleanup at :477-485, dispose at :487-491, flag at :494).
8. errors runtimeKind tests (R1d): every kind, `undefined`, and
   `hasAuthReason === false` cases; per-kind `AllBucketsExhaustedError`
   message assertions THROUGH the RetryOrchestrator.ts:851-860 construction
   path (not a hand-built error); requester `runtimeId` presence/absence
   through interactive-auth-request.ts:68-79 for kind match/mismatch and
   `undefined` identity, including after an activation override of
   runtimeId/kind (runtimeContextFactory.ts:374-387).
9. Disposal-seam characterization tests (R1e): ONE test per row of the
   census §8 table (complete/partial/absent foreground registration ×
   disposing-owner-carried-manager × adopted-manager case × post-handoff
   disposal), asserting the exact today-behavior recorded in the row's cell;
   any intentional deviation rides as a separately justified bug-fix test
   with its own description.

**Must stay green**: profileApplication/profileSnapshot suites (behavior via
ports), provider-alias-defaults suites, zed-acp cleanup/session suites,
`authRuntimeScope.test.ts` (packages/auth ALS scoping survives), agents
behavior suites, the new invariant/disposed-owner/adoption tests, and the
issue-level S1/S2 gates per #3633 when they land.

## Acceptance criteria

1. Scans return nothing on production sources (`packages/*/src`,
   `--glob '!**/*.test.*' --glob '!**/*.spec.*'`):
   - `rg -n "getCliRuntimeServices|getCliRuntimeContext|getCliRuntimeConfig|getCliProviderManager|getCliOAuthManager|maybeGetCliOAuthManager|isCliRuntimeStatelessReady|ensureStatelessProviderReady|getActiveProviderStatus|resolveActiveRuntimeIdentity|registerCliProviderInfrastructure" packages/*/src`
   - `rg -n "runtimeRegistry|defaultCliRuntimeId" packages/*/src`
   - Deleted-specifier scans (exact normalized matchers — the
     whole-`/runtime`-prefix scan from the earlier draft is RETIRED because
     it contradicts the retained-subpath design: `runtime/profileApplication.js`
     at agents/src/core/subagentOrchestrator.ts:66 must KEEP importing). The
     deleted specifier set is EXACTLY: the root barrel (`runtime` /
     `runtime.js`) and the four deleted deep subpaths
     (`runtime/runtimeRegistry`, `runtime/runtimeAccessors`,
     `runtime/runtimeSettings`, `runtime/active-runtime-identity`) — note
     `runtime/runtimeLifecycle` is NOT in the set (the module survives with
     `activateIsolatedRuntimeContext` and `isMissingRuntimeError`), and
     neither are the retained subpaths (`runtime/profileApplication`,
     `runtime/providerSwitch`, `runtime/profileSnapshot`,
     `runtime/providerConfigUtils`, …). Each scan covers static
     single/double-quoted imports, dynamic `import('…')`, and
     `export … from '…'` (all are quoted strings, so one quoted-form regex
     per family suffices), with optional `.js` normalization:
     - `rg -n "['\"]@vybestack/llxprt-code-providers/runtime(\.js)?['\"]" packages/*/src` (root barrel, absolute)
     - `rg -n "['\"]@vybestack/llxprt-code-providers/runtime/(runtimeRegistry|runtimeAccessors|runtimeSettings|active-runtime-identity)(\.js)?['\"]" packages/*/src` (deleted deep subpaths, absolute)
     - `rg -n "['\"]\.{1,2}/runtime(\.js)?['\"]" packages/providers/src` (root barrel, relative, inside providers)
     - `rg -n "['\"](\./|(\.\./)+runtime/)(runtimeRegistry|runtimeAccessors|runtimeSettings|active-runtime-identity)(\.js)?['\"]" packages/*/src` (deleted deep subpaths, relative: `./runtimeRegistry.js` from within `runtime/`, `../runtime/runtimeRegistry.js` and deeper `../../runtime/…` from sibling dirs like `auth/`, `openai/`, `composition/`)
   - `rg -n "activationBindings|registerIsolatedRuntimeBindings|active-runtime-identity" packages/*/src`
   - `rg -n "oauthRuntimeBridge" packages/*/src` (singleton bridge gone; all
     auth-cluster access per-owner)
   - POSITIVE CONTROLS stay green: `rg -n "providers/runtime/(profileApplication|providerSwitch|profileSnapshot|providerConfigUtils)\.js" packages/*/src`
     must still return the retained-subpath consumers (e.g.
     subagentOrchestrator.ts:66).
2. The extended guard passes in CI with per-symbol negative controls AND the
   deleted-specifier fixtures (single/double quotes, dynamic import,
   export-from) plus their positive controls (allowed deep paths, core's
   `createRuntimeSettingsService`); its list-alignment test names the PR C
   additions and the specifier list.
3. Zero module-level mutable runtime identity/state in
   `packages/providers/src/runtime/` for the deleted cluster
   (`statelessHardeningPreferenceOverride` and `sharedTokenStore`/
   `agentRuntimeFactoryBindings`/`runtimeCounter` remain, listed in the
   carry-over register with owners: criterion-3 sweep / #3222).
4. The #2300 invariant test, the no-ALS-scope test, the disposed-owner
   tests (public auth/token operations incl. the explicit-profile branch),
   the OAuth per-owner tests (all construction branches), the
   adoption/transfer tests (real createAgent/fromConfig paths with uploads,
   auth reads, cleanup, and surviving foreground ownership), and the
   disposal-seam characterization tests (one per §8 table row) pass.
5. `packages/providers/package.json` no longer exports deleted subpaths;
   `bun`/`import` entries resolve for every remaining one.
6. Full local cycle green at the PR head — `npm run test`, `npm run lint`,
   `npm run typecheck`, `npm run format`, `npm run build` — plus the smoke:
   `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and
   nothing else"` (issue text says "StepFun smoke"; StepFun was cancelled
   2026-09-13, current recorded profile is zai-glm-flash per
   .llxprt/LLXPRT.md). Every commit in the series typechecks and leaves
   affected package tests green (bisectability; the per-commit ledger in
   §Commit plan is the evidence).

## Open questions

- **OQ1 — split into sub-PRs?** RESOLVED: one PR, dependency-ordered commits,
  named review sections. See §PR shape decision.
- **OQ2 — singleton disposal ownership at the seam?** RESOLVED (rewritten):
  NOT an identity comparison — the disposal seam reproduces the exact
  characterization table of census §8 (complete/partial/absent foreground
  registration × disposing-owner-carried-manager × adopted-manager ×
  post-handoff), with the foreground registration passed explicitly at the
  seams (no new global). One characterization test per row; deviations are
  separately justified bug fixes. See census §8 / R1e.
- **OQ3 — errors.ts runtimeKind?** RESOLVED: explicit threading from the
  RetryOrchestrator.ts:851-860 construction site and the
  interactive-auth-request.ts:68-79 requester (owner state cell, use-time
  reads, activation overrides preserved); message formatting preserved
  exactly, including the `undefined`-kind branch and the requester's
  kind-match conditional; no silent coercion, no prose changes. See R1d.
- **OQ4 — OAuth accessor injection ordering?** RESOLVED: accessor wiring is
  a construction INPUT to `createProviderManager` (and, reordered, to
  `createIsolatedRuntimeContext`); the earlier "constructor parameter vs
  post-construction setter" question and the "inject immediately after
  :156" option are deleted — post-return injection lands after provider
  registration (providerManagerInstance.ts:613-626 precede the :644 return)
  and is invalid. The three per-factory sequences are in R1a.
- **OQ5 — ownership on adoption/transfer?** RESOLVED: the FINAL owner's
  owner-services cell threads into temporary provider construction
  (createAgent); adopted managers (fromConfig) are recorded as adopted and
  never rebound or disposed by the adopting handle. See R1g.
- **Remaining open (decided at implementation, none blocking review):**
  - `ephemeralSettings.js` / `cliEphemeralSettings.js` import shape for pure
    importers (new public subpath vs package index) — one import shape per
    symbol, no re-export shim.
  - `runtime/index.ts` final disposition (surviving focused re-exports vs
    removal together with `./runtime.js`) — no shim either way.

## Carry-over register (not this PR, tracked to zero by the issue)

- `statelessHardeningPreferenceOverride` (module mutable, providers/runtime) →
  issue criterion-3 sweep.
- `providerManagerInstance` singletons + `registerProviderManagerSingleton`/
  `resetProviderManager` calls PR C relocates → deleted by #3222.
- `agentRuntimeFactoryBindings`, `sharedTokenStore`, `runtimeCounter`,
  `runtimeScope` ALS reduction to observability-only, `runtimeScope`
  allowlisting (criterion 4) → #3222 / issue ALS sweep.
- agents WeakMap side-channels (`internalConfigAccess`,
  `activationPreflightState`), CLI `latestBridge`
  (`RuntimeContext.tsx:187`), MCP `hostServices` callbacks (#2615/#3222) —
  later PRs of this lane.
- (Resolved by this PR: the `oauthRuntimeBridge` singleton
  (`runtime-accessor-bridge.ts`) is DELETED here — its production readers
  all migrate to per-owner injected accessors per R1a — and is removed from
  the criterion-3 sweep list.)

## Out of scope

- `providerManagerInstance.ts` singletons and their registration/reset
  helpers (#3222 owns deletion; PR C only relocates the calls it already
  rewrites, preserving observable behavior per the §8 characterization).
- `agentRuntimeFactoryBindings` / `registerAgentRuntimeFactories` /
  `attachAgentRuntimeFactories` (#3222).
- Moving `createIsolatedRuntimeContext` construction into agents (#3222 slice
  G); PR C changes only its activation-cleanup indirection.
- agents WeakMap side-channels; CLI `RuntimeContext.tsx` `latestBridge` module
  pointer; MCP host callbacks; `BaseProvider.activeCallContext` disposition.
- `runtimeScope` ALS deletion (its identity consumer dies here; the scope
  itself survives as scoping/observability for `subagentOrchestrator` and
  stateless-preference metadata until the issue's ALS sweep).
- Config decomposition (#2615), the agents-owned assembly (#3222), the
  cross-cutting ADMISSION contracts of #2643 (the §R1h lease is an
  owner-liveness mechanism inside this lane's owners, not #2643's admission
  policy).

## Prohibited in this PR

Any new module-level mutable state; any new ALS scope; any
RuntimeServices/RuntimeHandle/CliRuntimeServices-style bundle type; any
whole-services-bag parameter outside the composition/assembly sites that
already own one (`AssembleCliProviderRuntimeInput`,
`IsolatedRuntimeContextHandle`, the provider's React props); any ambient
delegation wrapper in either direction; any re-export shim, alias, or
backward-compatibility export for a deleted symbol; any renamed-but-still-
whole-services getter on the UI bridge api (wholesale bag access must
actually disappear — §R2 inventory). This rule is why the C1/C2/C3 package
split was rejected: its intermediate states would have required exactly
these wrappers.

## Landing discipline reminders (binding)

Every commit in the single PR leaves typecheck and its affected package
tests green and preserves observable behavior (the series is bisectable;
the per-commit ledger in §Commit plan is the audit trail). Each
verb-migration commit moves ALL of that verb's callers (cli + zed-acp +
agents), deletes its last-used accessor AND its UI-bag consumers (§R2
inventory), and adds its guard names in the SAME commit — nothing
accessor-related is deferred to a final step. Side effects are deleted in
the same commit as their target implementations. Transient ambient readers
exist only BETWEEN commits of the series (verbs not yet migrated keep their
ambient reads until their own commit); no new delegation wrapper is ever
written. No test is deleted except the mechanism-pinning suites named in
the test strategy; rewritten tests keep their behavioral assertions.
Commit nothing from planning; this doc ships untracked.
