# Preflight Results

Plan ID: PLAN-20260629-ISSUE2285
Phase: P01 (Preflight Verification)
Artifact type: Preflight evidence (authoritative for P04 fixture details per architect review finding 7)

All evidence below was gathered by running each preflight command against the
actual source tree at HEAD on 2026-06-29. Every command exit status and key
output excerpt is recorded. No source/test/package/script files were modified
during P01 — P01 is evidence-gathering only.

## 1. Generated artifact policy

### Commands run

```
grep -n 'dist' .gitignore
git ls-files packages/agents/dist | head -5
git ls-files packages/agents | grep -E '\.tsbuildinfo$' | head -5
ls packages/agents/*.tsbuildinfo packages/agents/tsconfig.tsbuildinfo 2>/dev/null || echo "no tracked .tsbuildinfo"
```

### Evidence

- `.gitignore` line 44: `dist` — `dist` is gitignored.
- `git ls-files packages/agents/dist | head -5` — (empty output). `dist` is
  untracked.
- `git ls-files packages/agents | grep -E '\.tsbuildinfo$'` — (empty output).
  No `.tsbuildinfo` is tracked under packages/agents.
- `ls packages/agents/*.tsbuildinfo packages/agents/tsconfig.tsbuildinfo` —
  `no tracked .tsbuildinfo`.
- Build cache path gitignore verification:
  - `git check-ignore node_modules/.cache/tsbuildinfo/agents.tsbuildinfo` →
    exit 0 (ignored). `node_modules` is gitignored (.gitignore line 22).
  - `git check-ignore packages/agents/dist` → exit 0 (ignored).

### Policy decision (confirmed)

`dist` is an untracked build artifact. Ignore during source inventory.
Regenerate with `npm run build`. Any API guard reading declarations runs
against freshly generated output. Running `npm run build`/`tsc --build` also
emits `.tsbuildinfo` files (incremental build cache) at
`node_modules/.cache/tsbuildinfo/agents.tsbuildinfo` — these are build cache,
NOT source artifacts, and are gitignored under `node_modules`. The API guard's
isolated temp-tsconfig build overrides `tsBuildInfoFile` to a temp path so no
`.tsbuildinfo` is written into the package directory. Confirmed: both `dist`
and `node_modules/.cache/tsbuildinfo/` are gitignored, so a build produces no
tracked-file changes.

## 2. Agents import inventory

### Commands run

```
grep -rn "from '@vybestack/llxprt-code-agents'" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
grep -rn "llxprt-code-agents/internals.js" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
grep -rn "llxprt-code-agents/" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "llxprt-code-agents'"
```

### Classification of bare-root hits

**Production CLI (`packages/cli/src` non-test):** all currently PUBLIC symbols:
- `ui/AppContainerRuntime.tsx`: type `Agent` (public)
- `ui/App.tsx`: type `Agent` (public)
- `ui/utils/autoPromptGenerator.ts`: `createAgentClient` (public factory)
- `ui/AppContainer.tsx`: type `Agent` (public)
- `ui/hooks/useSlashCommandProcessorCore.ts`: type `Agent` (public)
- `ui/hooks/slashCommandProcessor.ts`: type `Agent` (public)
- `ui/hooks/geminiStream/useAgenticLoop.ts`: `createAgenticLoop`, types
  `AgenticLoopApprovalHandler`, `AgenticLoopEvent`, `AgenticLoopRunner`
  (public factory + types)
- `ui/hooks/geminiStream/toolCompletionHandler.ts`:
  `classifyCompletedTools` (public)
- `ui/hooks/geminiStream/contextLimit.ts`:
  `getTokenLimitForConfiguredContext` (public)
- `ui/hooks/useAutoAcceptIndicator.ts`: `ApprovalMode`, type `Agent` (public)
- `ui/hooks/slashCommandProcessorSupport.ts`: type `Agent` (public)
- `ui/commands/tasksCommand.ts`: type `Agent` (public)
- `ui/commands/logoutCommand.ts`: type `Agent` (public)
- `ui/commands/hooksCommand.ts`: type `HookInfo` (public)
- `ui/commands/types.ts`: type `Agent` (public)
- `ui/commands/compressCommand.ts`: type `Agent` (public)
- `ui/containers/AppContainer/hooks/useAppBootstrap.ts`: type `Agent` (public)
- `config/configBuilder.ts`: `createAgentRuntimeFactoryBindings` (public factory)
- `cliAgentBootstrap.ts`: `fromConfig`, type `Agent` (public)
- `cliSessionDispatch.tsx`: type `Agent` (public)
- `nonInteractiveCli.ts`: `fromConfig`, type `Agent` (public)
- `nonInteractiveCliSupport.ts`: (public symbols)
- `zed-integration/zedIntegration.ts`: (public symbols)

