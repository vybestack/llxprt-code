# Issue #2326 — Hot-load MCP configuration changes

## Policy status

`dev-docs/workflow/ISSUE-DELIVERY.md` is not present on `main`, in any local Git
history, on recently fetched remote branches, or at the GitHub contents endpoint
for the requested path. This ledger therefore applies the bounded delivery
requirements supplied with issue #2326 directly. `dev-docs/RULES.md` remains
authoritative for behavioral RED→GREEN TDD.

## Current behavior and root cause

`/mcp refresh` already restarts connected clients, but
`McpClientManager.restart()` reads each client's existing in-memory server
configuration. MCP settings are resolved once during CLI startup, and the
separate-process `llxprt mcp add` and `llxprt mcp remove` commands only write
settings to disk. An active session therefore cannot add a newly configured
server, remove a deleted server, or replace a changed server configuration.

## Acceptance matrix

| ID | Accepted behavior | Behavioral evidence | Completion gate |
| --- | --- | --- | --- |
| A1 | `/mcp reload` re-reads persisted MCP settings, applies the startup MCP merge/filter precedence, and reconciles the active session without restarting LLxprt. The active profile's startup-time MCP overlay, active extensions, startup `--allowed-mcp-server-names`, and startup admin MCP enablement remain authoritative. | RED-first CLI config/composition tests use temporary settings files and prove reload resolves through the same `resolveMcpServers` behavior as startup, including blocked-server results. | Focused tests prove fresh persisted settings are read while fixed startup inputs retain precedence. |
| A2 | A newly added, allowed server is connected and its discovered tools, prompts, and resources become available after `/mcp reload`. | RED-first manager/control behavior test changes the live desired map from `{A}` to `{A,B}`, reloads, and observes real registry-visible artifacts and re-published client tools. | The new server appears in `/mcp` status and its artifacts are callable/visible without session restart. |
| A3 | A removed server is disconnected, removed from manager status, and has all of its tools, prompts, and resources removed after `/mcp reload`. | RED-first manager behavior test changes `{A,B}` to `{A}` and observes the real manager and registries after reload. | No stale server or artifact remains and client tool declarations are re-published. |
| A4 | A server whose effective configuration changed is disconnected and rediscovered with the new configuration; an effectively unchanged server is not restarted. | RED-first manager behavior tests cover changed and unchanged effective configurations. | Reconfiguration takes effect and no-op reload is idempotent. |
| A5 | The existing `/mcp refresh` and `agent.mcp.refresh(server?)` behavior remains unchanged: they restart existing clients from in-memory configuration and do not read settings from disk. | Existing refresh suites remain green plus a regression test distinguishing refresh from reload. | No refresh contract regression. |
| A6 | A settings read/validation failure rejects reload, reports `Failed to reload MCP configuration: <reason>`, does not re-publish commands/tools, and leaves the previous live config and clients unchanged. | RED-first config and slash-command tests induce a settings-load failure and observe prior live state. | Failure is visible and validate-before-mutate is proven. |
| A7 | A per-server connection/discovery failure does not prevent other added or changed servers from reconciling; existing discovery-failure/status reporting exposes the failed server. | RED-first manager integration behavior uses one successful and one failing transport while exercising the real reconciliation path. | Successful servers remain available and failed server status is visible. |
| A8 | Reload honors folder trust: configuration can be refreshed in memory, but no MCP server is connected or discovered while the folder is untrusted. | RED-first manager behavior test reloads while untrusted and observes zero connections/artifacts. Existing trust transition tests remain green. | No trust-boundary regression. |
| A9 | Trusted-server policy rules and blocked-server status are synchronized to the newly accepted effective MCP configuration before reconciliation. | RED-first Config behavior tests add/remove trusted and filtered servers and observe policy/block state. | Removed rules do not persist and newly trusted servers receive only the existing MCP-trusted policy behavior. |
| A10 | `/mcp reload` is discoverable as a distinct built-in subcommand, reports a pending reload message, reloads slash commands after success, and returns current MCP status. | RED-first `mcpCommand` behavior tests cover registration, missing config/agent, success, `Error`, and non-`Error` rejection. Command/API mapping test covers the public agent route. | CLI tests and tmux harness demonstrate the command and resulting status. |

