# Phase 01: Package Scaffold

## Phase ID

`PLAN-20260608-ISSUE1587.P01`

## Requirements Implemented

- REQ-PKG-001: Create `packages/mcp` as a workspace package.

## Implementation Tasks

- Create `packages/mcp/package.json` following workspace conventions.
- Create `packages/mcp/tsconfig.json`.
- Create `packages/mcp/vitest.config.ts` with workspace source aliases for mcp/core.
- Create `packages/mcp/index.ts` and `packages/mcp/src/index.ts`.
- Add `packages/mcp` to root workspaces.
- Run `npm install --package-lock-only` or equivalent lockfile update if needed by npm workspace metadata.

## Verification

- `npm run typecheck --workspace @vybestack/llxprt-code-mcp` should at least resolve package config after files exist.
