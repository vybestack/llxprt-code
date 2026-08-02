# Issue #2685 — Docs audit phase 2: user-perspective rewrites and deduplication

Status: complete
Branch: `issue2685`
Predecessor: #2654 phase 1 (merged as 35369bb11) — link/placement guards, six relocations,
factual corrections, `dev-docs/documentation-style-guide.md`.

## Goal

Complete the subjective half of the #2654 audit: rewrite large user-facing pages from the
reader's perspective, split mixed user/internal material, deduplicate repeated sections, and
remove rollout-era and sensational framing. Placement and link correctness are already
mechanically enforced; this issue supplies the prose judgement those guards cannot make.

## Authority

`dev-docs/documentation-style-guide.md` is the governing standard:

- `docs/` targets product consumers; `dev-docs/` targets repository contributors.
- Pages lead with the reader's outcome and a minimal path, not implementation history.
- Source paths, internal type definitions, test names, and issue/plan IDs do not belong in
  `docs/`.
- One canonical page per subject; link rather than copy.
- Security claims state boundaries and evidence, not absolutes.

## Scope reconciliation

Two items named in the issue do not exist on `main` and are therefore out of scope. Both were
listed from the original audit snapshot and no longer resolve:

| Issue item                              | State on `main` | Disposition |
| --------------------------------------- | --------------- | ----------- |
| `docs/release-notes/2025Q4.md`          | Absent (no `docs/release-notes/` directory) | Out of scope — nothing to rewrite |
| `docs/migration/stateless-provider-v2.md` | Absent          | Out of scope — nothing to rewrite |

`docs/agent-api.md` was relocated wholesale to `dev-docs/agent-api.md` by phase 1. The phase 2
work for that item is the split the issue asks for: extract the supported consumer-facing API
surface back into `docs/`, leaving implementation history and future work in `dev-docs/`.

## Acceptance criteria

Each criterion is verified by inspection against the style guide checklist plus the mechanical
guards. "No internal material" means: no repository source paths, no internal-only type or
function signatures, no test names, no issue/plan IDs used as structure, no implementation
history or future-work sections.

### AC1 — Agent API split

- `docs/agent-api.md` exists and covers, in reader-task order: audience and stability, the
  supported entry package and imports, quick start, configuration (`createAgent` /
  `AgentConfig`), lifecycle and control-plane operations, events, errors, disposal, and
  examples.
- `dev-docs/agent-api.md` retains implementation history, recorded decisions, import-boundary
  material, runtime-vs-app-service internals, sequence model, and future work, and cross-links
  to the user page.
- Neither page duplicates the other's material.

### AC2 — Deployment split

- `docs/deployment.md` keeps install, run, and deployment guidance for users.
- Running-from-source, package/build architecture, test-runner, and release-workflow internals
  are removed from `docs/` and are present in `dev-docs/` (existing `dev-docs/npm.md`,
  `dev-docs/bun.md`, `dev-docs/test-runner-inventory.md` where already covered; no duplicate
  copies created).

### AC3 — Message bus

- `docs/message-bus.md` leads with controlling tool execution through policies.
- The legacy-flow diagram, current-flow pseudocode, and performance-internals sections are
  gone from `docs/`, and the equivalent material is confirmed present in
  `dev-docs/architecture/message-bus.md`, which the user page links to.

### AC4 — Todo system

- `docs/todo-system.md` leads with user-visible behavior (what the user sees, how to control
  the panel, how continuation affects a session).
- Model-facing tool schemas and continuation complexity heuristics are removed from `docs/`
  and recorded in `dev-docs/`.

### AC5 — Memory import

- `docs/core/memport.md` keeps syntax, path rules, safety, examples, errors, and
  troubleshooting.
- The function/type API reference and the cross-product comparison section are removed from
  `docs/` and recorded in `dev-docs/`.

### AC6 — MCP server page rebuild

- `docs/tools/mcp-server.md` is ordered by user task: add, authenticate, verify, use, restrict
  trust, troubleshoot, remove.
- Exactly one MCP-prompts section and exactly one server-management section remain (the page
  currently carries two of each).
- Discovery and tool-execution internals are removed from `docs/` and recorded in `dev-docs/`.

### AC7 — Hook tutorial consolidation

