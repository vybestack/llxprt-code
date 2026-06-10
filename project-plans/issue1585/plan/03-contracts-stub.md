# Phase 03: Scaffold + Tool Contract Stubs

## Phase ID

`PLAN-20260608-ISSUE1585.P03`

## Purpose

Create packages/tools scaffold AND add minimal tools-owned contract/interface stubs in one phase. This resolves the phase-order inconsistency where contracts were created before the package existed. All contracts are tools-owned; no core-local interfaces consumed by tools.

## Prerequisites

- Required: P02c completed (integration contracts verified, cycle-free).
- Previous artifacts: integration-contract.md, pseudocode, analysis files.

## Requirements Implemented

### REQ-PKG-001, REQ-API-001, REQ-INTERFACE-OWNERSHIP

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-INTERFACE-OWNERSHIP, REQ-PKG-BOUNDARY, REQ-TEMPORARY-INTERFACES

**Behavior specification**:
- GIVEN: Integration contracts are defined and verified as cycle-free
- WHEN: packages/tools scaffold and interface stubs are created
- THEN: All 15+ interface stubs exist and compile without importing core/cli/providers; packages/tools is in workspaces; no core-local interfaces consumed by tools exist

**Why it matters**: If interfaces accidentally import from core, the type-level dependency direction is already violated before any code moves.

## Implementation Tasks

### Step 1: Create packages/tools Scaffold

Create the skeleton package structure:

```bash
mkdir -p packages/tools/src/interfaces
mkdir -p packages/tools/src/formatters
mkdir -p packages/tools/src/tools
mkdir -p packages/tools/src/utils
mkdir -p packages/tools/src/__tests__
mkdir -p packages/tools/dist
```

Create `packages/tools/package.json` following `packages/providers/package.json` conventions:

```json
{
  "name": "@vybestack/llxprt-code-tools",
  "version": "0.10.0",
  "description": "LLxprt Code Tools — built-in tool implementations, contracts, formatters, and registry",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/vybestack/llxprt-code.git"
  },
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "node ../../scripts/build_package.js",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:ci": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "files": ["dist"],
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^24.2.1",
    "@vybestack/llxprt-code-test-utils": "file:../test-utils",
    "typescript": "^5.3.3",
    "vitest": "^3.2.4"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Create `packages/tools/tsconfig.json` following providers pattern.
Create `packages/tools/vitest.config.ts` following providers pattern.
Create `packages/tools/src/index.ts` with empty exports initially.
Create `packages/tools/.eslintrc.js` following providers pattern.

### Step 2: Create Tools-Owned Interface Stubs

Create all 15 interface files in `packages/tools/src/interfaces/`:

- `packages/tools/src/interfaces/IToolHost.ts` — method signatures for target dir, workspace roots, approval mode, interactive, feature flags
- `packages/tools/src/interfaces/IToolRegistryHost.ts` — core/exclude tools, discovery, enablement
- `packages/tools/src/interfaces/IToolMessageBus.ts` — confirmation request, policy update
- `packages/tools/src/interfaces/IShellExecutionService.ts` — execute, isCommandAllowed
- `packages/tools/src/interfaces/ISubagentService.ts` — executeSubagent, listSubagents, getSubagentConfig
- `packages/tools/src/interfaces/IAsyncTaskService.ts` — checkAsyncTask, getTaskStatus
- `packages/tools/src/interfaces/ISkillService.ts` — activateSkill, getSkillManager
- `packages/tools/src/interfaces/IMcpToolService.ts` — callTool, discoverTools
- `packages/tools/src/interfaces/IIdeService.ts` — applyDiff, getConnectionStatus, openDiff
- `packages/tools/src/interfaces/ILspService.ts` — getDiagnostics, waitForDiagnostics
- `packages/tools/src/interfaces/IStorageService.ts` — getLLXPRTDir, readFile, writeFile, ensureDir
- `packages/tools/src/interfaces/IToolKeyStorage.ts` — saveKey, getKey, deleteKey, hasKey, resolveKey, maskKeyForDisplay, getSupportedToolNames
- `packages/tools/src/interfaces/ITodoService.ts` — getTodoStore, getReminderService, getContextTracker, getDefaultAgentId
- `packages/tools/src/interfaces/ISettingsService.ts` — getSettingsService, getSetting, setSetting (unconditionally defined; semantically distinct from IToolRegistryHost even if current usage routes through it, because settings will get its own package)
- `packages/tools/src/interfaces/IPromptRegistryService.ts` — getPromptRegistry, getPrompt (unconditionally defined; semantically distinct from IToolRegistryHost even if current usage routes through it, because prompt registry will get its own package)
- `packages/tools/src/interfaces/index.ts` — barrel export

Each interface MUST:
- Be defined in packages/tools (tools-owned)
- Import NO modules from packages/core, packages/cli, packages/providers
- Use only packages/tools-local types or standard library types

### Step 3: Add Workspace Entry

Edit `package.json` root to add `"packages/tools"` to workspaces array.

### Files To Create

- `packages/tools/package.json`
- `packages/tools/tsconfig.json`
- `packages/tools/vitest.config.ts`
- `packages/tools/.eslintrc.js`
- `packages/tools/src/index.ts`
- `packages/tools/src/interfaces/IToolHost.ts`
- `packages/tools/src/interfaces/IToolRegistryHost.ts`
- `packages/tools/src/interfaces/IToolMessageBus.ts`
- `packages/tools/src/interfaces/IShellExecutionService.ts`
- `packages/tools/src/interfaces/ISubagentService.ts`
- `packages/tools/src/interfaces/IAsyncTaskService.ts`
- `packages/tools/src/interfaces/ISkillService.ts`
- `packages/tools/src/interfaces/IMcpToolService.ts`
- `packages/tools/src/interfaces/IIdeService.ts`
- `packages/tools/src/interfaces/ILspService.ts`
- `packages/tools/src/interfaces/IStorageService.ts`
- `packages/tools/src/interfaces/IToolKeyStorage.ts`
- `packages/tools/src/interfaces/ITodoService.ts`
- `packages/tools/src/interfaces/index.ts`

### Files To Modify

- `package.json` (add packages/tools to workspaces)

## Verification Commands

```bash
# Typecheck in tools package
npm run typecheck --workspace @vybestack/llxprt-code-tools
# Verify no forbidden imports in interfaces
rg -n "@vybestack/llxprt-code-core\|packages/core/src\|@vybestack/llxprt-code-providers\|packages/providers/src\|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches
# Verify all 15 interface files exist
ls packages/tools/src/interfaces/ITool*.ts packages/tools/src/interfaces/IShell*.ts packages/tools/src/interfaces/ISubagent*.ts packages/tools/src/interfaces/IAsync*.ts packages/tools/src/interfaces/ISkill*.ts packages/tools/src/interfaces/IMcp*.ts packages/tools/src/interfaces/IIde*.ts packages/tools/src/interfaces/ILsp*.ts packages/tools/src/interfaces/IStorage*.ts packages/tools/src/interfaces/ITodo*.ts 2>&1
# Verify workspace entry
node -e "const p=require('./package.json'); console.log(p.workspaces.includes('packages/tools'))"
```

## Semantic Verification Checklist

- [ ] All 15 interface stubs exist and compile without core/cli/providers imports.
- [ ] No core-local interfaces consumed by tools exist.
- [ ] packages/tools scaffold follows providers/package.json pattern.
- [ ] Workspaces include packages/tools.

## Success Criteria

- Typecheck passes for packages/tools.
- Forbidden import scan returns zero matches.
- All interface stubs are tools-owned.

## Failure Recovery

Fix interface stubs that accidentally import core. Do not proceed to P03a until clean.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P03.md` with files created and verification output.