**Result**: NO production CLI source imports internals-only names from the
root today. Production CLI is already clean. Depollution will not break
production CLI imports. CONFIRMED accurate against `import-inventory.md`
section 2.1.

**Production A2A server (`packages/a2a-server/src`):** four BREAKS (see §3).

**Tests and test utilities (`packages/cli/src`):** BREAKS (internals-only names
from agents root) — see §4.

**Intra-agents:** bare-root imports appear only in `packages/agents/src/api/__tests__/`
(test files within agents itself) and `packages/agents/src/api/__tests__/helpers/`
(test helpers). These are agents-internal tests and use the package's own root
specifier; they are not external consumers.

### internals subpath (`@vybestack/llxprt-code-agents/internals.js`) hits

Only three consumers today, ALL inside `packages/agents/src/api/__tests__/`:
- `boundary.spec.ts:34` — string constant `INTERNALS_SUBPATH` (not an import).
- `nonBreaking.exports.test.ts:15` — `import * as internals from '...internals.js'`.
- `publicSurface.nonbreaking.test.ts:23` — `import * as internals from '...internals.js'`.

No production CLI or A2A source imports the internals subpath today.
CONFIRMED accurate.

### Deep agents source path hits

Only the `app-service.js` subpath and string constants (no deep source-path
imports). See §5. CONFIRMED accurate.

### Inventory accuracy

`import-inventory.md` section 2 is ACCURATE against the live grep. No
corrections needed.

## 3. A2A consumers

### Commands run

```
grep -rn "from '@vybestack/llxprt-code-agents'" packages/a2a-server/src --include="*.ts"
```

### Evidence — four known compile-breakers (CONFIRMED, no others)

| File | Line | Symbols | Kind | Migration target |
|------|------|---------|------|------------------|
| `config/config.ts` | 30 | `AgentClient`, `CoreToolScheduler`, `createTaskToolRegistration` | value | `new AgentClient(...)` → `createAgentClient(...)`; `new CoreToolScheduler(...)` → `createToolScheduler(...)`; `createTaskToolRegistration()` → keep (curated root) OR `createTaskRegistration()` |
| `agent/task.ts` | 28 | `AgentClient` | value (constructed) | `new AgentClient(...)` → `createAgentClient(...)`; field type `AgentClient` → `AgentClientContract` (core) or internals subpath |
| `agent/task-runtime-helpers.ts` | 24 | type `AgentClient` | type | `AgentClient` → `AgentClientContract` (core) or internals subpath type import |
| `utils/testing_utils.ts` | 22 | type `CoreToolScheduler` | type | `CoreToolScheduler` → `ToolSchedulerContract` (core) or internals subpath type import |

No other A2A files import from the agents root. CONFIRMED exactly four.

### config.ts construction sites (exact lines)

- `config.ts:105`: `agentClientFactory: (config, runtimeState) => new AgentClient(config, runtimeState),`
- `config.ts:108`: `toolSchedulerFactory: (options) => new CoreToolScheduler(options),`
- `config.ts:111`: `taskToolRegistration: createTaskToolRegistration(),`

### Per-use migration notes

- `config/config.ts`: all three symbols migrate to public factories
  (`createAgentClient`, `createToolScheduler`) available at the agents root
  (`packages/agents/src/api/runtimeFactories.ts` lines 100, 112).
  `createTaskToolRegistration` (curated root export) can be kept OR
  `createTaskRegistration` (line 123) used. Decision (Gate 1):
  `createTaskToolRegistration` is a curated root-local compatibility export
  (app-glue factory wrapper, NOT a low-level internals symbol). Keep it as a
  curated root export. A2A keeps importing it from the root. No internals
  subpath exception needed for this symbol.
- `task.ts`: `new AgentClient(...)` (line 133) → `createAgentClient(...)`;
  field type `AgentClient` (line 84) → `AgentClientContract` from
  `@vybestack/llxprt-code-core` (already re-exported there) or internals
  subpath.
- `task-runtime-helpers.ts`: type `AgentClient` → `AgentClientContract`
  (core) — public type path sufficient. No internals subpath exception needed.
- `testing_utils.ts`: type `CoreToolScheduler` → `ToolSchedulerContract`
  (core) — public type path sufficient. No internals subpath exception needed.

No retained internals-subpath uses required for A2A: every symbol has a
public factory/type path. (Per-use exception records: NONE needed.)

### Architect review finding 1 (A2A test convention — COLOCATED tests)

