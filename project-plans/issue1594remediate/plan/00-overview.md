<!-- @plan:PLAN-20260621-COREAPIREMED.P00 @requirement:REQ-001..REQ-007,REQ-INT-001..REQ-INT-004 -->
# Plan: Core Public Agent API Remediation (enables #1595)

Plan ID: PLAN-20260621-COREAPIREMED
Generated: 2026-06-21
Total Phases: 48 (1 preflight + 23 worker NN + 23 verifier NNa + 1 final eval) — see index below.
Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007,
REQ-INT-001, REQ-INT-002, REQ-INT-003, REQ-INT-004.

> Counting note: phases are numbered 00a, 01/01a, 02/02a, 03/03a … 22/22a, 23/23a, 24.
> That is 1 (00a) + 2×23 (worker phases 01–23 each with a paired verifier 01a–23a)
> + 1 (24 final eval) = **48 phase files** (the separate `00-overview.md` index is not
> itself a phase).

## Critical Reminders

Before implementing ANY phase:

1. Phase 00a (preflight) MUST pass first — every type/call-path/dependency assumption verified,
   including the THREE corrected assumptions: (a) `IsolatedRuntimeContextOptions` has NO
   `providerManager?` field today and the factory builds a `ProviderManager` UNCONDITIONALLY
   (anchor by grep `new ProviderManager(`, ~`runtimeContextFactory.ts:502`; line approximate since
   P03/P05 mutate this file) — this plan ADDS that seam (P03–P05); (b) `Config` has NO
   `getMessageBus()` accessor — the shared bus is caller-supplied via `FromConfigOptions.messageBus`
   and forwarded into the EXISTING `messageBus?` seam (`runtimeContextFactory.ts:199`); (c)
   `AgentClientContract` is core-owned (`clientContract.ts:67`) and is promoted onto the CURATED
   API barrel `packages/agents/src/api/index.ts` (it is ABSENT there today).
