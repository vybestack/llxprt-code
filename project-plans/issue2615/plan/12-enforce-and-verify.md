# P12 — Flip to Enforcing, Full Verification

> **SUPERSEDED — DO NOT EXECUTE.** See `../STATUS.md`. This plan targeted type
> width; the real problem is that `Config` mixes configuration, construction,
> injection and service location. Kept for the reasoning and the recorded dead
> ends only.

Plan ID: PLAN-20260808-ISSUE2615.P12
Requirement: REQ-007

## Goal

Guard in enforcing mode, everything green, PR ready to close #2615.

## Steps

1. Flip `scripts/check-config-boundary.ts` to enforcing in `lint`
2. Full suite, in this order, all must pass:
   - `npm run typecheck`
   - `npm run lint` (now includes the enforcing guard)
   - `npm run lint:affected-shards`
   - `npm run check:lockfile`
   - `npm run format`
   - `npm run build`
   - `npm run test`
   - `npm run test:scripts`
   - `bun scripts/check-cli-import-boundary.ts`
   - `bun scripts/check-agents-api-surface.ts`
   - `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
3. Push, dispatch CI via `gh workflow run ci.yml --ref issue2615`, watch to green
4. Update PR #3118 body to state **Closes #2615** with the final measurements

## Known environment facts

- `npm run test` does NOT include the scripts shard or the affected-shards guard
- cli typechecks core through `dist`; rebuild core after core changes
- agents and cli shards produce occasional 30000ms timeout flakes; a failure is
  only real if it reproduces in isolation. Prove it before claiming otherwise.

## Acceptance

- Guard enforcing and exiting 0
- Every command above green
- CI green on PR #3118
- REQ-001 through REQ-007 all satisfied