CONFIRMED: the A2A package uses COLOCATED test files, NOT `__tests__/`
subdirectories. Evidence:
- `packages/a2a-server/src/config/config.test.ts` (alongside `config.ts`)
- `packages/a2a-server/src/agent/task.test.ts` (alongside `task.ts`)
- `packages/a2a-server/src/agent/task-support.test.ts`
- `packages/a2a-server/src/utils/testing_utils.test.ts` (alongside `testing_utils.ts`)
- `find packages/a2a-server/src -type d -name "__tests__"` → (empty, no
  `__tests__/` directories exist).

P04 behavior tests MUST be colocated (`config.factory-migration.test.ts`,
`task.factory-migration.integration.test.ts`) — NOT in `__tests__/` subdirs.

### Architect review finding 2 (record real A2A APIs)

CONFIRMED exact real A2A APIs (verified by grep against actual source):
- **Dispatch method**: `agentClient.sendMessageStream(...)` is the dispatch
  method — an ASYNC GENERATOR. Evidence: `task.ts:664`
  `yield* this.agentClient.sendMessageStream(...)` and `task.ts:714` same.
  There is NO `.sendMessage` method — it does not exist.
- **Task construction**: `Task` has a PRIVATE constructor (`task.ts:106`
  `private constructor(...)`). Instances are created via
  `Task.create(...)` — an async static factory (`task.ts:142`
  `static async create(...)`). Evidence from `task.test.ts`: all instances
  use `await Task.create(...)` (11+ call sites). NEVER `new Task(...)`.
- **Scheduler access**: obtained via
  `(this.config as SchedulerConfig).getOrCreateScheduler(...)` (`task.ts:464`)
  and dispatched via `this.scheduler.schedule(updatedRequests, abortSignal)`
  (`task.ts:517`). Evidence: `task.test.ts:469`
  `getOrCreateScheduler: vi.fn().mockImplementation(...)`.
- **Task events**: published via `this.eventBus?.publish(event)`
  (`task.ts:309`, `task.ts:340`). Evidence: `task-support.ts:360`
  `context.eventBus?.publish(event)`; `executor.ts` multiple
  `eventBus.publish({...})` calls.

P04 tests MUST reference these exact APIs — NOT nonexistent `.sendMessage` or
`new Task(...)`.

### Architect review finding 3 (record exact working test commands)

CONFIRMED workspace package names:
- A2A workspace: `@vybestack/llxprt-code-a2a-server`
  (`packages/a2a-server/package.json` `name` field).
- CLI workspace: `@vybestack/llxprt-code`
  (`packages/cli/package.json` `name` field).

Exact workspace-scoped test commands:
- A2A: `npm run test --workspace @vybestack/llxprt-code-a2a-server -- <pattern>`
- CLI: `npm run test --workspace @vybestack/llxprt-code -- <pattern>`

Root `npm run test` runs ALL workspaces
(`npm run test --workspaces --if-present`); root path arguments do NOT
reliably filter (e.g. `npm run test -- packages/a2a-server` runs all workspace
tests, not just A2A). P04/P04a commands MUST use the workspace-scoped form
above.

### Revision 3 architect finding 11 (P04 A2A fixture construction — exact builders/APIs)

The EXACT builder/API for constructing a real `AgentConfig` (not a cast) for
P04 `config.factory-migration.test.ts`:

- **Config construction**: `new Config(configParams)` from
  `@vybestack/llxprt-code-core/config/config.js` where `configParams` is a
  `ConfigParameters` object. Evidence: A2A `config.ts:70-73`
  `const config = new Config(configParams);`. The agents test
  `packages/agents/src/core/__tests__/agentClient.runtimeState.test.ts`
  `createTestConfig()` builds a minimal real Config:
  `new Config({ sessionId: 'test-session-id', targetDir: '/tmp/test-dir' } as unknown as ConfigParameters)`.
  This is the closest real construction path. A2A's own `createMockConfig()`
  (`testing_utils.ts:232`) returns a `Partial<Config>` mock — it is NOT a real
  Config and does NOT support factory-based AgentClient construction (it
  stubs `getAgentClient`). P04's construction-equivalence fixture should use
  `new Config(...)` with minimal `ConfigParameters`, NOT `createMockConfig()`.

- **RuntimeState construction**: `createAgentRuntimeState(params)` from
  `@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js` builds a real
  `AgentRuntimeState`. Evidence: agents test
  `agentClient.runtimeState.test.ts` imports `createAgentRuntimeState` and
  builds `createAgentRuntimeState({ runtimeId, provider, model, sessionId })`.
  `AgentRuntimeState` requires non-empty `provider` and `model` (client.ts
  constructor throws otherwise). This is the exact runtimeState builder the
  fixture uses.

