# Phase 02: Contract-First Pseudocode

## Phase ID

`PLAN-20260608-ISSUE1585.P02`

## Purpose

Create numbered pseudocode for package boundary, consumer migration, service adapters, registry integration, and release updates. Each pseudocode line must reference exact interface names, file paths, and adapter targets.

## Prerequisites

- Required: P01a completed (analysis verified covering all 18 consumer groups).
- Artifacts from P01a: all analysis files verified.

## Requirements Implemented

### REQ-API-001, REQ-DEP-001, REQ-REL-001, REQ-INTERFACE-OWNERSHIP

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-INTERFACE-OWNERSHIP, REQ-PKG-BOUNDARY, REQ-RELEASE-PROCESS

**Behavior specification**:
- GIVEN: Analysis is verified covering all consumer groups
- WHEN: Pseudocode is written for package boundary, consumer migration, and release updates
- THEN: Pseudocode references exact interface names, exact provider files, exact release file edits; no implementation code in pseudocode

**Why it matters**: Pseudocode is the bridge between analysis and implementation. Vague pseudocode leads to ambiguous implementation.

## Implementation Tasks

### Step 1: Update analysis/pseudocode/package-boundary.md

Rewrite to include exact interface definitions per `00-overview.md` table:

```
10: METHOD defineToolsPackageBoundary()
11:   CREATE packages/tools/src/interfaces/IToolHost.ts
12:     METHODS: getTargetDir(): string, getWorkspaceRoots(): string[], getApprovalMode(): ApprovalMode, isInteractive(): boolean, hasFeatureFlag(flag): boolean
13:   CREATE packages/tools/src/interfaces/IToolRegistryHost.ts
14:     METHODS: getCoreTools(): string[], getExcludeTools(): string[], getDiscoveryCommand(): string|undefined, isToolEnabled(name): boolean
15:   CREATE packages/tools/src/interfaces/IToolMessageBus.ts
16:     METHODS: requestConfirmation(details): Promise<ToolConfirmationOutcome>, publishPolicyUpdate(outcome): Promise<void>
17:   CREATE packages/tools/src/interfaces/IShellExecutionService.ts
18:     METHODS: execute(command, options): Promise<ShellResult>, isCommandAllowed(command): boolean
19:   CREATE packages/tools/src/interfaces/ISubagentService.ts
20:     METHODS: executeSubagent(request): Promise<SubagentResult>, listSubagents(): SubagentInfo[], getSubagentConfig(name): SubagentConfig|undefined
21:   CREATE packages/tools/src/interfaces/IAsyncTaskService.ts
22:     METHODS: checkAsyncTask(taskId): Promise<TaskStatus>, getTaskStatus(): TaskInfo[]
23:   CREATE packages/tools/src/interfaces/ISkillService.ts
24:     METHODS: activateSkill(name): Promise<SkillResult>, getSkillManager(): SkillManager
25:   CREATE packages/tools/src/interfaces/IMcpToolService.ts
26:     METHODS: callTool(serverName, toolName, params): Promise<Part[]>, discoverTools(): Promise<DiscoveredTool[]>
27:   CREATE packages/tools/src/interfaces/IIdeService.ts
28:     METHODS: applyDiff(params): Promise<DiffResult>, getConnectionStatus(): IDEConnectionStatus, openDiff(params): Promise<void>
29:   CREATE packages/tools/src/interfaces/ILspService.ts
30:     METHODS: getDiagnostics(filePath): Diagnostic[], waitForDiagnostics(filePath, timeout): Promise<Diagnostic[]>
31:   CREATE packages/tools/src/interfaces/IStorageService.ts
32:     METHODS: getLLXPRTDir(): string, readFile(path): Promise<string>, writeFile(path, content): Promise<void>, ensureDir(path): Promise<void>
33:   CREATE packages/tools/src/interfaces/IToolKeyStorage.ts
34:     METHODS: saveKey(toolName, key): Promise<void>, getKey(toolName): Promise<string|null>, deleteKey(toolName): Promise<void>, hasKey(toolName): Promise<boolean>, resolveKey(toolName): Promise<string|null>, maskKeyForDisplay(key): string, getSupportedToolNames(): string[]
35:   CREATE packages/tools/src/interfaces/ITodoService.ts
36:     METHODS: getTodoStore(): TodoStore, getReminderService(): TodoReminderService, getContextTracker(): TodoContextTracker, getDefaultAgentId(): string
37:   FOR each moved tool class constructor:
38:     REPLACE Config parameter with appropriate tools-owned interface(s)
39:     REPLACE MessageBus parameter with IToolMessageBus
40:     REPLACE direct service imports with injected interface parameters
41:   ENDFOR
42:   ENSURE packages/tools imports ZERO core/cli/providers modules
43:   EXPORT public API from packages/tools/src/index.ts
44:   DEFINE subpath exports matching current core/tools deep paths used by providers
45:   RETURN interface boundary ready for stub creation
```

