# Issue #2643 — Transactional ProfileController: literal commands, scheduler-safe commit, and runtime ownership

Branch: `issue2643`
Parent epic: #2635. Consumes #2642 (merged as PR #3312: single parser path in
`ProfileManager`, registry `owner`/`propagation` metadata).

## Objective (accepted behavior)

Build the core transactional per-agent profile state machine against the
existing v1 on-disk format:

1. Core contracts and ports (`packages/core`) — implementation-neutral.
2. Pure literal command reduction and candidate resolution (`packages/core`).
3. Load-balancer member auth identity fix (`packages/settings` +
   `packages/providers`, live code, real bug).
4. `ProfileController` + `ActiveProfileRuntime` lifecycle
   (`packages/agents`).

Entry-point cutovers (CLI/Zed startup, Agent API, subagent, compression) are
**separate subissues** (#2640, #2637). Nothing in production is re-routed
through the new controller by this PR. The LB member auth fix is the one
live-path behavioral change.

## Non-goals (hard boundaries)

- No `ProfileDocumentV2`, no qualified repository IDs, no etags, no generation
  migration. v1 files load unchanged.
- No removal of ambient accessors (`oauthRuntimeBridge`,
  `getCliRuntimeServices`) — that is #2616.
- No Config decomposition (#2615), no interactive auth UI (#2562), no retry
  budget changes (#2532).
- No cutover of `/model`, `/provider`, `/profile`, `/setup`, `/set` CLI
  handlers to the new command path.
- Core `profiles` tree must not import settings/provider implementations and
  must not expose a generic runtime/service bag.

## Acceptance criteria → tests

| # | Accepted behavior | Proof |
|---|---|---|
| AC1 | Core contracts: configured/unconfigured `ProfileState`, tagged saved/draft identity, `ProfileCommand` union with expected revision + unsaved-discard intent, typed result union (committed/no-op/queued/confirmation-required/cancelled/busy/stale/conflict/invalid/unverified/failed), redacted snapshot/diff/error/health views, factual agent+command+revision events, narrow `AgentProfile` capability + smaller read capabilities, ports (repository, runtime factory, credential resolver, provider/model catalog+capability, trust/tool environment, scheduler boundary), immutable `TurnContext`/`ProviderCallContext`/`ToolInvocationContext` | Contract type tests + boundary guard test (no settings/provider imports in the tree; no forbidden types in public surface) |
| AC2 | Literal reduction rules exactly as epic #2635 specifies: `/model` clones concrete standard source and patches model only (no template reread, no-op on same model); LB `/model` clones the immutable captured active member source (no cross-provider inference, removes LB state; startup LB+model requires explicit member); `/provider` blank reset from restricted template materialization copying nothing even for same provider; `/profile load` exact repository document; `/setup` blank candidate; profile `/set` clone+patch rejecting application-owned keys; startup one composite command. Pin/unset, saved/draft provenance, no-op detection, expected-revision stale rejection, unsaved-draft confirmation | Pure reducer behavioral tests per command + edge cases |
| AC3 | Candidate resolution with injected ports: defaults without mutating document; reference graphs from captured documents; discriminated credential bindings without copied secrets; provider/model validation returning valid/invalid/unverified; active LB member capture; per-member auth identity resolution into its own binding; policy intersection (env/trust ∩ application/session ∩ role/delegation ∩ profile intent) that narrows only, with requested-vs-effective explanations without secrets; missing required tool invalidates; unavailable allowed tool warns+intersects; unknown disabled IDs portable | Resolver behavioral tests |
| AC4 | LB member auth identity (live fix): `ResolvedSubProfile` carries member auth intent; member auth resolution reads full member auth intent (not just 3 ephemeral keys); bucket selection for a delegate call is member-scoped, not ambient; two OAuth members of one LB on different accounts of the same provider authenticate as their own accounts; member secrets resolved at use time (no plaintext caching at registration); `hasAuthConfig`/`isOAuthProfile` recognize member auth intent without breaking standard-profile behavior | Behavioral tests with real `ProfileManager` temp-dir profiles through the real LB registration + delegate options + bucket resolution paths |
| AC5 | `ProfileController`: one per agent, no singleton; serialized commands; queued commands retain base revision, never rebase; stale expected-revision rejection; pure reduction before wait; commit only at scheduler-safe boundary; revision + source-file recheck after wait; minimal non-failing ownership swap; async-disposable candidate scope with full cleanup on failure/cancel; isolated listener errors; bounded best-effort old-runtime disposal; unchanged effective config reuses runtime (LB reapply preserves rr/cb/TPM/failover state); tool registries stable with filtered declarations + immutable policy snapshots; lazy role runtimes are children of parent revision capturing the referenced document; external edit/delete converts saved identity to draft, increments revision, preserves document/runtime, never hot-reloads; health typed separately from identity, never auto-rewrites document | Controller/runtime behavioral tests incl. cleanup races, listener failures, disposal, parent/subagent boundaries, background tools, external file changes, simultaneous agents |
| AC6 | Full verification passes: `npm run test`, `lint`, `typecheck`, `format`, `build`, smoke profile `stepfun-37` | CI + local cycle |

## Design decisions (pinned)

### Directory layout

```
packages/core/src/profiles/
  contracts/   profileState.ts, profileCommands.ts, profileResults.ts,
               profileEvents.ts, profileViews.ts, capabilities.ts,
               routingContexts.ts, index.ts
  ports/       profileRepositoryPort.ts, profileRuntimeFactoryPort.ts,
               credentialResolverPort.ts, providerCatalogPort.ts,
               trustEnvironmentPort.ts, schedulerBoundaryPort.ts, index.ts
  reduction/   reduceModelCommand.ts, reduceProviderCommand.ts,
               reduceLoadCommand.ts, reduceSetCommand.ts, reduceSetupCommand.ts,
               reduceStartupCommand.ts, commandEnvironment.ts, index.ts
  resolution/  resolveProfileCandidate.ts, policyIntersection.ts,
               credentialBindings.ts, memberAuthResolution.ts, index.ts
  profiles-boundary.test.ts  (guard: no settings/provider imports in tree)
  co-located *.test.ts per module (match core/runtime/contracts style)

packages/agents/src/core/profile/
  ProfileController.ts, ActiveProfileRuntime.ts, commandQueue.ts,
  ownershipScope.ts, runtimeHealth.ts, sourceFingerprint.ts,
  settingsProfileRepository.ts (adapter over ProfileManager),
  executionCoordinatorBoundary.ts, index.ts
  __tests__/profileController.*.test.ts (behavioral)
```

Lint budgets: 800 lines/file, 80 lines/function, complexity 25. Decompose
accordingly (per-command reducer modules, per-concern controller modules).

### Document model

Core defines `ProfileDocument` as a structural mirror of v1
(`StandardProfileDocument | LoadBalancerProfileDocument`) with readonly maps.
Structural compatibility means settings' `Profile` passes through adapters
without conversion. The discriminated auth intent
(`key-name | keyfile | oauth+buckets | provider-default | inline-key`) is a
RESOLUTION output, not an on-disk change; documents keep `auth?` +
ephemeral keys exactly as v1.

### Where owner-metadata knowledge enters core

`/set` must reject application-owned keys, but core cannot import the settings
registry. The reduction environment carries an injected pure classifier
(`isApplicationOwnedKey(key): boolean`) supplied by the composition layer
(agents adapter reads registry owner metadata from settings). Core stays
implementation-neutral; the rule is still enforced at reduction time.

### Result union semantics

- `committed` — swap done; carries new revision + redacted snapshot.
- `no-op` — candidate document equals current; identity/revision preserved.
- `queued` — accepted behind an in-flight command; carries base revision.
- `confirmation-required` — destructive op on unsaved draft without
  `discardUnsaved`; carries a typed confirmation token; a follow-up command
  with the confirmation (or `discardUnsaved: true`) proceeds.
- `cancelled` — aborted while waiting (signal/boundary cancel).
- `busy` — non-queuing entry point invoked while a command is in flight.
- `stale` — expected revision ≠ current revision at submit or recheck.
- `conflict` — source file fingerprint changed externally in ways that break
  the expected source state (repository save collision).
- `invalid` — structural/capability/reference validation failure (redacted).
- `unverified` — candidate constructible but provider/model metadata
  unavailable to prove constraints.
- `failed` — construction/commit error after validation (redacted).

### Controller commit sequence (per issue, verbatim)

```
submit(command)
  → serialize (queue if in flight; retain base revision; never rebase)
  → pure reduction + validation + revision capture   (before waiting)
  → wait scheduler-safe boundary (parent awaiting subagent blocks itself)
  → recheck revision and source-file state
  → resolve credentials + build candidate runtime locally (ownership scope)
  → minimal non-failing ownership swap
  → emit isolated redacted events
  → bounded best-effort disposal of old runtime (cannot roll back)
```

### Runtime reuse rule

Before building, compare the candidate's resolved effective configuration
with the current runtime's resolved configuration (structural equality of the
resolved spec, not file identity). Equal → reuse the existing runtime binding
object (LB rr/circuit-breaker/TPM/failover state survives). Only explicitly
safe shared stores/transports/caches may be borrowed. Test proves operational
counters survive an unchanged LB reapply through the real controller.

### External-change detection

`SourceFingerprint = { mtimeMs; size } | { hash }`. On each command recheck
(and on explicit query), compare the saved identity's fingerprint against the
file's current stat. Mismatch or deletion → identity becomes draft
(`derivedFrom` preserved), revision increments, document and runtime stay
active, nothing hot-reloads. No repository event system.

### LB member auth identity (live fix) mechanics

- `ResolvedSubProfile` gains `auth?: { type: 'oauth' | 'apikey'; buckets?: string[] }`.
- `resolveLoadBalancerSubProfile` reads `subProfile.auth` (member document)
  in addition to the three ephemeral keys.
- OAuth members do NOT resolve an inline token at registration; their
  identity flows to delegate calls so token resolution scopes buckets to the
  member document (the established `profileId` metadata channel — see
  `subagent-isolation.behavioral.spec.ts` and `token-profile-resolver.ts`
  `resolveProfileBuckets`, which already loads a requested profile and
  applies the provider-match guard correctly for standard member docs).
- `hasAuthConfig`/`isOAuthProfile` remain correct for standard profiles and
  member auth intent becomes recognizable through member-aware paths.
- Registration-time plaintext caching for OAuth members is removed in favor
  of use-time resolution; key rotation is picked up.

## Test-first requirements

TDD per dev-docs/RULES.md and the typescript-test-writing skill. Bun +
`bun:test` only. Behavioral tests, no mock theater:

- Reducer/resolver: pure functions under test are real; ports are real
  in-memory implementations (data + simple logic), never `vi.fn()` mirrors.
- LB auth: real `ProfileManager` over temp-dir files, real LB registration
  path, real delegate option building, real bucket resolution; assert derived
  behavior (which account/bucket each member's request used), not mock calls.
- Controller: real controller + real runtime objects with observable state;
  test infrastructure (boundary that resolves on command, repository adapter
  over real temp files) is legitimate infrastructure, not self-mocking.
- Shared helpers for temp dirs / fixture profiles; no copy-pasted setup.

## Implementation sequencing (subagent runs)

1. **Run 1** — core contracts + ports + reducer + resolver + tests (AC1–AC3).
2. **Run 2** — LB member auth identity fix (AC4).
3. **Run 3** — ProfileController + ActiveProfileRuntime + adapters + tests
   (AC5).
4. Full verification cycle, deepthinker review (cap 2 rounds), OCR (cap 2
   rounds), PR.

### Execution status (2026-09-12)

- Runs 1a/1b/2/3/3c DONE (see git tree: core contracts/ports/reduction/resolution,
  providers LB member auth fix, agents controller/runtime/adapter + behavioral
  suites).
- deepthinker review round 1: 23 findings (4 BLOCKER / 16 MAJOR / 2 MINOR / 1
  NOTE). All 20 blocking+majors remediated across batches 1, 2a, 2b, 2c, 3;
  finding 6's coordinator implementation explicitly deferred to #2640 (port
  contract `withSafeBoundary` landed instead). Test migration:
  profileApplication.lb.authkey.test.ts moved from registration-time named-key
  resolution to use-time (issue superseded #1970 registration semantics).
- Environmental flakes filed: #3638 (grep-ephemeral), #3643
  (skillManager/extensionSkillRefresh leak ~55 ambient machine skills; both
  reproduce on clean HEAD).
- Verification cycle (final): build:types→typecheck→build FINAL:0; workspace
  tests pass except the two #3643 files; format clean; stepfun-37 smoke EXIT:0
  (haiku); audit scan delta = new tests only, categories consistent with
  baseline.
- OCR final review round 1 (zai-anthropic, glm-5.3, agent audience): 42 findings
  (4 high / ~20 medium / ~18 low), all triaged valid; status "partial" (30/80
  items failed LLM-side, 44 recovered by retries — round 2 completes coverage).
  Remediated in four batches, all green:
  - Batch A (core contracts/views): bare-form redaction masks to end of line;
    case-insensitive document redaction; structuredClone deep copy; sound
    per-kind isProfileCommand/isProfileCommandResult validators; single-source
    kind whitelist; contextLimit validation + presence-vs-defined consistency;
    negative tests for auth-config branches.
  - Batch B (core reduction): Object.hasOwn-style env lookups (prototype-key
    names → typed invalid); startup draft gate ordered before model branch;
    setup draft gate; discardUnsaved field for startup/setup + reducer honor;
    /set rejects __proto__/constructor/prototype keys; member validated
    against TARGET LB; blank-startup test replaced dead duplicate; dead void
    removed. 391 core tests.
  - Batch C (agents): closed/cancellation guards on execute + save route
    (no state adoption/events after abort); binding-reuse ownership transfer
    (releaseOwnership); captureMember tolerates catalog failure (unverified,
    not failed); adapter stat→load→stat retry-once TOCTOU fix + name
    validation (RangeError before FS); policy required; save anchoring vs
    external edits + mustCreate create-only save-as (port + adapter);
    blank-draft discriminator provider===''&&model===''; test-suite cleanups
    (dead scaffolding, failNextRead rename, shared helpers, strengthened
    fingerprint assertions, startup/setup confirm round-trips). 483 tests.
    Surfaced settings-parser limitation → filed #3645.
  - Batch D (providers): OAuth members skip stray auth-keyfile too (intent
    wins; no plaintext override of member-scoped OAuth); ResolvedSubProfile.auth
    doc corrected (intent record vs metadata.profileId channel);
    flushRuntimeAuthScope cleanup in behavioral spec; dead mock-restore
    scaffolding removed; LLXPRT_TEST_STORAGE_ISOLATED guard on memberAuth
    suite; projection-time member credential resolution (enforceTokenLimit
    path resolves member secret + member-scoped metadata, rotation covered).
    540 tests combined; providers tsc baseline unchanged (3306 before/after).
- Verification cycle (post-OCR-remediation): build:types→typecheck→build
  chain FINAL:1 where the only failures are the two #3643 environmental
  files (0 native-runner failures); format clean; stepfun-37 smoke EXIT:0
  (haiku).
- OCR round 2 (findings-verification, glm-5.3): 17 findings (1 high /
  9 medium / 7 low) — all classified as failure-to-fix completeness,
  fix-induced regressions, or same-defect-class stragglers of round 1; none
  widened scope. Review cap (2) reached; remediation batches E + F:
  - E (core reduction + controller confirmation plumbing): startup-provider
    draft gate (`discard:startup-provider:<p>`); /model member validated
    against current document profiles; /provider draft gate + discardUnsaved
    (command contract + validator + replay); empty-LB guard (typed invalid);
    dead discardUnsaved parameter removed from buildLoadCandidate (+ void
    cleanups); catalog-outage → unverified in forkLoadBalancerModel;
    unchanged startup model preserves saved identity (no-op-style, no draft
    downgrade); confirmation tokens namespaced by command kind +
    controller validates pending.commandKind on replay (mismatch → invalid,
    token not consumed); startup-with-model test now exercises the fork.
    505 tests green across core+agents.
  - F (agents + providers): [high] anchored overwrite TOCTOU closed via
    ProfileManager.saveProfileIfUnchanged (fingerprint check + write under
    the SAME profiles lock; contention test); post-write cancellation
    reconciles persisted fingerprint before returning cancelled/failed (no
    phantom draft promotion on next command); per-binding try/catch in
    CandidateScope.disposeAll (sync throws isolated); adapter deep-copies
    both directions (structuredClone); stat rethrows non-ENOENT/ENOTDIR
    (EACCES/EMFILE propagate — fail fast); binding-reuse reordering (attach
    before releaseOwnership, every failure point leaves exactly one owner);
    keyfile-only LB members resolve plaintext at use time with rotation
    tests (round-robin/failover/option-builder); strict isRecord exported
    from loadBalancerTypes and reused. 569 tests green across all trees;
    providers tsc baseline 3306 unchanged.
- Final gate re-run after E+F: build:types → typecheck → build → format.

<details><summary>Earlier run-by-run log (collapsed)</summary>

- Run 1a DONE — contracts + ports + boundary guard (124 tests).
- Run 1b DONE — reducer (model/provider/load/save/set/setup/startup) +
  candidate resolver incl. policy intersection, credential bindings, member
  auth resolution (272 cumulative core tests, eslint clean).
- Run 2 DONE — LB member auth identity fix: `ResolvedSubProfile.auth`
  intent, registration reads member `auth`, OAuth members skip ephemeral
  plaintext caching, delegate `metadata.profileId` scopes
  `resolveProfileBuckets` to the member; 4-case behavioral spec + unit
  tests green.
- Run 3a DONE — `profileRepositoryAdapter.ts` (ProfileManager-backed port
  + conflict error), `activeProfileRuntime.ts` (attach/snapshot/health,
  bounded best-effort disposal, injectable `disposeTimeoutMs`), 16 tests.
- Run 3b DONE — controller seams `controllerTypes.ts`,
  `controllerEnv.ts` (environment builder: provider templates via catalog,
  repo snapshot + stat, LB member captures), `controllerSave.ts`
  (optimistic-fingerprint save route), `controllerCommit.ts` (resolve →
  boundary wait → revision + source recheck with external-change draft
  promotion → build with configFingerprint reuse → minimal swap → emit),
  `profileController.ts` (serialization/queue/busy, reduction routing,
  confirmation-token re-drive, isolated listeners, best-effort disposal).
  typecheck + eslint clean on all six files.
- Run 3c DONE — 18 behavioral cases across serialization (9) + lifecycle (9)
  files. Behavioral tests surfaced and fixed 4 real seam bugs: (1)
  `reduceProfileCommand` missing from the reduction barrel (module-load
  failure for package consumers), (2) commit route reading `state.revision`
  on unconfigured state so the first commit always went `stale`, (3)
  unknown-provider had to return `invalid` without touching the live
  binding, (4) LB reapply rebuilt the runtime instead of reusing the
  binding (configFingerprint reuse now skips disposal of the kept binding).
- Verification cycle DONE (2026-09-11): adapter `EphemeralSettings` →
  `Record<string, unknown>` bridge via `Object.fromEntries`; duplicate
  auth-copy functions merged into one structural `copyAuthConfig`; 73
  typecheck errors in test files fixed type-level only (narrowing
  predicates, literal typing — zero assertion-semantics changes; final
  counts 303 profile tests pass, both package typechecks exit 0);
  `build:types` → `typecheck` → `build` chain FINAL:0; workspace tests
  132/133 native files (only failure = pre-existing flaky
  grep-ephemeral-precedence, proven on clean HEAD, filed as #3638);
  format clean; stepfun-37 smoke passes; audit scan delta = +1 finding,
  triaged as false positive (identity-stability `toBe` assertion is the
  contract; two real smells were fixed).

</details>

## Review-finding triage policy

Every finding classified Blocker-Fix / In-scope-Fix / Reject / Defer.
Reviewer suggestions do not authorize scope expansion (no new subsystems, no
public abstractions beyond the issue's list, no dependency changes, no
workflow/agent-memory/quality-tool changes, no unrelated refactors).

## Known follow-ups (deferred, not this PR)

- Live-path LB runtime reuse on re-registration (controller path proves the
  behavior; live `profileApplication` cutover belongs to #2640/#2637).
- Entry-point cutovers (#2640, #2637) and legacy-path deletion (#2644).
- Ambient accessor removal (#2616).

## Controller implementation spec (dispatched to implementer)

Location: `packages/agents/src/core/profile/profileController.ts` (+ helper
modules when line budgets demand). Consumes core profiles contracts/ports/
reduction/resolution and the existing `ActiveProfileRuntime`.

### API

```ts
export interface ProfileControllerDeps {
  agentId: string;
  repository: ProfileRepositoryPort;
  runtimeFactory: ProfileRuntimeFactoryPort;
  boundary: SchedulerBoundaryPort;
  catalog: ProviderModelCatalogPort;
  trust: TrustEnvironmentPort;
  session: PolicyCeiling;
  role?: PolicyCeiling;
  isApplicationOwnedKey: (key: string) => boolean;
  getPolicyIntent?: (document: ProfileDocument) => ProfilePolicyIntent;
  listeners?: ReadonlyArray<(event: ProfileEvent) => void>;
}

export class ProfileController {
  constructor(deps: ProfileControllerDeps);
  getState(): ProfileState;                       // current committed state
  getRuntime(): ActiveProfileRuntime | undefined; // current runtime
  getPendingConfirmations(): readonly string[];   // tokens awaiting confirm
  execute(command: ProfileCommand,
          options?: { signal?: AbortSignal; queue?: boolean }):
      Promise<ProfileCommandResult>;
  dispose(): Promise<void>;   // clear queue, dispose runtime best-effort
}
```

### Semantics (exact)

1. **Serialization.** One in-flight command. While in-flight:
   `queue === false` → `{kind:'busy', activeCommandKind, revision}`;
   default → enqueue `{command, signal}` and immediately return
   `{kind:'queued', baseRevision}` (revision at enqueue). Dequeued commands
   run against the *current* state; an old `expectedRevision` then produces a
   `stale` result. Queued commands are never rebased.
2. **Env build (async, before any waiting).** For the command kind:
   provider/startup-with-provider → template
   `{version:1,type:'standard',provider,model: catalog.getDefaultModel(provider) ?? '',
     modelParams:{}, ephemeralSettings:{}}`;
   load/startup-with-profileName → `repository.load(name)` + `repository.stat(name)`
   into `env.repository[name]`; for any loadbalancer document in play (current
   state or loaded) → per member: `repository.load(member)` and
   `catalog.listModels(memberProvider)` into
   `env.memberCaptures[member] = {revision:0, provider, sourceDocument, models}`;
   load failures skip that capture (reducer/resolver handle missing).
3. **Reduce.** `reduceProfileCommand(state, command, env)`; route outcomes:
   `stale` → stale result; `invalid` → invalid result; `no-op` → emit event,
   no-op result; `confirmation-required` → store token→original-command Map,
   return the confirmation-required result; `discard-authorized` → look up
   token (missing → invalid 'unknown confirmation token'), re-drive the
   *stored* command with `discardUnsaved: true`, delete the entry, loop back
   to env-build once (guard against re-loop); `save` →
   `repository.save(name, document, expectedFingerprint = current identity
   saved ? identity.source : undefined)` → success: identity becomes
   `{kind:'saved', name, source: newFingerprint}`, **revision unchanged,
   runtime/binding unchanged** (save never rebuilds) → committed result with
   redacted snapshot; `ProfileRepositoryConflictError` →
   `{kind:'conflict', cause:'source-changed', revision}`; `candidate` → step 4.
4. **Commit pipeline.**
   a. `resolveProfileCandidate({document, policyIntent: getPolicyIntent?.(document)
      ?? empty}, {catalog, trust, session, role, repository})` → `invalid` →
      invalid result; `unverified` → unverified result (no commit); valid → b.
   b. `boundary.waitSafeBoundary(signal)` → `'cancelled'` → cancelled result.
   c. **Recheck.** `state.revision !== command.expectedRevision` → stale.
      Saved identity → `repository.stat(name)`: null or fingerprint mismatch →
      EXTERNAL CHANGE: identity → draft (`derivedFrom {name, source: old}`),
      revision+1, document/binding preserved (no hot reload), emit event,
      stale result with `currentRevision` = new revision.
   d. **Build locally.** Blank setup draft (provider `''` and model `''`) →
      binding `undefined`. Else `runtimeFactory.build(...)`; throw → failed
      result `{error: message}` (prior state active).
   e. **Reuse.** Old binding && new binding && equal `configFingerprint` →
      dispose the NEW binding (best-effort), keep the OLD binding object
      (LB rr/circuit-breaker/TPM/failover state preserved).
   f. **Swap minimal non-failing.** New `ActiveProfileRuntime` with
      `{status:'configured', revision: nextRevision, identity, document,
      activeMember}`; attach chosen binding; assign. Failure → dispose new
      binding, failed result, old runtime stays active.
   g. Dispose OLD runtime fire-and-forget with isolated catch (cannot roll
      back). Emit committed event. Return
      `{kind:'committed', revision: nextRevision, snapshot}`.
5. **Events.** `emit()` wraps each listener call in try/catch; listener
   errors never affect command results. Facts only: agentId, commandKind,
   revision, per contracts `ProfileEvent` union.
6. **Drain.** After each command completes, dequeue and process the next
   queued command sequentially, then clear in-flight.

### Controller test matrix (behavioral, infra fakes for ports only)

In-memory repository (implements `ProfileRepositoryPort`), deferred boundary,
counting runtime factory (distinct `configFingerprint`, dispose counters),
catalog/trust fakes, one throwing listener. Real core reducer/resolver.

1. Serialization: second execute while boundary pending → `queued` with
   baseRevision; runs after the first completes.
2. Queued command with stale expectedRevision after first commit → `stale`
   (never rebased).
3. `queue:false` while in-flight → `busy` with `activeCommandKind`.
4. Load on unsaved draft without `discardUnsaved` → `confirmation-required`
   + registered token.
5. `confirm-discard` with that token re-drives and commits the load.
6. `confirm-discard` with unknown token → `invalid`.
7. Save fingerprint conflict → `conflict`; runtime/document unchanged.
8. Save success → saved identity, revision unchanged, SAME binding object.
9. `/model` same model → `no-op`, revision unchanged.
10. `/provider` unknown → `invalid`, prior state intact.
11. Throwing listener does not break the commit result; other listeners still
    notified.
12. Unverified candidate (catalog unknown) → `unverified`, no commit.
13. Boundary cancelled → `cancelled`; candidate binding disposed; prior
    runtime active (binding object identity preserved).
14. External file edit before boundary release → stale result, identity draft
    with `derivedFrom`, revision+1, document/binding preserved.
15. Unchanged LB reapply → same binding object retained (counters continue),
    new candidate binding disposed.
16. Two controllers over the same repository → fully independent state,
    bindings, health.
17. Failed build → `failed`, prior runtime active, candidate resources
    cleaned.
18. In-flight captured snapshot (getRuntime state object reference) is not
    mutated by a later commit (background work retains captured contexts).
