# Phase 1: Lock Behavior with Parity Tests

**Subagent:** `typescriptexpert`
**Prerequisite:** None — this is the first phase
**Verification:** `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Goal

Before any extraction, write targeted behavioral tests that lock the current behavior of the subsystems being extracted. These tests import from the CURRENT `config.ts` location and must all pass before any code moves. This follows `dev-docs/RULES.md` TDD principles.

## What To Read First

- `packages/cli/src/config/config.ts` — the monolith (focus on lines 1140-1910 for loadCliConfig internals)
- `packages/cli/src/config/config.test.ts` — existing test patterns and mock setup
- `packages/cli/src/config/__tests__/nonInteractiveTools.test.ts` — existing tool governance tests
- `packages/cli/src/config/config.integration.test.ts` — integration test patterns

## Tasks

### Task 1.1: Approval mode parity tests
Test all combinations of:
- `--approval-mode` values (yolo, auto_edit, default) × `--yolo` flag
- `disableYoloMode` and `secureModeEnabled` settings
- `trustedFolder` true/false
- Expected: correct `ApprovalMode` or thrown error

### Task 1.2: Provider/model precedence parity tests
Test the 4-level provider precedence:
- CLI `--provider` > profile provider > `LLXPRT_DEFAULT_PROVIDER` env > `'gemini'`

Test the 6-level model precedence:
- CLI `--model` > profile model > settings model > env vars > alias default > Gemini default

### Task 1.3: MCP filtering parity tests
Test interactions between:
- `settings.allowMCPServers` + `settings.excludeMCPServers` + `argv.allowedMcpServerNames`
- Verify `argv.allowedMcpServerNames` overrides settings-level filtering

### Task 1.4: Tool governance parity tests
Test tool allowed/excluded sets for:
- Interactive vs non-interactive mode
- DEFAULT / AUTO_EDIT / YOLO approval modes
- Profile-allowed vs explicit-allowed tool interactions

### Task 1.5: parseArguments behavioral parity tests
Lock down yargs behavior that could regress during extraction:
- Subcommand exit behavior (`mcp`, `hooks`, `extensions`, `skills`)
- Positional prompt/query mapping
- Conflicting flag handling (e.g., `--prompt` + `--prompt-interactive`)
- Array coercion behavior (`--include-directories`, `--set`)
- Boolean default handling (`--debug`, `--yolo`)

### Task 1.6: Profile + CLI override precedence parity tests
Test that:
- `--provider` with `--key`/`--keyfile`/`--baseurl` creates synthetic profile
- Profile ephemeral settings are skipped when `--provider` is explicit
- CLI model override re-applied after provider switch

### Task 1.7: End-to-end provider/profile/override ordering parity test
Test the full ordering-sensitive flow through the entire precedence chain:
- Load a profile that sets a provider and model
- Apply the profile (triggering provider switch)
- Then reapply CLI overrides on top

Specifically assert:
- Profile is applied and causes a provider switch
- After provider switch, CLI `--model` override is re-applied (not lost)
- Final resolved provider reflects the full precedence chain: CLI `--provider` > profile provider > env > default
- Final resolved model reflects the full precedence chain: CLI `--model` > profile model > settings > env > alias default > Gemini default
- The post-switch reapplication step actually runs (i.e., CLI overrides are not silently dropped when provider switch clears ephemeral settings)
- The runtime/provider registration happens BEFORE profile application — verify current ordering is preserved, not just call names. Specifically: `registerCliProviderInfrastructure` (step 11) must complete before `applyProfileToRuntime` (step 12) begins. A spy-ordering assertion (e.g., checking call order of spied functions) should enforce this temporal constraint.

This test guards against regressions where the extraction breaks the critical ordering between steps 11-14 of the orchestrator (registerCliProviderInfrastructure → applyProfileToRuntime → switchActiveProvider → reapplyCliOverrides).

### Task 1.8: folderTrust uses original settings, NOT profile-merged settings

`loadCliConfig` calls `isWorkspaceTrusted(settings)` and reads `settings.folderTrust` using the ORIGINAL settings object (before profile merging). This is a subtle but critical security boundary: a profile should not be able to override trust decisions. Add a parity test that:

- Configures settings with `folderTrust: 'untrusted'`
- Loads a profile that attempts to set `folderTrust: 'trusted'` (via ephemeral overrides or profile settings)
- Asserts that the resolved trust state still reflects the original `untrusted` value, NOT the profile-merged value
- Asserts that `resolveApprovalMode` receives the original trust state

This test prevents regressions where refactored code accidentally passes profile-merged settings to trust-checking logic.

## Constraints

- All new tests go in existing test files or new test files in the `__tests__/` directory
- Import from the CURRENT `config.ts` — these tests will be migrated to new import paths in later phases
- Follow existing test patterns (vitest, vi.mock, etc.)
- No production code changes in this phase
- No file >800 lines, no function >80 lines