- One canonical hook tutorial page remains under `docs/hooks/`.
- The superseded page is removed and every inbound link in the repository resolves to the
  canonical page.
- No tutorial content is lost without justification; overlapping examples are merged, not
  duplicated.

### AC8 — Approval-mode migration

- `docs/migration/approval-mode-to-policies.md` follows the style guide's migration structure:
  status/affected versions/audience, compatibility impact, before and after, migration steps,
  verification, rollback, deprecation timeline.
- Rollout-era phase framing (feature-flag phases, coexistence phases) is gone.

### AC9 — Sandbox tone

- `docs/sandbox.md` states a neutral threat model, explicit boundaries (what is and is not
  isolated), per-platform limitations, and verification steps a reader can run.
- No absolute or sensational security claims remain.

### AC10 — Provider reference freshness

- `docs/providers/quick-reference.md` is a scannable setup reference.
- Mutable model/pricing/capability guidance lives on its own page carrying an explicit "as of"
  date and a named owner, per the style guide's freshness rule.

### AC11 — CLI section index

- `docs/cli/index.md` opens with task-oriented navigation and no package-layout framing.

### AC12 — Implementation pointers removed

- `docs/cli/retry-settings.md`, `docs/debug-logging.md`, and `docs/multiline-input.md` contain
  no source-file or implementation-detail pointers; that material is in `dev-docs/` where it
  is worth keeping.

### AC13 — Verification gates

- `npm run lint:doc-links` and `npm run lint:doc-placement` pass.
- `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test` pass.
- Every factual claim written or retained is verified against source; the verification log
  below records the checks performed.

## Boundary cases

- **Link fan-in.** `packages/cli/src/ui/commands/mcpCommand.ts` and its test hard-code the
  GitHub URL for `docs/tools/mcp-server.md`. That path must not move.
- **Anchor stability.** The link guard validates `#anchor` fragments. Any heading rename must
  be matched by inbound-link updates in the same change.
- **Placement guard.** `docs/` must not gain `architecture/`, `plans/`, or `merge-notes/`
  directories, and must not carry `@plan:`, `@requirement:`, `PLAN-`, or `REQ-` markers
  outside fenced code blocks.
- **Deletion safety.** Content is only deleted from `docs/` after confirming the equivalent
  exists in `dev-docs/`; otherwise it is moved.

## Non-goals

- No changes to code, tests, tooling, CI, or dependencies.
- No new guards or lint rules; phase 1 already supplies them.
- No edits to `docs/` pages outside the issue's list except link updates forced by relocation
  or consolidation.

## Verification log

Claims that documentation asserted and source did not support. Each was found by checking the
existing text against the implementation, and each is corrected rather than carried forward.
Claims that source confirmed unchanged are not listed.

