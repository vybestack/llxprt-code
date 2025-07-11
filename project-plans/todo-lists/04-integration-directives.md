# Phase 4 - Integration and Directives (todo-lists)

## Goal

Integrate todo tools into the system and add comprehensive usage directives to guide LLM behavior with the same effectiveness as Claude Code.

## Deliverables

- [ ] Update system prompts to include comprehensive todo list usage instructions
- [ ] Add todo-specific reminders and guidance system
- [ ] Implement automatic empty todo list reminders
- [ ] Ensure tools are available in all provider configurations
- [ ] Add integration tests for todo functionality

## Integration Tasks

### System Prompt Updates

Add the following comprehensive directives to `/packages/core/src/core/prompts.ts`:

#### Core Todo Usage Rules

```
# Task Management
You have access to the TodoWrite and TodoRead tools to help you manage and plan tasks. Use these tools VERY frequently to ensure that you are tracking your tasks and giving the user visibility into your progress.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management
1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Only have ONE task in_progress at any time
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.
```

#### Add Concrete Examples

Include 4-5 detailed examples showing proper todo usage (copy from Phase 4 examples section).

### System Reminder Integration

- [ ] Implement automatic reminder system when todo list is empty
- [ ] Add post-TodoWrite confirmations with current todo state
- [ ] Create helper to inject todo state into LLM context

### Provider Integration

- [ ] Verify todo tools work with all providers (OpenAI, Anthropic, Gemini, etc.)
- [ ] Test todo persistence across multiple interactions
- [ ] Ensure proper error handling and user feedback
- [ ] Add provider-specific prompt adjustments if needed

### Documentation

- [ ] Create inline documentation for todo tools
- [ ] Add JSDoc comments with usage examples
- [ ] Document the todo item schema clearly
- [ ] Include behavioral guidance in tool descriptions

## Checklist (implementer)

- [ ] System prompts include ALL todo usage rules from above
- [ ] Proactiveness emphasis is clear ("use frequently", "when in doubt")
- [ ] Real-time update rules are explicit
- [ ] Single in_progress constraint is enforced
- [ ] Examples cover edge cases
- [ ] Reminder system is implemented
- [ ] Integration tests pass for all providers
- [ ] Todo state persists within a session
- [ ] Type checking and linting pass

## Self-verify

```bash
npm run test -- --grep "todo.*integration"
npm run typecheck
npm run lint
grep -q "TodoWrite.*TodoRead" packages/core/src/core/prompts.ts || echo "Prompts missing todo instructions"
grep -q "proactively.*frequently" packages/core/src/core/prompts.ts || echo "Missing proactiveness emphasis"
grep -q "in_progress.*ONE" packages/core/src/core/prompts.ts || echo "Missing single task constraint"
```
