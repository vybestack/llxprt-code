# Issue #2200 — Introduce Agent at the CLI composition root

Parent: #1595 (deficiency-closure / migration to the public Agent/runtime API).

## Goal

Build `Config` exactly as today, then create **one** interactive `Agent` by adopting
that `Config` (and the existing `sessionMessageBus`) through the public `fromConfig`
entrypoint. Thread that single Agent through the interactive UI component chain
(`startInteractiveUI → AppWrapper → AppContainer → AppContainerRuntime → useAppBootstrap`)
and own its lifecycle via `registerCleanup`, while keeping `Config` as an explicitly
documented temporary migration bridge.

This is a **staged** migration. We do NOT rewrite streaming hooks in this PR. The
single `config.getAgentClient()` extraction in `useAppInput.ts` is annotated with a
TODO referencing the parent migration issue (#1595) and left functionally unchanged.

## Grounded research findings (why the design is what it is)

- `fromConfig(options)` (`packages/agents/src/api/fromConfig.ts`) **adopts** the
  caller-supplied `Config`:
  - Adopts `config.getProviderManager()` (no second `ProviderManager`).
  - Adopts the caller `messageBus` when supplied; otherwise builds one from
    `config.getPolicyEngine()` (no second bus when we pass `sessionMessageBus`).
  - Guards double-`initialize` ("Config was already initialized" is swallowed) and
    skips `refreshAuth` when the agent client is already initialized.
  - Uses the SHARED `finalizeAgent(...)` path with the 17th positional arg `'caller'`,
    so the returned `Agent.dispose()` **skips** `config.dispose()` (caller-owned).
- `finalizeAgent` (`packages/agents/src/api/createAgent.ts`) **fires
  `agent.hooks.triggerSessionStart()`** at the end. Therefore, once an Agent is created
  in the interactive branch, the existing explicit
  `await triggerSessionStartHook(config, SessionStartSource.Startup)` in the interactive
  branch would DOUBLE-FIRE SessionStart and must be removed (the non-interactive branch
  keeps its explicit call, since it builds no Agent).
- `fromConfig` calls `handle.activate()` which re-runs `resetInfrastructure()` +
  `registerInfrastructure()` for the adopted runtime. Because we pass the SAME
  `settingsService`, `config`, adopted `providerManager`, and `sessionMessageBus`, this
  re-registers the SAME instances onto the active CLI runtime entry — it does not build a
  competing runtime. (Regression test guards "no duplicate construction".)
- `Agent` (`packages/agents/src/api/agent.ts:498`) exposes `getConfig(): Config` and
  `dispose(): Promise<void>` (idempotent; fires SessionEnd).
- The CLI already depends on `@vybestack/llxprt-code-agents` (package.json) and the
  barrel re-exports `fromConfig` and the `Agent` type (`packages/agents/src/index.ts`).

## Scope (one PR)

### Phase 1 — Agent composition root + lifecycle ownership

1. New helper `packages/cli/src/cliAgentBootstrap.ts`:
   - `export async function createForegroundAgent({ config, sessionMessageBus }: { config: Config; sessionMessageBus: MessageBus }): Promise<Agent>`
   - Calls `fromConfig({ config, messageBus: sessionMessageBus })`.
   - Keeps `configOwnership` caller-owned (the `fromConfig` default) — inline comment
     documenting `Config` is a temporary migration bridge.
   - Immediately registers `agent.dispose()` via `registerCleanup` (async queue), with an
     inline comment that dispose deliberately skips Config teardown (recording/Config
     cleanup remain owned by existing bootstrap).
   - Returns the constructed `Agent`.
2. `packages/cli/src/cli.tsx` — `dispatchInteractiveOrNonInteractive`:
   - Interactive branch calls `createForegroundAgent({ config, sessionMessageBus })`
     exactly once, before `startInteractiveUI`, and forwards the resulting `Agent`.
   - **Remove** the explicit `triggerSessionStartHook(config, SessionStartSource.Startup)`
     from the interactive branch only (Agent fires it via `finalizeAgent`). The
     non-interactive branch is untouched.

### Phase 2 — Thread the Agent through the interactive UI

3. `startInteractiveUI(config, agent, ...)` — accept `Agent`, pass `agent` prop to
   `<AppWrapper>`; mark `config` as a temporary migration bridge in a comment.
4. Add `agent: Agent` to `AppProps` (`ui/App.tsx`), `AppContainerProps`
   (`ui/AppContainer.tsx`), `AppContainerRuntimeProps` (`ui/AppContainerRuntime.tsx`),
   and forward through `AppWrapper → AppWithState → AppContainer → AppContainerRuntime`.
5. Forward `agent` into `useAppBootstrap` (`AppBootstrapProps`) and expose it on
   `AppBootstrapResult` so it is available alongside `config`. Do NOT replace existing
   `config.getAgentClient()` usage.
6. Annotate the single `config.getAgentClient()` extraction in `useAppInput.ts`
   (line ~330) with a TODO referencing #1595.

### Phase 3 — Tests (behavioral, no mock theater)

- `packages/cli/src/cliAgentBootstrap.test.ts`:
  - `fromConfig` invoked exactly once with the existing `Config` + `sessionMessageBus`.
  - `agent.dispose()` registered via `registerCleanup`; running cleanup disposes the
    Agent; on the interrupted-startup path (cleanup runs before UI) the Agent is still
    disposed; `config.dispose()` is NOT called (caller-owned).
  - Regression: the adopted `ProviderManager`/`MessageBus`/`Config` instances are the
    ones handed to `fromConfig` (no duplicate runtime construction).
- `packages/cli/src/cli.test.tsx` (interactive path): the explicit interactive
  `triggerSessionStartHook` no longer fires; non-interactive path still fires its hook.
- `packages/cli/src/ui/__tests__/AppContainer.mount.test.tsx`: extend `createMockConfig`
  pattern with a fake minimal `Agent` passed via the new `agent` prop; component mounts
  and unmounts cleanly.

## Acceptance criteria (from issue)

- Interactive bootstrap creates exactly one Agent for the UI path.
- AppContainer receives an Agent instance.
- Existing CLI startup/auth/provider behavior remains user-visible compatible.
- Shutdown disposes the Agent without prematurely tearing down caller-owned Config.
- Remaining Config bridge use is explicit migration debt (TODO → #1595).
- New tests protect the composition root and lifecycle.

## Verification commands

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- Smoke: `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`

## Risks

- **Double SessionStart**: mitigated by removing the explicit interactive hook call
  (verified `finalizeAgent` fires it). Covered by test.
- **Duplicate runtime construction**: mitigated by passing existing `config` +
  `sessionMessageBus`; `fromConfig` adopts both. Covered by regression test.
- **Premature Config teardown on dispose**: mitigated by `configOwnership='caller'`.
  Covered by dispose-ownership test.
- **Lint guardrails**: no eslint-disable / ts-ignore / threshold increases — fix root
  cause. New file needs Apache-2.0 header.

## Exit criteria

All verification commands pass, smoke test prints a haiku, deepthinker review passes,
ocr clean, PR opened with "fixes #2200", all CI workflows green, all CodeRabbit threads
addressed/resolved.