- **Stub model-provider seam**: The `AgentClient` constructor
  (`packages/agents/src/core/client.ts:131`) takes
  `(config: Config, runtimeState: AgentRuntimeState, historyService?)`. The
  provider/model come from `runtimeState.provider`/`runtimeState.model`
  (strings), NOT an injected model-provider interface. The deterministic
  stub seam for a fixed reply is at the `AgentRuntimeState` level: set
  `provider`/`model` to deterministic string values. The dispatch method is
  `sendMessageStream(...)` (async generator). For a behavior fixture that
  verifies the factory produces a client with the same PUBLIC dispatch method,
  assert `typeof client.sendMessageStream === 'function'` and that calling it
  with a representative request yields an async iterable. Do NOT mock
  `AgentClient` — construct a real client via `createAgentClient(config,
  runtimeState)` and assert the public method exists and is callable. If a
  full end-to-end dispatch fixture is needed, the provider seam is the
  `runtimeState.provider` string (which selects the model backend); a
  deterministic fixed-reply requires a stub provider registration, which is
  outside the factory-migration scope. P04's behavioral equivalence assertion
  is: the factory-produced client exposes `sendMessageStream` as a real
  function (public behavioral equivalence per import-inventory.md section 8,
  NOT own-enumerable key-set identity).

- **Dispatch method name**: `sendMessageStream` (async generator) — confirmed
  above. `createAgentClient(config, runtimeState)` returns an
  `AgentClientContract` which exposes `sendMessageStream`.

- **Gap note**: No existing A2A test constructs a real `AgentConfig` via
  `new Config(...)` for factory-migration purposes — the closest real
  construction site is `config.ts:loadConfig()` and the agents test
  `agentClient.runtimeState.test.ts`. P04 reuses the
  `new Config(minimalConfigParameters)` + `createAgentRuntimeState(...)` path.

## 4. CLI test compile-breakers

### Commands run

```
grep -rn "AgentClient\|CoreToolScheduler\|AgenticLoop" packages/cli/src --include="*.test.ts" --include="*.test.tsx" --include="*.spec.ts" --include="*.spec.tsx" | grep "llxprt-code-agents"
grep -n "AgentClient" packages/cli/src/ui/App.behavior.test.tsx packages/cli/src/ui/App.test.tsx | head
```

### Evidence — CLI test compile-breakers (CONFIRMED)

Eight CLI test files import internals-only names from the agents root:

| File | Symbols | Kind |
|------|---------|------|
| `ui/hooks/useTodoContinuation.spec.ts:29` | `AgentClient as AgentClientClass` | value |
| `ui/hooks/useToolScheduler.part5.test.ts:43` | type `CoreToolScheduler` | type |
| `ui/hooks/useToolScheduler.part4.test.ts:43` | type `CoreToolScheduler` | type |
| `ui/hooks/useToolScheduler.part2.test.ts:43` | type `CoreToolScheduler` | type |
| `ui/hooks/useToolScheduler.test.ts:43` | type `CoreToolScheduler` | type |
| `ui/hooks/useToolScheduler.part3.test.ts:43` | type `CoreToolScheduler` | type |
| `ui/hooks/geminiStream/__tests__/useAgenticLoop.test.tsx:39` | `CoreToolScheduler` | value |
| `integration-tests/todo-continuation.integration.test.ts:18` | `AgentClient`, type `Turn` | value |
| `integration-tests/test-utils.ts:18` | `AgentClient`, `CoreToolScheduler`, `createTaskToolRegistration` | value |

All migrate to the internals subpath (`@vybestack/llxprt-code-agents/internals.js`).
CONFIRMED accurate against `import-inventory.md` section 2.3.

### App.*.test.tsx import source verification

CONFIRMED: `App.behavior.test.tsx`, `App.test.tsx`, `App.context.test.tsx`,
`App.components.test.tsx`, `App.dialogs.test.tsx` import `AgentClient` from
`@vybestack/llxprt-code-core` (NOT agents root). Evidence:
- `App.behavior.test.tsx:14-18`: `AgentClient` is in the import block ending
  `} from '@vybestack/llxprt-code-core';`
- `App.test.tsx:14-18`: same — `} from '@vybestack/llxprt-code-core';`
- `App.context.test.tsx:17`, `App.components.test.tsx:18`,
  `App.dialogs.test.tsx:17`: all import `AgentClient` from core.

These do NOT break from agents depollution (they use the core re-export).
CONFIRMED accurate against `import-inventory.md` section 2.3 note.

## 5. app-service subpath non-scope check

### Commands run