| Claim as documented | Source consulted | Result |
| ------------------- | ---------------- | ------ |
| Hooks receive `GEMINI_PROJECT_DIR` and `CLAUDE_PROJECT_DIR` as compatibility aliases | `hookRunner.ts` — the child environment adds only `LLXPRT_PROJECT_DIR`, and only `$LLXPRT_PROJECT_DIR` is expanded in a hook `command` | False; removed |
| A hook denies a tool by writing decision JSON to stdout and exiting 2 | `hookRunner.ts` `parseHookOutput` — stdout is parsed only on exit 0; on non-zero exit only stderr is converted. Combined with `hookAggregator.ts`, such a hook produces no decision and the tool proceeds | False and fails open; every affected example corrected |
| New or changed project hooks require explicit trust before they execute | `hookRegistry.ts` `checkProjectHooksTrust` warns only; `processHooksFromConfig` registers all project hooks when the folder is trusted. `hookRunner.ts` blocks only on an untrusted folder | False; rewritten to state folder trust as the real gate |
| `write_file` hook input carries a `path` field | `write-file.ts` — the parameter is `absolute_path`, with `file_path` as a compatibility alias | False; examples silently matched nothing |
| Hooks are enabled with `hooks.enabled` | `settingsLegacy.ts` `migrateHooksConfig` moves the key to `hooksConfig`; `hooksCommand.ts` names `hooksConfig.enabled` | Legacy form; canonical key documented |
| `tools.policyPath` points the policy loader at a file | Declared in `schema-security.ts`, but the only reader is `getUserPolicyPath`, which no production `PolicyConfigSource` implements | No production consumer; per-project policy instructions removed |
| Policy files accept decimal priorities such as `2.5` | `toml-loader.ts` `PolicyRuleSchema` accepts integers 0–999; `transformPriority` computes `tier + priority/1000` | False; authored vs resolved priority now distinguished |
| `Ctrl+E` toggles auto-edit mode | `keyBindings.ts` — `TOGGLE_AUTO_EDIT` is Shift+Tab; Ctrl+E is `END` | False; corrected |
| Dangerous shell commands are deny rules at priority 2.0 | `policy-engine.ts` hard-denies via `isDestructiveCommand` before rule matching, with no priority | Mischaracterised; corrected |
| Read-only/write default policy tool lists | `read-only.toml`, `write.toml` | Multiple tool names wrong; corrected from the policy files |
| `/policies` prints pipe-separated columns | `policiesCommand.ts` groups by tier with `Priority X.XXX: tool → DECISION` | False; corrected |
| Todo continuation is controlled by `/ephemeral todo-continuation` | `setCommand.ts` — ephemeral settings are set with `/set`; no `/ephemeral` command exists | False; corrected |
| `showTodoPanel` is a top-level settings key | `schema-ui.ts` — defined under `ui` | False; nesting corrected |
| Retry attempts default to 6 uniformly across providers | `openAIResponsesExecutor.ts` and `AnthropicRateLimitHandler.ts` use 6; `vercelRequestParams.ts` uses 2 | Not uniform; corrected |
| `Ctrl+Enter` and `Alt+Enter` insert a newline on all platforms | `Help.tsx` and `keyBindings.ts` — Ctrl+J outside Windows, Ctrl+Enter on Windows, Alt+Enter only on some Linux terminals | False; corrected |
| Container sandboxing keeps stored secrets off the boundary | `sandbox-containers.ts` mounts `~/.config/gcloud` and `GOOGLE_APPLICATION_CREDENTIALS`, forwards `GEMINI_API_KEY`/`GOOGLE_API_KEY`, and honours arbitrary `SANDBOX_MOUNTS` | Overstated; crossings enumerated with risk |
| A non-empty `SANDBOX` variable confirms the sandbox is active | `sandboxConfig.ts` `getSandboxCommand` returns early on a pre-existing `SANDBOX`, suppressing sandbox startup | Forgeable and self-defeating; replaced with container filesystem markers |
| MCP performs dynamic client registration on first connect, and `auth.noBrowser` gives a manual flow | `mcp-transport.ts` `resolveAccessToken` requires `/mcp auth`; `oauth-provider.ts` `ensureClientRegistration` is conditional; `auth.noBrowser` has no consumer in the MCP package | False; rewritten |
| stdio MCP servers do not inherit shell variables | `mcp-transport.ts` builds the child env as `{ ...process.env, ...config.env }` | Inverted; corrected with the security implication |
| MCP tool-name conflicts resolve by first registration | `mcp-tool.ts` `generateMcpToolName` always namespaces as `mcp__<server>__<tool>` | False; corrected |
| `context-limit` and `max_tokens` are additive windows | `CompressionHandler.ts` / `contextLimitPolicy.ts` subtract the completion budget from the single limit | False; budgeting guidance rewritten |
| No listed API-key provider ships a configured context window | `deepseek.config`, `fireworks.config`, `zai.config` configure 1,000,000 windows | False; every alias config audited |

## Verification gates

| Gate | Result |
| ---- | ------ |
| `npm run lint:doc-links` | pass |
| `npm run lint:doc-placement` | pass |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm run test` | pass |
| `npx prettier --check docs/ dev-docs/` | pass |

## Deferred

`docs/policy-configuration.md` and `docs/cli/configuration.md` are outside this issue's page
list. Two defects were observed there and are not fixed here:

- Every TOML example on `docs/policy-configuration.md` uses a fractional `priority`, which
  `PolicyRuleSchema` rejects. Only the section that contradicted this change's migration guide
  was corrected.
- `docs/cli/configuration.md` lists `tools.policyPath` as a working setting. It is declared in
  the schema but has no production consumer.
