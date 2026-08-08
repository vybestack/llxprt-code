# P01 — Config Member Census by Role

Plan ID: PLAN-20260808-ISSUE2615.P01 · Requirement: REQ-002

> Authoritative checker-based census. Generated from commit `fedd4f9e932834ffd7f3d9affa750db3d4829f1b` using the
> TypeScript compiler API **with a type checker** (`ts.createProgram` + `program.getTypeChecker()`).
> This supersedes the syntactic tools `scripts/config-contract.ts` and
> `scripts/config-narrow-candidates.ts`, which are known to over- and under-report.

## 1. Method

Each property access in every production source file outside `packages/core` was resolved by
the checker: the receiver expression's type was obtained with `getTypeAtLocation`, the member
symbol resolved with `getPropertyOfType` (decomposed across `Config | undefined` unions to
recover optional-chaining accesses), and the access was counted **only** when the resolved
symbol's declaration sits on the `ConfigBaseCore → ConfigBase → Config` hierarchy. This makes the
result immune to the three failure modes of the syntactic tools (see §5).

Config declares **369** members; **116** are reached
from production code outside core, across **85** production files
(a further ~35 files reference `Config` as a type annotation only).

## 2. Member totals per role

| Role | Members |
|---|---|
| SessionIdentity | 6 |
| ModelSelection | 10 |
| EphemeralSettings | 6 |
| WorkspacePaths | 8 |
| MemoryAccess | 11 |
| ToolAccess | 5 |
| PolicyAccess | 3 |
| McpAccess | 10 |
| TelemetryAccess | 1 |
| Diagnostics | 2 |
| **role subtotal** | **62** |
| serviceLocators | 41 |
| unassigned | 13 |
| **total reached** | **116** |

No role exceeds the 12-member budget. The largest are ModelSelection (10) and McpAccess (10);
MemoryAccess has 11. Headroom exists on every role.

Each role's members, signatures and call sites are in `role-assignment.json → roles`.

## 3. Service locators (41)

Members that hand out — or install — an injectable service object. These do **not** appear on any
role interface; P06 turns each into an explicit constructor/factory parameter at the composition
root. Setters (`setProviderManager`, …) are the write side of the same injection point.

| Member | Returns | prod | roots needing it |
|---|---|---|---|
| `getToolRegistry` | ToolRegistry | 17 | 6 |
| `getProviderManager` | RuntimeProviderManager | undefined | 17 | 5 |
| `getSettingsService` | SettingsService | 13 | 6 |
| `getPolicyEngine` | PolicyEngine | 9 | 6 |
| `getHookSystem` | HookSystem | undefined | 9 | 0 |
| `getSubagentManager` | SubagentManager | undefined | 9 | 1 |
| `getMcpClientManager` | McpClientManager | undefined | 8 | 0 |
| `getOrCreateScheduler` | Promise<ToolSchedulerContract> | 7 | 2 |
| `getAgentClient` | AgentClientContract | 6 | 5 |
| `storage` | Storage | 6 | 0 |
| `setSessionRecordingService` | void | 5 | 0 |
| `getPromptRegistry` | PromptRegistry | 3 | 1 |
| `getResourceRegistry` | ResourceRegistry | 3 | 1 |
| `getSkillManager` | SkillManager | 3 | 0 |
| `getProfileManager` | ProfileManager | undefined | 3 | 1 |
| `setBucketFailoverHandler` | void | 3 | 1 |
| `setProviderManager` | void | 2 | 1 |
| `getExtensionLoader` | ExtensionLoader | 2 | 1 |
| `getRunImageOperation` | ImageOperationRunner | undefined | 2 | 0 |
| `getFileSystemService` | FileSystemService | 2 | 1 |
| `getSessionRecordingService` | SessionRecordingService | undefined | 2 | 1 |
| `getFileService` | FileDiscoveryService | 2 | 0 |
| `getGitService` | Promise<GitService> | 2 | 0 |
| `getBucketFailoverHandler` | BucketFailoverHandler | undefined | 2 | 0 |
| `getTokenizerFactory` | RuntimeTokenizerFactory | undefined | 2 | 0 |
| `toolRegistry` | ToolRegistry | 1 | 1 |
| `setProfileManager` | void | 1 | 1 |
| `setSubagentManager` | void | 1 | 1 |
| `getAsyncTaskManager` | AsyncTaskManager | undefined | 1 | 1 |
| `getShellJobManager` | ShellJobManager | undefined | 1 | 1 |
| `setRunImageOperation` | void | 1 | 1 |
| `getToolSchedulerFactory` | ToolSchedulerFactory | undefined | 1 | 1 |
| `setToolSchedulerFactory` | void | 1 | 1 |
| `getAgentClientFactory` | AgentClientFactory | undefined | 1 | 1 |
| `setAgentClientFactory` | void | 1 | 1 |
| `getRuntimeMessageBus` | MessageBus | undefined | 1 | 1 |
| `setRuntimeMessageBus` | void | 1 | 1 |
| `getRuntimeOAuthManager` | OAuthManager | undefined | 1 | 1 |
| `setRuntimeOAuthManager` | void | 1 | 1 |
| `setImageBackendResolver` | void | 1 | 1 |
| `getIdeClient` | IdeClient | undefined | 1 | 0 |

