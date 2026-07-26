# OCR Concurrency Canary — Issue #2673

This document records the controlled OCR concurrency experiment at 2, 3, and 4
against one fixed pull-request head, preserves comparable measurements, and
documents the evidence-backed decision to change the automatic/default OCR
concurrency from 2 to 3 while keeping manual `workflow_dispatch` selections of
2, 3, and 4 available.

## Protocol

1. Before each dispatch, query active OCR workflow runs with `gh` and proceed
   only when none are active. This avoids cross-run account contention because
   StepFun caps concurrent API requests at five per account, not per session.
2. Dispatch one `workflow_dispatch` run for PR 2610 at the chosen concurrency,
   wait for completion, then download the `ocr-concurrency-canary` artifact
   (`ocr-canary-metrics.json`).
3. Repeat for concurrency 2, 3, and 4, sequentially.
4. The metrics artifact is generated only for `workflow_dispatch` runs. It
   records safe transport telemetry, synchronous command wall timing,
   configured/effective provenance, and the canonical configuration
   fingerprint. Invalid evidence is sanitized to a parseable artifact with
   `valid: false` and `validation_errors` rather than thrown before artifact
   creation.
5. The canary comparison is valid only when all three artifacts pass the
   fixed-configuration equality checks and the decision rules below.

## Isolation checks

- Each run targets PR 2610 at head `cdd6a6cbd7169894d2ad67c7cb8fc5520d86d4d8`.
- The trusted checkout base SHA and merge-base SHA must be equal in every run
  so the reviewed diff is identical.
- The workflow SHA, OCR version, normalized model, canonical config
  fingerprint, monitor hash, rule hash, and OCR config file hash must be
  exactly equal across canaries so concurrency is the only intentional
  variable.
- No raw OCR session JSONL is uploaded; it contains prompts and responses and
  is unnecessary because OCR's result JSON already includes elapsed time,
  token totals, and findings.

## Run URLs

| Concurrency | Run                                                               | Wall time (s)  | Tokens    | Findings | Positive requests |
| ----------- | ----------------------------------------------------------------- | -------------- | --------- | -------- | ----------------- |
| 2           | https://github.com/vybestack/llxprt-code/actions/runs/30185378927 | 2616.549257183 | 4,263,737 | 78       | 338               |
| 3           | https://github.com/vybestack/llxprt-code/actions/runs/30186627852 | 1491.986057633 | 3,540,361 | 59       | 287               |
| 4           | https://github.com/vybestack/llxprt-code/actions/runs/30187396664 | 1156.843271737 | 3,436,574 | 75       | 286               |

## Artifact hashes

The hash covers the downloaded `ocr-canary-metrics.json` file from each run's
`ocr-concurrency-canary` artifact.

| Concurrency | Run artifact | SHA-256                                                            |
| ----------- | ------------ | ------------------------------------------------------------------ |
| 2           | 30185378927  | `1b681557dd919818df8d92442eeaa32379e869dc67eed19549f8eeea57ce6e98` |
| 3           | 30186627852  | `9201ccd19d218359593f67745a2fdb53d73c00cf4fafd15386488cf31d315afb` |
| 4           | 30187396664  | `b1d80714c85eeba1dbd1e618ae503a58cd618bc265bc3f761edbc6ce330ad2be` |

## Full aggregate data

### Concurrency 2

- `command_wall_seconds`: 2616.549257183
- `ocr_internal_elapsed`: `43m37s` / `ocr_internal_elapsed_seconds`: 2617
- `total_tokens`: 4,263,737 (input 3,464,176; output 799,561; cache_read 2,121,984; cache_write 0)
- `findings.total`: 78
  - by_category: `bug` 21, `correctness` 9, `security` 5, `other` 4, `maintainability` 27, `test` 6, `performance` 3, `style` 3
  - by_severity: `high` 16, `medium` 36, `low` 26
- `transport.total_requests`: 338; `responses_by_status`: `{200: 338}`; `http_429_responses`: 0; `retry_events`: 0; `retry_count_header_missing`: 0; `retry_count_header_malformed`: 0

### Concurrency 3

- `command_wall_seconds`: 1491.986057633
- `ocr_internal_elapsed`: `24m52s` / `ocr_internal_elapsed_seconds`: 1492
- `total_tokens`: 3,540,361 (input 2,868,783; output 671,578; cache_read 1,829,504; cache_write 0)
- `findings.total`: 59
  - by_category: `correctness` 4, `maintainability` 27, `test` 6, `correctability` 1, `style` 2, `bug` 14, `other` 2, `performance` 1, `robustness` 2
  - by_severity: `medium` 30, `low` 25, `high` 4
- `transport.total_requests`: 287; `responses_by_status`: `{200: 287}`; `http_429_responses`: 0; `retry_events`: 0; `retry_count_header_missing`: 0; `retry_count_header_malformed`: 0

### Concurrency 4

- `command_wall_seconds`: 1156.843271737
- `ocr_internal_elapsed`: `19m17s` / `ocr_internal_elapsed_seconds`: 1157
- `total_tokens`: 3,436,574 (input 2,731,254; output 705,320; cache_read 1,551,104; cache_write 0)
- `findings.total`: 75
  - by_category: `bug` 22, `reliability` 1, `maintainability` 36, `security` 1, `correctness` 6, `test` 8, `other` 1
  - by_severity: `high` 4, `low` 36, `medium` 35
- `transport.total_requests`: 286; `responses_by_status`: `{200: 286}`; `http_429_responses`: 0; `retry_events`: 0; `retry_count_header_missing`: 0; `retry_count_header_malformed`: 0

## Provenance equality

All three artifacts report exact equality for:

- `pull_request`: 2610
- `head_sha`: `cdd6a6cbd7169894d2ad67c7cb8fc5520d86d4d8`
- `trusted_checkout_base_sha`: `be8f36c6e1c7f7d3a90a5955e7eab80906d695d6`
- `merge_base_sha`: `be8f36c6e1c7f7d3a90a5955e7eab80906d695d6`
- `provenance.workflow_sha`: `620f1bacf2228eb0789c43c2a38c71068e1afc52`
- `provenance.actual_ocr_version`: `1.7.16`
- `provenance.effective_endpoint.normalized_model`: `step-3.7-flash`
- `provenance.effective_endpoint.protocol`: `openai`
- `provenance.effective_endpoint.provider_url_sha256`: `9aee381219f852c56c256571df4a47ae8df506ecbe561b259e86c499233e9268`
- `provenance.effective_endpoint.language`: `English`
- `provenance.canonical_config_fingerprint`: `07e9843a9866129d7f53852cab8610fbd3b3d35e89345c376b1961d4b8f433db`
- `provenance.monitor_sha256`: `95a050dd74e7ef0d938fbc3de4f60c318bbde94b989b10d8f13a473a5a1d303b`
- `provenance.rule_json_sha256`: `72d04310bab50b48d6d0932a3313fe7a6a2453a0df9da1490c73bd89f4dd510c`
- `provenance.configured_ocr_settings_sha256`: `a3024bfe2b533c6c9de8c360382f3ef0e8d975006b9c8ad64e9d38a88e529238`
- `provenance.ocr_config_file_sha256`: `b94bbdef6bcf16ff77aadeb1da909afcd13aa68fb1dec988bacc8eb850f9f42d`
- `provenance.review_timeout_minutes`: 30
- `provenance.background_enabled`: true
- `provenance.audience`: `agent`
- `provenance.format`: `json`

The cross-artifact comparison validator (`scripts/ocr-canary-compare-2673.cjs`)
confirms all of the above are equal and emits `valid: true` for the three local
artifacts.

## Calculations

Wall-time speedup is `(baseline - candidate) / baseline`, using the
independently measured synchronous `ocr review` command wall seconds.

- c3 vs c2: `(2616.549257183 - 1491.986057633) / 2616.549257183` = **0.4298**
  (~43.0% faster)
- c4 vs c2: `(2616.549257183 - 1156.843271737) / 2616.549257183` = **0.5579**
  (~55.8% faster)
- c4 vs c3: `(1491.986057633 - 1156.843271737) / 1491.986057633` = **0.2246**
  (~22.5% faster)

All three runs reported zero 429 responses and zero retry events.

## Finding category/severity variability

Finding counts and distributions vary across runs (78 / 59 / 75). OCR's model
output is nondeterministic, so the distributions are a sanity check rather than
a deterministic quality score. All three runs reviewed the same 63 files at
the same head SHA.

## Token/model nondeterminism caveat

Token totals (4,263,737 / 3,540,361 / 3,436,574) also vary with
nondeterministic model output. The single run at each concurrency does not
establish that concurrency caused the token differences. Token counts are
reported for transparency but are not part of the decision rule.

## Primary metric: command wall time

The primary decision metric is `timing.command_wall_seconds`, the
independently measured synchronous `ocr review` command wall time (including
nonzero exits). `timing.ocr_internal_elapsed_seconds` is retained only as
secondary internal runtime corroboration; it agrees with wall time to within
one second in all three runs (2617/2616.5, 1492/1492.0, 1157/1156.8).

## 30-minute per-task OCR timeout vs overall run duration

OCR's `--timeout` is a per-task limit (30 minutes per file review). The
overall run duration is the sum of all sequential and parallel file reviews
plus OCR's auxiliary LLM calls (planning, fact-checking, summarization). A
63-file review at concurrency 2 took ~43 minutes of wall time even though no
single task approached the 30-minute per-task timeout. The per-task timeout
does not bound the overall run duration.

## Invalid/excluded runs

- `30183854462` — excluded: dispatched before the version-provenance fix. Its
  metrics validation failed because `actual_ocr_version` could not be parsed,
  so it did not produce `valid: true` evidence comparable to the final runs.
- `30185333767` — excluded and canceled: another OCR run (`30185164782`) was
  already active when this run was dispatched, violating the isolation
  protocol for the account-wide StepFun request cap.

## Recommendation

Change the automatic/default/fallback OCR concurrency from 2 to 3, while
keeping `workflow_dispatch` explicit selections of 2, 3, and 4 available
(the declared `workflow_dispatch` default is now 3).

### Why 3, not 4

- c3 is ~43.0% faster than c2 with zero 429s and zero retries, satisfying the
  issue's decision rule (adopt 3 if zero 429 and >30% faster than 2).
- c4 is ~22.5% faster than c3 with zero 429s and zero retries. However, the
  StepFun account-wide concurrent request cap is five. Two simultaneous OCR
  runs at concurrency 4 would attempt up to 8 concurrent requests, exceeding
  the cap. There is no safe dynamic cross-PR concurrency guard available in
  GitHub Actions today, so making 4 the automatic default would risk 429s
  whenever two PRs trigger OCR close together.
- Concurrency 3 keeps a safety margin: even two simultaneous runs at 3 each
  (~6 concurrent requests) are borderline but far less likely to exceed the
  cap than two runs at 4 each. The auto-review limit (#2666) further reduces
  simultaneous runs, making 3 safer as the default.
- Dispatch option 4 is preserved for controlled isolated runs where an
  operator has verified no other OCR run is active.

### Scope isolation

Only the `OCR_CONCURRENCY` fallback expression and the `workflow_dispatch`
default were changed. OCR version (1.7.16), model, rules, timeout (30 minutes
per task), prompt, review range, and authorization are unchanged.