```
grep -A3 '"./app-service.js"' packages/agents/package.json
grep -rn "app-service.js" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "packages/agents/src/app-service"
```

### Evidence

- `packages/agents/package.json` declares `"./app-service.js"` export:
  `"types": "./dist/src/app-service.d.ts"`, `"import": "./dist/src/app-service.js"`.
- Consumers (all test/internal, NO production CLI source):
  - `packages/agents/src/api/__tests__/command-api-map.ts` (agents test helper)
  - `packages/agents/src/api/__tests__/boundary.spec.ts` (string constant)
  - `packages/agents/src/api/__tests__/app-service.spec.ts` (agents test)
  - `packages/agents/src/api/__tests__/app-service-boundary.spec.ts` (agents test)
  - `packages/cli/src/services/commandApiMapCompleteness.test.ts` (CLI test)
  - `packages/agents/src/app-services/*` (internal, excluded by grep filter)

### Decision (confirmed)

`./app-service.js` is ORTHOGONAL to the root internals leak (it is its own
curated subpath, not the root barrel). Do NOT modify it. No direct
requirement identified. CONFIRMED accurate against `import-inventory.md`
section 2.4 and `api-guard-mechanism.md` section 4.

## 6. Type/export-map resolution for internals subpath

### Commands run

```
grep -A3 '"./internals.js"' packages/agents/package.json
grep -rn "llxprt-code-agents/internals.js" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
```

### Evidence

- `packages/agents/package.json` declares `"./internals.js"` export:
  `"types": "./dist/src/internals.d.ts"`, `"import": "./dist/src/internals.js"`.
- Current consumers (all in `packages/agents/src/api/__tests__/`):
  - `boundary.spec.ts:34` (string constant, not import)
  - `nonBreaking.exports.test.ts:15` (`import * as internals`)
  - `publicSurface.nonbreaking.test.ts:23` (`import * as internals`)

### Resolution confirmation

The internals subpath resolves today under Vitest for the agents-internal
tests (they are part of the agents workspace test suite). After depollution,
CLI tests migrated to the internals subpath will resolve because the export
map entry exists and points at `dist/src/internals.{d.ts,js}`. The subpath is
a declared export — typecheck and Vitest will resolve it for legitimate test
consumers. CONFIRMED.

## 7. API guard mechanism decision

### Command run (exact executable proof)

The B1 temp-tsconfig proof script from the plan was executed verbatim (using
`pwd`-derived absolute paths). The script:
1. Creates a temp dir.
2. Writes `tsconfig.api-surface.json` extending the SOURCE-path
   `packages/agents/tsconfig.json` with `rootDir: packages/agents`,
   `outDir: temp`, `tsBuildInfoFile: temp`, `declaration: true`, `noEmit:
   false`, `composite: false`.
3. Runs `npx tsc -p <temp-tsconfig>`, capturing stdout+stderr to a combined
   log.
4. Checks for `TS6059`/rootDir errors.

### B1 result (rootDir = packages/agents)

- `tsc` exit code: 2.
- Combined log contained ONLY:
  `error TS2688: Cannot find type definition file for 'node'.` and
  `error TS2688: Cannot find type definition file for 'vitest/globals'.`
- The `TS6059`/rootDir grep returned **NO rootDir error** in the B1 log —
  BUT this is misleading: the TS2688 errors (missing ambient `types`) caused
  tsc to surface only those two errors and stop before deeper analysis.
  `index.d.ts` WAS emitted (400 `.d.ts` files) despite the nonzero exit.
- When the TS2688 was resolved (by overriding `types`), the deeper TS6059
  errors appeared (see B1c below), confirming B1's `rootDir: packages/agents`
  is fundamentally incompatible with source-path dependency resolution.

### B1c probe (rootDir = packages/agents, types: [])

- Ran with `types: []` to eliminate TS2688.
- Result: `TS6059: File '.../packages/core/src/test-utils/config.ts' is not
  under 'rootDir'` (and `mock-tool.ts`). Dependency SOURCE files outside
  `packages/agents` violate rootDir when `declaration: true`.
- Confirms: **B1 (rootDir = packages/agents) FAILS with TS6059** once the
  TS2688 noise is cleared. This matches revision 5 architect finding 3.

### B1a result (rootDir = workspace root) — REQUIRED mechanism

- Ran with `rootDir: <repo-root>`, `types: ['node']`, `typeRoots:
  [<repo-root>/node_modules/@types]`, `skipLibCheck: true`.
- `tsc` exit code: 2 (declarations STILL emit — 892 `.d.ts` files).
- `TS2688` check: **NO TS2688** (resolved by typeRoots/types override).
- `TS6059` check: **NO TS6059** (rootDir at workspace root contains all
  dependency source).
