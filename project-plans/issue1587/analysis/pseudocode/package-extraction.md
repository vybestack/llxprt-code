# Pseudocode: Package Extraction

Plan ID: PLAN-20260608-ISSUE1587

## Interface Contracts

Inputs:
- Existing MCP source/test files in `packages/core`.
- Existing package configuration conventions.

Outputs:
- New `packages/mcp` workspace package.
- Updated imports and re-exports.
- Passing package and repository verification.

## Algorithm

10: CREATE `packages/mcp` package scaffold.
11: ADD workspace registration in root `package.json`.
12: ADD package dependencies needed by moved MCP code.
13: MOVE `packages/core/src/mcp/**` to `packages/mcp/src/auth/**` preserving tests.
14: MOVE `packages/core/src/tools/mcp-*` to `packages/mcp/src/client/**` preserving tests.
15: REWRITE moved relative imports to match new locations.
16: DEFINE narrow package boundary types/interfaces only when required to avoid concrete core config/tool registry coupling.
17: EXPORT auth, client, status, token, and interface APIs from `packages/mcp/src/index.ts`.
18: EXPORT root package entry from `packages/mcp/index.ts`.
19: UPDATE package exports in `packages/mcp/package.json` for root and useful subpaths.
20: UPDATE `packages/core` to use and re-export `@vybestack/llxprt-code-mcp` APIs.
21: UPDATE direct CLI/A2A imports where appropriate and add direct dependencies for packages that import MCP.
22: RUN package-specific tests for mcp, core, cli, and a2a-server.
23: RUN repository verification suite.
24: FIX import/type/test failures without reverting user changes or touching `.llxprt/`.
25: COMMIT and create PR.

## Anti-Pattern Warnings

- DO NOT create duplicate MCP implementations.
- DO NOT leave old moved files in `packages/core/src/mcp` or `packages/core/src/tools/mcp-*` as active parallel code.
- DO NOT introduce dependencies from `packages/mcp` to `packages/cli` or `packages/providers`.
- DO NOT remove backward-compatible core exports.
