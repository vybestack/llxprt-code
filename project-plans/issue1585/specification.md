# Feature Specification: Extract Tools Package

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585 Extract packages/tools

## Purpose

Refactor tool contracts, registry, formatters, and tool implementations out of packages/core/src/tools into a dedicated packages/tools workspace package. This is an architectural refactoring for modularity and maintainability, not a user-visible behavior change. Existing CLI, subagent, MCP, filesystem, search, edit, web, memory, and todo tool behavior must remain reachable through the same runtime paths.

## Current State Summary

Issue #1584 already extracted packages/providers. That work established the package-extraction pattern this plan follows: classify ownership before moving files, prevent package cycles, avoid compatibility shims, update package metadata and release workflows, write behavioral regression tests before migration, and add forbidden import scans.

Current issue #1585 is harder than issue #1584 because tools are foundational core runtime contracts. Evidence gathered during planning:

- packages/core/src/tools contains 150 TypeScript files, 79 test/spec files, and 152 total relevant files including snapshots.
- packages/core/src/config/toolRegistryFactory.ts imports every built-in tool class from ../tools and wires them into ToolRegistry.
- packages/core/src/tools/tools.ts imports IDE diff types, schema validation, MessageBus, confirmation-bus types, terminal serialization, and tool confirmation types.
- packages/core/src/tools/tool-registry.ts imports Config, MessageBus, DebugLogger, mcp-tool, shell-quote, and tool base classes.
- packages/providers currently imports tool formatter and tool ID utilities from @vybestack/llxprt-code-core/tools/... after issue #1584.
- packages/settings, packages/storage, and packages/mcp do not currently exist.
- .github/workflows/release.yml publishes core, lsp, providers, and cli, but does not publish tools.
- scripts/tests/release-process.test.js encodes release package expectations and must be updated with a tools publish/package order.

## Architectural Decisions

- Pattern: package-boundary refactoring with contract-first migration, adapter-based dependency inversion, and integration-first verification.
- Technology Stack: TypeScript strict mode, Node.js >=20, npm workspaces, existing scripts/build_package.js, Vitest.
- Target Package: @vybestack/llxprt-code-tools in packages/tools.
- Final Dependency Direction:
    packages/tools      -> no core/cli/providers imports
    packages/core       -> packages/tools
    packages/providers  -> packages/tools + packages/core as still required by issue #1584 interim architecture
    packages/cli        -> packages/core + packages/providers only
    packages/cli        -X-> packages/tools unless direct imports are intentionally added and documented
- Adapter Boundary: core owns adapters for Config, MessageBus, shell execution, subagent/task services, MCP managers, IDE/LSP services, skill management, async tasks, and current storage/config implementations until separate packages exist.
- **Approved Missing-Packages Decision**: The plan approves a temporary tools-owned interface/core-adapter path for issue #1585 while still forbidding packages/tools from importing core/cli/providers. tools-owned interfaces are defined in `packages/tools/src/interfaces/**`; core adapters in `packages/core/src/tools-adapters/**` implement these interfaces. When packages/settings, packages/storage, or packages/mcp are created in the future, the corresponding temporary interfaces and adapters are replaced by direct imports from those packages.
- **MCP Constraint**: mcp-client.ts and mcp-client-manager.ts are client/manager infrastructure, not simple tool implementations. They remain in core. mcp-tool.ts may move only when it can depend on a tools-owned `IMcpToolService` interface or equivalent.
- Contract Ownership: All interfaces consumed by tools MUST be tools-owned (defined in `packages/tools/src/interfaces/**`). Core may only implement adapters. No core-local interfaces consumed by tools.
- No Compatibility Shims: do not leave core files that merely re-export or forward packages/tools APIs for old deep import paths. Core may re-export public tool APIs from its top-level package only if the plan explicitly preserves the existing top-level core API and verifies no deep-import shim files remain.

## Project Structure