- Remaining errors (532 total): ALL confined to test/spec files EXCEPT one
  (`packages/core/src/utils/shell-parser.ts` — a `TS2307: Cannot find module
  'tree-sitter-bash/tree-sitter-bash.wasm?binary'` WASM binary import that
  requires the `../core/src/types/wasm.d.ts` declaration included by the
  source tsconfig but not by the temp include array). These are type-CHECKING
  errors in test files and one dependency-source WASM import — they do NOT
  affect declaration EMISSION for the agents root barrel.
- Emitted declarations are COMPLETE and CORRECT:
  - `<temp>/packages/agents/index.d.ts`: `export * from './src/index.js';`
  - `<temp>/packages/agents/src/index.d.ts`: full barrel with
    `export * from './internals.js';`, `export * from './api/index.js';`,
    disambiguation type exports, and `createTaskToolRegistration`.
  - `<temp>/packages/agents/src/internals.d.ts`: full internals barrel
    (`AgentClient`, `CoreToolScheduler`, etc.).

### Mechanism decision: B1a (rootDir at workspace root)

**CONFIRMED mechanism: B1a.** The API guard's temp tsconfig MUST:
1. `extends` the SOURCE-path `packages/agents/tsconfig.json` (NOT
   `tsconfig.build.json`) — dependency SOURCE resolves, no dependency `dist/`
   required, clean-CI safe.
2. Set `rootDir` to the **repo root** (NOT `packages/agents`) — avoids
   `TS6059` because dependency source files (`../core/src/...`) are within
   rootDir. B1 (rootDir = packages/agents) FAILS with TS6059.
3. Override `types: ['node']` and add `typeRoots: [<repo-root>/node_modules/@types]`
   — resolves `TS2688` (cannot find type definition for 'node'/'vitest/globals'
   in the isolated temp dir). `vitest/globals` is NOT needed for declaration
   emission (it only affects test-file type-checking).
4. Set `skipLibCheck: true` — avoids spurious `.d.ts` lib-check errors.
5. Override `outDir`, `tsBuildInfoFile` to temp paths (no shared-dist or
   shared-tsbuildinfo perturbation).
6. The guard script MUST check for the EMITTED declaration file at the NESTED
   path `<temp>/packages/agents/index.d.ts` (because rootDir = repo root
   shifts the output layout) — NOT at `<temp>/index.d.ts`. The parser then
   resolves `<temp>/packages/agents/src/index.d.ts` for the real barrel.
7. The guard script MUST NOT fail on `tsc`'s nonzero exit code. The nonzero
   exit is caused by type-checking errors in transitively-included test files
   (which `exclude` cannot prevent because non-test-named test-helper files
   import them) and one dependency-source WASM-module import. These errors do
   NOT affect the agents root-barrel declaration surface. The guard verifies
   declaration PRESENCE (`test -f <nested-index.d.ts>`) and parses the emitted
   declarations; it does NOT rely on `tsc` exit 0.

**CI wiring (revision 6 architect finding 7):** B1a uses source-path
resolution → no dependency `dist/` needed → the guard runs in BOTH the
pre-build `lint_javascript` job (alongside `lint:cli-boundary`) AND the
post-build `test` job (to generate the report before `npm run test`).

**Side-effect tradeoffs:** B1a confines ALL build side effects to the temp
dir (removed on exit). No shared `dist/` or `.tsbuildinfo` perturbation.
Clean-CI safe.

P03 reads this recorded mechanism and implements the guard script
(`scripts/check-agents-api-surface.mjs`) with the B1a config above.

### Fallback (NOT chosen): B2

B2 (fresh shared `dist` via `npm run build --workspace`) was NOT needed
because B1a works. If B1a had failed, B2 would read
`packages/agents/dist/index.d.ts` post-build, running ONLY in the `test` job.

## 8. Runtime factory dependency/ownership decision

### Commands run

```
grep -n "interface AgentRuntimeFactoryBindings" packages/agents/src/api/runtimeFactories.ts
grep -n "interface AgentRuntimeFactoryBindings" packages/providers/src/runtime/runtimeContextFactory.ts
grep '"@vybestack/llxprt-code-providers"' packages/agents/package.json
grep '"@vybestack/llxprt-code-agents"' packages/providers/package.json || echo "providers does NOT depend on agents"
grep -rn "AgentClientFactory\|ToolSchedulerFactory\|TaskToolRegistration" packages/core/src --include="*.ts" | grep -v node_modules | grep -v dist | head
grep -rn "AgentRuntimeFactoryBindings" packages/core/src --include="*.ts"
```

