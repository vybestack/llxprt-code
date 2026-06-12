# Phase 09: Complete Tool Inventory And Move Map

## Phase ID

`PLAN-20260608-ISSUE1585.P09`

## Purpose

Regenerate complete per-file move map from current filesystem. Classify every file exactly once. Define import rewrite categories, runtime dependency relocation, and retained-file list with rationale.

## Prerequisites

- Required: P08a completed (release wiring verified).
- Artifacts: all analysis files, contracts, build/release infrastructure, dependency-relocation-final.md.

## Requirements Implemented

### REQ-MOVE-001, REQ-CLEAN-001, REQ-MOVE-MAP, REQ-CONFIG-REPLACEMENT

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-MOVE-MAP, REQ-CONFIG-REPLACEMENT, REQ-RETAINED-CORE-TOOLS

**Behavior specification**:
- GIVEN: Build/release infrastructure is wired and verified
- WHEN: Complete per-file move map is produced from current filesystem
- THEN: Every .ts file is classified exactly once (zero UNCLASSIFIED entries); every `this.config.*` usage is mapped to an interface; retained-file allowlist has explicit rationale for each entry

**Why it matters**: Missing or double-classified files cause silent data loss or conflicting actions. Missing Config mappings cause build failures during P11.

## Implementation Tasks

### Step 1: Generate Current File Inventory

```bash
find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/current-tools-files-final.txt
find packages/core/src/tools -type f \( -name '*.snap' -o -name '*.md' \) | sort > project-plans/issue1585/analysis/current-tools-non-ts-final.txt
```

### Step 2: Classify Every File

For each file, assign exactly one classification:

| Classification | Meaning |
| --- | --- |
| MOVE_NOW | Contract/utility with no core deps, can move immediately |
| MOVE_AFTER_INTERFACE | Depends on core services, can move after interface/adapters exist |
| STAY_CORE_INFRASTRUCTURE | Core infrastructure that stays in packages/core/src/tools/ permanently |
| STAY_UNTIL_FUTURE_PKG | Stays in packages/core/src/tools/ until packages/settings, packages/storage, or packages/mcp exist. **Strict criteria**: (1) the file imports a core service that has no tools-owned interface and cannot be feasibly abstracted; (2) the file's primary purpose belongs in the target future package, not in tools; (3) moving it to packages/tools would require either duplicating core service behavior or creating a complex interface that will be replaced when the future package exists. STAY_UNTIL_FUTURE_PKG MUST NOT be used to avoid extraction — if a file can cleanly move to packages/tools with existing interfaces, it MUST be classified MOVE_AFTER_INTERFACE instead. Every STAY_UNTIL_FUTURE_PKG entry MUST have explicit justification documenting why MOVE_AFTER_INTERFACE is not feasible. |
| TEST_MOVES_WITH_SOURCE | Test/spec file moves with its production file |
| DELETE_AFTER_MIGRATION | File to remove in P15 (re-export shims, temp files) |

### Step 3: Produce Move Map Table

Create `analysis/move-map-final.md` with columns:

| Source Path | Classification | Target Path (if moving) | Interface Dependencies | Import Rewrites | Rationale |

### Step 4: Produce Approved Retained-File List

Files that STAY in packages/core/src/tools/ after P15:

- `mcp-client.ts` — STAY_CORE_INFRASTRUCTURE (OAuth/auth infrastructure)
- `mcp-client-manager.ts` — STAY_CORE_INFRASTRUCTURE (MCP client lifecycle management)
- `tool-key-storage.ts` — STAY_CORE_INFRASTRUCTURE (SecureStore/keyring-backed ToolKeyStorage class; only pure functions maskKeyForDisplay/getSupportedToolNames/isValidToolKeyName move to packages/tools)
- `mcp-client.test.ts` — TEST_STAYS_WITH_SOURCE (stays with mcp-client)
- `mcp-client-manager.test.ts` — TEST_STAYS_WITH_SOURCE (stays with mcp-client-manager)
- `tool-key-storage.test.ts` (if exists) — TEST_STAYS_WITH_SOURCE (SecureStore integration test)

For issue #1585, mcp-client.ts and mcp-client-manager.ts are the ONLY approved retained core tools infrastructure in `packages/core/src/tools/`. `tool-key-storage.ts` retains the ToolKeyStorage class because it imports SecureStore. Any other retained file must have explicit rationale recorded.

### Step 5: Import Rewrite Categories