project-plans/issue1585/
  specification.md
  execution-tracker.md
  phase_manifest.tsv
  manual-trusted-publishing.md
  analysis/
    dependency-audit.md
    final-architecture.md
    tool-move-map.md
    release-process.md
    preflight-results-template.md
    preflight-results.md
    issue-body-and-comments.md
    verification-matrix.md
    interface-contracts-detailed.md
    dependency-relocation-final.md
    consumer-rewrite-map-final.md
    all-tool-consumers-final.md
    package-metadata-constraints.md
    tool-config-usage.txt
    all-tool-consumers-final.txt
    pseudocode/
      package-boundary.md
      consumer-migration.md
      release-updates.md
  plan/
    00-overview.md
    00a-preflight-verification.md
    01-analysis.md
    01a-analysis-verification.md
    02-pseudocode.md
    02a-pseudocode-verification.md
    02b-integration-contract.md
    02c-integration-contract-verification.md
    03-contracts-stub.md
    03a-contracts-stub-verification.md
    04-contracts-tdd.md
    04a-contracts-tdd-verification.md
    05-contracts-impl.md
    05a-contracts-impl-verification.md
    06-package-scaffold-stub.md
    06a-package-scaffold-stub-verification.md
    07-package-scaffold-tdd.md
    07a-package-scaffold-tdd-verification.md
    08-package-scaffold-impl.md
    08a-package-scaffold-impl-verification.md
    09-tool-inventory-and-move-map.md
    09a-tool-inventory-and-move-map-verification.md
    10-tool-move-tdd.md
    10a-tool-move-tdd-verification.md
    11-tool-move-impl.md
    11a-tool-move-impl-verification.md
    12-core-adapters-and-registry-integration.md
    12a-core-adapters-and-registry-integration-verification.md
    13-consumer-migration.md
    13a-consumer-migration-verification.md
    14-release-process.md
    14a-release-process-verification.md
    15-cleanup-no-shims.md
    15a-cleanup-no-shims-verification.md
    16-full-verification.md
    16a-final-review.md

## Technical Environment

- Type: TypeScript monorepo CLI/library refactoring.
- Runtime: Node.js >=20.
- Package Manager: npm workspaces for repository scripts.
- Build: node ../../scripts/build_package.js inside packages.
- Testing: Vitest via workspace scripts and root scripts.
- Existing packages: core, providers, cli, a2a-server, test-utils, vscode-ide-companion, lsp.
- Existing packages consuming tool types through core: a2a-server (via Config.getToolRegistry(), ToolRegistry, and core re-exports).
- Missing packages: settings, storage, mcp (approved temporary adapter path recorded).

## Integration Points

### Existing Code That Will Use The Extracted Package