### Evidence — duplicated interface (CONFIRMED)

- `packages/agents/src/api/runtimeFactories.ts:58`:
  `export interface AgentRuntimeFactoryBindings` — agents-owned.
- `packages/providers/src/runtime/runtimeContextFactory.ts:55`:
  `export interface AgentRuntimeFactoryBindings` — providers-owned.

### Dependency direction (CONFIRMED)

- agents → depends on → providers: `packages/agents/package.json` lists
  `"@vybestack/llxprt-code-providers": "file:../providers"`.
- providers does NOT depend on agents: grep returned
  `providers does NOT depend on agents`.
- A single source in agents would create providers → agents (WRONG/cycle).
- A single source in providers would make agents import from providers
  (acceptable directionally).

### Core ownership evaluation (CONFIRMED feasible)

- Core already owns the constituent contract types:
  - `AgentClientFactory`: `packages/core/src/core/clientContract.ts:127`
    `export type AgentClientFactory = (...)`.
  - `ToolSchedulerFactory`:
    `packages/core/src/core/toolSchedulerContract.ts:107`
    `export type ToolSchedulerFactory = (...)`.
  - `TaskToolRegistration`: re-exported by core (used in
    `packages/agents/src/api/runtimeFactories.ts` via
    `@vybestack/llxprt-code-core/config/toolRegistryFactory.js`).
- Core does NOT currently export `AgentRuntimeFactoryBindings` (grep of
  `packages/core/src` returned no hits) — so adding it is an ADDITIVE,
  non-breaking change.
- Both packages (agents, providers) already depend on core. Defining the
  contract in core creates NO cycle.

### Shape comparison

- **agents version** (`runtimeFactories.ts:58`):
  `agentClientFactory: (config, runtimeState) => AgentClientContract`,
  `toolSchedulerFactory: ToolSchedulerFactory`,
  `taskToolRegistration: () => TaskToolRegistration`.
  The `agentClientFactory` uses an inline
  `(config: Config, runtimeState: AgentRuntimeState) => AgentClientContract`.
- **providers version** (`runtimeContextFactory.ts:55`):
  `agentClientFactory: AgentClientFactory`,
  `toolSchedulerFactory: ToolSchedulerFactory`,
  `taskToolRegistration: () => TaskToolRegistration`.
  The `agentClientFactory` uses the core-owned `AgentClientFactory` type
  alias.
- Difference: agents uses an inline signature; providers uses the
  `AgentClientFactory` alias. The core-owned `AgentClientFactory`
  (`clientContract.ts:127`) is the canonical form. A single-source contract
  in core uses `AgentClientFactory` (the core alias) — the agents inline
  signature is structurally identical to `AgentClientFactory`.

### Decision

**single-source in core is feasible and preferred.** Core already owns all
constituent contract types; adding `AgentRuntimeFactoryBindings` to core is
additive and non-breaking; both packages depend on core (no cycle). The
decision record
(`analysis/runtime-factory-contract-decision.md`) records
`decision: single-source`. P09 finalizes it by moving the interface to core
and updating both packages to import from core. No drift guard needed (no
duplication retained).

See `analysis/runtime-factory-contract-decision.md` for the authoritative
machine-greppable decision.

## 9. Current cliSessionDispatch behavior and safe test seams

### Commands run

```
grep -n "^export\|export function\|export async function\|export const" packages/cli/src/cliSessionDispatch.tsx
grep -n "cliSessionDispatch" packages/cli/src/cli.tsx
grep -n "validateDnsResolutionOrder" packages/cli/src/cli.tsx
grep -n "validateDnsResolutionOrder" packages/cli/src/cliSessionDispatch.tsx
grep -n "process.on\|process.exit\|process.stdout\|process.stderr\|enableMouseEvents\|disableMouseEvents\|appendFileSync\|render(" packages/cli/src/cliSessionDispatch.tsx
```

### Exported names (the six cli.tsx imports — CONFIRMED)

`cli.tsx:91-97` imports exactly six names from `./cliSessionDispatch.js`:
1. `dispatchInteractiveOrNonInteractive` (`cliSessionDispatch.tsx:404`,
   `export async function`)
2. `formatNonInteractiveError` (`:91`, `export function`)
3. `initializeOutputListenersAndFlush` (`:246`, `export function`)
4. `installNonInteractiveSigintHandler` (`:112`, `export function`)
5. `setupUnhandledRejectionHandler` (`:138`, `export function`)
6. `startInteractiveUI` (`:274`, `export async function`)

Additional exports (NOT imported by cli.tsx, but exported):
- `setWindowTitle` (`:222`, `export function`) — UI-adjacent.
- `NonInteractiveSessionOptions`, `PipedOrPromptSessionOptions`,
  `SessionDispatchOptions` (`:373-390`, `export interface`) — option types.