2. This plan makes the public agents surface ADEQUATE for #1595 and proves it with a CLI-parity
   harness (the executable contract for #1595). It does NOT modify CLI production source. It DOES
   make ONE small additive change to `packages/providers`: an optional `providerManager?` field on
   `IsolatedRuntimeContextOptions` adopted via `options.providerManager ?? new ProviderManager(...)`
   (P03–P05), mirroring the existing `messageBus?` adoption pattern.
3. Non-breaking is a hard constraint: the shipped `createAgent(AgentConfig)` path and every
   current export keep working (REQ-006). Backed by characterization tests written BEFORE impl. The
   new `providerManager?` option is OPTIONAL; `createAgent` omits it, so the factory's behavior is
   unchanged for the existing path.
4. Integration-first: the #1595 turn-parity contract is authored EARLY as a RED slice at P07
   (BEFORE the implementation phases it drives — `fromConfig` impl is P09), then made GREEN at P09.
   P07 is the integration-first RED TDD DRIVER. The BROADER parity suite at P19 is an integration
   CHARACTERIZATION / parity-EXPANSION + VERIFICATION gate (NOT a RED TDD phase): it extends coverage
   to the remaining seams (settings/seqmodel/boundary), and because those seams are already
   implemented by the time it runs, a PASSING suite is its success condition (any real adequacy gap
   is fixed in P20 without weakening tests). Both import ONLY the public surface on the
   agent-under-test path (REQ-INT-004); the reference-drive side may import the internal `AgenticLoop`
   for comparison.
5. TDD discipline: stubs may return empty / throw `NotYetImplemented` but tests NEVER reverse-test
   for stubs; TDD phases write behavioral tests that FAIL for behavioral reasons (RED state is
   ENFORCED — a phase FAILS if its new tests unexpectedly pass, or fail for setup/compile reasons,
   except the contract type-surface phase whose expected RED is a genuine TYPE error); ≥30%
   property-based (the ratio is COMPUTED and ENFORCED, not merely printed); impl phases cite
   pseudocode line numbers; verification enforces mutation ≥80% on changed files.
6. Verification gates BLOCK: every mandatory violation check EXITS NON-ZERO (no print-and-continue);
   `|| true` is used ONLY where a grep finding nothing is the PASS case.
7. Comment discipline (N5): production code carries ONLY `@plan` / `@requirement` / `@pseudocode`
   marker blocks — no explanatory prose comments.

---

## Summary

#1594 shipped `createAgent(AgentConfig): Promise<Agent>` and a stable `AgentEvent` stream. An
architecture evaluation found the surface NOT YET adequate to enable #1595 ("Refactor CLI to
consume core API"). Six gaps block #1595:

| Gap | Title | Evidence (post-merge) | Resolved by |
|---|---|---|---|
| C1 | No Config-injection seam | `createAgent.ts:71` only takes `AgentConfig`; `:128` `new Config(params)`; `config-types.ts` has no `config` field | REQ-001 (`fromConfig`) — P06/P08/P09; `getConfig()` identity DECLARED on the interface in P06 (NotYetImplemented stub) & IMPLEMENTED (GREEN) at P09; early parity P07 (RED) → P09 (green) |
| C2 | Agent omits settings/config surface | `agent.ts` exposes none of `getConfig`/`getEphemeralSetting`/`setEphemeralSetting`; ~97 get + ~41 set call sites in cli+core | REQ-002 — ephemeral get/set/getAll: P10/P11/P12. `getConfig()` is SHARED with C1 (identity), DECLARED in P06 and IMPLEMENTED at P09, NOT re-declared by the settings surface |
| C3 | CLI turns don't route via `agent.stream()/chat()` | zero `agent.stream(`/`agent.chat(` in cli; turns via `useAgenticLoop.ts:254` `new AgenticLoop({ agentClient, config, messageBus, interactiveMode, approvalHandler, displayCallbacks })` (object-form) | REQ-INT-002 parity — early P07 (RED) → P09 (green); broad P19/P20 |
| H1 | No client CONTRACT on the curated API barrel | `internals.ts:38` exports the `AgentClient` CLASS; root `index.ts:26-27` re-exports both barrels; `AgentClientContract` ABSENT from curated `api/index.ts`; contract is core-owned (`clientContract.ts:67`) | REQ-004 — P15/P16 |
| H2 | Provider runtime CLI-orchestrated; no adoption seam | `profileBootstrap.ts:413 createProviderManager`, `:380 prepareRuntimeForProfile`; `runtimeContextFactory.ts` builds `ProviderManager` unconditionally (anchor by grep `new ProviderManager(`, ~`:502`; no `providerManager?` option) | REQ-005 (`providerManager?` seam + adopt + `getRuntimeId`) — P03/P04/P05, P17/P18 |
| H3 | `getCurrentSequenceModel` is a stub | `agentImpl.ts:668-670 return null`; real value at `clientContract.ts:118` | REQ-003 — P13/P14 |

> The exact gap→phase rows above are summarized; the authoritative REQ→phase mapping is the table
> at the bottom of this file and the per-phase Prerequisites.

The event model (19-variant union covering all 17 GeminiEventType members) was judged SUFFICIENT
and is NOT re-planned.

---

## Architectural Decisions (recap from specification.md)

- **`fromConfig` is additive**, a SEPARATE exported function — NOT an overload that changes
  `createAgent`'s type. It ADOPTS a supplied `Config` (no second Config/SettingsService/
  MessageBus/ProviderManager) and reuses the SAME extracted `finalizeAgent` path.
