# Todo List Implementation Plan

This directory contains a comprehensive implementation plan for adding Claude Code-style todo list functionality to gemini-cli.

## Overview

The todo list feature provides LLMs with task management capabilities to:

- Track multi-step tasks
- Show progress to users
- Maintain focus on complex work
- Prevent forgetting important steps

## Implementation Phases

1. **Phase 1: Stub Scaffolding** - Create basic tool structure with Zod schemas
2. **Phase 2: TDD Specification** - Define behavior through comprehensive tests
3. **Phase 3: Core Implementation** - Build file-based todo storage with sorting
4. **Phase 3b: Reminder System** - Add automatic reminders and confirmations
5. **Phase 3c: Tool Responses** - Implement proper response formatting
6. **Phase 4: Integration & Directives** - Add comprehensive LLM instructions
7. **Phase 5: UI Integration** - Visual todo display with status indicators
8. **Phase 6: Final Testing** - E2E tests and documentation

## Key Features

### Behavioral Directives

- Detailed rules for when to use/not use todos
- Proactiveness emphasis ("use frequently", "when in doubt")
- Real-time status updates
- Single in_progress task constraint
- Concrete examples for edge cases

### Technical Implementation

- TodoRead and TodoWrite tools with Zod validation
- File-based persistence in `~/.gemini/todos/`
- Agent-specific storage (`{sessionId}-agent-{agentId}.json`)
- Sophisticated sorting (status → priority)
- Thread-safe file operations
- Provider-agnostic design
- Automatic reminder system with state tracking

### User Experience

- Visual todo display in CLI
- Status indicators (⏳ ○ ✓)
- Priority levels
- Automatic display on updates

## Running the Implementation

## Success Metrics

- All tests pass
- Works with all providers (OpenAI, Anthropic, Gemini, etc.)
- LLMs consistently use todos for appropriate tasks
- Users report improved task tracking and visibility
