# Target Public API Design — Draft Proposal

Status: **draft for discussion.** Not agreed, not scheduled.

Derived from `usage-census.md` (generated at `05d50c1e8`). Every claim below traces to measured
consumption rather than judgement about what core "should" expose.

## 1. Why the previous attempt produced nothing

`project-plans/issue1584/analysis/core-deep-import-policy.md` is where core's public API was
supposed to be defined. It does not define one. It grants 14 deep-import prefixes:

    auth/  config/  core/  debug/  models/  parsers/  prompt-config/
    runtime/  services/  settings/  telemetry/  tools/  types/  utils/

That is substantially all of core. Its rationale — "auth/settings/tools/history/debug packages are
not yet extracted" and "existing package.json files do not define exports" — is now false on both
counts. The allowlist was never revisited, and the exports map was subsequently populated to match
what consumers had already imported.

That is the defect to correct: **the surface was transcribed from usage instead of declared.** The
census is the same data, but used as design input rather than as a rubber stamp.

## 2. Design rules

0. **Coherence is the goal; export count is not the goal.** The objective is that each package
   publishes a contract a reader can understand and a reviewer can defend — not that the number of
   entries is small. A package with 25 well-named seams that cover its domain is better than one
   with 12 seams achieved by pushing its own vocabulary into other packages.

   The issue's `<20 subpaths` acceptance criterion actively works against this. It rewards moving
   things sideways, and it is the reasoning that produced the 14 cross-package shims already in the
   tree (§4) and an earlier draft of this document proposing to evict core's content model (§8 Q3).
   Count belongs in the analysis as a symptom. It should not be the target.

1. **Declared, not emergent.** The public API is a hand-authored file. The implementation is
   checked against it, never the reverse.
2. **No `export *` in a public entry point.** Today 26 of 282 public entry points use it (core: 10).
   Each one means the surface silently changes whenever an unrelated internal file changes. This is
   the single mechanism by which the surface grew from 117 to 127 while an issue about it was open.
3. **No cross-package re-export shims.** Already Hard Rule 1 of the issue, currently violated 15
   times (§4).
4. **One barrel plus a small number of named seams.** Not dogmatically one entry — but every entry
   is a deliberate seam with an owner. The failure mode is unnamed, unowned entries.
5. **Test scaffolding is not public API.**
6. **Types for the compile-time contract; zod for data crossing the seam.** 51.2% of core's deep
   imports are type-only, so the surface itself must be a compile-time artifact. Zod applies to the
   payloads that travel across the boundary (§5.1), which is a different problem.

## 3. What the census says the surface must contain

Demand is concentrated. Ten subpaths carry most cross-package traffic, and the symbol distribution
clusters cleanly into five seams.

### Seam A — Content model (~620 imports, almost entirely types)

`IContent` (355, 354 type-only), `ContentBlock` (82/81), `ToolCallBlock` (46/46),
`ThinkingBlock` (46/46), `TextBlock` (35/35), `ToolResponseBlock` (35/35), `MediaBlock` (24/24).

This is the data model every package speaks. It is the largest single cluster and it is pure types.
Proposed entry: `./content`.

`packages/core/src/services/history/IContent.ts` is 510 lines, 16 exports, zero import statements —
every block type (`TextBlock`, `ToolCallBlock`, `ToolResponseBlock`, `MediaBlock`, `ThinkingBlock`,
`CodeBlock`), the `ContentMetadata`/`UsageStats` shapes, a `ContentValidation` const and three
factory functions, all self-contained.

**This stays in core, and it is the centrepiece of core's public API.** The content model is core's
primary domain vocabulary — the thing core exists to manipulate. A core package whose published
contract excluded it would be incoherent: `HistoryService` would operate on types owned by
somewhere else.

The defect was never its location. It is that consumers reach it at
`services/history/IContent.js`, a path that leaks an implementation detail — that the content model
happens to live under a `services/history` folder. Same symbol, same package, wrong contract.
Publishing it as a named seam fixes that without moving a line of code.

The existing hand-rolled `ContentValidation` const is precisely where zod belongs: this is data
crossing every package boundary, currently validated by bespoke code.