## Explicit user-visible semantics

- `/mcp reload` means: read MCP settings from disk, validate and resolve them,
  atomically replace the live effective MCP map, reconcile added/removed/changed
  configured servers, then re-publish tools and slash commands.
- `/mcp refresh` retains its current meaning: restart currently connected MCP
  servers using their already loaded configuration.
- Unchanged effective server definitions remain connected. Changed and removed
  definitions are disconnected as part of the explicit user command.
- Server discovery failures use the existing per-server partial-failure status;
  configuration-read failures reject the command and preserve the prior state.

## Bounded vertical slices

1. **Reload resolution contract (RED→GREEN):** inject one MCP-only reload
   callback at the CLI composition boundary. It reloads persisted settings,
   reapplies only the active profile's startup MCP overrides, and invokes the
   existing `resolveMcpServers` function with startup extension/CLI/admin inputs.
2. **Atomic live config update (RED→GREEN):** Config validates callback output,
   swaps MCP and blocked-server maps together, and re-synchronizes the existing
   MCP trusted-policy source.
3. **Runtime reconciliation (RED→GREEN):** manager compares current client
   configurations with the new desired map, removes stale artifacts/clients,
   discovers added/changed servers through existing lifecycle primitives, leaves
   unchanged servers alone, and preserves existing trust/partial-failure paths.
4. **Agent and CLI entry point (RED→GREEN):** expose additive `agent.mcp.reload()`
   orchestration and `/mcp reload`; re-publish tool declarations and commands
   after success while preserving `/mcp refresh`.
5. **Documentation and evidence:** document reload versus refresh, run focused
   and full gates, exercise the command in the tmux harness, and record exact-head
   review/CI evidence in this ledger.

## Expected paths

| Path | Planned change |
| --- | --- |
| `project-plans/issue-2326-hotload-mcp-config.md` | Acceptance, scope, findings, and evidence ledger. |
| `packages/cli/src/config/config.ts` | Construct the MCP-only persisted-settings reload callback with startup precedence inputs. |
| `packages/cli/src/config/configBuilder.ts` | Thread the callback through the existing composition root. |
| `packages/cli/src/config/config.test.ts` or an adjacent existing config test | Behavioral reload-resolution and failure-preservation evidence. |
| `packages/core/src/config/configTypes.ts` | Add the optional injected MCP reload callback contract. **Approval-gated shared construction API.** |
| `packages/core/src/config/configBaseCore.ts` | Store the injected callback and support atomic MCP/blocked-state replacement. |
| `packages/core/src/config/configConstructor.ts` | Apply the callback during Config construction. |
| `packages/core/src/config/config.ts` | Reload effective MCP state and synchronize existing MCP trusted-policy rules. |
| `packages/core/src/config/config.test.ts` or one adjacent Config behavior test | Atomic state and trusted-policy behavior evidence. |
| `packages/mcp/src/client/mcp-client-manager.ts` | Reconcile configured server clients and artifacts against the refreshed map. |
| `packages/mcp/src/client/mcp-client-manager.restart.test.ts` or one adjacent manager test | Add/remove/change/no-op/trust/partial-failure behavioral evidence. |
| `packages/agents/src/api/agent.ts` | Add `AgentMcpControl.reload()`. **Approval-gated public API.** |
| `packages/agents/src/api/control/mcpControl.ts` | Orchestrate config reload, manager reconciliation, and tool re-publication. |
| `packages/agents/src/api/control/mcpControlWiring.ts` | Bind reload to live Config. |
| `packages/agents/src/api/__tests__/mcp-discovery.spec.ts` and/or `mcpOAuth.behavior.test.ts` | Agent reload and refresh-regression behavioral evidence. |
| `packages/agents/src/app-services/command-api-map.ts` | Map `/mcp reload` to the public agent capability. |
| `packages/cli/src/ui/commands/mcpCommand.ts` | Add the distinct reload subcommand and result/error UX. |
| `packages/cli/src/ui/commands/mcpCommand.auth-refresh.test.ts` | Slash-command registration, success, failure, and guard evidence. |
| `docs/tools/mcp-server.md` | Document reload versus refresh and bounded limitations. |
| `docs/cli/configuration.md` | Mark persisted MCP server changes as reloadable without session restart. |

