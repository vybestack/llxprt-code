# Phase 16a: Final Semantic Review

## Phase ID

`PLAN-20260608-ISSUE1585.P16a`

## Purpose

Perform final review of issue intent, behavior preservation, package boundaries, release readiness, and blockers.

## Prerequisites

- Required: P16 completed (full verification suite passes).

## Requirements Implemented

### REQ-PKG-001, REQ-DEP-001, REQ-REL-001

## Review Checklist

### Issue Intent

- [ ] Issue #1585 intent (extract tools package) is fully satisfied.
- [ ] All tool contracts, registry, formatters, and implementations are in packages/tools.
- [ ] No user-visible behavior changes.

### Behavior Preservation

- [ ] CLI startup reaches the same tool registry state.
- [ ] All built-in tools are discoverable and executable through scheduler.
- [ ] Provider tool formatting and ID normalization produce identical output.
- [ ] Shell tool execution works through adapter.
- [ ] Todo/memory/MCP tool behavior preserved through adapters.
- [ ] Key storage masking and resolution preserved.
- [ ] Memory path (LLXPRT dir) resolution preserved.

### Package Boundaries

- [ ] packages/tools does not import core/cli/providers.
- [ ] Core adapters implement tools-owned interfaces only.
- [ ] No core-local interfaces consumed by tools.
- [ ] providers imports tools formatter/ID utilities from @vybestack/llxprt-code-tools.
- [ ] No re-export shims in core.

### Release Readiness

- [ ] .github/workflows/release.yml publishes tools before dependents.
- [ ] release-process.test.js includes tools in publish order.
- [ ] build_sandbox.js packs tools tarball.
- [ ] Dockerfile copies and installs tools tarball.
- [ ] manual-trusted-publishing.md exists with complete checklist.
- [ ] bind-release-deps includes tools.
- [ ] Release order reconciled between tests and workflow.

### MCP Ownership

- [ ] mcp-client.ts and mcp-client-manager.ts remain core infrastructure.
- [ ] mcp-tool.ts moved (or retained with documented rationale).
- [ ] No MCP OAuth/auth code leaked into tools package.

### Tool Key Storage

- [ ] IToolKeyStorage interface defined in tools.
- [ ] maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName moved to packages/tools/src/utils/tool-key-utils.ts.
- [ ] ToolKeyStorage class remains in core (imports SecureStore).
- [ ] CoreToolKeyStorageAdapter delegates to core ToolKeyStorage/SecureStore (adapter owns lifecycle).
- [ ] Tests cover masking, key storage, and storage boundary (observable behavior, not delegation-only).

### Scripts Coverage

- [ ] scripts/version.js includes @vybestack/llxprt-code-tools in actualWorkspaces.
- [ ] scripts/prepare-package.js has copyFiles for tools package.
- [ ] scripts/build.js uses workspaces build (auto-includes tools).

### Dockerfile Ordering

- [ ] Dockerfile COPY tools tarball before core/providers/cli.
- [ ] Dockerfile npm install places tools first in install transaction.
- [ ] Sandbox build packs tools before core/providers/cli (toolsPackageDir=packages/tools/dist).
- [ ] Chmod tools tarball: `chmodSync(tarballPath, 0o755)` (consistent with existing 0o755 in build_sandbox.js).

### Package Metadata

- [ ] packages/tools/package.json has no core/providers/cli dependencies.
- [ ] @vybestack/llxprt-code-test-utils is devDependency-only.
- [ ] IToolFormatter export maps to dist/src/formatters/ (not dist/src/interfaces/).
- [ ] tsconfig references do not create cycles.

### Documentation

- [ ] move-map-final.md documents every file classification.
- [ ] manual-trusted-publishing.md documents npm trusted publisher setup.
- [ ] integration-contract.md documents all interface/adapter mappings.
- [ ] preflight-results.md records approved decisions.

## Final Check

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else"
```

## Success Criteria

- All review checklist items pass.
- Final verification passes.
- No remaining blockers.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P16a.md` with final review assessment.
