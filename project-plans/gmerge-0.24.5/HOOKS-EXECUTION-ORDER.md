# Hooks Playbook Execution Order

Execute these 9 playbooks in the order listed below. Each builds on previous changes. All playbooks have been rewritten with precise paths, preflight checks, and deterministic verification commands.

## Execution Sequence

### Phase 1: Infrastructure & Security (1-3)
1. **dced409ac42d-plan.md** — Add Folder Trust Support To Hooks
   - **Dependencies:** None
   - **Provides:** Folder trust infrastructure for hooks (ConfigSource, trust checks in registry/runner)
   - **Files:** types.ts, hookRegistry.ts, hookRunner.ts, hookSystem.ts
   - **Verification:** `npm run typecheck && npm run test -- packages/core/src/hooks/`
   
2. **e6344a8c2478-plan.md** — Security: Project-level hook warnings
   - **Dependencies:** dced409ac42d (folder trust infrastructure)
   - **Provides:** TrustedHooksManager, getHookKey utility, project hook trust tracking
   - **Files:** trustedHooks.ts (NEW), types.ts, hookPlanner.ts, hookRegistry.ts, CLI config
   - **Verification:** `npm run typecheck && npm run test -- packages/core/src/hooks/ packages/core/src/config/`

3. **15c9f88da6df-plan.md** — Deduplicate agent hooks and add cross-platform integration tests
   - **Dependencies:** e6344a8c2478 (project warnings)
   - **Provides:** HookState interface, safe hook firing methods, agent hook deduplication
   - **Files:** client.ts, types.ts, integration tests (CONDITIONAL)
   - **Verification:** `npm run typecheck && npm run test -- packages/core/src/core/client.test.ts`

### Phase 2: Core Hook Enhancements (4-6)
4. **90eb1e0281bf-plan.md** — Implement support for tool input modification
   - **Dependencies:** 15c9f88da6df (agent deduplication), dced409ac42d (folder trust)
   - **Provides:** BeforeToolHookOutput.getModifiedToolInput(), tool input chaining, tool rebuilding
   - **Files:** types.ts, coreToolHookTriggers.ts, hookAggregator.ts, hookRunner.ts, coreToolScheduler.ts
   - **Contracts:** `getModifiedToolInput()` returns `Record<string, unknown> | undefined`, sequential modification applies in order
   - **Verification:** `npm run typecheck && npm run test -- packages/core/src/hooks/ packages/core/src/core/`
   
5. **05049b5abfae-plan.md** — Implement STOP_EXECUTION and enhance hook decision handling
   - **Dependencies:** 90eb1e0281bf (tool input modification must work first)
   - **Provides:** ToolErrorType.STOP_EXECUTION, precedence change (shouldStopExecution before getBlockingError)
   - **Files:** tool-error.ts, types.ts, coreToolHookTriggers.ts, nonInteractiveCli.ts, useGeminiStream.ts
   - **Contracts:** `stopReason` prioritized over `reason`, stop checked before block
   - **Verification:** `npm run typecheck && npm run test -- packages/core/src/tools/ packages/core/src/hooks/ packages/core/src/core/ packages/cli/src/`

6. **dd84c2fb837a-plan.md** — Implement granular stop and block behavior for agent hooks
   - **Dependencies:** 05049b5abfae (STOP_EXECUTION precedence), 15c9f88da6df (agent deduplication)
   - **Provides:** AgentExecutionStopped and AgentExecutionBlocked events, stop vs block semantics
   - **Files:** turn.ts, client.ts, nonInteractiveCli.ts, useGeminiStream.ts
   - **Contracts:** Stop = terminate, Block = warn + continue (or re-prompt for AfterAgent)
   - **Verification:** `npm run typecheck && npm run test -- packages/core/src/core/client.test.ts packages/cli/src/`

### Phase 3: Session & UX Integration (7-9)
7. **6d1e27633a32-plan.md** — Support context injection via SessionStart hook
   - **Dependencies:** dd84c2fb837a (agent stop/block), earlier SessionStart infrastructure
   - **Provides:** triggerSessionStartHook returns DefaultHookOutput | undefined, context injection in CLI and UI
   - **Files:** lifecycleHookTriggers.ts, gemini.tsx, AppContainer.tsx, clearCommand.tsx
   - **Contracts:** `getAdditionalContext()` returns `string | undefined`, prepended to input in non-interactive, added to history in interactive
   - **Verification:** `npm run typecheck && npm run test -- packages/core/src/core/ packages/cli/src/`
   
