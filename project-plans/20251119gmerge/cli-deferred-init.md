# CLI Deferred Initialization Plan

## Objective
Re-implement the spirit of upstream commit `7e170527` (“Refactor to defer initialization”) for llxprt so that:
- The outer CLI process decides whether a relaunch (for higher `--max-old-space-size` or sandboxing) is required **before** we load settings, providers, or MCP servers.
- Only the child process performs heavy initialization (settings parsing, provider bootstrap, MCP discovery) once we know it is the final runtime.
- The implementation follows `dev-docs/RULES.md`: test-first, minimal surface area, and compatibility with multi-provider configuration.

## Upstream Reference Checklist
Before touching llxprt code, study the upstream refactor so we understand every interaction point:
- `packages/cli/src/gemini.tsx` – how argument parsing, debug detection, and sandbox checks happen before any heavy config load.
- `packages/cli/src/config/config.ts` – the extracted `isDebugMode` helper so debug detection remains lightweight prior to relaunch.
- `packages/cli/src/utils/relaunch.ts` & `packages/cli/src/utils/relaunch.test.ts` – the loop that respawns children until a non-`RELAUNCH_EXIT_CODE` result plus stdin pause/resume handling.
- `packages/cli/src/gemini.test.tsx` – ordering tests that prove config is untouched until `relaunchAppInChildProcess` decides the final runtime.
- `packages/core/src/prompt-config/defaults/service-defaults.ts` – confirm the `commands/init-command.md` instructions still describe the startup experience once initialization is deferred, updating the prompt later if bootstrap timing changes what the user sees.

Document any deviations we plan to take so downstream reviewers can compare against upstream behavior.

**Estimate:** 2–3 engineering days, including upstream review, refactor, tests, and verification inside the gmerge window.

## Deliverables
1. `packages/cli/src/gemini.tsx` – refactor startup flow to:
   - Parse bootstrap args via `parseArguments` in a lightweight mode.
   - Call a helper `shouldRelaunch(argv, env)` that checks memory requirements and sandbox conditions **without** triggering `loadCliConfig`.
   - If relaunch is needed, call `relaunchAppInChildProcess` immediately and `return`.
   - Only after we know we are in the final process do we call `loadSettings`, `loadCliConfig`, and initialize providers.
2. `packages/cli/src/utils/relaunch.ts` – extract relaunch helpers with unit tests.
3. `packages/cli/src/config/config.test.ts`/`gemini.test.tsx` – new tests proving we don’t load configs before relaunch.
4. Docs update (section in `project-plans/20251119gmerge/plan.md` already links here; no public doc change needed unless UX changes).

## Constraints
- Preserve existing behavior for auth, sandbox flags, and multi-provider switching.
- Tests must cover:
  - Relaunch path (child invoked with `LLXPRT_CODE_NO_RELAUNCH` guard).
  - Non-relaunch path (no extra process spawn, config loads once).
  - Error handling when relaunch fails.
- No regression for `node scripts/start.js --profile-load synthetic ...`.

## Implementation Steps
1. **Bootstrap Helper**
   - Extract `shouldRelaunchForMemory(argv, env)` and `shouldEnterSandbox(settings, argv)` utilities.
   - Write unit tests covering boundary conditions.
2. **Relaunch Module** (`packages/cli/src/utils/relaunch.ts`)
   - Move spawn logic from `gemini.tsx` into a reusable function.
   - Add tests (Vitest) verifying arguments/env passed to `spawn`.
3. **CLI Refactor**
   - In `gemini.tsx`, restructure `main`: parse args, load minimal settings (if needed for sandbox detection), call `shouldRelaunch`. If true, invoke relaunch and exit.
   - Only after the relaunch decision do we call `loadCliConfig`, `loadSettings`, MCP bootstrap, etc.
4. **Tests**
   - Expand `packages/cli/src/gemini.test.tsx` to assert `loadCliConfig` is not called before relaunch (similar to upstream, but adapted to llxprt runtime).
   - Add integration test ensuring sandbox entry still works with the new flow.
5. **Verification**
   - Run full suite (`npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `node scripts/start.js --profile-load synthetic --prompt "smoke"`).
   - Document results in `project-plans/20251119gmerge/plan.md` under “Follow-up: CLI Deferred Initialization”.

## Risk Assessment
- **Bootstrap deadlocks / relaunch loops:** If we mis-handle `RELAUNCH_EXIT_CODE`, the parent could spawn infinite children. Mitigation: mirror upstream guard (`LLXPRT_CODE_NO_RELAUNCH`) and add tests covering success/failure exit codes.
- **Sandbox/auth regressions:** Loading configs too late or not forwarding args/env could prevent sandbox entry or drop provider credentials. Mitigation: capture sandbox config + auth flags before relaunch, then assert via integration tests.
- **Prompt drift for `/init`:** Changing the bootstrap order can alter what the init command sees. After refactor, re-validate `commands/init-command.md` in `service-defaults.ts` and adjust wording if necessary.
- **Blocking dependent cherry-picks:** Commits like `ce92ed3f` assume deferred init. A flawed reimplementation will cascade into later batches, so we must finish this work before resuming picks.

## Open Questions
- Do we need a minimal subset of settings (e.g., auth provider) before deciding on sandbox? If so, load only that subset via a lightweight loader.
- Should we expose a CLI flag to bypass relaunch for debugging? (Currently `LLXPRT_CODE_NO_RELAUNCH` env exists; document if behavior changes.)

## Next Actions
1. While executing the gmerge, stop after cherry-picking through commit #149 and branch for this refactor before proceeding.
2. Follow the steps above, keeping commits small and tested.
3. Resume cherry-picking with commit #150 onward (skipping upstream `7e170527` but picking dependents such as `ce92ed3f`).
4. Link the final PR back to this plan and update the “Follow-up” section in `plan.md` when complete.