- **Provider-runtime adoption requires a providers-package seam (CRIT-1)**: the factory builds a
  `ProviderManager` UNCONDITIONALLY (anchor by grep `new ProviderManager(`, ~`runtimeContextFactory.ts:502`;
  line approximate — P03/P05 mutate this file), with NO `providerManager?` option. So "no second
  `ProviderManager`" (REQ-001.2 / REQ-005.2) is infeasible without a real seam. P03–P05 ADD an
  OPTIONAL `providerManager?: RuntimeProviderManager` (the CORE STRUCTURAL interface, NOT the
  concrete `ProviderManager` class — CRIT-1 type decision) to `IsolatedRuntimeContextOptions` and
  adopt it via `options.providerManager ?? new ProviderManager(...)`, mirroring the existing
  `messageBus?` pattern. `fromConfig` derives the manager from the adopted `Config` via
  `Config.getProviderManager()` (which returns `RuntimeProviderManager | undefined`,
  `configBaseCore.ts:265`) and passes it in with ZERO assertion — the option type and the
  getter's return type match exactly, so NO `any`/unsafe-`as` is needed (grep-enforced in
  P05/P05a, P09/P09a). When the Config exposes no manager, the factory builds exactly one (still
  single-manager for that runtime). `createAgent` omits `providerManager`, so its behavior is
  unchanged.
- **Shared MessageBus handoff requires a caller-supplied field (CRIT-2)**: `Config` exposes NO
  `getMessageBus()` accessor (it only CONSUMES a bus via `initialize({ messageBus? })`). The shared
  bus CANNOT be read back off the Config. `FromConfigOptions` therefore carries an optional
  `messageBus?: MessageBus` that the caller (#1595) supplies; `fromConfig` forwards it into the
  EXISTING `createIsolatedRuntimeContext({ messageBus })` seam (`runtimeContextFactory.ts:199`,
  adopted at `:482-484`). When no bus is supplied, `fromConfig` builds ONE from the Config's policy
  engine exactly as `createAgent` does (a single bus, not a "second" one).
- **Settings surface delegates** to the bound `Config` (no parallel store); normalization/side
  effects remain Config's responsibility.
- **`getCurrentSequenceModel` delegates** to the freshly-resolved client (`resolveClient()`),
  honoring the #1594 never-cache-client invariant.
- **Contract promotion targets the CURATED API barrel (CRIT-3)**: the core-owned
  `AgentClientContract` (`clientContract.ts:67`) is re-exported TYPE-ONLY from
  `packages/agents/src/api/index.ts` — the boundary #1595 imports from and the one that survives the
  eventual #1595 internals trim. It becomes reachable from the package root transitively (root
  already does `export * from './api/index.js'`). The concrete `AgentClient` CLASS stays on
  `./internals.js`; the root ALSO re-exposes that class today via `export * from './internals.js'`,
  but that low-level re-export is owned/trimmed by #1595 and is NOT this plan's stable promise.
- **Provider-runtime reachability**: `fromConfig` adopts the runtime via
  `createIsolatedRuntimeContext({ config, settingsService, messageBus, providerManager })` (the
  `config?`/`messageBus?` fields already exist at `runtimeContextFactory.ts:187/199`; the
  `providerManager?` field is ADDED by P03–P05); the Agent exposes read-only `getRuntimeId()`.

---

## Subagent Role Table

| Role | Subagent | Phases |
|---|---|---|
| Implementation / worker | `typescriptexpert` | All `NN` worker phases (01–22) |
| Verification / review | `architect` | Preflight `00a`; every `NNa` verifier; the pseudocode-compliance gates on impl phases (05a, 09a, 12a, 14a, 16a, 18a); and the final plan-quality evaluation (24) |

> Rationale: the OpenAI/codex review subagents are unavailable; `architect` (Opus) performs all
> review/verification including pseudocode-compliance gates and final evaluation.

---

## Requirements (full titles)

- **REQ-001** Config-injection seam (`fromConfig`) — adopt an external `Config`; reuse shared
  finalize; do not construct a second Config/SettingsService/MessageBus/ProviderManager; adopt the
  caller-supplied `MessageBus`; supplied Config (and caller-supplied bus/manager) is caller-owned
  (not disposed). `getConfig()` identity (REQ-001.2/REQ-002.2) is DECLARED on the interface WITH this
  seam in P06 (interface member + NotYetImplemented stub) and IMPLEMENTED (GREEN) in P09 — so the
  early parity slice (P07/EP1) and fromConfig TDD (P08/T1) can COMPILE and reference it (RED for a
  behavioral reason) before P09 turns it GREEN, and before the settings surface lands.