### Step 2: Update analysis/pseudocode/consumer-migration.md

Add exact provider import rewrites:

```
10: METHOD migrateConsumers()
11:   FOR providers/src/utils/toolFormatDetection.ts:
12:     REWRITE '@vybestack/llxprt-code-core/tools/IToolFormatter.js' → '@vybestack/llxprt-code-tools/IToolFormatter.js'
13:     REWRITE '@vybestack/llxprt-code-core/tools/ToolIdStrategy.js' → '@vybestack/llxprt-code-tools/ToolIdStrategy.js'
14:   ENDFOR
15:   FOR providers/src/reasoning/reasoningUtils.ts:
16:     REWRITE '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js' → '@vybestack/llxprt-code-tools/doubleEscapeUtils.js'
17:     REWRITE '@vybestack/llxprt-code-core/tools/toolIdNormalization.js' → '@vybestack/llxprt-code-tools/toolIdNormalization.js'
18:   ENDFOR
19:   FOR providers/src/openai-vercel/messageConversion.ts and OpenAIVercelProvider.ts:
20:     REWRITE '@vybestack/llxprt-code-core/tools/toolIdNormalization.js' → '@vybestack/llxprt-code-tools/toolIdNormalization.js'
21:     REWRITE '@vybestack/llxprt-code-core/tools/ToolIdStrategy.js' → '@vybestack/llxprt-code-tools/ToolIdStrategy.js'
22:     REWRITE '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js' → '@vybestack/llxprt-code-tools/doubleEscapeUtils.js'
23:   ENDFOR
24:   FOR providers/src/anthropic/*.ts:
25:     REWRITE all '@vybestack/llxprt-code-core/tools/*' → '@vybestack/llxprt-code-tools/*'
26:   ENDFOR
27:   FOR providers/src/openai/OpenAIResponseParser.ts:
28:     REWRITE '@vybestack/llxprt-code-core/tools/toolIdNormalization.js' → '@vybestack/llxprt-code-tools/toolIdNormalization.js'
29:   ENDFOR
30:   FOR providers vi.mock() calls referencing tools:
31:     REWRITE mock paths from core/tools to tools package
32:   ENDFOR
33:   FOR packages/core/src/config/toolRegistryFactory.ts:
34:     IMPORT tool classes from '@vybestack/llxprt-code-tools'
35:     CONSTRUCT core adapters in packages/core/src/tools-adapters/
36:     PASS adapters into moved tool constructors
37:   ENDFOR
38:   REMOVE packages/core/package.json ./tools/* exports for moved modules
39:   ADD packages/tools/package.json exports per package export policy
40:   RUN: rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"
41:   ENSURE zero matches
42:   RETURN migrated consumers
```

### Step 3: Update analysis/pseudocode/release-updates.md

Add exact file edits per review requirement #6:

```
10: METHOD updateReleaseProcessForToolsPackage()
11:   EDIT .github/workflows/release.yml:
12:     ADD "Publish @vybestack/llxprt-code-tools" step BEFORE core/providers/cli steps
13:     ADD "npm publish --workspace=@vybestack/llxprt-code-tools --access public --provenance"
14:     ADD tarball prep step: "npm pack -w @vybestack/llxprt-code-tools"
15:   EDIT .github/workflows/build-sandbox.yml:
16:     ADD "npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist" BEFORE existing pack commands
17:   EDIT scripts/tests/release-process.test.js:
18:     ADD tools to expectedPublishOrder array BEFORE core/providers/cli
19:     ADD assertion for tools tarball preparation
20:     ADD assertion for tools in sandbox pack list
21:     ADD assertion for tools in Dockerfile install
22:     ADD assertion for build-sandbox.yml tools pack step
23:     ADD assertion tools appears before core in build-sandbox pack sequence
24:   EDIT scripts/build_sandbox.js:
25:     ADD "npm pack -w @vybestack/llxprt-code-tools" BEFORE existing pack commands
26:     ADD tools tarball to COPY statements
27:   EDIT Dockerfile:
28:     ADD "COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz /tmp/" BEFORE existing COPY lines
29:     ADD tools tarball to npm install transaction as first arg:
30:       /tmp/vybestack-llxprt-code-tools-*.tgz /tmp/vybestack-llxprt-code-core-*.tgz ...
31:   EDIT package.json:
32:     ADD "packages/tools" to workspaces array
33:   RUN: npm install (updates package-lock.json)
34:   EDIT scripts/version.js:
35:     ADD '@vybestack/llxprt-code-tools' to actualWorkspaces array (after core, before providers)
36:   EDIT scripts/prepare-package.js:
37:     ADD copyFiles('tools', { README.md, LICENSE, .npmrc })
38:   INSPECT scripts/build.js:
39:     VERIFY npm run build --workspaces covers tools automatically
40:   EDIT packages/tools/package.json:
41:     Follow packages/providers/package.json conventions exactly:
42:       name, version, type, main, types, exports, scripts, files, dependencies, devDependencies, engines
43:   CREATE project-plans/issue1585/manual-trusted-publishing.md
44:   RUN: npm run test:scripts
45:   RUN: node scripts/bind-release-deps.js --dry-run
46:   RETURN release process ready
```

### Files To Create Or Modify

- Update: `analysis/pseudocode/package-boundary.md`
- Update: `analysis/pseudocode/consumer-migration.md`
- Update: `analysis/pseudocode/release-updates.md`
- Create: `project-plans/issue1585/.completed/P02.md`

## Verification Commands

```bash
# Verify pseudocode files reference exact interface names
rg -c "IToolHost|IToolRegistryHost|IToolMessageBus|IShellExecutionService|ISubagentService|IAsyncTaskService|ISkillService|IMcpToolService|IIdeService|ILspService|IStorageService|IToolKeyStorage|ITodoService" project-plans/issue1585/analysis/pseudocode/package-boundary.md
# Verify consumer migration names exact provider files
rg -c "toolFormatDetection|reasoningUtils|messageConversion|OpenAIVercelProvider|AnthropicProvider|OpenAIResponseParser" project-plans/issue1585/analysis/pseudocode/consumer-migration.md
# Verify release pseudocode names exact files
rg -c "release.yml|release-process.test.js|build_sandbox.js|Dockerfile|package.json|packages/tools/package.json" project-plans/issue1585/analysis/pseudocode/release-updates.md
# Also verify build-sandbox.yml is mentioned
rg -c "build-sandbox" project-plans/issue1585/analysis/pseudocode/release-updates.md
```

## Semantic Verification Checklist

- [ ] Pseudocode references exact interface names from the overview table.
- [ ] Pseudocode names exact provider files and import rewrites.
- [ ] Pseudocode names exact release file edits.
- [ ] No implementation code in pseudocode files.

## Success Criteria

- All three pseudocode files updated with exact references.
- No code changed (analysis/pseudocode phase, no code markers required).

## Failure Recovery

Return to P02 to add missing details before P02a.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P02.md` with pseudocode coverage assessment.
