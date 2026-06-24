<!-- @plan:PLAN-20260622-COREAPIGAP @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-006,REQ-007,REQ-008,REQ-009,REQ-010,REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004,REQ-INT-005 -->
# Feature Specification: Close Agent API Engine-Capability Gaps (prerequisite for #1595)

Plan ID: PLAN-20260622-COREAPIGAP
Generated: 2026-06-22
Predecessor: PLAN-20260621-COREAPIREMED (#1594 remediate, merged) — which itself follows
PLAN-20260617-COREAPI (#1594 original). This plan is ADDITIVE on top of that merged surface.
Scope: `packages/agents/src/api/**` (the public `@vybestack/llxprt-code-agents` surface) ONLY.
No CLI production source is modified (that is #1595). No core/providers/policy source is modified.

---

## Purpose

#1594 (PR #2108, then remediated by PLAN-20260621-COREAPIREMED) shipped the public Agent API:
`createAgent(AgentConfig)` / `fromConfig(Config)` returning an `Agent` facade
(`packages/agents/src/api/agent.ts`). The **core interaction path is parity-proven**: the
CLI-turn-parity harness drives a real `read_file` tool call through `fromConfig → agent.stream()`
and asserts the projected event stream is byte-identical to the CLI's reference `AgenticLoop` drive.

Issue #1595 ("Refactor CLI to consume core API") will rewire `packages/cli/src/**` to consume ONLY
the public agents surface, so that — per its own acceptance criterion — "the CLI could theoretically
be replaced with a different UI using the same core API." A capability-coverage audit of the CLI
against the current `Agent` surface found a **small, bounded set of engine capabilities the CLI
drives DIRECTLY from `core.Config` today that have NO first-class `Agent` method**. If left
unaddressed, #1595 must keep `agent.getConfig().<core method>()` escape hatches — defeating its own
acceptance criterion.

This issue is a **prerequisite for #1595** and is **purely additive** to the API surface (no
breaking changes). It closes those gaps with new first-class `Agent` methods / sub-controllers,
following the EXISTING sub-controller convention exactly.

### Why the shipped surface is inadequate (evidence, current post-merge source)

Each row was ground-truthed against the working tree on the `issue2143` branch.

| Gap | Evidence (file:line, verified) | Why it blocks #1595 |
|---|---|---|
| **G1 Approval mode** | CLI reads/writes directly: `useAutoAcceptIndicator.ts` (read `config.getApprovalMode()`, write `config.setApprovalMode(...)`). Backing core: `getApprovalMode()` `configBaseCore.ts:463`; `setApprovalMode()` `config.ts:401` (THROWS on untrusted folder, `:404`). No `Agent.getApprovalMode`/`setApprovalMode`. | CLI would need `agent.getConfig().setApprovalMode()` — a deep escape hatch, and must preserve the untrusted-folder throw. |
| **G2 Policy inspection** | `/policies` reaches `config.getPolicyEngine()` then `getRules()`/`getDefaultDecision()`/`isNonInteractive()`, and reads `rule.argsPattern.source` (`policiesCommand.ts:60-61,110-111,125,128`). Backing: `getPolicyEngine()` `configBaseCore.ts:475`; `PolicyEngine.getRules():320`/`getDefaultDecision():329`/`isNonInteractive():338` (`packages/policy/src/policy-engine.ts`). No `Agent.policy`. | CLI would deep-import the policy engine through `getConfig()`. |
| **G3 Async tasks** | `/task` drives `getAllTasks()` (`tasksCommand.ts:80,117`), `getTask()` (`:189`), `getTaskByPrefix()` (`:193`), `cancelTask()` (`:236`); ESC-cancel drives `getRunningTasks().forEach(cancelTask)` (`useGeminiStreamOrchestration.ts`). Backing: `Config.getAsyncTaskManager(): AsyncTaskManager \| undefined` (`config.ts:601`; abstract `configBase.ts:33`). No `Agent.tasks`. | Full `/task` surface + ESC-cancel would all go through `getConfig()`. |
| **G4 Hooks administration** | `/hooks` drives `config.getHookSystem()` (`hooksCommand.ts:31,74,144,211,279`), `getDisabledHooks()` (`:107,177`), `setDisabledHooks()` (`:111,180,239`). Backing: `getHookSystem()` `config.ts:755`; `getDisabledHooks()` `config.ts:734`; `setDisabledHooks()` `configBase.ts:132`. Current `AgentHookControl` (`agent.ts:314-321`) only has execution/lifecycle (`onHookExecution`/`triggerSessionStart`/`triggerSessionEnd`/`clear`) — NO registry/enable-disable admin. | Hook admin would deep-import the hook system through `getConfig()`. |
| **G5 (A) Detailed OAuth state** | `/auth` needs token expiry `peekStoredToken()` (`authCommand.ts`), higher-priority warning `getHigherPriorityAuth()`, bucket status `getAuthStatusWithBuckets()`. Backing OAuthManager: `peekStoredToken():243`/`getHigherPriorityAuth():313`/`getAuthStatusWithBuckets():395`/`isOAuthEnabled():300`/`isAuthenticated():199` (`packages/providers/src/auth/oauth-manager.ts`). Current `AgentAuthControl.status()` is per-agent state, not OAuthManager token metadata. | Detailed `/auth` UX would reach the OAuthManager outside the Agent surface. |
| **G6 (B) MCP OAuth + deep detail** | Real flow `mcpAuth.ts:82 performMcpOAuth` → `MCPOAuthProvider.authenticate():108` → `mcpClientManager.restartServer():132` → `agentClient.setTools():136`. `Agent.mcp.auth()` only reports a per-agent flag (`mcpControl.ts:199-205`); `Agent.mcp.refresh()` restarts but does NOT re-publish tools (`mcpControl.ts:236-245`) whereas `/mcp refresh` calls `setTools()`. Deep `/mcp list desc/schema` reads tool/prompt/resource registries. | MCP OAuth + post-auth tool refresh + deep detail have no public equivalent. |
| **G7 (C) Built-in tool-key storage** | `/toolkey` + `/toolkeyfile` directly `new ToolKeyStorage()` and call `getKey`/`saveKey`/`deleteKey`/`getKeyfilePath`/`setKeyfilePath`/`clearKeyfilePath` (`toolkeyCommand.ts`, `toolkeyfileCommand.ts`). Backing: `ToolKeyStorage` (`tool-key-storage.ts:109`, methods `saveKey:280`/`getKey:299`/`deleteKey:314`/`getKeyfilePath:248`/`setKeyfilePath:241`/`clearKeyfilePath:254`); helpers `getSupportedToolNames`/`maskKeyForDisplay`/`getToolKeyEntry`/`isValidToolKeyName` (`@vybestack/llxprt-code-tools`, re-exported core `index.ts:472-475`). `Agent.tools` has no `keys`; `Agent.auth.keys` is provider-auth keys (a different concern). | Built-in tool-key management has no public equivalent. |

> The shipped event model and the turn-drive/tool-execution/settings/history/compression/profiles
> path are SUFFICIENT and are NOT re-planned. This plan adds ONLY the seven gap surfaces above plus
> their public projected types, barrel re-exports, and `COMMAND_API_MAP` registrations.

### Two issue claims corrected by ground-truthing (recorded so the plan is accurate)

1. **`mcpAuth.ts` EXISTS.** The issue body says "the real MCP OAuth flow lives in
   `mcpCommand.ts:679-714`, not a separate `mcpAuth.ts`." Ground truth: `mcpAuth.ts` is present at
   `packages/cli/src/ui/commands/mcpAuth.ts` and contains `listOAuthServers:49` + `performMcpOAuth:82`
   (which calls `MCPOAuthProvider.authenticate:108`, `restartServer:132`, `setTools:136`). The
   substance (the real OAuth flow shape) is correct; the file claim is not. This plan cites
   `mcpAuth.ts`.
2. **Item A needs NO new plumbing.** `OAuthManager` is ALREADY on `AgentDeps`
   (`agentImpl.ts:121 readonly oauthManager: OAuthManager`, imported `:25`). `buildAuthControl()`
   (`agentImpl.ts:431`) can thread `this.deps.oauthManager` into the auth control with zero new
   constructor wiring — only an added closure on the existing deps object.

---

## Architectural Decisions

- **Pattern: Facade + Adapter, additive sub-controllers.** Every new capability follows the EXISTING
  convention with NO new patterns introduced:
  1. Declare the interface in `packages/agents/src/api/agent.ts` (alongside `AgentToolControl`,
     `AgentMcpControl`, `AgentAuthControl`, `AgentHookControl` at `:223-321`).
  2. Implement in `packages/agents/src/api/control/<name>Control.ts` (mirrors `control/mcpControl.ts`,
     `control/authControl.ts`).
  3. Wire into `AgentImpl`: add `readonly <name>: <Name>Control` near `agentImpl.ts:194-200`;
     instantiate in the constructor near `:328-332` (alongside `auth`/`mcp`/`ide`/`session`/`hooks`),
     via a `private build<Name>Control()` near `:431-510`.
  - Top-level capabilities with no sub-state (approval mode) become direct top-level `Agent` methods
    mirroring the ephemeral-settings one-liners (`agentImpl.ts:726-738`).
- **Non-breaking is a HARD CONSTRAINT (REQ-009).** Additive only. The shipped
  `createAgent(AgentConfig)` / `fromConfig(Config)` signatures, every current public export, every
  current `./internals.js` / `./app-service.js` export keep working unchanged. Backed by a
  characterization test extended BEFORE/ALONGSIDE the new surface (the existing
  `publicSurface.nonbreaking.test.ts`).
- **Delegate, never cache.** Each controller resolves through `this.deps.config.<getter>()` (or the
  injected closure over the live Config/OAuthManager) PER CALL — mirroring `getConfig`/`getRuntimeId`
  (`agentImpl.ts:716-723`). No cached engine state in any controller. Every controller is
  **undefined-safe** for its backing manager (async-task manager / hook system / MCP manager can all
  be absent — mirror the idle/empty/no-op idiom at `mcpControl.ts:121-124,216-219,236-239`).
- **Project public types; omit non-serializable internals.** New public types are PROJECTED views
  that omit non-serializable / unsafe internals: `AgentTaskInfo` omits `abortController`
  (`asyncTaskManager.ts:28`); `PolicyRuleView` projects `argsPattern: RegExp` to its `.source` string
  (the CLI already consumes `.source`, `policiesCommand.ts:111`); auth/tool-key views expose MASKED
  metadata only — NEVER raw token strings or raw secret values.
- **Type-safety: zero-assertion.** New re-exports use `export` for VALUES (enums/classes/functions)
  and `export type` for interfaces/type-aliases, matching `verbatimModuleSyntax` and the
  `AgentClientContract` type-only precedent (`api/index.ts:20`). No `any`, no unsafe `as`.
- **Comment discipline (N5).** Production code carries ONLY `@plan` / `@requirement` / `@pseudocode`
  marker blocks — no explanatory prose comments.

---

## Project Structure

> **Reconciliation note:** This plan UPDATES existing files; it does NOT create `*V2`/`*New`/parallel
> surfaces. New files are permitted ONLY where they are a NET-NEW entrypoint that the existing
> convention demands — i.e. one `control/<name>Control.ts` per genuinely new sub-controller (policy,
> tasks, tool-keys), exactly as #1594 added one file per controller. Capabilities that EXTEND an
> existing controller (hooks-admin, auth-detail, mcp-oauth) MODIFY that controller's existing file.

```
packages/agents/src/api/
  agent.ts                       MODIFY  add AgentPolicyControl, AgentTasksControl,
                                         AgentToolKeysControl interfaces; extend AgentHookControl,
                                         AgentAuthControl, AgentMcpControl, AgentToolControl;
                                         add getApprovalMode/setApprovalMode + readonly policy/tasks
                                         on Agent; add projected public types
  agentImpl.ts                   MODIFY  add readonly policy/tasks fields; getApprovalMode/
                                         setApprovalMode delegations; build<Name>Control() builders;
                                         thread oauthManager into buildAuthControl
  index.ts                       MODIFY  re-export new projected public types + any new VALUE
                                         (none expected; enums already re-exported by core barrel)
  control/
    policyControl.ts             CREATE  AgentPolicyControl impl (read-only snapshots)
    tasksControl.ts              CREATE  AgentTasksControl impl (undefined-safe)
    toolKeysControl.ts           CREATE  AgentToolKeysControl impl (masked)
    hooks.ts                     MODIFY  extend HookControl with admin (list/disabled get-set/enable-disable)
    authControl.ts               MODIFY  add detailedStatus/getHigherPriorityAuth/listBucketStatuses
    mcpControl.ts                MODIFY  add authenticate(server) (real OAuth) + details(opts);
                                         refresh() setTools parity
  __tests__/
    agent.approvalMode.behavior.test.ts        CREATE
    policyControl.behavior.test.ts             CREATE
    tasksControl.behavior.test.ts              CREATE
    hooksAdmin.behavior.test.ts                CREATE
    authDetail.behavior.test.ts                CREATE
    mcpOAuth.behavior.test.ts                  CREATE
    toolKeysControl.behavior.test.ts           CREATE
    capabilityGaps.integration.spec.ts         CREATE  (public-root-only; the #1595 adequacy driver)
    publicSurface.nonbreaking.test.ts          MODIFY  assert new methods present + nothing removed
app-services/
  command-api-map.ts             MODIFY  register /approval-mode, /policies, /task, /hooks,
                                         /toolkey, /toolkeyfile (kind: runtime)
docs/
  agent-api.md                   MODIFY  document the new surfaces (REQ-010)
```

CONFIRM (read-only, NOT modified): `packages/core/**`, `packages/providers/**`, `packages/policy/**`,
`packages/cli/**`.

---

## Technical Environment

- Type: TypeScript monorepo (npm workspaces), ESM, `verbatimModuleSyntax`, `noUnusedLocals`.
- Runtime: Node ≥ 20.
- Test: Vitest (`agents` package `test` script = `vitest run`). Single-file: `npx vitest run <file>`.
- Property testing: `fast-check` ^4.2.0 (devDep present). Schema: `zod` ^3.25.76.
- Mutation: Stryker (`@stryker-mutator/core` ^9.6.1 + `@stryker-mutator/vitest-runner`) via
  `packages/agents/stryker.conf.json` (`mutate: ["src/api/**/*.ts", ...exclusions]`) — new
  `control/*.ts` files are auto-included in the mutation set.
- Dependencies available to `packages/agents` (verified `package.json:42-45`):
  `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-policy`, `@vybestack/llxprt-code-providers`.
- Boundary guard: `api/__tests__/boundary.spec.ts` (T17) scans ONLY `*.spec.ts`. Behavioral
  `*.spec.ts` on the public-consumer path may import ONLY the public root
  `@vybestack/llxprt-code-agents` (+ `node:`/`vitest`/`fast-check`/relative-within-src). `*.test.ts`
  is T17-exempt (may use `./internals.js` / reference-drive). The new public-adequacy driver is a
  `.spec.ts` importing ONLY the public root.

---

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature

- **#1595 CLI refactor (the consumer).** After this plan, #1595 rewires these CLI call sites to the
  new Agent surface instead of `core.Config`:
  - `packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts` → `agent.getApprovalMode()` /
    `agent.setApprovalMode()`.
  - `packages/cli/src/ui/commands/policiesCommand.ts` → `agent.policy.getRules()` /
    `getDefaultDecision()` / `isNonInteractive()`.
  - `packages/cli/src/ui/commands/tasksCommand.ts` + `useGeminiStreamOrchestration.ts` →
    `agent.tasks.list()` / `listRunning()` / `get()` / `cancel()` / `cancelAllRunning()`.
  - `packages/cli/src/ui/commands/hooksCommand.ts` → `agent.hooks.listHooks()` /
    `getDisabledHooks()` / `setDisabledHooks()` / `enable()` / `disable()`.
  - `packages/cli/src/ui/commands/authCommand.ts` → `agent.auth.detailedStatus()` /
    `getHigherPriorityAuth()` / `listBucketStatuses()`.
  - `packages/cli/src/ui/commands/mcpAuth.ts` + `mcpCommand.ts` → `agent.mcp.authenticate()` /
    `agent.mcp.details()` / `agent.mcp.refresh()`.
  - `packages/cli/src/ui/commands/toolkeyCommand.ts` + `toolkeyfileCommand.ts` →
    `agent.tools.keys.*`.
- **`COMMAND_API_MAP`** (`app-services/command-api-map.ts`) — the machine-checkable registry #1595
  uses to know each slash command's API backing. New `runtime`-kind rows for the six commands.

### Existing Code To Be Replaced/Removed

- NONE in this plan. The CLI deep-import call sites above are replaced by #1595, NOT here. This plan
  only makes the replacement POSSIBLE by providing the public surface. No production code is removed.

### User Access Points

- Public package root `@vybestack/llxprt-code-agents`: `agent.getApprovalMode()`,
  `agent.setApprovalMode()`, `agent.policy.*`, `agent.tasks.*`, `agent.hooks.*` (admin),
  `agent.auth.*` (detail), `agent.mcp.*` (oauth/details), `agent.tools.keys.*`, and the new projected
  public types.
- No CLI-visible behavior change ships in this plan (the CLI still uses its current code until #1595).

### Migration Requirements

- Additive: existing consumers of `@vybestack/llxprt-code-agents` require NO migration. The
  `publicSurface.nonbreaking.test.ts` guard proves every #1594-era export is unchanged.
- The new projected types are NEW names; they do not shadow or rename existing exports.

---

## Formal Requirements

### [REQ-001] Approval mode read/write on `Agent`

**Full Text**: `Agent` MUST expose `getApprovalMode(): ApprovalMode` and
`setApprovalMode(mode: ApprovalMode): void` as top-level methods that delegate directly to the bound
`Config.getApprovalMode()` (`configBaseCore.ts:463`) and `Config.setApprovalMode()` (`config.ts:401`).
- **[REQ-001.1]** `getApprovalMode()` returns the live Config value (no caching).
- **[REQ-001.2]** `setApprovalMode(mode)` delegates DIRECTLY — it MUST NOT normalize, swallow, or
  catch. The untrusted-folder throw (`"Cannot enable privileged approval modes in an untrusted
  folder."`, `config.ts:404`) MUST propagate faithfully to the caller for any non-`DEFAULT` mode in
  an untrusted folder.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a Config whose approval mode is `AUTO_EDIT`
- WHEN `agent.getApprovalMode()` is called
- THEN it returns `ApprovalMode.AUTO_EDIT`
- GIVEN a trusted folder
- WHEN `agent.setApprovalMode(ApprovalMode.YOLO)` is called
- THEN the bound Config's approval mode becomes `YOLO` and a subsequent `getApprovalMode()` reflects it
- GIVEN an untrusted folder
- WHEN `agent.setApprovalMode(ApprovalMode.YOLO)` is called
- THEN it THROWS the untrusted-folder error (not caught/normalized)

### [REQ-002] Read-only policy inspection controller

**Full Text**: `Agent` MUST expose a read-only `policy: AgentPolicyControl` sub-controller that
projects the bound `Config.getPolicyEngine()` (`configBaseCore.ts:475`).
- **[REQ-002.1]** `getRules(): readonly PolicyRuleView[]` returns read-only SNAPSHOTS of
  `PolicyEngine.getRules()` (`policy-engine.ts:320`), with `argsPattern` projected to its `.source`
  string (or `undefined` when absent) so the public type is JSON-safe and never leaks a raw `RegExp`.
- **[REQ-002.2]** `getDefaultDecision(): PolicyDecision` delegates to `getDefaultDecision()`
  (`policy-engine.ts:329`).
- **[REQ-002.3]** `isNonInteractive(): boolean` delegates to `isNonInteractive()`
  (`policy-engine.ts:338`).
- **[REQ-002.4]** Rule MUTATION is OUT OF SCOPE (no CLI write path exists). The controller is
  read-only.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a policy engine with zero rules → `getRules()` returns `[]`; `getDefaultDecision()` returns
  the engine default; `isNonInteractive()` returns the engine flag
- GIVEN a rule with `argsPattern = /"command":"npm test"/` → the projected `PolicyRuleView.argsPattern`
  equals the string `"command":"npm test"` (i.e. `rule.argsPattern.source`), NOT a `RegExp`
- GIVEN a rule with no `argsPattern` → the projected view's `argsPattern` is `undefined`

### [REQ-003] Async-task administration controller (full `/task` surface)

**Full Text**: `Agent` MUST expose a `tasks: AgentTasksControl` sub-controller projecting the bound
`Config.getAsyncTaskManager()` (`config.ts:601`, `AsyncTaskManager | undefined`), undefined-safe.
- **[REQ-003.1]** `list(): readonly AgentTaskInfo[]` projects `getAllTasks()`
  (`asyncTaskManager.ts:77`).
- **[REQ-003.2]** `listRunning(): readonly AgentTaskInfo[]` projects `getRunningTasks()`
  (`asyncTaskManager.ts:319`).
- **[REQ-003.3]** `get(id): AgentTaskInfo | undefined` projects `getTask(id)`
  (`asyncTaskManager.ts:273`).
- **[REQ-003.4]** `cancel(id): boolean` delegates to `cancelTask(id)` (`asyncTaskManager.ts:239`,
  idempotent boolean).
- **[REQ-003.5]** `cancelAllRunning(): number` cancels every running task (iterate `getRunningTasks()`
  → `cancelTask()`) and returns the COUNT cancelled (better than `void` for behavioral assertions —
  core has no native `cancelAllRunning`).
- **[REQ-003.6]** When the async-task manager is `undefined`, every method is a SAFE no-op:
  `list()`/`listRunning()` → `[]`; `get()` → `undefined`; `cancel()` → `false`;
  `cancelAllRunning()` → `0`.
- **[REQ-003.7]** The public `AgentTaskInfo` projection MUST OMIT `abortController`
  (`asyncTaskManager.ts:28`) and any other non-serializable internal.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a manager with 3 tasks (2 running, 1 completed) → `list()` has length 3; `listRunning()` has
  length 2; `cancelAllRunning()` returns 2 and a subsequent `listRunning()` is empty
- GIVEN `get("known-id")` → returns that task projected (no `abortController` key); `get("missing")`
  → `undefined`
- GIVEN `cancel("known")` → `true`; `cancel("missing")` → `false`
- GIVEN `getAsyncTaskManager()` returns `undefined` → all methods no-op per REQ-003.6

### [REQ-004] Hooks administration (extend `AgentHookControl`)

**Full Text**: `AgentHookControl` MUST be EXTENDED with registry inspection + enable/disable
administration (distinct from its existing execution/lifecycle surface at `agent.ts:314-321`),
undefined-safe when there is no hook system (`Config.getHookSystem()`, `config.ts:755`, nullable).
- **[REQ-004.1]** `listHooks(): readonly HookInfo[]` snapshots the registry
  (`HookSystem.getRegistry().getAllHooks()`, `hookRegistry.ts:82`; each entry's name via
  `getHookName()`, `hookRegistry.ts:118`; `enabled` flag from `HookRegistryEntry.enabled`,
  `hookRegistry.ts:41`).
- **[REQ-004.2]** `getDisabledHooks(): readonly string[]` delegates to `Config.getDisabledHooks()`
  (`config.ts:734`).
- **[REQ-004.3]** `setDisabledHooks(names: readonly string[]): void` delegates to
  `Config.setDisabledHooks()` (`configBase.ts:132`).
- **[REQ-004.4]** Convenience `enable(name)` / `disable(name)` over the disabled-set (compute the new
  disabled array and call `setDisabledHooks`) — exact `/hooks enable|disable` semantics
  (`hooksCommand.ts:107-111,177-180`).
- **[REQ-004.5]** When `getHookSystem()` is `undefined`, `listHooks()` → `[]`; the disabled-set
  get/set still delegate to Config (which owns the disabled list independent of an initialized
  system).
- **[REQ-004.6]** The existing `AgentHookControl` methods (`onHookExecution`/`triggerSessionStart`/
  `triggerSessionEnd`/`clear`) MUST remain unchanged (non-breaking).

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a hook system with hooks `[a (enabled), b (disabled)]` → `listHooks()` returns both with
  correct names + `enabled` flags
- GIVEN `setDisabledHooks(["a"])` then `getDisabledHooks()` → returns `["a"]` (round-trip)
- GIVEN `disable("b")` when disabled is `["a"]` → disabled becomes `["a","b"]`; `enable("a")` →
  disabled becomes `["b"]`
- GIVEN `getHookSystem()` is `undefined` → `listHooks()` returns `[]` (no throw)

### [REQ-005] (Item A) Detailed OAuth state (extend `Agent.auth`)

**Full Text**: `AgentAuthControl` MUST be EXTENDED with sanitized OAuth metadata methods backed by
the OAuthManager ALREADY available on `AgentDeps` (`agentImpl.ts:121`), threaded into the auth
control via the existing `buildAuthControl()` builder (`agentImpl.ts:431`). NO raw token strings are
ever exposed.
- **[REQ-005.1]** `detailedStatus(provider): Promise<AuthProviderDetail>` — authenticated flag
  (`isAuthenticated()`, `oauth-manager.ts:199`), OAuth-enabled flag (`isOAuthEnabled()`, `:300`),
  token expiry (from `peekStoredToken()`, `:243` — expiry timestamp ONLY, never the token string).
- **[REQ-005.2]** `getHigherPriorityAuth(provider): Promise<string | null>` delegates to
  `getHigherPriorityAuth()` (`oauth-manager.ts:313`).
- **[REQ-005.3]** `listBucketStatuses(provider): Promise<readonly AuthBucketStatus[]>` projects
  `getAuthStatusWithBuckets()` (`oauth-manager.ts:395`) to `{ bucket, authenticated, expiry?,
  isSessionBucket }` — masked metadata, never token strings.
- **[REQ-005.4]** The existing `AgentAuthControl` methods remain unchanged (non-breaking).

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN an authenticated provider with a token expiring at epoch T → `detailedStatus()` returns
  `{ authenticated: true, oauthEnabled: <flag>, expiry: T }` and NO field contains the raw token
- GIVEN a provider shadowed by a higher-priority auth → `getHigherPriorityAuth()` returns that
  source name; otherwise `null`
- GIVEN two buckets → `listBucketStatuses()` returns one entry each, with `isSessionBucket` set
  correctly and no token strings present

### [REQ-006] (Item B) MCP OAuth + deep detail + refresh parity (extend `Agent.mcp`)

**Full Text**: `AgentMcpControl` MUST be EXTENDED to cover the real MCP OAuth flow and deep detail,
and `refresh()` MUST achieve tool-declaration parity with the CLI.
- **[REQ-006.1]** `authenticate(server): Promise<McpServerAuthStatus>` performs the REAL OAuth flow
  mirroring `mcpAuth.ts:82 performMcpOAuth`: `MCPOAuthProvider.authenticate()` (`mcpAuth.ts:108`) →
  `manager.restartServer(server)` (`:132`) → re-publish tools (`agentClient.setTools()`, `:136`) →
  return the resulting auth status. (`MCPOAuthProvider` is re-exported from the core barrel
  `index.ts:498` — no new dependency.)
- **[REQ-006.2]** `refresh(server?)` MUST re-publish tool declarations after restart (setTools
  parity) — closing the confirmed gap where `mcpControl.ts:236-245` restarts but never calls
  `setTools()`, whereas `/mcp refresh` does.
- **[REQ-006.3]** `details(opts?: { includeTools?; includePrompts?; includeResources?;
  includeSchemas? }): Promise<McpDetailStatus>` projects deep registry detail (tools/prompts/
  resources/schemas) for the migrated `/mcp list desc|schema` views.
- **[REQ-006.4]** All methods undefined-safe when the MCP manager is absent (idle/empty/no-op idiom,
  `mcpControl.ts:121-124`).
- **[REQ-006.5]** The existing `AgentMcpControl` methods (`listServers`/`status`/`toolsByServer`/
  `auth`/`discoveryState`) remain unchanged in signature (non-breaking); `auth()` retains its
  per-agent flag semantics and the NEW real flow is `authenticate()`.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a server requiring OAuth → `authenticate(server)` runs the provider auth, restarts the
  server, re-publishes tools, and returns an authenticated status
- GIVEN a refresh → after `refresh(server?)`, the agent client's tools are re-published (parity with
  `/mcp refresh`)
- GIVEN `details({ includeTools: true })` → returns the tool detail for configured servers
- GIVEN no MCP manager → `authenticate()`/`details()`/`refresh()` no-op safely

### [REQ-007] (Item C) Built-in tool-key storage (`Agent.tools.keys`)

**Full Text**: `AgentToolControl` MUST be EXTENDED with a `keys: AgentToolKeysControl` sub-controller
for built-in tool-key storage, backed by `ToolKeyStorage` (`tool-key-storage.ts:109`) and the tool
registry helpers (`getSupportedToolNames`/`getToolKeyEntry`/`isValidToolKeyName`/`maskKeyForDisplay`,
core barrel `index.ts:472-475`). MASKED metadata only — raw secret values are NEVER returned.
- **[REQ-007.1]** `supported(): readonly ToolKeyInfo[]` lists tool-key-capable tools
  (`getSupportedToolNames()` + `getToolKeyEntry()`).
- **[REQ-007.2]** `status(toolName): Promise<ToolKeyStatus>` returns whether a key/keyfile is set,
  with the key MASKED (`maskKeyForDisplay()`, `index.ts:475`) — never the raw value.
- **[REQ-007.3]** `save(toolName, key): Promise<void>` → `ToolKeyStorage.saveKey()`
  (`tool-key-storage.ts:280`); validates the name (`isValidToolKeyName()`).
- **[REQ-007.4]** `delete(toolName): Promise<void>` → `deleteKey()` (`tool-key-storage.ts:314`).
- **[REQ-007.5]** `setKeyFile(toolName, path | null): Promise<void>` → `setKeyfilePath()` /
  `clearKeyfilePath()` (`tool-key-storage.ts:241,254`).
- **[REQ-007.6]** `getKeyFile(toolName): Promise<string | null>` → `getKeyfilePath()`
  (`tool-key-storage.ts:248`).
- **[REQ-007.7]** CLI-side path expansion / existence / non-empty validation stays UI-level
  prevalidation (remains in the CLI), NOT in the Agent API. `Agent.auth.keys` (provider-auth) is
  untouched and distinct.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a supported tool with no key → `status(tool)` reports not-set; after `save(tool, "secret")`,
  `status(tool)` reports set with a MASKED value (raw `"secret"` never returned)
- GIVEN `setKeyFile(tool, "/p")` then `getKeyFile(tool)` → `"/p"`; `setKeyFile(tool, null)` then
  `getKeyFile(tool)` → `null`
- GIVEN an invalid tool name → `save()` rejects (validation), no silent write

### [REQ-008] Public barrel re-exports + `COMMAND_API_MAP` registration

**Full Text**: All new PROJECTED public types MUST be re-exported from the agents api barrel
(`packages/agents/src/api/index.ts`), type-only where they are types (matching the
`AgentClientContract` precedent `index.ts:20`); and the six migrated commands MUST be registered in
`COMMAND_API_MAP` (`app-services/command-api-map.ts`).
- **[REQ-008.1]** Re-export `PolicyRuleView`, `AgentTaskInfo`, `HookInfo`, `AuthProviderDetail`,
  `AuthBucketStatus`, `McpDetailStatus`, `ToolKeyInfo`, `ToolKeyStatus` (projected types), plus any
  enums needed by consumers that are NOT already surfaced (`ApprovalMode` is already re-exported as a
  type at `agent.ts:387`; `PolicyDecision` is a VALUE enum re-exported from the core barrel —
  surface it for consumers if not already reachable).
- **[REQ-008.2]** Add `COMMAND_API_MAP` rows (kind `runtime`) for `/approval-mode`, `/policies`,
  `/task`, `/hooks`, `/toolkey`, `/toolkeyfile`. The map's boundary test
  (`app-service-boundary.spec.ts`) MUST stay green (no orphan, unique names, durable entries
  importable).

### [REQ-009] Non-breaking guarantee

**Full Text**: The change MUST be purely additive. The shipped `createAgent(AgentConfig)` /
`fromConfig(Config)` signatures and behavior, every current public export, and every current
`./internals.js` / `./app-service.js` export MUST keep working unchanged. No existing export is
removed, renamed, or retyped.
- **Behavior**: GIVEN a consumer written against the prior public surface, WHEN this plan lands,
  THEN it compiles and behaves identically.
- **[REQ-009.1]** The existing methods on extended controllers (`AgentHookControl`,
  `AgentAuthControl`, `AgentMcpControl`, `AgentToolControl`) keep their exact signatures; new methods
  are ADDED, not substituted.

### [REQ-010] Documentation

**Full Text**: `docs/agent-api.md` MUST document the new surfaces: approval mode, `policy`, `tasks`,
hooks-admin, auth-detail, MCP OAuth/details, and `tools.keys`, with the masked/projected-type
contract and the undefined-safe semantics.

---

### Integration Requirements

> Acceptance-interpretation note: the integration requirements are the EXECUTABLE form of the #1595
> adequacy criterion. Each is satisfied by a behavioral test on the PUBLIC-ROOT-ONLY path
> (`capabilityGaps.integration.spec.ts`), driving a real `fromConfig`-built Agent — NOT a mock.

### [REQ-INT-001] Approval-mode CLI parity
The value read/written through `agent.getApprovalMode()` / `setApprovalMode()` is identical to what
the CLI's current `useAutoAcceptIndicator` direct `Config` calls would observe, INCLUDING the
untrusted-folder throw (REQ-001.2).

### [REQ-INT-002] Policy + async-task CLI parity
`agent.policy.*` returns the same rules/default/non-interactive the `/policies` command renders today
(with `argsPattern` as `.source`); `agent.tasks.*` covers the full `/task` surface
(list/listRunning/get/cancel/cancelAllRunning) the CLI drives today.

### [REQ-INT-003] Hooks-admin + auth-detail CLI parity
`agent.hooks.listHooks()/getDisabledHooks()/setDisabledHooks()/enable()/disable()` round-trips
exactly as `/hooks` does; `agent.auth.detailedStatus()/getHigherPriorityAuth()/listBucketStatuses()`
exposes the same masked metadata the `/auth` UX needs (no raw tokens).

### [REQ-INT-004] MCP-OAuth + tool-keys CLI parity
`agent.mcp.authenticate()/refresh()/details()` matches the `mcpAuth.ts`/`/mcp` flow including
post-auth `setTools()` parity; `agent.tools.keys.*` matches `/toolkey`+`/toolkeyfile` (masked).

### [REQ-INT-005] No-deep-import boundary (the #1595 mission)
Every new capability MUST be reachable using ONLY the public root `@vybestack/llxprt-code-agents`
(the boundary the #1595 CLI imports from). The new public-adequacy driver
(`capabilityGaps.integration.spec.ts`) is a `.spec.ts` that imports ONLY the public root and is
enforced by the T17 boundary guard (`boundary.spec.ts`). No new deep `/src/`/`core/src`/
`providers/src`/`internals.js` import on the public-consumer path.

---

## Data Schemas

New PROJECTED public types (TypeScript). Interfaces are `export type`-re-exported from the barrel.
Zod schemas are provided for the projected DATA types that cross the public boundary as values
(callbacks and class instances are NOT Zod-validated, per #1594 precedent).

```typescript
// Policy (REQ-002) — argsPattern projected to string (never raw RegExp)
export interface PolicyRuleView {
  readonly priority: number;
  readonly toolName: string;
  readonly decision: PolicyDecision;          // VALUE enum (core barrel)
  readonly argsPattern?: string;              // = rule.argsPattern?.source
  readonly source?: string;
}

// Async tasks (REQ-003) — omits abortController and other internals
export interface AgentTaskInfo {
  readonly id: string;
  readonly subagentName: string;
  readonly goalPrompt: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';  // = AsyncTaskStatus
  readonly launchedAt: number;
  readonly completedAt?: number;
  readonly error?: string;
}

// Hooks admin (REQ-004)
export interface HookInfo {
  readonly name: string;
  readonly eventName: string;
  readonly enabled: boolean;
  readonly source?: string;
}

// Auth detail (REQ-005) — masked metadata, NEVER token strings
export interface AuthProviderDetail {
  readonly provider: string;
  readonly authenticated: boolean;
  readonly oauthEnabled: boolean;
  readonly expiry?: number;                   // epoch seconds/ms from peekStoredToken; NO token
}
export interface AuthBucketStatus {
  readonly bucket: string;
  readonly authenticated: boolean;
  readonly expiry?: number;
  readonly isSessionBucket: boolean;
}

// MCP detail (REQ-006)
export interface McpDetailStatus {
  readonly servers: readonly McpServerDetail[];
}
export interface McpServerDetail {
  readonly name: string;
  readonly authenticated: boolean;
  readonly tools?: readonly ToolInfo[];
  readonly prompts?: readonly string[];
  readonly resources?: readonly string[];
}
// McpServerAuthStatus is the EXISTING type already returned by AgentMcpControl.auth().

// Tool keys (REQ-007) — masked only
export interface ToolKeyInfo {
  readonly toolName: string;
  readonly description?: string;
}
export interface ToolKeyStatus {
  readonly toolName: string;
  readonly hasKey: boolean;
  readonly maskedKey?: string;                // maskKeyForDisplay(); NEVER raw
  readonly keyFile?: string | null;
}
```

```typescript
// Zod (data types crossing the boundary as values). Callbacks/instances are NOT validated.
import { z } from 'zod';

export const AgentTaskInfoSchema = z.object({
  id: z.string(),
  subagentName: z.string(),
  goalPrompt: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  launchedAt: z.number(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
}).strict();   // .strict() PROVES abortController cannot leak (REQ-003.7)

export const PolicyRuleViewSchema = z.object({
  priority: z.number(),
  toolName: z.string(),
  decision: z.nativeEnum(PolicyDecision),
  argsPattern: z.string().optional(),         // string, not RegExp (REQ-002.1)
  source: z.string().optional(),
}).strict();
```

---

## Example Data

```json
{
  "policyRuleView": {
    "priority": 0.5,
    "toolName": "run_shell_command",
    "decision": "deny",
    "argsPattern": "\"command\":\"npm test\"",
    "source": "user-settings"
  },
  "agentTaskInfo": {
    "id": "task-7f3a",
    "subagentName": "researcher",
    "goalPrompt": "summarize the repo",
    "status": "running",
    "launchedAt": 1750000000000
  },
  "hookInfo": { "name": "format-on-save", "eventName": "PostToolUse", "enabled": true },
  "authProviderDetail": { "provider": "anthropic", "authenticated": true, "oauthEnabled": true, "expiry": 1750003600000 },
  "toolKeyStatus": { "toolName": "web_search", "hasKey": true, "maskedKey": "sk-…last4", "keyFile": null }
}
```

---

## Constraints

- **C-APPROVAL-THROW**: `setApprovalMode` delegates directly; the untrusted-folder throw propagates
  (REQ-001.2). NO try/catch, NO normalization.
- **C-NO-ABORTCONTROLLER**: `AgentTaskInfo` MUST NOT contain `abortController` (REQ-003.7);
  `.strict()` Zod proves it.
- **C-ARGSPATTERN-STRING**: `PolicyRuleView.argsPattern` is the `.source` STRING, never a raw
  `RegExp` (REQ-002.1).
- **C-NO-RAW-SECRETS**: Auth-detail and tool-key surfaces expose MASKED metadata only — never raw
  token strings (REQ-005) or raw key values (REQ-007.2).
- **C-UNDEFINED-SAFE**: Every controller is undefined-safe for its backing manager (async-task / hook
  system / MCP manager / policy engine where nullable).
- **C-DELEGATE-NO-CACHE**: Resolve through the live Config/OAuthManager per call; no cached engine
  state.
- **C-NON-BREAKING**: No existing export removed/renamed/retyped (REQ-009).
- **C-NO-DEEP-IMPORT**: The public-consumer path imports only the public root (REQ-INT-005); behavioral
  drivers are `.spec.ts` under the T17 guard.
- **C-COMMENT-DISCIPLINE**: Production code carries only `@plan`/`@requirement`/`@pseudocode` markers.

## Performance Requirements

- All new methods are thin projections/delegations; no added latency beyond the underlying Config /
  manager call. `cancelAllRunning()` is O(running tasks). `details()` is O(servers × tools) and is
  only invoked on explicit `/mcp list desc|schema`. No polling, no background work introduced.
