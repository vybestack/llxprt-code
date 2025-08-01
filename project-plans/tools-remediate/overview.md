# Todo List Tool Integration Requirements

## Overview

The todo list functionality has been implemented but is not properly integrated into the llxprt-code system. This document outlines the numbered requirements for complete integration to achieve parity with Claude Code's todo system.

## Requirements

### 1. Tool Registration [REQ-001]

The TodoWrite and TodoRead tools must be registered in the core tool registry.

**1.1** Add imports for TodoWrite and TodoRead classes in `packages/core/src/config/config.ts`
**1.2** Add `registerCoreTool(TodoWrite)` and `registerCoreTool(TodoRead)` calls in the `createToolRegistry()` method
**1.3** Ensure tools are exported from the tools index file for proper module resolution

### 2. Session Context Injection [REQ-002]

Tools need proper session and agent context injection for multi-session support.

**2.1** Modify ToolRegistry to inject sessionId into tool instances during instantiation
**2.2** Add agentId injection for subagent context tracking
**2.3** Remove hacky type casting in todo tools and use properly injected context
**2.4** Ensure context flows through tool execution pipeline

### 3. System Reminder Integration [REQ-003]

Implement system reminders that guide model behavior without exposing internal state.

**3.1** Create TodoReminderService that monitors todo state changes
**3.2** Inject "empty todo list" reminders when appropriate (complex tasks detected)
**3.3** Inject "todo list changed" reminders after TodoWrite operations
**3.4** Format reminders as `<system-reminder>` tags that are invisible to users
**3.5** Add reminder content that includes current todo state for model context

### 4. Tool Response Enhancement [REQ-004]

Enhance todo tool responses to better integrate with conversation flow.

**4.1** Modify TodoWrite response to trigger reminder injection
**4.2** Add metadata to tool responses indicating state changes
**4.3** Include suggestions for next actions based on todo state
**4.4** Ensure responses maintain concise format per llxprt style

### 5. Proactive Todo Detection [REQ-005]

Implement detection of scenarios where todos should be used proactively.

**5.1** Create ComplexityAnalyzer service to detect multi-step tasks
**5.2** Analyze user messages for task indicators (numbered lists, multiple requests)
**5.3** Inject reminders to use todos when complexity threshold met
**5.4** Track conversation patterns that benefit from todo usage
**5.5** Integrate with prompt system to add todo guidance

### 6. Prompt System Integration [REQ-006]

Ensure todo functionality is properly documented in system prompts.

**6.1** Verify todo usage instructions are in the main system prompt
**6.2** Add examples of when to use and not use todos
**6.3** Include behavioral guidance for todo state management
**6.4** Add instructions for proactive todo creation

### 7. Testing Infrastructure [REQ-007]

Comprehensive behavioral tests for todo functionality.

**7.1** Test todo persistence across sessions
**7.2** Test reminder injection after state changes
**7.3** Test complexity detection and proactive suggestions
**7.4** Test multi-agent todo isolation
**7.5** Test error handling and edge cases

### 8. UI Integration [REQ-008]

Ensure todo state is properly displayed in the UI.

**8.1** Add todo status indicator to conversation UI
**8.2** Show current todos in a collapsible panel
**8.3** Update in real-time as todos change
**8.4** Maintain visibility without cluttering interface

## Success Criteria

- Models consistently use todos for multi-step tasks
- Todo state persists across conversation turns
- System reminders guide behavior without user visibility
- Proactive todo suggestions appear for complex requests
- All behavioral tests pass with >90% coverage
- UI shows todo state clearly but unobtrusively

## Implementation Priority

1. Tool Registration (REQ-001) - Critical foundation
2. Session Context (REQ-002) - Required for proper operation
3. System Reminders (REQ-003) - Core behavioral guidance
4. Tool Response Enhancement (REQ-004) - Improved integration
5. Proactive Detection (REQ-005) - Enhanced user experience
6. Testing (REQ-007) - Validation of functionality
7. Prompt Integration (REQ-006) - Documentation alignment
8. UI Integration (REQ-008) - User visibility