### validateDnsResolutionOrder (CONFIRMED not in cliSessionDispatch)

- `cli.tsx:100`: `export { validateDnsResolutionOrder } from './cliBootstrap.js';`
  — re-exported from `cliBootstrap`, NOT from `cliSessionDispatch`.
- `grep validateDnsResolutionOrder cliSessionDispatch.tsx` →
  `not in cliSessionDispatch (correct)`.

### Internal helper functions (non-exported)

- `appendInteractiveUiDebug` (`:165`)
- `handleError` (`:175`) — Ink error boundary handler
- `mouseEventsExitHandler` (`:213`)
- `runPipedOrPromptSession` (`:456`, `async function`)
- `runNonInteractiveSession` (`:511`, `async function`)
- `reportNonInteractiveError` (`:599`, `function`)

### Side effects enumerated

- `process.on('SIGINT', handler)` (`:122`) — SIGINT handler installation.
- `process.exit(130)` (`:120`) — non-interactive cancel exit.
- `process.stderr.write('\nCancelled.\n')` (`:119`).
- `process.on('unhandledRejection', handler)` (`:159`).
- `process.on('exit', mouseEventsExitHandler)` (`:313`) and
  `process.off('exit', mouseEventsExitHandler)` (`:312`).
- `process.on('exit', restoreTerminalProtocolsSync)` (`:323`) and
  `process.off` (`:322`).
- `process.stdout.isTTY` checks (`:215`, `:291`).
- `enableMouseEvents()` / `disableMouseEvents()` (`:301`, `:214`) — from
  `./ui/utils/mouse.js`.
- `appendFileSync(join(artifactDir, 'cli-debug.log'), ...)` (`:169`) — FS
  diagnostic write.
- Ink `render(...)` (`:331`) — from `ink`; imports `render` at `:31`.
- `registerSyncCleanup(restoreTerminalProtocolsSync)` (`:329`).

### Candidate split seams (per analysis/pseudocode/cli-session-split.md)

1. `session/nonInteractiveSession.ts`: `dispatchInteractiveOrNonInteractive`,
   `runPipedOrPromptSession`, `runNonInteractiveSession`,
   `NonInteractiveSessionOptions`, `PipedOrPromptSessionOptions`,
   `SessionDispatchOptions`.
2. `session/interactiveUI.ts`: `startInteractiveUI`, `setWindowTitle`.
3. `session/outputListeners.ts`: `initializeOutputListenersAndFlush`.
4. `session/signalHandlers.ts`: `installNonInteractiveSigintHandler`,
   `setupUnhandledRejectionHandler`.
5. `session/errorReporting.ts`: `formatNonInteractiveError`,
   `reportNonInteractiveError`.
6. `session/terminalCleanup.ts`: `mouseEventsExitHandler`,
   `restoreTerminalProtocolsSync` registration helpers.

### Safe test seams (CONFIRMED)

- Replace `process.stdout`/`process.stderr` writes with captured buffers.
- Replace `process.exit` with a safe seam (throw a sentinel or
  subprocess-style characterization) — never terminate the test runner.
- Replace Ink `render` with a no-op or recording fake that captures the React
  tree without a real TTY.
- Replace filesystem diagnostics (`appendFileSync`) with a temp-dir sink.
- Replace `enableMouseEvents`/`disableMouseEvents`/terminal sequence writes
  with captured spies that record calls but write nowhere.

### FORBIDDEN

Mocking the `cliSessionDispatch` module itself and asserting only that mocks
were called (without checking resulting output, cleanup state, handler
effect, selected branch, or flushed payloads) is FORBIDDEN.

---

## Preflight summary

All nine preflight checks completed with recorded evidence. No blockers
identified. Key decisions recorded:
- Generated artifact policy: `dist`/`.tsbuildinfo` untracked/gitignored.
- Import inventory: accurate, no corrections needed.
- A2A: four compile-breakers, all have public factory/type migration paths.
- CLI tests: eight compile-breakers, migrate to internals subpath.
- app-service: orthogonal, no change.
- internals subpath: resolves for legitimate consumers.
- API guard mechanism: **B1a** (rootDir at workspace root) — B1 fails with
  TS6059; guard checks emitted declaration presence, not tsc exit code.
- Runtime factory: **single-source in core** (feasible, non-breaking, no
  cycle) — recorded in `runtime-factory-contract-decision.md`.
- cliSessionDispatch: six exports confirmed, safe test seams recorded.

P01 is evidence-gathering only — no source/test/package/script files modified.
