# Plan: Session-wide `/dumpcontext` for subagents

Plan ID: PLAN-20260808-ISSUE3151
Generated: 2026-08-08
Issue: https://github.com/vybestack/llxprt-code/issues/3151

## Goal

Make the effective `dumpcontext` mode live and session-wide for foreground and isolated subagent provider invocations without weakening subagent isolation or adding provider-specific behavior.

## Requirements

### REQ-3151-1: Live session inheritance

- GIVEN an active foreground session
- WHEN `/dumpcontext on`, `/dumpcontext error`, or `/dumpcontext off` changes the foreground setting
- THEN subsequent provider invocations from foreground and already-created subagent runtimes use that value
- AND an invocation snapshot already created remains unchanged

### REQ-3151-2: Isolation and precedence

- GIVEN an isolated subagent runtime with its own profile settings
- WHEN it resolves effective settings
- THEN only settings explicitly classified as session-wide are inherited from the foreground session
- AND the session `dumpcontext` value overrides a profile-local value
- AND provider, model, endpoint, authentication, reasoning, and tool settings remain isolated

### REQ-3151-3: Consistent command behavior

- GIVEN `/dumpcontext status`
- WHEN the command reads the current mode
- THEN it reports the same effective session value inherited by subagents
- AND `/dumpcontext now` retains its immediate foreground-history behavior

### REQ-3151-4: Documentation

- Document that transport dump modes apply to foreground and subagent traffic in the session.
- Warn that subagent prompts, history, and tool data can be written to disk.

## Preflight findings

- `dumpcontextCommand.action` reads and writes through the foreground runtime's `Config` and `SettingsService`.
- `TaskTool` already passes the foreground `Config` to `SubagentOrchestrator`.
- `SubagentOrchestrator.createRuntimeBundle` creates a fresh `SettingsService` and populates it only from the subagent profile.
- Provider invocation normalization already snapshots `getAllGlobalSettings()` for each request, and provider dump implementations already consume that snapshot.
- The common propagation seam is therefore settings-service construction in `createRuntimeBundle`, not individual providers.
- `SettingSpec` can carry explicit inheritance metadata, avoiding a broad copy or shared foreground service.

## TDD phases

### Phase 1: Settings inheritance contract

1. Add failing Bun behavioral tests to `packages/settings/src/__tests__/SettingsService.test.ts` proving:
   - a child service reads a session-wide `dumpcontext` value from a source service;
   - source changes are visible on later reads and snapshots;
   - a snapshot already returned is immutable;
   - source `off` overrides child/profile `on`;
   - an absent source value falls back to the child's local value;
   - unrelated settings are not inherited;
   - a separate service/session has no inherited value.
2. Add minimal setting-scope metadata and a source-aware `SettingsService` implementation.
3. Run the focused settings tests and refactor only if needed.

### Phase 2: Subagent runtime integration

1. Add a failing Bun orchestrator behavioral test proving the real runtime assembly receives the foreground session's live `dumpcontext` setting while retaining subagent-local settings.
2. Extend runtime settings construction to accept a session source and pass `foregroundConfig.getSettingsService()` from `SubagentOrchestrator.createRuntimeBundle`.
3. Cover live `on -> off -> error` changes through the already-created isolated service and immutable snapshots.
4. Add or extend load-balancer runtime coverage if the common construction test does not exercise that activation branch.
5. Run focused agents tests.

### Phase 3: Command and provider regression checks

1. Confirm existing command tests prove `on|error|off|status` use the same foreground settings source and `now` remains independent; add a failing behavioral test only if a gap exists.
2. Confirm provider normalization consumes the inherited value through `getAllGlobalSettings()`; add a focused Bun regression only if the settings and orchestrator tests do not reach that public boundary.
3. Do not modify provider-specific dump consumers.

### Phase 4: Documentation

Update `docs/cli/context-dumping.md` and, if useful, `docs/subagents.md` with session-wide subagent behavior and the sensitive-data warning.

### Phase 5: Verification

Run focused tests during TDD, then the complete required suite:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Run Open Code Review after implementation and remediate actionable findings.

## Constraints

- All new or changed tests use Bun and `bun:test`.
- No full foreground `SettingsService` sharing and no copying of all foreground ephemerals.
- No provider-specific fallback, wrapper, or duplicated dump logic.
- No lint/type suppressions, lint severity downgrades, complexity-threshold increases, or new ignored source paths.
- Preserve immutable per-invocation setting snapshots.
- Prefer the direct ownership/propagation fix over defensive guards or swallowed failures.
