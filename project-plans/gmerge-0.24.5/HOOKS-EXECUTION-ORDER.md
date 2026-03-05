# Hooks Playbook Execution Order

Execute these 10 playbooks in the order listed below. Each builds on previous changes.

## Execution Sequence

### Phase 1: Infrastructure & Security (1-3)
1. **dced409ac42d-plan.md** — Add Folder Trust Support To Hooks
   - Dependencies: None
   - Adds folder trust checks to hook registry and runner
   
2. **9c48cd849bb7-plan.md** — Add security warning and improve layout for Hooks list (SKIP)
   - Dependencies: dced409ac42d
   - Status: SKIP (LLxprt has no hooks list UI)

3. **e6344a8c2478-plan.md** — Security: Project-level hook warnings
   - Dependencies: dced409ac42d
   - Adds security warnings for project-level hooks in untrusted folders

### Phase 2: Core Hook Enhancements (4-6)
4. **15c9f88da6df-plan.md** — Deduplicate agent hooks and add cross-platform integration tests
   - Dependencies: e6344a8c2478
   - Implements hook deduplication for BeforeAgent/AfterAgent
   
5. **90eb1e0281bf-plan.md** — Implement support for tool input modification
   - Dependencies: 15c9f88da6df
   - Enables BeforeTool hooks to modify tool parameters

6. **05049b5abfae-plan.md** — Implement STOP_EXECUTION and enhance hook decision handling
   - Dependencies: 90eb1e0281bf
   - Adds STOP_EXECUTION error type and changes hook decision precedence

### Phase 3: Agent Hook Behavior (7-8)
7. **dd84c2fb837a-plan.md** — Implement granular stop and block behavior for agent hooks
   - Dependencies: 05049b5abfae, 15c9f88da6df
   - Adds AgentExecutionStopped and AgentExecutionBlocked events

8. **6d1e27633a32-plan.md** — Support context injection via SessionStart hook
   - Dependencies: dd84c2fb837a
   - Enables SessionStart hooks to inject context into sessions

### Phase 4: UX & Configuration (9-10)
9. **61dbab03e0d5-plan.md** — Add visual indicators for hook execution
   - Dependencies: 6d1e27633a32
   - Adds real-time UI feedback for executing hooks
   - SKIP: Hooks list command (not in LLxprt)

10. **56092bd78205-plan.md** — Add a hooks.enabled setting
    - Dependencies: ALL previous playbooks
    - Adds canonical hooks.enabled toggle (execute LAST)

## Dependency Graph

```
dced409 (folder trust)
  ├── 9c48cd8 (hooks list UI - SKIP)
  └── e6344a8 (project warnings)
        └── 15c9f88 (deduplication)
              └── 90eb1e0 (tool input modification)
                    └── 05049b5 (STOP_EXECUTION)
                          └── dd84c2f (agent stop/block)
                                └── 6d1e276 (SessionStart context)
                                      └── 61dbab0 (visual indicators)
                                            └── 56092bd (hooks.enabled setting)
```

## Verification Commands

After each playbook:
```bash
npm run typecheck
npm run test -- packages/core/src/hooks/
npm run test -- packages/core/src/core/
npm run test -- packages/cli/src/
```

## Notes

- **SKIP commits**: 9c48cd849bb7 (hooks list UI not in LLxprt)
- **Integration tests**: Most playbooks mark integration tests as OPTIONAL — only implement if LLxprt has compatible test infrastructure
- **Final verification**: After all 10 playbooks, run full test suite: `npm run test`