- packages/core/src/config/toolRegistryFactory.ts - creates and registers built-in tools.
- packages/core/src/config/config.ts and configBase*.ts - hold ToolRegistry, McpClientManager, memory path helpers, and tool configuration state.
- packages/core/src/core/* and packages/core/src/scheduler/* - use ToolRegistry, ToolResult, ToolErrorType, ToolContext, ToolConfirmationOutcome, AnyToolInvocation, and tool display types.
- packages/core/src/agents/* - use ToolRegistry and concrete validation tools for agent execution.
- packages/core/src/confirmation-bus/* - currently imports tool confirmation types.
- packages/core/src/telemetry/* - imports tool confirmation outcomes and MCP tool telemetry types.
- packages/core/src/prompts/* - imports MCP prompt/tool types.
- packages/a2a-server/src/agent/task.ts - uses Config.getToolRegistry() and ToolRegistry-shaped values for tool discovery and execution in A2A agent tasks.
- packages/a2a-server/src/utils/testing_utils.ts - provides mock Config with getToolRegistry() for A2A test infrastructure.
- packages/a2a-server/src/http/app.test.ts - tests A2A HTTP layer with mock getToolRegistry().
- packages/providers/src/* - imports ToolFormatter, IToolFormatter, ToolIdStrategy, doubleEscapeUtils, toolIdNormalization, and toolNameUtils from core tools after issue #1584.
- scripts/build_sandbox.js, Dockerfile, release workflow, and release-process tests - must package/publish/install the new tools package when it becomes an npm release package.

### Existing Code To Be Replaced Or Removed

- packages/core/src/tools/* files whose ownership moves to packages/tools/src/*.
- core deep package exports for moved tool modules in packages/core/package.json.
- provider imports from @vybestack/llxprt-code-core/tools/* for utilities that move to packages/tools.
- direct Config and MessageBus constructor dependencies inside moved concrete tools, replaced by tools-owned interfaces and core-owned adapters.

### User Access Points To Preserve

- CLI startup through node scripts/start.js.
- Tool discovery and built-in tool registration via toolRegistryFactory.
- Model tool-call execution through CoreToolScheduler and scheduler components.
- Subagent tools, task tools, todo tools, MCP tools, shell tools, filesystem/edit/search/web/memory tools.
- Provider-specific tool formatting and tool ID normalization behavior.

### Migration Requirements

- No user configuration or data migration is expected. However, key storage/memory path behavior still needs regression coverage.
- Package metadata, lockfile, release workflow, release tests, sandbox packing, and Dockerfile must be updated when packages/tools becomes publishable.
- Existing tests must move with their production code or be rewritten only where imports/package boundaries require it.
- The implementation must avoid old deep import compatibility wrapper files in core.

## Formal Requirements

[REQ-PKG-001] Tools Package Boundary
  [REQ-PKG-001.1] packages/tools MUST be created as @vybestack/llxprt-code-tools following packages/providers/package.json conventions for metadata, tsconfig, Vitest, build, files, engine, and export map.
  [REQ-PKG-001.2] packages/tools MUST NOT depend on packages/cli or packages/providers.
  [REQ-PKG-001.3] packages/tools MUST NOT import from packages/core production modules in the final state.
  [REQ-PKG-001.4] packages/core and packages/providers may depend on packages/tools if no package cycle is introduced.
  [REQ-PKG-001.5] Tool key storage ownership MUST be split: IToolKeyStorage and pure utility functions (maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) move to packages/tools; the SecureStore/@napi-rs/keyring-backed ToolKeyStorage implementation remains in packages/core until packages/storage exists. CoreToolKeyStorageAdapter implements IToolKeyStorage and owns the SecureStore-backed lifecycle. If packages/settings and packages/storage remain absent, the approved temporary tools-owned interface/core-adapter path is used. Implementation does not stop at preflight. Pure functions (maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) and the IToolKeyStorage interface are owned by packages/tools. ToolKeyStorage class with SecureStore imports stays in packages/core/src/tools/tool-key-storage.ts as STAY_CORE_INFRASTRUCTURE. CoreToolKeyStorageAdapter owns the ToolKeyStorage+SecureStore instance internally and MUST NOT delegate to a moved ToolKeyStorage class.

[REQ-API-001] Tool Contracts And Public API
  [REQ-API-001.1] packages/tools MUST expose a clean public API for tool contracts, invocation/result types, ToolContext, confirmation types, tool names/constants, error types, registry entry points, formatters, and moved tool implementations.
  [REQ-API-001.2] Every moved tool MUST implement explicit tools-owned interfaces rather than importing Config, MessageBus, core services, cli, or providers.
  [REQ-API-001.3] ToolContext MUST remain a narrow injectable context and MUST NOT become a grab-bag of global services.
  [REQ-API-001.4] ToolRegistry public entry points MUST discover and instantiate tools using explicit host/service interfaces.
  [REQ-API-001.5] All interfaces consumed by tools MUST be tools-owned (in packages/tools/src/interfaces/). Core may only implement adapters. No core-local interfaces consumed by tools.

[REQ-MOVE-001] Tool Ownership Migration
  [REQ-MOVE-001.1] Low-coupling utilities and contracts MUST be classified and moved or intentionally retained with written rationale.
  [REQ-MOVE-001.2] Concrete tools MUST be moved only after their core dependencies are inverted behind tools-owned interfaces.
  [REQ-MOVE-001.3] mcp-client.ts and mcp-client-manager.ts MUST remain in core as MCP infrastructure; mcp-tool.ts may move only when IMcpToolService dependency is met.
  [REQ-MOVE-001.4] Tests and snapshots for moved code MUST move with the code and continue verifying behavior.
  [REQ-MOVE-001.5] Tool key storage ownership MUST be split: IToolKeyStorage and pure utility functions (maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) move to packages/tools; the SecureStore/@napi-rs/keyring-backed ToolKeyStorage implementation remains in packages/core until packages/storage exists. CoreToolKeyStorageAdapter implements IToolKeyStorage and owns the SecureStore-backed lifecycle. Tests for pure functions move with them; SecureStore integration tests stay in core. This is an explicit split (not a move of the whole file): pure functions/interface go to packages/tools, SecureStore-backed implementation stays in core per STAY_CORE_INFRASTRUCTURE classification.

[REQ-DEP-001] Dependency Direction And Cycle Prevention
  [REQ-DEP-001.1] No production dependency cycle may exist among core, tools, providers, cli, a2a-server, settings, storage, or mcp.
  [REQ-DEP-001.2] Forbidden import scans MUST prove packages/tools/src does not import packages/core, packages/cli, or packages/providers.
  [REQ-DEP-001.3] Forbidden import scans MUST prove packages/core/src/tools contains no compatibility wrappers for moved modules after cleanup.
  [REQ-DEP-001.4] Provider imports of moved tool formatting/ID utilities MUST be updated to @vybestack/llxprt-code-tools.
  [REQ-DEP-001.5] packages/core/src/tools after cleanup MUST contain only approved retained-file list items with explicit rationale.
  [REQ-DEP-001.6] CLI does NOT directly depend on packages/tools unless intentional direct imports are added and documented; CLI receives tool types through core top-level re-exports.
  [REQ-DEP-001.7] A2A server uses ToolRegistry through core re-exports only and does not need a direct packages/tools dependency.

[REQ-TEST-001] Behavioral Refactoring Verification
  [REQ-TEST-001.1] Tests MUST prove representative built-in tools still execute through the existing ToolRegistry and scheduler paths.
  [REQ-TEST-001.2] Tests MUST prove provider tool formatting and tool ID normalization behavior remains unchanged after import migration.
  [REQ-TEST-001.3] Tests MUST prove package boundary rules by detecting forbidden imports and forbidden shim files.
  [REQ-TEST-001.4] Tests MUST be behavioral, not reverse tests, mock theater, or structure-only checks.
  [REQ-TEST-001.5] Named behavioral regression tests MUST exist for filesystem, edit/apply-patch/AST, registry/scheduler integration, provider formatting/ID normalization, shell/todo/MCP, memory/key storage, and boundary scans.

[REQ-REL-001] Release And Trusted Publishing
  [REQ-REL-001.1] packages/tools MUST be added to root workspaces, package-lock, package versioning, release dependency binding, and build order as needed.
  [REQ-REL-001.2] .github/workflows/release.yml MUST publish @vybestack/llxprt-code-tools with npm provenance and correct ordering before packages that depend on it.
  [REQ-REL-001.3] scripts/tests/release-process.test.js MUST include tools in publish order, tarball preparation, sandbox packing, and Dockerfile install assertions.
  [REQ-REL-001.4] scripts/build_sandbox.js and Dockerfile MUST pack/copy/install the tools tarball if tools is needed by unpublished local sandbox builds.
  [REQ-REL-001.5] The plan MUST include project-plans/issue1585/manual-trusted-publishing.md with a manual npm trusted publishing setup checklist for @vybestack/llxprt-code-tools.

[REQ-CLEAN-001] Cleanup And No Shims
  [REQ-CLEAN-001.1] Old core tool source files that move to packages/tools MUST be removed from packages/core/src/tools.
  [REQ-CLEAN-001.2] No V2, New, compatibility wrapper, or parallel tool implementation files may be introduced.
  [REQ-CLEAN-001.3] Full project verification required: npm run test, npm run lint, npm run typecheck, npm run format, npm run build, and node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else".

## Data Schemas

No new runtime user data schema is introduced. Package metadata follows packages/providers/package.json pattern with explicit top-level plus subpath exports.

## Package Export Policy

- Top-level export "." provides the full public API.
- Subpath exports for modules needed by providers and other direct consumers, matching current @vybestack/llxprt-code-core/tools/* paths.
- No core deep-import shims. packages/core/package.json removes ./tools/* exports for moved modules.
- Packages that need tools modules import @vybestack/llxprt-code-tools or its subpath exports.

## Constraints

- This is a refactor: no intentional behavior changes.
- No tools-to-core production dependency in the final packages/tools package.
- No packages/tools dependency on cli or providers.
- packages/cli -X-> packages/tools unless direct imports are intentionally added and documented.
- A2A server uses core re-exports for ToolRegistry; no direct tools dependency needed.
- Explicit dependency direction block:
    packages/tools      -> no core/cli/providers imports
    packages/core       -> packages/tools
    packages/providers  -> packages/tools + packages/core as still required by issue #1584 interim architecture
    packages/cli        -> packages/core + packages/providers only
    packages/cli        -X-> packages/tools unless direct imports are intentionally added and documented
- Tools-owned interfaces only; no core-local interfaces consumed by tools.
- TDD is mandatory for production changes; write package-boundary and behavioral regression tests before moving production code.
- Integration tests must be defined before unit-only migration assertions.
- Existing .llxprt contents must not be modified.

## Performance Requirements

- Tool package extraction must not add duplicate tool registration, duplicate service initialization, or additional startup passes.
- Tool execution should remain equivalent in latency except for noise from unchanged subprocess/network operations.
- Build order must remain deterministic under npm run build and npm run build --workspaces.