### Seam B — Runtime contracts (already correct)

`packages/core/src/runtime/contracts/index.ts` — ~30 exports, all `export type` except one
function, with `boundary-guards.test.ts` enforcing that it never re-exports provider symbols.
`RuntimeProvider` alone accounts for 51 imports.

This came out of issue 1584 P03/P04 and is the one seam that was genuinely designed. It is the
template for everything else. Keep as `./runtime/contracts`.

### Seam C — Config roles (replaces the god-object)

`Config` is imported 266 times, **231 of them type-only**. Consumers want something to annotate
against, not the object. See §6.

### Seam D — History (~84 imports, 178 construction sites — but only 9 in production)

`HistoryService` is constructed 178 times, and **169 of those are in test files**. Production
construction is 9 sites, 3 of which are inside core itself. Outside core the entire production
need is 5 files in agents (`api/createAgent.ts`, `core/ChatSessionFactory.ts`,
`core/chatSession-tokenSync-helpers.ts`, `core/client.ts`) and **zero in cli**.

So the concrete class does not need to be public. Publish an interface plus a core-owned factory
for the handful of production sites, and give tests a helper in the `test-utils` package. The
apparent "181 construction sites" objection dissolves under the test/production split (§8 Q1).

### Seam E — Confirmation bus (61 imports)

`MessageBus` (60 references). Currently a compat subclass (§4).

## 4. Core's public API is partly a proxy for other packages

**14 of core's 127 subpaths are pure re-export shims onto a different package** — no own
declarations at all:

| core subpath | actually lives in |
|---|---|
| `./debug/index.js` (125 imports) | telemetry |
| `./debug/DebugLogger.js` (75 imports) | telemetry |
| `./debug/ConfigurationManager.js` | telemetry |
| `./debug/FileOutput.js` | telemetry |
| `./debug/MockConfigurationManager.js` | telemetry |
| `./debug/MockFileOutput.js` | telemetry |
| `./telemetry/types.js` | telemetry |
| `./telemetry/constants.js` | telemetry |
| `./telemetry/uiTelemetry.js` | telemetry |
| `./utils/safeJsonStringify.js` | telemetry |
| `./services/fileSystemService.js` | storage |
| `./services/fileDiscoveryService.js` | storage |
| `./storage/sessionTypes.js` | storage |
| `./policy/policy-engine.js` | policy |

`packages/core/src/debug/index.ts` states it outright: *"Compatibility shim: re-exports all debug
types and classes from the @vybestack/llxprt-code-telemetry package"* — and does it with
`export *`, so core's debug surface is defined by whatever telemetry happens to export.

`MessageBus` is the same pattern in class form: core's is a thin subclass over the policy package's,
existing only "to preserve the historic two-argument constructor."

`settings` has one more (`./storage/Storage.js` → storage).

Roughly 200 imports currently reach telemetry *through* core. Repointing them at the owning package
deletes 14 subpaths and needs no design decisions.

## 5. What leaves the surface

Core's 126 non-root subpaths, bucketed so each is counted exactly once:

| Category | Subpaths | Imports | Production imports | Design needed? |
|---|---|---|---|---|
| Dead — zero importers | 18 | 0 | 0 | No — delete |
| Cross-package re-export shim (§4) | 9 | 227 | 174 | No — repoint at owner |
| Test scaffolding | 3 | 212 | 6 | No — move to `test-utils` |
| Test-only, no production consumer | 8 | 82 | 0 | No — test entry or delete |
| **Mechanical subtotal** | **38 (30%)** | **521** | **180** | **No** |
| **Production internal reach-through** | **88 (70%)** | **2,310** | **978** | **Yes** |

**This is the load-bearing table.** 70% of the surface — 88 subpaths carrying 978 production
imports — consists of production code reaching into core internals. That is the actual problem, and
no amount of shim-removal, dead-path deletion or test-scaffolding relocation touches it.

The mechanical 30% is worth doing first because it is free and because each removal is justified by
coherence, not arithmetic: dead paths have no consumers, shims make core claim ownership of another
package's API, and test scaffolding is not a production contract.

