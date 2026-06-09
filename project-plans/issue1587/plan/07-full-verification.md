# Phase 07: Full Repository Verification and Smoke

## Phase ID

`PLAN-20260608-ISSUE1587.P07`

## Requirements Implemented

- REQ-TEST-001: Full repository verification passes.

## Verification Commands

Run from repository root:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`

## Completion

- Update `.completed/P07.md` with outputs.
- Return status and any known limitations.