Expected maximum: 20 paths and approximately 800–1,200 net changed lines. No
other path is authorized without updating this ledger and checking the stop
conditions.

## Explicit non-goals

- No automatic settings filesystem watcher, polling, or reload daemon.
- No new dependency, subsystem, workflow, agent-memory, quality-tool, lint,
  complexity, source-size, coverage, or CI configuration change.
- No hot-reload of profile selection/profile contents, extension installation or
  discovery, admin MCP enablement, CLI arguments, or `mcpServerCommand`; those
  process-start inputs remain fixed. Already active extension MCP definitions
  continue to participate through the startup context.
- No OAuth token invalidation or authentication redesign. A reconfigured server
  may still require `/mcp auth <server>` through the existing flow.
- No headless/REST/A2A reload endpoint and no changes to non-interactive command
  semantics.
- No new active-tool-call draining/tracking subsystem. `/mcp reload` is an
  explicit interactive lifecycle operation, and changed/removed servers may be
  disconnected with the same lifecycle semantics as today's explicit
  `/mcp refresh`.
- No unrelated MCP refactor, test relocation, cleanup, or optional hardening
  after A1–A10 and required gates pass.

## Scope ledger

### Planned scope

| Slice | Paths | Status |
| --- | --- | --- |
| Acceptance and scope record | `project-plans/issue-2326-hotload-mcp-config.md` | Complete; API additions approved by the user |
| Reload resolution | CLI `config.ts`, `configBuilder.ts`, `mcpFilteringParity.test.ts` | Implemented; 16 focused tests pass |
| Atomic Config update | Core config types/base/constructor/config and `config.d.test.ts` | Implemented; additive construction seam approved |
| Runtime reconciliation | MCP client manager, existing adjacent helper module, and restart behavior test | Implemented; helper extraction was required to retain the existing 800-line lint limit |
| Agent/CLI entry point | Agent interface/control/wiring/tests/mapping and CLI command/tests | Implemented; additive public API approved |
| Documentation | MCP server and configuration docs | Implemented |

### Budget and stop conditions

- Target: no more than 25 changed files or 1,500 net changed lines.
- Mandatory scope review above either target threshold.
- Hard stop without approval above 40 files or 2,500 net changed lines.
- Stop before any unplanned subsystem/public abstraction, workflow,
  agent-memory, quality-tool, dependency, unrelated refactor/test move, or
  behavior outside A1–A10.
- Stop if profile/extension hot-reload, OAuth redesign, transport changes, or an
  active-call tracking subsystem becomes necessary.

## Approval gate before implementation

The bounded design requires two additive shared/public abstractions that do not
exist today:

1. `AgentMcpControl.reload(): Promise<void>` so `/mcp reload` uses the supported
   agent API rather than reaching through CLI internals.
2. An optional `ConfigParameters` MCP reload callback plus
   `Config.reloadMcpServers()` so core can request fresh CLI-owned settings
   resolution without introducing a core→CLI dependency.

The user approved both planned API additions before implementation. No further
public abstraction was added.

## Review finding classifications

Every finding will be recorded as one of:

- **Blocker-Fix:** accepted behavior, safety/data loss, or required-gate failure.
- **In-scope-Fix:** defect or maintainability issue wholly within A1–A10 and the
  approved paths.
- **Reject:** factually incorrect, already satisfied, or harmful.
- **Defer:** valid but outside this matrix or budget; no implementation without
  approval.

Reviewer suggestions never authorize scope expansion. Local Open Code Review is
limited to two runs and PR Open Code Review is limited to two runs for this
issue/PR effort.

## Candidate-head evidence

