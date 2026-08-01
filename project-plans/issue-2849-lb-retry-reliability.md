# Issue #2849: LB Profile Reliability for Transient 429

## Problem

A load-balancer `failover` profile (e.g., "glm" = zai + ollamaglm51 + chutes)
loopbreaks more frequently than the standalone zai profile. The root cause is
twofold:

1. **429 treated as immediate-failover**: `isImmediateFailoverError()` classified
   HTTP 429 (rate limited) alongside 401/402/403 as an "immediate failover"
   signal. This caused the LB to skip same-backend retry entirely and immediately
   advance to the next backend on every 429.

2. **Default retryCount=1**: The per-backend retry count defaulted to 1, so even
   non-immediate errors got only a single attempt per backend per rotation.

Combined, these meant: with 3 backends and a transport-attempt budget of 6, the
LB completed only 2 full rotations — far fewer effective retries than a standalone
provider (which retries 429s with exponential backoff up to the same budget).

## Acceptance Matrix

| # | Behavior | Evidence |
|---|----------|----------|
| A1 | A transient 429 on the primary backend is retried on the SAME backend before failing over | `LoadBalancingProvider.issue2849.test.ts` — "retries a transient 429 on the same backend" |
| A2 | After exhausting per-backend retries on persistent 429, the LB advances to the next backend | `LoadBalancingProvider.issue2849.test.ts` — "fails over after exhausting per-backend retries" |
| A3 | Auth errors (401/402/403) still cause immediate failover without same-backend retry | `LoadBalancingProvider.issue2849.test.ts` — "still immediately fails over on 401" |
| A4 | When the primary has a transient 429 and others are exhausted, the LB succeeds on the primary's retry | `LoadBalancingProvider.issue2849.test.ts` — "succeeds when primary transient + others exhausted" |
| A5 | All backends persistently 429 → bounded aggregate error (3 × retryCount invocations) | `LoadBalancingProvider.issue2849.test.ts` — "throws bounded aggregate when all persistent 429" |
| A6 | Default `failover_retry_count` is 2 | `extracted-helpers.behavior.test.ts` — default assertion updated to 2 |
| A7 | Issue #2450 orchestrator-level retry still works (all-429 rotation retried) | `LoadBalancingProvider.retryBoundary.integration.test.ts` — Scenario A & B pass unchanged |

## Non-Goals

- Changing the transport-attempt budget model (shared budget consumption per backend)
- Adding within-LB exponential backoff (the orchestrator already provides backoff at the rotation level)
- Changing the circuit-breaker or TPM-threshold logic
- Modifying the round-robin strategy path
- Changing the bucket-failover system (separate from LB failover)

## Changes

### Production (1 file, 2 lines changed)

**`packages/providers/src/loadBalancing/failoverSettings.ts`**:
1. `extractFailoverSettings()`: default `failover_retry_count` changed from 1 → 2
2. `isImmediateFailoverError()`: removed 429 from immediate-failover status codes

### Tests (8 files)

- **`LoadBalancingProvider.issue2849.test.ts`** (new): 5 behavioral acceptance tests
- **7 existing test files**: pinned `failover_retry_count: 1` in configs for tests
  that verify error messages, sticky index, compression, lifecycle, and token
  accounting (not retry behavior). This preserves each test's original intent
  while letting the production default change take effect.

## Scope Ledger

| Item | Status | Notes |
|------|--------|-------|
| Files changed | 11 (9 modified + 2 new) | Under 25-file budget |
| Net changed lines | ~35 insertions, ~8 deletions (production) + ~260 lines (new test) | Under 1,500-line budget |
| New subsystem? | No | |
| New public abstraction? | No | |
| Workflow/CI change? | No | |
| Dependency change? | No | |