8. **61dbab03e0d5-plan.md** — Add visual indicators for hook execution
   - **Dependencies:** 6d1e27633a32 (SessionStart context injection), all hook infrastructure
   - **Provides:** hooks.notifications setting, useHookDisplayState hook, HookStatusDisplay component, StatusDisplay component
   - **Files:** settingsSchema.ts, useHookDisplayState.ts (NEW), HookStatusDisplay.tsx (NEW), StatusDisplay.tsx (NEW), Composer.tsx, AppContainer.tsx, types.ts, constants.ts (NEW)
   - **Contracts:** ActiveHook interface with name/eventName/index/total, notifications controlled by hooks.notifications setting
   - **SKIP:** All hooks list command changes (LLxprt doesn't have this UI)
   - **Verification:** `npm run typecheck && npm run test -- packages/cli/src/ui/`

9. **56092bd78205-plan.md** — Add a hooks.enabled setting
   - **Dependencies:** ALL previous playbooks (execute LAST)
   - **Provides:** Canonical hooks.enabled toggle, getEnableHooks() helper, two-level gating
   - **Files:** settingsSchema.ts, CLI config.ts, core config.ts, extension-manager.ts, hooksCommand.ts (CONDITIONAL), migrate.ts (CONDITIONAL), integration tests (CONDITIONAL), docs (CONDITIONAL)
   - **Contracts:** `getEnableHooks(settings)` returns `(tools.enableHooks ?? true) && (hooks.enabled ?? false)`
   - **Breaking Change:** Hooks disabled by default after this commit (hooks.enabled defaults to false)
   - **Verification:** `npm run typecheck && npm run test -- packages/cli/src/config/ packages/core/src/config/`

## Dependency Graph

```
dced409 (folder trust)
  └── e6344a8 (project warnings)
        └── 15c9f88 (deduplicate agent hooks)
              ├── 90eb1e0 (tool input modification)
              │     └── 05049b5 (STOP_EXECUTION)
              │           └── dd84c2f (agent stop/block)
              │                 └── 6d1e276 (SessionStart context)
              │                       └── 61dbab0 (visual indicators)
              │                             └── 56092bd (hooks.enabled setting) [EXECUTE LAST]
              └── dd84c2f (agent stop/block)
                    [... converges above ...]
```

## Inter-Playbook Contracts

### dced409ac42d → e6344a8c2478
- **Provides:** `ConfigSource` enum in types.ts
- **Provides:** `source?: ConfigSource` field on `CommandHookConfig`
- **Provides:** `Config.isTrustedFolder()` method
- **Provides:** Folder trust checks in `HookRegistry.processHooksFromConfig()`

### e6344a8c2478 → 15c9f88da6df
- **Provides:** `TrustedHooksManager` class in trustedHooks.ts
- **Provides:** `getHookKey()` utility function in types.ts
- **Provides:** Project hook trust checking in hookRegistry

### 15c9f88da6df → 90eb1e0281bf
- **Provides:** `HookState` interface for tracking hook execution state
- **Provides:** `fireBeforeAgentHookSafe()` and `fireAfterAgentHookSafe()` methods in client.ts
- **Provides:** Agent hook deduplication prevents duplicate hook fires

### 15c9f88da6df → dd84c2fb837a
- **Provides:** Safe hook methods that return `DefaultHookOutput | undefined`
- **Provides:** Hook state tracking for agent turns

### 90eb1e0281bf → 05049b5abfae
- **Provides:** `BeforeToolHookOutput.getModifiedToolInput()` method
- **Provides:** Tool input modification chaining in hookRunner
- **Provides:** `tool` parameter to `executeToolWithHooks()`

### 05049b5abfae → dd84c2fb837a
- **Provides:** `ToolErrorType.STOP_EXECUTION` enum value
- **Provides:** `shouldStopExecution()` checked before `isBlockingDecision()`
- **Provides:** `getEffectiveReason()` prioritizes `stopReason` over `reason`

### dd84c2fb837a → 6d1e27633a32
- **Provides:** `AgentExecutionStopped` and `AgentExecutionBlocked` event types
- **Provides:** Stop vs block semantics (terminate vs warn + continue)
- **Provides:** Event handling in CLI and UI

### 6d1e27633a32 → 61dbab03e0d5
- **Provides:** `triggerSessionStartHook()` returns `DefaultHookOutput | undefined`
- **Provides:** `SessionStartHookOutput.getAdditionalContext()` method
- **Provides:** Context injection in non-interactive and interactive modes

### 61dbab03e0d5 → 56092bd78205
- **Provides:** `hooks.notifications` setting
- **Provides:** `ActiveHook` interface
- **Provides:** Visual feedback infrastructure for hook execution

### 56092bd78205 (Final)
- **Consumes:** All previous hook infrastructure
- **Provides:** Canonical `hooks.enabled` toggle
- **Provides:** `getEnableHooks()` helper for two-level gating
- **Provides:** Updated error messages and documentation

## Verification Commands (Run After Each Playbook)

```bash
# Type checking
npm run typecheck

# Hook system tests
npm run test -- packages/core/src/hooks/

# Core tests (client, triggers, scheduler)
npm run test -- packages/core/src/core/

# CLI tests
npm run test -- packages/cli/src/

# UI tests (for playbooks 8-9)
npm run test -- packages/cli/src/ui/

# Integration tests (CONDITIONAL - run if they exist)
test -d integration-tests && npm run test -- integration-tests/ || echo "SKIPPED: No integration tests"
```

## Final Verification (After All Playbooks)

```bash
# Full test suite
npm run test

# Type check entire codebase
npm run typecheck

# Lint
npm run lint

# Build
npm run build

# Verify no upstream branding remains
grep -r "gemini\|Gemini\|GEMINI" packages/core/src/hooks/ packages/cli/src/config/ | grep -v "gemini.tsx\|GeminiClient\|getGeminiClient" | grep -v "comment" || echo "CLEAN"

# Verify folder trust infrastructure
grep -n "ConfigSource" packages/core/src/hooks/types.ts
grep -n "isTrustedFolder" packages/core/src/config/config.ts

# Verify hook decision precedence
grep -n "shouldStopExecution" packages/core/src/core/coreToolHookTriggers.ts | head -5

# Verify hooks.enabled setting
grep -n "hooks.*enabled" packages/cli/src/config/settingsSchema.ts

# Verify getEnableHooks helper
grep -n "getEnableHooks" packages/cli/src/config/settingsSchema.ts
```

## Notes

- **SKIP commits:** None — all 9 playbooks are REIMPLEMENT
- **SKIP sections:** 
  - 9c48cd849bb7 (hooks list UI — separate commit, not in sequence)
  - Hooks list command in playbook 8 (61dbab03e0d5)
  - Integration tests marked CONDITIONAL — only implement if LLxprt has compatible test-helper.ts
- **Integration tests:** Most playbooks mark integration tests as OPTIONAL — only implement if LLxprt has compatible test infrastructure
- **Breaking changes:**
  - Playbook 1: `HookRunner` constructor requires `Config` parameter
  - Playbook 4: `executeToolWithHooks` signature adds `tool` parameter
  - Playbook 5: Hook decision precedence changes (continue:false before decision:block)
  - Playbook 9: Hooks disabled by default (hooks.enabled defaults to false)
- **LLxprt-specific paths verified:**
  - Storage: `packages/core/src/config/storage.ts` — `getGlobalLlxprtDir()` at line 24
  - GeminiClient: `packages/core/src/core/client.ts` — class at line 193
  - Hooks: `packages/core/src/hooks/` — all core infrastructure exists
  - CLI: `packages/cli/src/` — entry points in gemini.tsx and AppContainer.tsx
  - UI: `packages/cli/src/ui/` — Ink-based UI with components/ and hooks/ subdirectories
- **Settings structure:** LLxprt uses FLAT settings (e.g., `settings.folderTrust` at root, NOT `settings.security.folderTrust`)
- **Test framework:** vitest (`vi.fn()`, `vi.mock()`, `vi.spyOn()`)
- **Test file location:** Root level (e.g., `hookRegistry.test.ts`), NOT in `__tests__/` subdirectory

## Success Criteria

- [ ] All 9 playbooks executed in order
- [ ] All tests pass: `npm run test`
- [ ] Type check passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] No upstream branding leakage (all `getGlobalGeminiDir` replaced with `getGlobalLlxprtDir`)
- [ ] Folder trust infrastructure works
- [ ] Tool input modification works
- [ ] STOP_EXECUTION precedence correct
- [ ] Agent stop/block behavior correct
- [ ] SessionStart context injection works
- [ ] Visual indicators display (if hooks.notifications enabled)
- [ ] Canonical hooks.enabled toggle works
- [ ] All inter-playbook contracts satisfied
- [ ] All preflight checks documented and verified
- [ ] All deterministic verification commands pass