### RED evidence

Before production implementation, focused behavior tests failed because
`Config.reloadMcpServers`, `McpClientManager.reconcileConfiguredMcpServers`,
`McpControl.reload`, and the `/mcp reload` command did not exist. Existing tests
in those focused files remained green.

### Focused GREEN evidence

- Core Config, MCP manager, agent orchestration, command-map, and slash-command
  suites: 5 files and 87 tests passed.
- CLI MCP filtering/reload integration suite: 16 tests passed from the CLI
  package configuration, including persisted server/filter reload, fixed startup
  CLI allow-list, and startup administrative disablement.
- ESLint passes for all changed TypeScript paths. The manager remains within the
  existing 800-line source limit through a bounded extraction into its existing
  adjacent helper module; no lint or complexity rule changed.
- `git diff --check` passes, and the diff contains no new ESLint/TypeScript
  suppressions or MCP client type assertions.

### Scope counts

Current implementation scope is 23 paths, including this ledger and the existing
`mcp-client-manager-helpers.ts` module used for the lint-required lifecycle
extraction. Tracked code/test/doc changes are +863/-90 (773 net); the
ledger remains below the 25-file and 1,500-net-line mandatory-review thresholds.

### Local verification (complete)

| Gate                                       | Result                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Focused behavior suites (5 files)          | 87 tests passed (core config reload, manager reconciliation, agent orchestration, command map, slash command).                        |
| CLI MCP filtering/reload parity (1 file)   | 16 tests passed (persisted server/filter reload, startup CLI allow-list retention, startup administrative disablement).               |
| Full `npm run test`                        | 498 files, 6160 tests passed, 4 skipped, 0 failed. One pre-existing flaky timeout (`process-run.test.ts`) proven unrelated (passes 19/19 in isolation; not in diff). |
| `npm run typecheck`                        | 0 errors across all workspaces (after stale-dist rebuild).                                                                            |
| `npm run lint`                             | Passed.                                                                                                                               |
| `npm run lint:eslint-guard`                | Passed ("ESLint policy guard passed").                                                                                                |
| `npx prettier --check <changed files>`     | All files formatted.                                                                                                                  |
| `npm run build`                            | Clean, 0 errors.                                                                                                                      |
| Smoke test (`bun scripts/start.ts`)        | Boot path confirmed: CLI boots and reaches the provider call stage; fails only on external 401/402 credentials (not a code regression). No profile with valid credentials is available in this environment. |
| tmux harness (`/mcp reload`)               | PASS. Captured screen shows `/mcp reload` -> "Reloading MCP configuration from disk..." -> "No MCP servers configured." -> clean return to prompt. No error.json; all steps passed. |

### Reviews

Architect review (opusthinking): **request-changes** with 2 Blockers and 3
In-scope fixes, all reproduced against the real McpClientManager. 3 findings
rejected after verification (non-issues).

