# The eager purge coordinator is removed; both persisted production cases pass

`SemanticMediaPurgeCoordinator`, its array transaction and its array-valued
configuration are removed from `semantic-media-purge.ts`. The module remains
because the streaming implementation uses its scalar contracts, boundary identity
and row-value helpers. Its existing public re-export no longer exposes the
removed classes or configuration. No compatibility adapter was added.

Evidence is under
`tmp/verify854/p05d/legacy-purge-remove-20260930T2158-sol/`.
`final-summary.json` records the focused commands, final-source static gates,
body digests, reference inventory, assertion ledger and protected hashes.

## Callers and test placement

The source inventory scanned 6,059 package, plugin and script TypeScript files.
It found no executable references to the three removed symbols. There were no
production callers of the eager coordinator left to migrate. Historical planning
text and an untouched comment in `subagentNonInteractive.issue3535.test.ts` still
mention its old name; they are not callers.

The nineteen old coordinator behavior cases now exercise
`SemanticMediaPurgeStreamCoordinator`. Their assertion counts are preserved per
case. Test-side collection replaces array indexing where required, persistence
checks compare the actual row-source identities, and frontier restoration is
observed after asynchronous `begin`. Transaction and history cleanup is explicit.
The cases retain summary, oldest-first selection, MIME errors, frontier rebasing,
cache gating, stale commit and rollback, concurrent append, persistence rejection,
compensation and AggregateError ordering checks.

The two independent expected-value consumers now import
`semantic-purge-eager-test-oracle.ts`. It retains the earlier eager candidate
algorithm only for test expectations. It has no commit or rollback lifecycle,
no production importers and no public package export. The streaming candidate
and production body expectations are not computed by the streaming coordinator.

The original two no-array cases are relocated from core to
`packages/agents/src/core/semantic-purge-array-seam.test.ts`, where the production
session lives. Their original titles and coordinate assertions remain. Those
coordinates are measured from actual candidate block differences. The expanded
cases compare every candidate row, preserve tool and media values, check the
frontier, traverse explicit-cache requests twice, reject foreign cache evidence,
commit to the same real recorder used by the history journal, restore every row
on rollback, reject duplicate completion and check closed cursors and owner
release. The 512/8192 sizes and 440-owner/8-MiB predicates are unchanged.

Relocation fixed a root typecheck failure caused by importing agents source
from a core test. A token comparison confirms that relocation changed imports
only. No compiler exclusions or package-boundary enforcement were changed.

A package-surface test exposed the missing streaming coordinator subpath export,
which workspace aliases had masked. Core now exports
`services/history/semantic-purge-stream.js` with declaration, Bun-source and built
import targets. The new public-import test performs real persisted row commit
and rollback with all three eager-access traps active. Initial fixture attempts
and their failures remain in the evidence directory; the passing fixture uses
the same chronology-bearing persisted row contract as the production cases.

## Verification

| Group | Result |
| --- | --- |
| Unchanged original atomicity/density cases | 31 pass |
| Semantic stream cases, including faults, lifecycle and oversized row | 18 pass |
| Unchanged production session suite | 4 pass |
| Relocated persisted production no-array cases | 2 pass |
| Migrated coordinator behavior cases | 19 pass |
| Recorder, preflight, ordering, durable folds and mutation protocol | 80 pass |
| Responses, production and curated provider body matrices | 4 + 24 + 12 pass |
| Adjacent session, request, cache, admission and chat cases | 53 pass |
| Original purge recorder and deterministic durable owner controls | 2 + 2 pass |
| Public streaming package surface | 1 pass |

The main focused manifest has 247 passing test executions across 26 commands,
excluding the structural suite. Final-source confirmations overlap these runs;
counts are not a full-repository or unique-test acceptance claim. All forty
saved actual/expected provider body pairs match byte-for-byte. The production
matrix covers Responses, Anthropic and Gemini, both persisted sizes, candidate
and explicit-cache requests, caching on/off and repeated preparation. Responses
also forces transport retry. These are local transport comparisons, not evidence
of remote cache writes.

An isolated unmodified production-session copy passes both no-array cases.
Each of six independently mutated copies fails both cases: constructor `getAll`,
materializer and `transformAll` calls; a wrong candidate; accepted foreign cache
evidence; and omitted rollback. Mutation controls use the real downstream
coordinator, history and recorder. They do not modify production source files.
The first mutation harness attempt had unresolved package imports and is retained
as a failed harness run, not accepted control evidence.

Final official root typecheck and root lint pass. All 596 dirty code files pass
forced 800/80 ESLint with zero warnings and Prettier checks. The modified core
package JSON also passes Prettier. The final audit retains all 2,126 baseline
identities with zero additions or removals, ignoring only line numbers and
preserving multiplicity. An initial duplicate-assertion finding in the new public
test was resolved by using separate committed/restored counters; both cardinality
assertions remain. The report formatting and `git diff --check` pass.

The structural suite remains at 18 passes and two failures, with the same five
findings: `materializeHistory`, `captureChronology`, `getRawHistory`, `getAll` and
`getCurated`. Its mutation controls pass. The scanner, whitelist and assertions
were not changed. All 23 protected file hashes match the starting state, including
`.llxprt` contents, raw-memory controls, the estimator and enforcement files.

## Remaining limits

There is no active eager purge coordinator in the inspected production graph.
The eager recorder API remains available on the recording contract and has an
independent recording test, but the chat purge callback uses the row API. External
consumers outside this checkout were not inspected; removal of the old exported
coordinator is an API change.

Provider enforcement, hooks, telemetry and request conversion still retain whole
request arrays. The five structural findings remain unresolved. Instrumented
owner predicates and eager-access traps do not prove that every JavaScript
reference is bounded. No statistical retained-heap lane was run on the busy
host, and no full-provider memory acceptance is claimed.

Earlier dirty work and raw evidence were preserved. No `.llxprt`, immutable raw
history, scanner, threshold or enforcement edit was made. No GitHub, commit,
push, OCR, PR or merge action was performed.
