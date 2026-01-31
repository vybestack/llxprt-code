# Phase 22: Config Wiring

## Phase ID
`PLAN-20260130-ASYNCTASK.P22`

## Prerequisites
- Required: Phase 21a completed

## Requirements Implemented

Wire all components together in the Config system.

## Implementation Tasks

### Files to Modify

1. **Config class** (`packages/core/src/config/config.ts`)
   - Add AsyncTaskManager instance
   - Add AsyncTaskReminderService instance
   - Add AsyncTaskAutoTrigger instance
   - Add getters for each

2. **Client integration** (`packages/core/src/core/client.ts`)
   - Wire AsyncTaskReminderService to next-turn reminders
   - Wire AsyncTaskAutoTrigger to agent turn mechanism
   - Provide isAgentBusy implementation

3. **Tool registration**
   - Register CheckAsyncTasksTool
   - Update TaskTool dependencies to include getAsyncTaskManager

### Research Existing Patterns

```bash
# Find Config class
grep -rn "class Config" packages/core/src/config/config.ts

# Find where services are created
grep -rn "new.*Service\|createService" packages/core/src/config/

# Find tool registration
grep -rn "registerTool\|toolRegistry" packages/core/src/config/
```

### Required Changes

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P22
 */

// In Config class:
private asyncTaskManager?: AsyncTaskManager;
private asyncTaskReminderService?: AsyncTaskReminderService;
private asyncTaskAutoTrigger?: AsyncTaskAutoTrigger;

getAsyncTaskManager(): AsyncTaskManager {
  if (!this.asyncTaskManager) {
    const maxAsync = this.getEphemeralSettings()?.['task-max-async'] ?? 5;
    this.asyncTaskManager = new AsyncTaskManager(maxAsync);
  }
  return this.asyncTaskManager;
}

getAsyncTaskReminderService(): AsyncTaskReminderService {
  if (!this.asyncTaskReminderService) {
    this.asyncTaskReminderService = new AsyncTaskReminderService(this.getAsyncTaskManager());
  }
  return this.asyncTaskReminderService;
}

// Wire auto-trigger in client setup
setupAsyncTaskAutoTrigger(
  isAgentBusy: () => boolean,
  triggerAgentTurn: (message: string) => Promise<void>,
): () => void {
  if (!this.asyncTaskAutoTrigger) {
    this.asyncTaskAutoTrigger = new AsyncTaskAutoTrigger(
      this.getAsyncTaskManager(),
      this.getAsyncTaskReminderService(),
      isAgentBusy,
      triggerAgentTurn,
    );
  }
  return this.asyncTaskAutoTrigger.subscribe();
}
```

## Verification Commands

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P22" packages/core/src

# Check Config has getters
grep -rn "getAsyncTaskManager\|getAsyncTaskReminderService" packages/core/src/config/config.ts

# TypeScript compiles
npm run typecheck

# Tests pass
npm test
```

## Success Criteria

- [ ] AsyncTaskManager available via Config
- [ ] AsyncTaskReminderService available via Config
- [ ] AsyncTaskAutoTrigger wired up
- [ ] TypeScript compiles
- [ ] Tests pass

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P22.md`
