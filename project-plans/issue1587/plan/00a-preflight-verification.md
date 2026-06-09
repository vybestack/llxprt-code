# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260608-ISSUE1587.P00a`

## Purpose

Verify assumptions before moving code.

## Required Checks

- `npm ls @modelcontextprotocol/sdk google-auth-library`
- Confirm `packages/auth` and `packages/tools` directories do not exist, or adapt if they do.
- Confirm source files listed in `analysis/domain-model.md` exist.
- Confirm package conventions from `packages/providers` and `packages/core`.
- Confirm import consumers from repository search.

## Deliverables

- Update `project-plans/issue1587/.completed/P00a.md` with command outputs and any plan adjustments.