| Finding | Classification | Resolution |
| --- | --- | --- |
| B1: In-flight discovery race — reconcile diffs only `this.clients`, so a removed server whose connect is still resolving re-registers after `/mcp reload` returns | Blocker-Fix | `reconcileConfiguredMcpServers` now bumps `this.trustGeneration++` before computing the diff, mirroring the `quarantineForTrustRevocation` pattern. Any in-flight `connectAndDiscover` sees the stale generation and cleans up instead of calling `clients.set`. Behavioral test added: slow-connect server removed during reconcile does not resurrect. |
| B2: Extension server teardown — extension-owned clients not in `getMcpServers()` are classified as removals in the agents composition | Blocker-Fix | `getConfiguredMcpReconciliation` now excludes clients whose `getServerConfig().extension !== undefined` from removals. Behavioral test added: extension client survives reconcile against an extension-free configured map. |
| IS3: Trusted-policy source divergence — reload builds rules from the merged/filtered map while startup uses raw `settings.mcpServers`, allowing extension-declared `trust:true` to gain rules on reload | In-scope-Fix | Reload callback now returns `settingsMcpServers` alongside `mcpServers`; `reloadMcpServers` feeds `settingsMcpServers` (not the merged map) to `buildMcpTrustedRules`. Behavioral test added: policy rules match `settingsMcpServers`, not the merged map. |
| IS4: Eager-argument-evaluation trust regression — `startConfiguredMcpServers` now mutates `Config.mcpServers` in untrusted folders because the helper extraction moved the trust check after the argument object is constructed | In-scope-Fix | `startConfiguredMcpClients` now takes `resolveServers: () => ...` (a thunk) instead of `servers: ...`. The mutation runs only after the trust check passes. Behavioral test added: `populateMcpServerCommand` not called in an untrusted folder. |
| IS5: Silent no-op reported as success — `reloadMcpServers` silently returns when `_onReloadMcpServers` is undefined | In-scope-Fix | `reloadMcpServers` now throws "MCP server reload is not available in this composition." when the callback is unwired. The `/mcp reload` error path renders this correctly. Behavioral test added: Config without callback throws and preserves prior state. |
| IS6: Partial reconciliation failure summary | Defer | A7 requires per-server failure visibility, which the existing status provides. No summary line needed. |
| IS7: comment-json/isDeepStrictEqual no-op detection | Reject | Verified: comment-json attaches non-enumerable Symbol metadata; `isDeepStrictEqual` ignores them. |
| IS8: docs/cli/configuration.md binary diff | Reject | Pre-existing `.gitattributes -diff` setting; zero NUL bytes; clean single-line text addition. |
| IS9: 799/800 max-lines margin | Reject | `eslint` exits 0; no rule changed or suppressed. |

DeepThinker: pending (gpt56solhigh rate-limited).
Open Code Review (local): 0 files reviewed (LLM rate-limited; same account-wide limit).
Open Code Review (PR, CI): 12 findings (7 inline, 5 summary-only). Dispositioned below.

| Finding | Classification | Resolution |
| --- | --- | --- |
| F1: Stale closure in reload callback captures startup state | Reject | By design: acceptance matrix A1 states the active profile's startup-time overlay remains authoritative for the session. Hot-loading profile changes is an explicit non-goal. |
| F2: Promise.all fail-fast in reconcile removals | Reject | `removeAndDisconnectMcpClient` catches all errors via `reportError`; it never throws. Promise.all cannot fail-fast. |
| F3: Magic timeout `setTimeout(resolve, 50)` in in-flight race test | In-scope-Fix | Replaced with `vi.waitFor(() => expect(manager.getClient('fast')).toBeDefined())` — deterministic, no magic timeout. |
| F4: Reference equality in `applyStartupMcpProfileOverrides` | Reject | The comparison detects whether a profile merged MCP settings at startup (`profileMergedSettings.mcpServers === startupSettings.mcpServers`). It compares startup objects to each other, not refreshed-vs-startup. Correct by design. |
| F5: Non-MCP policy rules not verified to survive reload | In-scope-Fix | Added test asserting a custom-source rule added before reload remains after reload. |
| F6: Inconsistent error handling (discover vs remove) | Reject | Pre-existing behavior: `maybeDiscoverMcpServer` records failures instead of throwing. Not introduced by this PR. |
| F7: Missing JSDoc on `AgentMcpControl.reload()` | In-scope-Fix | Added JSDoc explaining reload vs refresh semantics and that it throws when unwired. |
| F8: Missing @requirement annotation on /mcp reload command-map test | In-scope-Fix | Rejected scope-wise — the test file does not use @requirement annotations for any command. Adding it to only one would be inconsistent. |
| F9: toMatchObject on potentially-undefined row | In-scope-Fix | Added `expect(row).toBeDefined()` before `toMatchObject` in the reload command-map test. |
| F10: Error-path tests missing addItem assertion | In-scope-Fix | Added `expect(context.ui.addItem).toHaveBeenCalledWith(...)` to both error-path tests. |
| F11: Subcommand list in error message | Reject | Outside acceptance matrix scope; the existing error message format is adequate. |
| F12: Coverage warning | Informational | No action needed; coverage is above thresholds. |