| Rewrite Category | Pattern | Example |
| --- | --- | --- |
| TYPE_IMPORT | `import type { X } from '../tools/Y'` → `import type { X } from '@vybestack/llxprt-code-tools'` | ToolRegistry, ToolContext |
| CONCRETE_IMPORT | `import { X } from '../tools/Y'` → `import { X } from '@vybestack/llxprt-code-tools'` | ToolFormatter, toolNameUtils |
| SUBPATH_IMPORT | `import { X } from '@vybestack/llxprt-code-core/tools/Y'` → `import { X } from '@vybestack/llxprt-code-tools/Y'` | provider imports |
| ADAPTER_INJECTION | Constructor takes interface instead of Config | shell, task, mcp-tool |
| BARREL_UPDATE | packages/core/src/index.ts re-exports | tool types re-exported from tools pkg |

### Step 6: tool-key-storage.ts Ownership Decision (per review-02)

**Decision**: packages/tools OWNS `IToolKeyStorage`, `maskKeyForDisplay`, `getSupportedToolNames`, `isValidToolKeyName`, and any facade that delegates ONLY to injected tools-owned storage/key interfaces. packages/core OWNS secure-store/@napi-rs/keyring-backed implementations until packages/storage exists. CoreToolKeyStorageAdapter MUST NOT delegate to a moved ToolKeyStorage class unless that class is package-local pure/facade behavior with no core storage imports.

Classification:
- `tool-key-storage.ts` — MOVE_AFTER_INTERFACE (pure functions move; ToolKeyStorage class stays in core)
  - ProviderKeyStorage import → replaced by IToolKeyStorage interface
  - SecureStore import → replaced by IToolKeyStorage (CoreToolKeyStorageAdapter owns ToolKeyStorage+SecureStore lifecycle; adapter MUST NOT import moved ToolKeyStorage class)
  - `maskKeyForDisplay`, `getSupportedToolNames`, `isValidToolKeyName` → move to `packages/tools/src/utils/tool-key-utils.ts` (pure functions, no deps)
  - `IToolKeyStorage` → already in `packages/tools/src/interfaces/IToolKeyStorage.ts`
  - `ToolKeyStorage` class → STAYS in `packages/core/src/tools/tool-key-storage.ts` (imports SecureStore)
  - CoreToolKeyStorageAdapter creates and owns ToolKeyStorage instance internally (must NOT delegate to a moved class unless that class is package-local pure/facade with no core storage imports)
  - Tests for masking/key-storage behavior move with pure functions to packages/tools
  - Tests for ToolKeyStorage+SecureStore integration stay in core

### Step 7: Dependency Relocation (per dependency-relocation-final.md)

For every non-relative import used by moved tools files, classify and add to `packages/tools/package.json`:

```bash
# Full tools import dependency inventory
rg -n "^import .* from ['\"][^./]" packages/core/src/tools -g "*.ts" | \
  rg -v "vitest|@types|node:|child_process|fs'|fs/|fs\"|path'|path\"|os'|os\"|crypto|events|string_decoder|stream"
```

Classification rules:
- Runtime dependency: imported by production (non-test) moved files
- devDependency: imported only by test files (e.g., vitest, test utilities)
- FORBIDDEN: `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code`

Update `packages/tools/package.json` dependencies per dependency-relocation-final.md §"packages/tools/package.json Dependencies (Final)".

**Core dependency remediation check**: If any external dependency remains imported by core after a tool move (for example `zod-to-json-schema` in `packages/core/src/agents/executor.ts`), it must also be declared directly in `packages/core/package.json` and recorded in `package-lock.json`. Do not remove a dependency from core until core has no production imports of it.

### Step 8: Non-Tools Core Dependency Classification (per final-architecture.md Non-Tools Core Dependency Rule)

Run the non-tools core relative import scan:
```bash
rg -n "from ['"]\.\./" packages/core/src/tools -g "*.ts" | rg -v "from ['"]\.\./tools/" > project-plans/issue1585/analysis/non-tools-core-relative-imports.txt
```

Classify every import in `analysis/non-tools-core-dependency-map.md` with columns:

| File | Import Path | Classification | Target In packages/tools | Rationale |

Allowed classifications: `MOVE_PURE_UTILITY`, `MOVE_TYPE_ONLY`, `TOOLS_OWNED_INTERFACE`, `CORE_ADAPTER`, `STAY_WITH_RETAINED_CORE_TOOL`, `REPLACE_WITH_TOOLS_OWNED_TYPE`, `FORBIDDEN_UNRESOLVED`.

**Failure gate**: P09 MUST NOT complete if any import is `FORBIDDEN_UNRESOLVED`. Every non-tools core import must have a viable resolution.

After classifying utilities to move, scan their external dependencies:
```bash
xargs rg -n "^import .* from ['"][^./]" < project-plans/issue1585/analysis/moved-non-tools-utils.txt > project-plans/issue1585/analysis/moved-utility-external-imports.txt
```

Add every discovered external runtime dependency to `packages/tools/package.json` dependencies.

### Step 9: MCP Ownership Classification

