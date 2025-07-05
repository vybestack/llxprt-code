# Phase 4 - Integration and Directives (todo-lists)

## Goal
Integrate todo tools into the system and add comprehensive usage directives to guide LLM behavior.

## Deliverables
- [ ] Update system prompts to include todo list usage instructions
- [ ] Add todo-specific reminders and guidance
- [ ] Ensure tools are available in all provider configurations
- [ ] Add integration tests for todo functionality

## Integration Tasks

### System Prompt Updates
- [ ] Add todo list usage guidelines to `/packages/core/src/core/prompts.ts`
- [ ] Include when to use/not use todo lists
- [ ] Add examples of proper todo list usage
- [ ] Include task state management rules

### Provider Integration
- [ ] Verify todo tools work with all providers (OpenAI, Anthropic, Gemini, etc.)
- [ ] Test todo persistence across multiple interactions
- [ ] Ensure proper error handling and user feedback

### Documentation
- [ ] Create inline documentation for todo tools
- [ ] Add JSDoc comments with usage examples
- [ ] Document the todo item schema clearly

## Checklist (implementer)
- [ ] System prompts include comprehensive todo usage instructions
- [ ] Todo tools are registered and available
- [ ] Integration tests pass for all providers
- [ ] Todo state persists within a session
- [ ] Clear error messages for invalid todo operations
- [ ] Type checking and linting pass

## Self-verify
```bash
npm run test -- --grep "todo.*integration"
npm run typecheck
npm run lint
grep -q "TodoWrite.*TodoRead" packages/core/src/core/prompts.ts || echo "Prompts missing todo instructions"
```