# Phase 3b - Reminder System Implementation (todo-lists)

## Goal

Implement the automatic reminder system that notifies LLMs about empty todo lists and provides post-update confirmations.

## Deliverables

- [ ] Empty todo list reminder functionality
- [ ] Post-TodoWrite state confirmation system
- [ ] Integration with tool response handling
- [ ] Provider-agnostic reminder injection

## Implementation Tasks

### Empty Todo Reminder

- [ ] Create reminder message generator in `/packages/core/src/tools/todo-reminders.ts`
- [ ] Hook into conversation context to detect empty todo state
- [ ] Inject reminder as system message when appropriate
- [ ] Ensure reminder doesn't appear in user-visible output

### Post-Write Confirmation

- [ ] Modify TodoWrite tool to include state summary in response
- [ ] Format current todo list state in tool response metadata
- [ ] Include instruction not to mention the update to user
- [ ] Ensure state is injected into LLM context

### Reminder Templates

```typescript
// Empty todo reminder
const EMPTY_TODO_REMINDER = `
<system-reminder>
Your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.
</system-reminder>`;

// Post-update confirmation
const TODO_UPDATE_CONFIRMATION = (todos: Todo[]) => `
<system-reminder>
Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:

${JSON.stringify(todos)}. You DO NOT need to use the TodoRead tool again, since this is the most up to date list for now. Continue on with the tasks at hand if applicable.
</system-reminder>`;
```

## Checklist (implementer)

- [ ] Reminder system triggers appropriately
- [ ] Reminders are injected as system messages
- [ ] User never sees reminder text directly
- [ ] Post-write confirmations include full todo state
- [ ] Integration works across all providers
- [ ] No performance impact from reminder checks

## Self-verify

```bash
npm run test -- todo-reminders
npm run typecheck
grep -q "system-reminder" packages/core/src/tools/todo-reminders.ts || echo "Missing reminder implementation"
```
