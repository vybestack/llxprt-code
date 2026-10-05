# All 30 compression fixture regressions repaired; memory acceptance remains open

The unchanged seven-suite run reproduced 36 passes and 30 failures. After fixture
migration, the same 66 tests pass together with zero failures, zero skips and 187
executed assertions. Every original test title and assertion statement remains
token-identical. Retry counts, fault types, commit rejection, snapshot identity,
projection diagnostics and cooldown/recency policies were preserved.

Evidence is in
`tmp/verify854/p05d/highdensity-regression-fixtures-20261001T210742Z/`.
`test-contract-inventory.md` enumerates all 66 original tests, including the 30
regressions, their starting fixtures, invoked routes, act steps and assertions.
Starting sources and RED logs remain available; earlier stage evidence was not
edited. `final-summary.json` and `gates-closing/manifest-with-body.json` record
closing results.

## Cause and fixture repair

Primary compression dispatch now uses disk runners rather than the array strategy
factory. The old tests installed array-only strategies while selecting
high-density, so their intended failures, attempts and candidate histories no
longer reached production. No production compatibility branch was added.

| Suite | Original failures | Repaired fixture |
| --- | ---: | --- |
| `CompressionHandler.chronology.test.ts` | 4 | Real disk candidate spool at the one-shot strategy seam; real span calculation, chronology stamping and publication |
| `compression-provider-fallback-propagation.test.ts` | 4 | Real journal and estimator faults seed three failed disk attempts; original pending/provider commit fixtures remain |
| `compression-recency.test.ts` | 5 | Real one-shot provider transport, forwarding disk fallback observer and estimator failures |
| `compression-retry-behavior.test.ts` | 8 | Provider faults retain HTTP, Anthropic overload, SDK-wrapped, permanent and empty-summary injection |
| `compression-retry-cooldown.test.ts` | 2 | Switchable provider success/failure and disk fallback estimator failures |
| `compression-retry-hardlimit.test.ts` | 6 | Provider attempt counters and failures; existing pending-window fallback contract retained |
| `transcriptPathContext.test.ts` | 1 | Forwarding disk strategy observation and summary provider over real history |

Most summary tests now select one-shot with enough real journal rows to exercise
its planner. The chronology tests retain their deliberately chosen membership at
the disk strategy seam because membership is input to the publication behavior
under test. The two empty-summary tests retain a one-row source and explicitly
invoke the provider failure at that seam; this preserves their unchanged
single-row fallback consequence. Both cases use real disk source/candidate state
and real handler retry, fallback and publication. Their special strategy seam does
not establish planner coverage; the independent disk suites provide that coverage.

Pending/provider hard-limit fallback still invokes its array contract. Its existing
snapshot and rejection doubles remain where that contract is the subject of the
test. Obsolete primary factory branches were removed. No history cap, row cap,
threshold change or assertion downgrade was introduced.

The timing fixtures spy only on `Date.now`, leaving timers and disk I/O active.
The original 61,000-ms clock advance and 60,000-ms production window remain intact.
Earlier failed fixture attempts and static checks remain in separate logs.

## Closing verification

The deduplicated ordinary union has 318 passes and zero failures: the 66 repaired
cases, 35 high-density disk cases, the original 31 chronology/atomicity cases, 108
provider BODY-matrix cases, 20 provider ownership cases, 57 retry-classification
cases and the combined optimizer/compressor's 512-row case. The latter invocation
explicitly selected 512 rows; the separate 8192-row case was not rerun.

All eight BODY matrices pass. All 108 saved actual/expected body pairs match as
bytes without JSON normalization, including 24 high-density before/after pairs.
The artifact count is separate from the matrix test count; some matrices do not
save their bodies under the configured output variables.

Agents production TypeScript, agents Bun-test TypeScript and scoped TypeScript for
all eight BODY matrices pass. Scoped ESLint passes with forced 800 effective lines
per file, 80 per function and zero warnings. Prettier and diff-check pass. The
line-drift-independent, duplicate-preserving audit remains at 2,117 findings with
no additions or removals. All 17 protected hashes and all 20 captured high-density
source/test hashes match, including the unchanged optimized integration test.

## Remaining failures and limits

The adverse retaining control still produces its four required failures, covering
borrowed and copied histories at 512 and 8192 rows. These failures are recorded
separately from the ordinary union.

The structural scanner still has 18 passes and two production-surface failures.
Its four unchanged findings are `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getAll` and
`HistoryService.getCurated`. Mutation controls pass. None of the scanner's rules,
whitelist or assertions was changed.

The separate combined 8192-row optimizer/compressor timeout remains unresolved.
Its source, fixture size, assertions and explicit 180,000-ms deadline are unchanged.
The previous stage's timeout evidence still applies; this fixture repair does not
claim that case now passes.

This stage repairs the seven fixture-suite regressions. It does not establish
whole-session bounded memory, no-leak acceptance, a quiet-host retained-growth
sweep or repository-wide build/test acceptance. No production source, `.llxprt`,
protected source or enforcement policy was changed. No GitHub, commit, push, OCR,
PR or merge action was performed.