The 88 production reach-throughs are a different question, and it is **not** "how do we get this
number under 20." Most of them are not things that should leave core. They are things core
genuinely owns that consumers currently reach at an internal file path. The work is to decide, for
each, whether it is (a) part of core's published contract and should be named as such, or (b) an
implementation detail whose consumers need a different seam. Some will collapse into a single
well-named entry; some will become internal; a few will move because they belong elsewhere.

Per rule 0, the resulting count is an outcome, not a target.

The largest production reach-throughs:

| Subpath | prod | test |
|---|---|---|
| `services/history/IContent.js` | 150 | 276 |
| `config/config.js` | 127 | 170 |
| `llm-types/index.js` | 66 | 47 |
| `runtime/providerRuntimeContext.js` | 33 | 135 |
| `core/turn.js` | 33 | 35 |
| `confirmation-bus/message-bus.js` | 30 | 31 |
| `runtime/AgentRuntimeContext.js` | 25 | 28 |
| `services/history/HistoryService.js` | 21 | 63 |

The top two alone — the content model and the Config god-object — account for 277 production
imports, and both have designated homes in this proposal (Seam A leaf package, Seam C role
interfaces). They are the highest-leverage targets, not the long tail.

Beyond core: policy exports 9 subpaths and **all 9 are dead**; providers has 28 dead of 42. 65 dead
subpaths repo-wide.

### 5.1 Where zod belongs

Not on the export surface — it cannot express `interface IContent`, and 51.2% of the surface is
types. It belongs on **payloads crossing the seam**: the content model (Seam A), agent events, tool
call payloads. The agents package already does this (`AgentEventSchema`, `AgentToolCallSchema`,
`AgentStopInfoSchema` are on its public surface). Generalising that to the content model would give
a validated boundary where data actually flows, complementing rather than replacing the
compile-time surface control.

## 6. Config role interfaces

`Config` spans 2,514 lines across three files and declares ~200 methods. **81 are called from
outside core; 119 are internal-only** and belong in no published contract.

Cross-package calls cluster into eight roles:

| Role | Members (by call volume) |
|---|---|
| Tools | `getToolRegistry` (70), `getAllowedTools` |
| Provider & model | `get/setProviderManager` (45/14), `get/setProvider`, `get/setModel` (32/7), `refreshAuth` (12), `get/initializeContentGeneratorConfig`, `getEmbeddingModel`, `getTokenizerFactory` |
| Session | `getSessionId` (41), `getMaxSessionTurns`, `isInteractive` |
| Settings | `get/setEphemeralSetting` (33/14), `getEphemeralSettings`, `getSettingsService` (10), `getProfileManager` |
| Workspace | `getWorkspaceContext`, `getTargetDir`, `getProjectRoot`, `getWorkingDir`, `getProjectTempDir` |
| Memory | `get/setUserMemory`, `get/setCoreMemory`, `getGlobalMemory`, `getJitMemoryForPath`, `refreshMemory`, file-count accessors |
| MCP | `getMcpServers`, `getMcpClientManager`, `getMcpInstructions`, `refresh/reloadMcpServers`, `getMcpRuntimeStatus`, `getBlockedMcpServers`, `awaitMcpDiscoveryGate` |
| Policy | `getPolicyEngine` (12), `get/setApprovalMode` |

A ninth group should not become an interface. Roughly 45 methods are called exactly once, and the
single-call tail is almost entirely service getters — `getSkillManager`, `getExtensionLoader`,
`getAsyncTaskManager`, `getShellJobManager`, `getLspServiceClient`, `getSubagentManager`,
`getHookSystem`, `getPromptRegistry`, `getResourceRegistry`. Each is a service fetched *through*
Config instead of injected. These become constructor parameters; they do not belong in any role.

Because 231 of 266 `Config` references are type-only, publishing these roles satisfies the
overwhelming majority of consumers without the implementation moving at all — which means the role
interfaces can land *before* the decomposition and give it a target to converge on.

## 7. Enforcement

Ordered by leverage, reusing what already exists:

1. **Add `types` conditions** to every retained subpath. Core has them on 12 of 127; telemetry 1 of
   21; policy 1 of 10. Without this, removing the wildcard aliases couples typecheck to build order
   and degrades unresolved imports to `any` (TS7016) rather than failing.
2. **`import/no-internal-modules` with `forbid`**, plus a TypeScript resolver. The rule is already
   at error severity and currently catches nothing because its `allow` branch fails open on
   unresolvable specifiers. Switching to `forbid` on the same file flags 5 of 5 deep imports.
   Scope it by `files:` to migrated packages and widen per PR — a monotonic ratchet with no warn
   phase and no disable comments.
3. **Trim the exports maps.**
4. **Delete the wildcard tsconfig paths and vitest resolvers**, per consumer, in the same PR as that
   consumer's migration. `tsc` then enforces the map natively (verified: a path absent from the
   exports map fails with TS2307 under `nodenext` with no aliases).
5. **Lint rule banning `export *`** in public entry points.
6. **Universal package cycle test**, generalised from the currently-dead
   `check-storage-package-cycle.ts`.

The declared-barrel approach makes `check-agents-api-surface.ts` and `expected-root-surface.json`
redundant: a hand-written barrel is validated by `tsc` for free, whereas a snapshot is a derived
artifact whose designed failure response is "regenerate". Snapshots normalise drift; declarations
prevent it.

## 8. Questions resolved from data

### Q1 — Does `HistoryService` need to be a public concrete class? **No.**

| | Sites |
|---|---|
| Total `new HistoryService(...)` | 178 |
| **Production** | **9** |
| Test | 169 |

Of the 9 production sites, 3 are inside core and 1 is a `test-bun` harness file. External
production construction is 5 files, all in agents; cli has none. Publish an interface plus a
core-owned factory; route test construction through a `test-utils` helper.

### Q2 — Should tests share the production API? **No — a separate test entry is justified.**

19 of core's 125 imported subpaths (15%) are reached **only** by test files, accounting for 109
import statements:

| Test-only subpath | test imports |
|---|---|
| `runtime/createAgentRuntimeContext.js` | 35 |
| `runtime/runtimeAdapters.js` | 26 |
| `config/schedulerSingleton.js` | 14 |
| `policy/policy-engine.js` | 9 |
| `test-utils/tools.js` | 4 |

These are exactly the "deep internal paths" the issue objects to — `schedulerSingleton`,
`runtimeAdapters`, `createAgentRuntimeContext` — and they exist purely for test wiring. Treating
tests as ordinary consumers would enshrine test scaffolding in the published contract permanently.

The pattern is not core-specific: **providers has 11 test-only subpaths out of 15 imported (73%)**.

| Target | Imported subpaths | Test-only |
|---|---|---|
| core | 125 | 19 |
| providers | 15 | 11 |
| tools | 41 | 1 |
| settings | 6 | 2 |
| agents | 3 | 2 |
| storage | 9 | 1 |
| telemetry | 16 | 0 |
| auth | 10 | 0 |

Recommendation: one sanctioned test entry per package (or relocation into the existing `test-utils`
workspace), held to the same declared-surface rules so it cannot become a second unbounded API.

### Q3 — Should the content model be a leaf package? **No. It belongs in core.**

An earlier draft of this document proposed extracting it, on the grounds that `IContent.ts` has
zero dependencies and is the most-imported path in the monorepo (426 statements; `IContent` alone
referenced 355 times, 354 type-only), so the extraction would be cheap and would "reduce inbound
pressure on core."

That reasoning was wrong, and its wrongness is instructive.

"Inbound pressure" is not a defect here. Every package depending on core's content model is the
intended DAG working correctly — `tools → core → providers → agents → cli`. The extraction would
not break a cycle (a zero-import file cannot participate in one), would not remove a dependency
(consumers would depend on the new package instead), and would not make anything more coherent. It
would only make core's export count smaller.

That is the count-minimisation trap: optimising the acceptance metric rather than the contract. It
is the same failure mode as the 14 cross-package shims (§4) — moving things sideways so a number
improves, at the cost of a package no longer owning its own vocabulary.