- **REQ-002** Agent settings/config projection — `getEphemeralSetting`, `setEphemeralSetting`,
  `getEphemeralSettings` (P10–P12) delegating to the bound `Config`. `getConfig()` is SHARED with
  C1/REQ-001.2 (identity), DECLARED in P06 and IMPLEMENTED at P09; the settings surface REFERENCES it
  and does NOT re-declare it.
- **REQ-003** Real `getCurrentSequenceModel` — delegate to the bound client; nullable; reflects
  the current client after rebind.
- **REQ-004** Public client contract promotion — `AgentClientContract` re-exported TYPE-ONLY from
  the curated API barrel `packages/agents/src/api/index.ts` (reachable transitively from the root);
  `AgentClient` class stays on `./internals.js`.
- **REQ-005** Provider-runtime reachability — ADD a `providerManager?` adoption seam to the
  providers package; adopt the runtime through the public API; expose read-only `getRuntimeId()`;
  no second `ProviderManager`.
- **REQ-006** Non-breaking guarantee — additive only; `createAgent(AgentConfig)` unchanged; the new
  providers option is optional and unused by `createAgent`; characterization tests.
- **REQ-007** Documentation — `docs/agent-api.md` documents `fromConfig`, the settings surface,
  `getCurrentSequenceModel`, the promoted contract, and `getRuntimeId`.
- **REQ-INT-001** CLI Config adoption — `fromConfig` adopts a CLI-style `Config` and streams a turn.
- **REQ-INT-002** CLI turn-drive parity — `agent.stream()` output is equivalent to the CLI's
  current reference `AgenticLoop` drive over the same FakeProvider script.
- **REQ-INT-003** Settings call-site adequacy — agent settings round-trip and normalize exactly as
  the CLI's current direct `Config` calls.
- **REQ-INT-004** No-deep-import boundary — the new surface + harness import only the public root
  and documented subpaths.

---

## Phase Index (CONTIGUOUS — NO SKIPPED NUMBERS)