## 4. Composition roots (21)

A file is a composition root if it calls `fromConfig(...)` (or `createAgentRuntimeStateFromConfig`),
constructs a chat session / content generator / agent / subagent scope, or reads more than 8
distinct Config members. All three signals are recorded per file so P02 can judge. The five roots
named in the plan overview are present: `client.ts`, `zedIntegration.ts`,
`subagentOrchestrator.ts` (reached via `subagentRuntimeSetup.ts`), `ChatSessionFactory.ts`
(`createChatSessionSafe`) and the CLI entry (reached via `cliAgentBootstrap.ts` → `fromConfig`).

| members | new Config | fromConfig | session ctor | file |
|---|---|---|---|---|
| 17 |  |  |  | `packages/agents/src/api/agentImpl.ts` |
| 13 | ✓ |  |  | `packages/providers/src/runtime/runtimeContextFactory.ts` |
| 12 |  |  | ✓ | `packages/agents/src/core/subagentRuntimeSetup.ts` |
| 12 |  |  | ✓ | `packages/agents/src/core/ChatSessionFactory.ts` |
| 11 |  |  |  | `packages/agents/src/api/fromConfig.ts` |
| 11 |  |  |  | `packages/mcp/src/client/mcp-client-manager.ts` |
| 10 | ✓ |  |  | `packages/agents/src/api/createAgent.ts` |
| 10 |  |  |  | `packages/cli/src/config/postConfigRuntime.ts` |
| 10 |  | ✓ | ✓ | `packages/cli/src/nonInteractiveCli.ts` |
| 9 |  |  |  | `packages/providers/src/runtime/providerSwitch.ts` |
| 9 |  |  |  | `packages/cli/src/cliSessionBootstrap.ts` |
| 9 |  |  |  | `packages/a2a-server/src/agent/task.ts` |
| 7 |  | ✓ | ✓ | `packages/agents/src/agents/executor.ts` |
| 7 |  | ✓ | ✓ | `packages/cli/src/zed-integration/zedIntegration.ts` |
| 6 |  |  | ✓ | `packages/agents/src/core/client.ts` |
| 3 |  |  | ✓ | `packages/agents/src/tools/task.ts` |
| 2 |  | ✓ | ✓ | `packages/cli/src/cliAgentBootstrap.ts` |
| 1 |  |  | ✓ | `packages/agents/src/api/agentBootstrap.ts` |
| 0 |  |  | ✓ | `packages/providers/src/gemini/geminiGenerationExecution.ts` |
| 0 | ✓ |  | ✓ | `packages/agents/src/core/client-test-helpers.ts` |
| 0 |  |  | ✓ | `packages/agents/src/api/runtimeFactories.ts` |

### `new Config(...)` sites

49 distinct files construct `Config`; **6 are production** (the legitimate
factories/harnesses that keep the concrete class), the rest are test scaffolding. Production
construction sites (the `configConstructors` list):

- `packages/a2a-server/src/config/config.ts`
- `packages/agents/src/api/createAgent.ts`
- `packages/agents/src/core/client-test-helpers.ts`
- `packages/agents/src/core/subagent-test-helpers.ts`
- `packages/cli/src/config/configBuilder.ts`
- `packages/providers/src/runtime/runtimeContextFactory.ts`

## 5. Where the checker disagreed with the syntactic tools

`scripts/config-contract.ts` is purely syntactic: it binds identifiers by text (per file) and
records any property access on a name annotated `Config`. The checker-based pass differs in three
ways, exactly the three the phase file names. The reconciliation below is computed directly from
`scripts/config-contract.ts` output vs this checker census.

### 5.1 Missed receivers reached through `deps` properties

The syntactic tool only follows a direct identifier or a single `this.x` receiver. It cannot see
`this.deps.config.getSessionId()` or `deps.config.getToolRegistry()`, so it **skips entire files**
whose only Config handle is a nested property. The worst case is
`packages/agents/src/api/agentImpl.ts`: it imports `Config` and reads **17 distinct members**
exclusively through `this.deps.config.*` / `deps.config.*`; the syntactic tool reports **0** for
that file. Other examples: `MessageStreamOrchestrator.ts` (`this.deps.config`),
`messageStreamModelInfo.ts` (`deps.config.getContentGeneratorConfig()`).

Net effect on shared members — the syntactic tool **under-counts** 41 of the
shared members (every getter also reached through a deps/forwarding/optional chain). Sample:

| Member | syntactic prod | checker prod |
|---|---|---|
| `getEphemeralSetting` | 31 | 40 |
| `setEphemeralSetting` | 25 | 34 |
| `getSessionId` | 15 | 24 |
| `isInteractive` | 15 | 22 |
| `getModel` | 17 | 22 |
| `getProvider` | 17 | 18 |

### 5.2 Mis-attributed properties of objects that share a variable name

Because binding is by text, a non-`Config` object also named `config` (a provider config, an
options bag, a provider-record) gets its properties recorded as `Config` members. The checker
resolves the receiver's actual type and excludes them. **29 names** the
syntactic tool reports are **not** Config members at all, including: `options` (10), `constructor` (4), `cacheLogger` (4), `isOAuth` (3), `logger` (3), `config` (3), `name` (1), `apiKey` (1), `envKeyNames` (1), `isOAuthEnabled` (1), `supportsOAuth` (1), `oauthProvider` (1), `oauthManager` (1), `providerKeyStorage` (1), …

Concrete mechanism: `packages/providers/src/BaseProvider.ts` imports `Config` **and** has a
`constructor(config: BaseProviderConfig, …)`; `config.name`, `config.apiKey`,
`config.envKeyNames`, `config.isOAuthEnabled`, `config.supportsOAuth` are provider-config
fields that the syntactic tool attributes to `Config`. The checker resolves `config` to
`BaseProviderConfig` and records none of them.

### 5.3 Cannot see forwarding / optional chaining

**Forwarding:** an unannotated local that holds a Config (`const cfg = config; cfg.getX()`)
is invisible to text binding. The checker infers the local's type and resolves it. **21
members** the checker confirms are reached in production are **entirely absent** from the
syntactic output: `awaitMcpDiscoveryGate`, `dispose`, `getAsyncTaskManager`, `getCoreMemoryFileCount`, `getDisabledHooks`, `getExcludeTools`, `getExtensionLoader`, `getImagePayloadBudgetBytes`, `getLlxprtMdFileCount`, `getLlxprtMdFilePaths`, `getQuiet`, `getShellJobManager`, `getSkillManager`, `refreshMemory`, `reloadSkills`, `setApprovalMode`, `setCoreMemory`, `setSessionRecordingService`, `setUserMemory`, `shutdownLspService`, `toolRegistry`.

**Optional chaining:** the syntactic tools do not model `config?.x`. `getTokenizerFactory()` is
reached only as `this.config?.getTokenizerFactory()` (`ProviderManager.ts:571`) and
`config?.getTokenizerFactory` (`promptEnvelopeSendSeam.ts:220`); the syntactic tool's single
report of it is a coincidental name hit, while the checker recovers both real sites by decomposing
the `Config | undefined` receiver union. (`toolRegistry`, the public field, is similarly
invisible to text binding and appears only in the checker output.)

### 5.4 Net reconciliation

- Syntactic reports **124** production members; the checker confirms **116**.
- **29** syntactic names are false positives (not Config members) → removed.
- **21** checker-confirmed members were entirely missing from the syntactic output
  (forwarding/deps-only) → added; `getTokenizerFactory`'s two real optional-chaining sites were
  recovered where the syntactic tool had only a single coincidental name hit.
- Counts on 41 shared members rise because deps/forwarding/optional sites are now counted.

## 6. Unassigned (13)

Members that fit none of the ten roles and are not service locators. P02 decides their fate; no
eleventh role is invented here.

| Member | Note |
|---|---|
| `getEnableHooks` | hook feature flag; no Hook role defined (P02: fold into ToolAccess or a new HookAccess) |
| `getDisabledHooks` | hook configuration list; no Hook role defined |
| `setDisabledHooks` | hook configuration setter; no Hook role defined |
| `disposeScheduler` | scheduler lifecycle/teardown, not a data or service read |
| `initialize` | Config lifecycle bootstrap, not a role member |
| `ensureInitialized` | Config lifecycle bootstrap, not a role member |
| `dispose` | Config teardown, not a role member |
| `shutdownLspService` | LSP service teardown, not a role member |
| `getCheckpointingEnabled` | checkpointing feature flag; separate concern (P02: consider Diagnostics) |
| `reloadSkills` | skill lifecycle reload; skill access is via getSkillManager (locator) |
| `getExtensions` | extension list; separate subsystem (P02: new ExtensionAccess or ToolAccess) |
| `getExperimentalZedIntegration` | launch-mode feature flag; separate concern |
| `getListExtensions` | launch-mode feature flag; separate concern |

## 7. Acceptance check

- [x] `analysis/role-assignment.json` exists, valid JSON, matches the phase shape
- [x] every member with a production call site appears exactly once across roles + serviceLocators + unassigned (116 = 62 + 41 + 13)
- [x] every role has ≤ 12 members (max is 11)
- [x] no file under `packages/` modified

## Reproduction

Throwaway scripts under `tmp/` (gitignored): `bun tmp/p01-analyze.ts` builds the program and
emits `tmp/p01-raw.json`; `bun tmp/p01-finalize.ts` classifies and writes these two files.