The content model is core's domain vocabulary and stays in core, published as a first-class seam.

## 8b. The proposed contract: 88 reach-throughs collapse into 11 seams

Applying rule 0 — group by domain, name the contract, let the count fall out. Every one of the 88
production reach-through subpaths is assigned to a candidate seam:

| Candidate seam | Paths it absorbs | Production imports |
|---|---|---|
| `./content` | 2 | 216 |
| `./config` (role interfaces, §6) | 6 | 156 |
| `./session` | 8 | 114 |
| `./runtime` (shape settled by #2616) | 7 | 91 |
| `./runtime/contracts` (exists) | 6 | 70 |
| `./policy` | 4 | 42 |
| `./history` | 5 | 35 |
| `./tool-scheduling` | 6 | 28 |
| `./prompts` | 4 | 23 |
| `./hooks` | 3 | 16 |
| `./models` | 3 | 9 |
| **Named subtotal** | **54** | **800** |
| Utility sprawl — needs triage | 22 | 148 |
| Services — needs triage | 8 | 18 |
| Other | 4 | 12 |

Two observations.

**The vocabulary is smaller than the path count suggests.** `./content` is two paths carrying 216
production imports — `services/history/IContent.js` (150) and `llm-types/index.js` (66). The single
highest-traffic seam in the monorepo is two files. Most of the 88 are not distinct concepts; they
are one concept reached at several internal paths.

**The triage bucket is mostly not an API problem at all — it is misplacement.** Resolving the
utility/services paths by consumer profile settles 37 paths:

| Verdict | Paths | Meaning |
|---|---|---|
| **Move to the sole consumer** | **28 (76%)** | exactly one production package imports it |
| Genuine shared seam | 9 | two or more production consumers |

The 28 single-consumer paths are code that lives in core but is used by exactly one other package:
~19 belong to agents (`generateContentResponseUtilities`, `errorReporting`, `thoughtUtils`,
`environmentContext`, `editor`, `complexity-analyzer`, `todo-reminder-service`, `EmojiFilter`,
`asyncTaskManager`, `terminalSerializer`, `loopDetectionService`, `skillManager`, `skillLoader`,
`quotaErrorDetection`, `streamWatchdog`, `asyncIterator`, `tool-utils`, `output-format`, and
`testUtils`), ~6 to providers (`hydration`, `unicodeUtils`, `parameterCoercion`, `registry`,
`ImageGenerationService`), and ~4 to mcp (`resource-registry`, `workspaceContext`,
`safeJsonStringify`). None of these needs a contract. They need to be in the right package, after
which they leave core's surface entirely.

The mcp group is worth noting: `resources/resource-registry.js` and `utils/workspaceContext.js` are
core paths whose only production consumer is mcp — directly relevant to the core⇄mcp cycle work.

Only **9 paths are genuinely shared**, and they are a small kernel rather than a drawer:

| Path | prod | consumers | Concern |
|---|---|---|---|
| `utils/retry.js` | 19 | providers, agents | resilience |
| `utils/debugLogger.js` | 18 | providers, agents, mcp | diagnostics |
| `utils/delay.js` | 16 | providers, agents | resilience |
| `utils/toolOutputLimiter.js` | 13 | providers, agents | tools |
| `utils/errors.js` | 13 | agents, mcp | errors |
| `utils/streamIdleTimeout.js` | 10 | providers, agents | resilience |
| `utils/events.js` | 8 | providers, agents, mcp | diagnostics |
| `utils/secure-browser-launcher.js` | 5 | providers, mcp | auth/browser |
| `parsers/TextToolCallParser.js` | 5 | providers, agents | parsing |

Three of these (`retry`, `delay`, `streamIdleTimeout`) are one concern — streaming resilience — and
two (`debugLogger`, `events`) are diagnostics, which is also where #2617's two-logger duplication
lands. So the shared kernel is roughly four seams, not nine paths.

**This is the strongest evidence for rule 0.** Counting exports would have treated all 37 paths as
surface to be minimised. Grouping by consumer shows 76% of them were never public API in the first
place — they are simply in the wrong package.

Note that `utils/debugLogger.js` (18 production imports) sits here while `debug/DebugLogger.js`
(a shim onto telemetry) sits in §4 — the two-logger duplication #2617 exists to resolve.

So core's published contract lands at roughly a dozen named entries, plus whatever the triage
yields. That is close to the issue's `<20`, but it is an **outcome of grouping by domain**, not a
number that was aimed at — which is the distinction rule 0 exists to protect.

## 9. Coverage gap: the five-issue program does not add up to the whole problem

Attributing each of the 88 production reach-through subpaths to whichever issue's stated scope
would dissolve it (prefix-based attribution — see caveat below):

| Owner | Subpaths | Production imports | Share |
|---|---|---|---|
| **UNOWNED** | **55** | **326** | **33%** |
| This design — Seam A (content model) | 7 | 251 | 26% |
| #2615 Config decomposition | 6 | 156 | 16% |
| #2616 runtime globals | 7 | 91 | 9% |
| Already the designed `runtime/contracts` seam | 6 | 70 | 7% |
| #2617 dedup | 3 | 42 | 4% |
| This design — Seam E (confirmation bus) | 2 | 37 | 4% |
| #2614 gemini containment | 2 | 5 | 1% |

**A third of the production surface is owned by no issue in the program.** The four sibling issues
together account for 18 subpaths and 294 production imports; this design's seams account for 9
subpaths and 288. The remaining 55 subpaths have no home.

The residue is not random. Two coherent domains fall out of it:

**Agent loop / chat session (~130 production imports, no owner):** `core/turn.js` (33),
`core/compression/types.js` (21), `core/clientContract.js` (19), `core/chatSessionTypes.js` (14),
`core/subagentTypes.js` (12), `core/contentGenerator.js` (11), `core/prompts.js` (11),
`core/toolSchedulerContract.js` (7), `core/tokenLimits.js`, `core/lifecycleHookTriggers.js`,
`core/coreToolHookTriggers.js`, `core/compression/continuationDirective.js`. This is a real domain
with a real public contract and nobody has scoped it.

**Utility sprawl (~20 subpaths, ~100 production imports, no owner):** `utils/delay.js`,
`utils/errors.js`, `utils/generateContentResponseUtilities.js`, `utils/toolOutputLimiter.js`,
`utils/streamIdleTimeout.js`, `utils/events.js`, `utils/secure-browser-launcher.js`,
`utils/errorReporting.js`, `utils/thoughtUtils.js`, `utils/editor.js`,
`utils/environmentContext.js`, `utils/unicodeUtils.js`, `utils/parameterCoercion.js`,
`utils/workspaceContext.js`, `utils/terminalSerializer.js`, `utils/asyncIterator.js`,
`utils/quotaErrorDetection.js`, `utils/streamWatchdog.js`, `utils/tool-utils.js` — plus
`utils/testUtils.js`, which is exported *and* imported by production code.

Scattered remainder: `scheduler/*`, `hooks/types.js`, `policy/types.js`, `services/*`,
`prompt-config/*`, `models/*`, `parsers/*`, `filters/*`, `tools-adapters/*`, `skills/*`,
`resources/*`.

**Caveat on method.** Attribution is by path prefix against each issue's stated scope, so it will
under-credit issues whose work removes paths outside their obvious prefix (#2614 and #2617 in
particular). Even under generous re-attribution, the two clusters above remain unowned: no issue in
the program claims the agent-loop contract or the utility surface.

**Implication for sequencing.** Completing #2614–#2617 and then enforcing boundaries would still
leave ~55 subpaths and ~326 production imports needing decisions, discovered at the point where the
enforcement gate is switched on — the worst possible moment. Either the program needs a sixth
workstream for the agent-loop and utility domains, or this design has to specify their public
contract up front so the gap is closed by decision rather than by discovery.

## 10. Remaining decision

Ownership: does this design stand as its own issue ahead of #2614–#2617, or fold into #2615?
The role interfaces in §6 are simultaneously that issue's deliverable and this one's input.