For issue #1585:
- `mcp-client.ts` — STAY_CORE_INFRASTRUCTURE (in `packages/core/src/tools/`)
- `mcp-client-manager.ts` — STAY_CORE_INFRASTRUCTURE (in `packages/core/src/tools/`)
- `mcp-tool.ts` — MOVE_AFTER_INTERFACE (only if constructor accepts IMcpToolService instead of Config+MessageBus)

**Decision artifacts required before P03/P10/P11**: `analysis/mcp-tool-decision.md` and `analysis/lsp-diagnostics-helper-decision.md`. These must be produced no later than P09 and consumed by P03 (contract stub design), P10 (test planning), and P11 (migration groups).

### Step 10: MCP Tool Decision Artifact

Produce `analysis/mcp-tool-decision.md` containing:

1. **Actual import list** of `mcp-tool.ts` (evidence: `rg -n "^import .* from" packages/core/src/tools/mcp-tool.ts -g "*.ts" > project-plans/issue1585/analysis/mcp-tool-imports.txt`)
2. **Per-import classification**: for each import, state whether it can be satisfied by `IMcpToolService` alone or requires additional core coupling
3. **Final decision**: `MOVE_AFTER_INTERFACE` or `STAY_CORE_INFRASTRUCTURE`
4. **Justification**: if STAY_CORE_INFRASTRUCTURE, document which imports prevent the move and add mcp-tool.ts to the retained-file allowlist with documented rationale

This artifact is a **gating prerequisite** for P11 Group 8. P11 MUST NOT execute Group 8 unless this artifact exists and contains a final decision.

### Files To Create

- `analysis/move-map-final.md`
- `analysis/current-tools-files-final.txt`
- `analysis/current-tools-non-ts-final.txt`
- `analysis/non-tools-core-relative-imports.txt`
- `analysis/non-tools-core-dependency-map.md`
- `analysis/moved-non-tools-utils.txt`
- `analysis/moved-utility-external-imports.txt`
- `analysis/mcp-tool-decision.md` (see Step 10 below)
- `analysis/lsp-diagnostics-helper-decision.md` (required before P03/P10/P11; classify MOVE_AFTER_INTERFACE or STAY_CORE_INFRASTRUCTURE)
- Create: `project-plans/issue1585/.completed/P09.md`

## Verification Commands

```bash
# Verify every .ts file is classified exactly once
WC_TOOLS=$(find packages/core/src/tools -type f | wc -l)
WC_MAP=$(grep -c "^packages/core/src/tools" project-plans/issue1585/analysis/move-map-final.md)
echo "Tools files: $WC_TOOLS, Map entries: $WC_MAP"
# Must be equal
# Verify no unclassified files
grep -c "UNCLASSIFIED" project-plans/issue1585/analysis/move-map-final.md
# Expected: 0
# Verify retained-file list is explicit
grep -c "STAY_CORE_INFRASTRUCTURE\|STAY_UNTIL_FUTURE_PKG" project-plans/issue1585/analysis/move-map-final.md
# Verify packages/tools/package.json has required runtime dependencies
node -e "const p=require('./packages/tools/package.json'); if (!p.dependencies || Object.keys(p.dependencies).length < 5) process.exit(1)"
# Verify no forbidden dependencies
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"
# Verify test-utils is devDependency-only
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"
```

## Semantic Verification Checklist

- [ ] Every .ts file is classified exactly once.
- [ ] No UNCLASSIFIED entries remain.
- [ ] Retained-file list has explicit rationale for each.
- [ ] tool-key-storage classification follows review-02 decision (pure functions move, ToolKeyStorage class stays).
- [ ] MCP ownership is explicit: mcp-client/manager stay, mcp-tool moves only if IMcpToolService met.
- [ ] packages/tools/package.json has all required runtime dependencies.
- [ ] packages/tools/package.json has no forbidden dependencies.
- [ ] test-utils is devDependency-only.
- [ ] Non-tools core relative imports scanned and classified in analysis/non-tools-core-dependency-map.md.
- [ ] Zero FORBIDDEN_UNRESOLVED entries in non-tools-core-dependency-map.
- [ ] Moved utility external dependencies scanned and added to packages/tools/package.json.
- [ ] MCP tool decision artifact (analysis/mcp-tool-decision.md) exists with final MOVE/STAY decision.
- [ ] LSP diagnostics helper decision artifact (analysis/lsp-diagnostics-helper-decision.md) exists with final MOVE/STAY decision.

## Success Criteria

- Complete move map with zero unclassified files.
- Approved retained-file list with rationale.
- packages/tools/package.json dependencies match dependency-relocation-final.md.

## Failure Recovery

Return to P09 to classify missing files.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P09.md` with classification summary, dependency list, and gaps.
