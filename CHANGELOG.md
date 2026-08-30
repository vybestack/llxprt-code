# Changelog

## [Unreleased]

### Added

- **Managed background shell jobs (#1995):** The `run_shell_command` tool's `is_background` parameter now launches a fully managed background job via a direct detached spawn (`ShellJobManager`), replacing the old flag-only shell wrapper. Each job gets a stable job id (`shell_<hex>`) and is tracked for its entire lifecycle — status, output, and cancellation are available through the `check_async_tasks` tool (`action: 'list'` / `'peek'` / `'cancel'`) and the `/task list` / `/task end <id>` slash commands. Completion notifications are coalesced and surfaced to the model (alongside subagent completions) via the existing reminder/auto-trigger pipeline. The `ShellJobManager` is owned by `Config` and terminates all running jobs on session disposal (SIGTERM → bounded wait → SIGKILL), leaving no orphaned processes. A trailing `&` in any command is now promoted to a managed job identically on both the child_process and node-pty backends, using AST-based detection (fixing the long-standing defect where the PTY backend killed the job on teardown). Output is written to a mode-0600 log file and read via a bounded tail (never loaded in full). Budget (`shell-max-background-jobs`, default 10) and log cap (`shell-background-log-max-bytes`, default 8 MiB) settings control resource usage. On POSIX, a trailing `&` in any command is promoted to a managed job.

- **Windows background job support (#2981):** `is_background` is now supported on Windows. Managed background jobs are launched via PowerShell `Start-Process` with `-EncodedCommand` (base64 of UTF-16LE, eliminating all command-escaping concerns), writing stdout and stderr to two separate log files. Exit-code propagation relies on caching the process handle (`$null = $p.Handle` before `$p.WaitForExit()`). Cancellation uses `taskkill /F /T /PID` to reap the entire process tree. CLIXML-encoded error records in the stderr log are decoded automatically for display. The `check_async_tasks` tool inspects and cancels Windows jobs identically to POSIX.

### Fixed

- **Emoji filter now applies to history replay (#2888):** Session resume (`--continue`, `/chat resume`, including the session-browser resume path), `/chat restore`, and startup seeding of resumed history re-displayed recorded model text verbatim, bypassing the emoji filter that live output passes through. All history-load paths now resolve the `emojifilter` ephemeral setting exactly as the live streaming path does (`resolveEmojiFilterMode`, default `auto`) and filter replayed model text with the same rule and blocked/warn presentation as live output: thinking-block text is filtered the same way, a blocked (error-mode) turn replays as the same error item the live path renders, and warn-mode feedback appears as an info item (at the live flush-time position, after the model item). Parity is defined on the final committed transcript — replay does not reproduce intra-turn streaming interleavings (e.g. a paragraph committed before a later block, or push-time feedback ordering). User-authored text replays verbatim (the live path never filters user input) and the agent client's stored history (`clientHistory`) is untouched.
- Restored the **`claude-opus-5`** and **`claude-opus-5-latest`** entries, and the `claude-opus-5` case-insensitive rule covering dated snapshots, to the core model-limits catalog (`packages/core/src/core/model-limits.json`). They were dropped during the `dev/0.11.0` → `main` integration, which took the dev branch's catalog wholesale rather than the union of both sides; the dev tip predated Opus 5's addition. Because the restored value (`200000`) equals the catalog `defaultLimit`, `tokenLimit('claude-opus-5')` still returned the correct number by fallthrough, making this a latent regression that would have surfaced only if the default changed. Opus 5's 200K subscription context window is now pinned explicitly again, matching the provider layer and `anthropic.config`, which were unaffected (#2737).

### Changed

- **Recording-native checkpoints and branching (#2625):** `/chat save`, `/continue`, `/chat resume`, and the Agent session API now use append-only JSONL checkpoint metadata. Continuing a checkpoint creates a new locked, self-contained child session; living-session continuation remains append-in-place. Session/checkpoint names share a project namespace, history clear/restore is persisted as rewind events, and sessions with live checkpoints cannot be deleted.
- Removed dead remote telemetry scaffolding: destination CLI flags and settings now fail fast as unknown, OTLP/sdk-node dependencies and collector helpers are gone, and local file/console telemetry uses direct OpenTelemetry providers (#2692).

- **Installed command launches Bun directly (issue #2603):** The `llxprt` bin entry is now `packages/cli/bin/llxprt`, a POSIX sh launcher with a valid `#!/bin/sh` shebang (directly execve-compatible). On Windows, the CLI workspace `postinstall` (`packages/cli/scripts/install-native-launchers.cjs`) replaces npm's cmd-shim with native `.cmd` and `.ps1` launchers. No Node process is started on the installed command path. The old Node launcher (`packages/cli/bin/llxprt.cjs`) has been removed. The POSIX launcher validates the Bun executable's native binary magic (ELF/Mach-O) before exec, producing an actionable exit 43 for a corrupt or unusable binary without double-starting Bun. The Windows cmd launcher preserves the child exit code exactly (no errorlevel remapping); the PowerShell launcher wraps the invocation in try/catch to surface launch failures as exit 43 while propagating normal nonzero exits via `$LASTEXITCODE`.

### Removed (0.12.0 breaking cleanup)

- Removed expired legacy token compatibility as a 0.12.0 breaking cleanup. Retired after deprecation: the `FileTokenStore` class (file and tests), its exports from the `@vybestack/llxprt-code-mcp/auth` and core barrels, and the legacy `FileTokenStorage` `iv:authTag:ciphertext` (hex-colon) read path. OAuth tokens are stored and read exclusively through the versioned `mcp-oauth-tokens-v2.json` envelope codec; any non-envelope token file is rejected as corrupted rather than decoded. `FileTokenStorage` (v:2 envelope codec) and the other storages (`HybridTokenStorage`, `KeychainTokenStorage`, `MCPOAuthTokenStorage`) are unaffected (#2535).

- Removed inert runtime surfaces that were never wired to current behavior: the `RetryOrchestrator` circuit-breaker options (`circuitBreaker*` fields, `CircuitBreakerState`), the dead MCP tool methods `DiscoveredMCPTool.getFullyQualifiedPrefix` / `getFullyQualifiedName` / `asFullyQualifiedTool` and the `ToolRegistry` fully-qualified-name fallback that called `getFullyQualifiedName`, and the inaccessible `getLoadBalancerStats` / `getLoadBalancerLastSelected` / `getAllLoadBalancerStats` accessors on the load-balancing profile application. Retained: the live load-balancer circuit breaker, `getStats()`/`ExtendedLoadBalancerStats`, and `generateMcpToolName`/`generateValidName` (#2535).

### Removed (0.10.0 breaking cleanup)

- Removed provider-neutral Gemini legacy aliases and inherited internal naming as a 0.10.0 breaking cleanup. The `geminiLegacyAliases.ts` singleton alias module (the single legacy re-export location introduced in #2354) is deleted without replacement. External consumers must use the canonical names directly:
  - Event types: `AgentEventType`, `ServerAgentStreamEvent`, `ServerAgent*Event`, `AgentErrorEventValue`, `ServerFinishedOutcome`, `InformationalStreamEvent` — import from `@vybestack/llxprt-code-core/core/turn.js`.
  - `GeminiCodeRequest` had no internal usages and was already retired in #2354; use `ContentBlock[]` or `IContent` (`@vybestack/llxprt-code-core/services/history/IContent.js`) for conversation content, or `ToolResultContent` (`@vybestack/llxprt-code-core/llm-types/toolCall.js`) for tool-result payloads.
  - `GeminiCLIExtension` type alias — use `LlxprtExtension`.
  - `GEMINI_DIR` constant — use `LLXPRT_CONFIG_DIR`.
- `GEMINI_YOLO_MODE` environment variable is no longer honored. Use `LLXPRT_YOLO_MODE` to enable yolo (auto-approve) mode.
- Renamed provider-neutral LLxprt-owned internal identifiers: `getGeminiDir` → `getLlxprtDir`, `geminiResult` → `agentStreamResult`, `refreshGeminiTools` → `refreshAgentTools`, `maybeRefreshGeminiTools` → `maybeRefreshAgentTools`, `useGeminiignore` (filesearch option) → `useExtensionIgnore`, `setupGeminiClient` (agents test helper) → `setupAgentClient`.
- Renamed ToolFormatter tool-declaration/schema conversion methods (provider-neutral, no longer Gemini-specific): `convertGeminiToOpenAI` → `convertToolDeclarationsToOpenAI`, `convertGeminiToAnthropic` → `convertToolDeclarationsToAnthropic`, `convertGeminiToFormat` → `convertToolDeclarationsToFormat`, `convertGeminiSchemaToStandard` → `convertSchemaToStandard`.
- Added architecture enforcement (`providerAgnosticNaming.test.ts`) that rejects provider-neutral Gemini filenames and exported/declared identifiers using TypeScript AST-based scanning, while explicitly permitting genuine Gemini provider code, Code Assist/Google contracts, model/env identifiers, checkpoint wire strings, and tested gemini-cli interoperability boundaries.
- **Note:** This cleanup removes LLxprt-owned TypeScript aliases and internal names only. gemini-cli extension compatibility is fully retained: `gemini-extension.json` manifest loading (with `llxprt-extension.json` precedence), `.gemini/extensions` discovery, `.gemini-extension-install.json`, `GEMINI.md`, `.geminiignore`, and gemini-cli manifest fields/context semantics continue to work unchanged.

### Removed

- Removed legacy conversation `checkpoint-*.json` persistence and the Agent `restoreCheckpoint()` API. Legacy checkpoint files are intentionally ignored and are not migrated; recover any needed conversation content before upgrading. Unrelated Git file-edit checkpointing remains supported.
- Removed the discontinued Qwen OAuth provider. Qwen discontinued its OAuth free tier on 2026-04-15; the OAuth flow, device-flow implementation, and all OAuth wiring have been removed. Qwen models remain reachable via **API key** through Alibaba Cloud DashScope (OpenAI-compatible endpoint `https://dashscope.aliyuncs.com/compatible-mode/v1`, environment variable `DASHSCOPE_API_KEY`). The `qwen` and `qwenvercel` aliases are now API-key-only. Users should obtain a DashScope API key (or use an OpenRouter API key) instead of `/auth qwen enable`. OAuth providers are now three: Gemini, Anthropic, and Codex.

### Added

- Added **Claude Opus 5** (`claude-opus-5`) to the model menu: it is now selectable in the profile-create wizard and appears in both OAuth and default model lists with correct token/context resolution (200K subscription context default, 32K max output). Adaptive thinking and `effort` wiring cover it. The "latest" opus alias (`getLatestClaudeModel('opus')`) now resolves to `claude-opus-5-latest` (#2665).
- Added **Claude Sonnet 5** (`claude-sonnet-5`) to the model menu: it is now selectable in the profile-create wizard, appears in the Anthropic provider model list (both OAuth and default paths), and resolves correct max output tokens (128K), context window (200K subscription default; 1M is API-only/plan-gated), and token limits. The "latest" sonnet alias logic now tracks Sonnet 5, and adaptive thinking / `effort` wiring covers it (#2289).
- Async task execution: Launch subagents with `async=true` to run in background (#244)
- `check_async_tasks` tool for model to query async task status
- `/tasks list` command to show all async tasks
- `/task end <id>` command to cancel async tasks
- `task-max-async` setting to limit concurrent async tasks (default: 5)
- Auto-trigger notifications when async tasks complete

### Changed

- The Anthropic provider's default model is now **Claude Opus 5** (`claude-opus-5`), aligning `getDefaultModel()` with the `anthropic` alias config (`anthropic.config` now declares `claude-opus-5` as its `defaultModel`) (#2665).
- `AnthropicProvider.getLatestClaude4Model()` was renamed to `getLatestClaudeModel()` so the helper tracks the newest release of each tier (e.g. Sonnet 5) rather than a single generation. The old name is retained as a deprecated alias delegating to the new method and will be removed in a future release (#2289).

### Migration

- Direct consumers constructing `AuthPrecedenceResolver` and expecting it to resolve named auth keys must pass `providerKeyStorage` in the constructor options or use core's `createAuthPrecedenceResolver()` factory. The CLI profile flow already resolves named keys to concrete provider API keys before provider construction.
- LLxprt Code has moved to the [Bun](https://bun.sh) runtime. Node-compatible install/run UX is preserved — the npm (`npm install -g @vybestack/llxprt-code`), npx, and Homebrew flows are unchanged from the user's perspective. Bun is now required under the covers to power execution; the published package bundles Bun as a dependency, so most users never need to install Bun separately. The published npm package ships TypeScript source (`.ts`) and a platform-native launcher (`packages/cli/bin/llxprt`, a POSIX sh script) as its `bin` entry — no compilation or pre-compiled `dist/` artifact is shipped or required. The launcher resolves the package-local Bun and executes the `.ts` entry point directly at run time. `tsc --noEmit` is used solely for type-checking during development. The retired `bundle/llxprt.js` esbuild bundle artifact is no longer produced. Repository tests run directly with Bun via `bun:test` (Vitest has been fully removed). On Windows, the `node-pty` module has a known terminal resize race condition; the CLI silences this specific error at the process level and uses `@lydell/node-pty` (not the Bun adapter, which is POSIX-only). Users encountering terminal sizing issues should use a compatible terminal emulator; the resize race is in `node-pty` itself, not the Bun runtime.

### Removed

- Removed `--experimental-ui` flag and `@vybestack/llxprt-ui` (OpenTUI) package. The Ink-based terminal UI is now the sole UI. Development will focus on improving the existing Ink UI.
- Removed `@vybestack/llxprt-ui` from npm publishing pipeline and CI/CD workflows.
- Renamed `oldui-*` scripts and documentation to remove legacy naming (the "old UI" distinction is no longer needed).

## [0.5.3] - 2025-10-28

### Changed

- CLI runtime guard warnings now route through `packages/cli/src/runtime/messages.ts`, so every `MissingProviderRuntimeError` / `ProviderRuntimeNormalizationError` includes remediation steps (activate isolated runtime, register provider infrastructure, rerun profile bootstrap) and requirement markers (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).
- `ensureStatelessProviderReady()` and related helpers emit strict guard failures instead of silently falling back, aligning CLI behaviour with the stateless enforcement contract (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-001 @requirement:REQ-SP4-003).
- Provider cache toggles and LLXPRT\_\* compatibility flags are removed from the CLI messaging path, reinforcing that providers must instantiate clients per invocation (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-002).

### Documentation

- Added `docs/release-notes/2025-10.md` summarizing the stateless enforcement, CLI guard changes, and migration checklists (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-001 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).
- Updated `dev-docs/codex-workers.md` and `dev-docs/RULES.md` so coordinators know stateless operations are mandatory, legacy LLXPRT flags are gone, and all edits must flow through runtime-aware helpers (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).

### Migration

- Coordinators should bootstrap every worker via `activateIsolatedRuntimeContext()` / `registerCliProviderInfrastructure()` and drop any reliance on legacy singleton helpers before executing tests or edits (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).
- CLI users encountering `MissingProviderRuntimeError` should follow the remediation steps embedded in the guard output and review `dev-docs/codex-workers.md` for stateless workflows (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-001 @requirement:REQ-SP4-003).

### Verification

- `rg "PLAN-20251023-STATELESS-HARDENING.P10" docs dev-docs packages/cli/src/runtime`
- `pnpm lint packages/cli`

## [0.5.2] - 2025-10-25

### Changed

- OpenAI provider now instantiates a fresh API client for every call, drops the temporary runtime caches, and retains `clearClientCache()` solely as a compatibility no-op (PLAN-20251023-STATELESS-HARDENING.P09 / REQ-SP4-002).
- OpenAI stateless regression tests now assert that repeated invocations within the same runtime still create new clients, matching the hardened runtime guard expectations.
- ProviderManager documentation references stateless guard enforcement so downstream providers and CLI helpers no longer rely on singleton `getSettingsService()` fallbacks.

### Documentation

- Updated `docs/cli/runtime-helpers.md` with a "Stateless guard behaviour" section describing the CLI runtime registry, normalization guard, and `MissingProviderRuntimeError` escalation path.
- Extended `docs/core/provider-interface.md` with explicit stateless runtime requirements covering per-call instantiation, `options.resolved` usage, and legacy cache-helper handling.

### Verification

- `rg "getSettingsService" packages/core/src/providers` → matches limited to Vitest suites validating guard behaviour; no production providers import the singleton helper.
- `rg "runtimeClientCache" packages/core/src/providers` → (no matches)
- `pnpm lint`

## [0.5.1] - 2025-10-20

### Added

- Runtime-scoped authentication guide and migration article (`docs/migration/stateless-provider-v2.md`) covering PLAN-20251018-STATELESSPROVIDER2 upgrades.
- Q4 2025 release notes outlining provider runtime changes and CLI scope helpers.

### Changed

- Architecture, settings, CLI runtime helper, and provider runtime context documentation now describe scoped auth caches, nested runtime orchestration, and OAuth manager registration.
- `CHANGELOG.md` entry summarises stateless provider v2 deliverables and migration expectations.

### Migration

- Follow the Stateless Provider v2 migration notes for this release to adopt runtime-scoped auth.

## [0.5.0] - 2025-10-18

### Added

- Stateless provider runtime powered by `ProviderRuntimeContext`, enabling multiple concurrent contexts (CLI + subagents).
- CLI runtime helper documentation and APIs for provider switching, profile management, and diagnostics.
- Migration guide and release notes for PLAN-20250218-STATELESSPROVIDER.

### Changed

- Providers now receive runtime-scoped `SettingsService`, `Config`, and metadata through `GenerateChatOptions`.
- CLI commands route all provider mutations through `runtimeSettings` helpers to preserve context isolation.
- Documentation refreshed across architecture, settings, core, and CLI sections to describe the stateless model.

### Deprecated

- Provider methods `setConfig`, `clearState`, `clearAuth`, and `clearAuthCache` are deprecated and scheduled for removal in the next minor release.
- Legacy helpers that assumed a singleton `SettingsService` now throw when no runtime is registered.

### Migration

1. Create a `ProviderRuntimeContext` during bootstrap and register it with `setActiveProviderRuntimeContext()`.
2. Replace direct calls to `getSettingsService()` with `getCliRuntimeServices()` or the runtime provided in `GenerateChatOptions`.
3. Update subagent or automation workflows to spawn isolated contexts before mutating provider state.
4. Review the Stateless Provider v2 migration notes for this release for detailed examples and verification commands.

### Verification

- `npm run lint -- --cache`
- `npm run typecheck`
- `npm run test`
