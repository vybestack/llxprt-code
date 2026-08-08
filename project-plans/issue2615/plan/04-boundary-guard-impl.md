# P04 — Boundary Guard: Implementation, Report-Only

Plan ID: PLAN-20260808-ISSUE2615.P04
Requirement: REQ-001.1

## Goal

`scripts/check-config-boundary.ts` making P03's tests pass. Wired into
`package.json` `lint` and CI **in report-only mode** so the migration phases can
watch the number fall without breaking the build.

## Requirements

- TypeScript compiler API, not regex. The three known over-report modes of
  `config-narrow-candidates.ts` (forwarding, constructors, untracked receivers)
  must not be repeated.
- Prints a per-package count and a per-file list.
- `--enforce` flag flips to exit 1. Default is report-only until P12.
- Registered in `tsconfig.scripts.json`.

## Acceptance

- All P03 tests pass, none modified
- `npm run lint` includes it and stays green
- Reports the true current count, which P01 predicts
