# Phase 10a: Providers Stub Verification

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P10a`

## Verification Goals

- Provider stubs compile
- Plan markers present

## Verification Steps

1. Check markers
   - `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P10" packages/core/src/providers`
2. Run typecheck
   - `npm run typecheck`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P10.md`