| Phase | File | Worker | Title |
|---|---|---|---|
| 00a | `00a-preflight-verification.md` | architect | Preflight: verify all assumptions (incl. CRIT-1/2/3) |
| 01 | `01-analysis.md` | typescriptexpert | Domain analysis (produce/confirm domain-model.md) |
| 01a | `01a-analysis-verification.md` | architect | Verify analysis |
| 02 | `02-pseudocode.md` | typescriptexpert | Pseudocode (produce/confirm components) |
| 02a | `02a-pseudocode-verification.md` | architect | Verify pseudocode (contract-first sections) |
| 03 | `03-provider-manager-seam-stub.md` | typescriptexpert | Providers: add `providerManager?` option (stub seam) |
| 03a | `03a-provider-manager-seam-stub-verification.md` | architect | Verify stub (option exists, compiles, no behavior change) |
| 04 | `04-provider-manager-seam-tdd.md` | typescriptexpert | Providers: `providerManager?` adoption behavioral tests |
| 04a | `04a-provider-manager-seam-tdd-verification.md` | architect | Verify TDD (RED, ≥30% property, identity assertions) |
| 05 | `05-provider-manager-seam-impl.md` | typescriptexpert | Providers: adopt `options.providerManager ?? new ProviderManager(...)` |
| 05a | `05a-provider-manager-seam-impl-verification.md` | architect | Pseudocode-compliance gate + semantic verify (single construction site) |
| 06 | `06-fromconfig-stub.md` | typescriptexpert | `fromConfig` + `FromConfigOptions` (incl. `messageBus?`) stub |
| 06a | `06a-fromconfig-stub-verification.md` | architect | Verify stub (no reverse tests, compiles, exported, canonical config-types.ts) |
| 07 | `07-early-parity-red.md` | typescriptexpert | EARLY integration-first CLI turn-parity RED slice (drives #1595 adequacy before impl) |
| 07a | `07a-early-parity-red-verification.md` | architect | Verify RED-before-green (behavioral RED; FAILS if slice passes prematurely) |
| 08 | `08-fromconfig-tdd.md` | typescriptexpert | `fromConfig` behavioral tests (adopt config/bus/manager, ownership) |
| 08a | `08a-fromconfig-tdd-verification.md` | architect | Verify TDD (behavioral, ≥30% property, RED, no mock theater) |
| 09 | `09-fromconfig-impl.md` | typescriptexpert | `fromConfig` impl (cite config-injection-seam.md lines 10–78); makes P07 slice GREEN |
| 09a | `09a-fromconfig-impl-verification.md` | architect | Pseudocode-compliance gate + semantic + early-slice content-hash integrity |
| 10 | `10-settings-surface-stub.md` | typescriptexpert | Settings/config surface (stub on Agent interface+impl) |
| 10a | `10a-settings-surface-stub-verification.md` | architect | Verify stub |
| 11 | `11-settings-surface-tdd.md` | typescriptexpert | Settings behavioral tests (delegation, normalization) |
| 11a | `11a-settings-surface-tdd-verification.md` | architect | Verify TDD |
| 12 | `12-settings-surface-impl.md` | typescriptexpert | Settings impl (cite settings-surface.md lines) |
| 12a | `12a-settings-surface-impl-verification.md` | architect | Pseudocode-compliance gate + semantic verify |
| 13 | `13-seqmodel-tdd.md` | typescriptexpert | `getCurrentSequenceModel` behavioral tests (delegate, rebind) |
| 13a | `13a-seqmodel-tdd-verification.md` | architect | Verify TDD |
| 14 | `14-seqmodel-impl.md` | typescriptexpert | `getCurrentSequenceModel` impl (cite get-current-sequence-model.md) |
| 14a | `14a-seqmodel-impl-verification.md` | architect | Pseudocode-compliance gate + semantic verify |
| 15 | `15-contract-promotion-tdd.md` | typescriptexpert | Contract promotion tests + non-breaking export characterization |
| 15a | `15a-contract-promotion-tdd-verification.md` | architect | Verify TDD (RED is a TYPE error; no reverse tests) |
| 16 | `16-contract-promotion-impl.md` | typescriptexpert | Promote `AgentClientContract` on curated `api/index.ts` (cite client-contract-promotion.md) |
| 16a | `16a-contract-promotion-impl-verification.md` | architect | Pseudocode-compliance gate + semantic verify |
| 17 | `17-runtime-seam-tdd.md` | typescriptexpert | `getRuntimeId` + no-second-manager behavioral tests |
| 17a | `17a-runtime-seam-tdd-verification.md` | architect | Verify TDD |
| 18 | `18-runtime-seam-impl.md` | typescriptexpert | `getRuntimeId` impl + adopt-runtime wiring (cite provider-runtime-seam.md) |
| 18a | `18a-runtime-seam-impl-verification.md` | architect | Pseudocode-compliance gate + semantic verify |
| 19 | `19-parity-harness-tdd.md` | typescriptexpert | BROADER CLI-parity integration CHARACTERIZATION / parity-expansion + verification gate (NOT RED TDD — driver is P07); cite cli-integration-adapter.md; reuses P07 helper/fixture |
| 19a | `19a-parity-harness-tdd-verification.md` | architect | Verify integration characterization/expansion gate (real FakeProvider, parity, ≥30% property; passing suite is success) |
| 20 | `20-parity-harness-green.md` | typescriptexpert | Make broad parity harness green end-to-end (no production stubs remain) |
| 20a | `20a-parity-harness-green-verification.md` | architect | Semantic verify: parity proven, single terminal done; content-hash frozen-test guard |
| 21 | `21-boundary-and-nonbreaking.md` | typescriptexpert | No-deep-import boundary scan + full non-breaking characterization |
| 21a | `21a-boundary-and-nonbreaking-verification.md` | architect | Verify boundary + non-breaking |
| 22 | `22-docs.md` | typescriptexpert | `docs/agent-api.md` updates (REQ-007) |
| 22a | `22a-docs-verification.md` | architect | Verify docs accuracy against code |
| 23 | `23-quality-gates.md` | typescriptexpert | Full verification suite (test/lint/typecheck/format/build + smoke) + mutation ≥80% |
| 23a | `23a-quality-gates-verification.md` | architect | Verify gates output |
| 24 | `24-final-plan-quality-eval.md` | architect | Final plan-quality evaluation (integration-first, no isolation) |

---

## REQ → Phase Mapping (authoritative)

| Requirement | Worker phases | Verifier phases |
|---|---|---|
| REQ-001 (`fromConfig`) | 06, 08, 09 (early parity 07) | 06a, 07a, 08a, 09a |
| REQ-002 (settings surface) | 10, 11, 12 | 10a, 11a, 12a |
| REQ-003 (`getCurrentSequenceModel`) | 13, 14 | 13a, 14a |
| REQ-004 (contract promotion) | 15, 16 | 15a, 16a |
| REQ-005 (`providerManager?` seam + `getRuntimeId` / adopt runtime) | 03, 04, 05, 09, 17, 18 | 03a, 04a, 05a, 09a, 17a, 18a |
| REQ-006 (non-breaking) | 03, 05, 15, 21 (+ every impl phase) | 03a, 05a, 15a, 21a |
| REQ-007 (docs) | 22 | 22a |
| REQ-INT-001 (CLI Config adoption) | 07, 09, 19 | 07a, 09a, 19a |
| REQ-INT-002 (turn-drive parity) | 07, 09, 19, 20 | 07a, 09a, 19a, 20a |
| REQ-INT-003 (settings adequacy) | 11, 12, 19 | 11a, 12a, 19a |
| REQ-INT-004 (no-deep-import) | 07, 19, 21 | 07a, 19a, 21a |

---

## Gap → REQ → Phase (the six gaps, explicit)

| Gap | REQ | First proven adequate at |
|---|---|---|
| C1 (Config injection) | REQ-001, REQ-INT-001 | P09 impl; early parity P07 (RED) → P09 (green, adopts CLI-style Config); broad P19/P20 |
| C2 (settings/config surface) | REQ-002, REQ-INT-003 | P12 impl; P19 parity (settings round-trip) |
| C3 (turn-drive via public API) | REQ-INT-002 | early P07 (RED) → P09 (green); broad P19/P20 parity harness green |
| H1 (contract promotion) | REQ-004 | P16 impl (curated API-barrel type export) |
| H2 (provider-runtime reachability) | REQ-005, REQ-001.2 | P05 `providerManager?` seam; P09 adopt-runtime; P17/P18 `getRuntimeId` + no-second-manager |
| H3 (`getCurrentSequenceModel` stub) | REQ-003 | P14 impl |

---

## #1595 Adequacy Statement

When phases 03–21 are green, the public agents surface provides everything #1595 needs:
the providers `providerManager?` adoption seam (P03–P05) plus `fromConfig` (adopt the CLI's
existing `Config`, its `ProviderManager`, and a caller-supplied shared `MessageBus`), the
settings/config projection (replace ~138 deep ephemeral call sites), `getCurrentSequenceModel`
(real), `AgentClientContract` on the curated API barrel (reachable from the root), `getRuntimeId`,
and a passing CLI-parity harness — driven integration-first by the EARLY RED slice (P07, made green
at P09) and extended by the broad suite (P19/P20) — proving `agent.stream()` matches the CLI's
current object-form `AgenticLoop` drive (`useAgenticLoop.ts:254`) — all importable from the public
root + documented subpaths only on the agent-under-test path. The final evaluation (P24) rejects
the plan if any piece could be built in isolation from these seams.
