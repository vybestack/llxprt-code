# Plan: Extract packages/mcp

Plan ID: PLAN-20260608-ISSUE1587
Generated: 2026-06-08
Total Phases: 8
Requirements: REQ-PKG-001, REQ-MOVE-001, REQ-MOVE-002, REQ-API-001, REQ-COMPAT-001, REQ-INT-001, REQ-NOCYCLE-001, REQ-TEST-001

## Critical Reminders

1. Follow `dev-docs/COORDINATING.md`.
2. Execute phases sequentially.
3. Verify each phase before proceeding.
4. Preserve compatibility through core re-exports.
5. Do not touch `.llxprt/`.

## Phases

| Phase | Title | Subagent |
|---|---|---|
| P00a | Preflight verification | typescriptexpert |
| P01 | Package scaffold tests/config | typescriptexpert |
| P02 | Move auth code/tests | typescriptexpert |
| P03 | Move client code/tests | typescriptexpert |
| P04 | Public API and core compatibility | typescriptexpert |
| P05 | Consumer integration updates | typescriptexpert |
| P06 | Package verification and fixes | typescriptexpert |
| P07 | Full repository verification and smoke | typescriptexpert |

## Success Criteria

- `packages/mcp` exists and is a workspace.
- MCP auth/client/tool code lives in `packages/mcp`.
- Backward-compatible core exports remain available.
- Direct consumers compile and tests pass.
- Full verification suite passes.
- PR exists for issue #1587.
