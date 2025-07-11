# Todo Usage Examples for Phase 4 Integration

These examples should be included in the system prompts to demonstrate proper todo list usage.

## Examples of When to Use the Todo List

### Example 1: Multi-Feature Implementation

```
User: I need to implement these features for my e-commerce site: user registration, product catalog, shopping cart, and checkout flow.
Assistant: I'll help implement these features. Let me create a todo list to track this implementation.

[Uses TodoWrite to create:]
1. Implement user registration system (pending)
2. Create product catalog functionality (pending)
3. Build shopping cart features (pending)
4. Develop checkout flow (pending)

Let me start with the user registration system.
[Updates todo 1 to in_progress]
[Implements registration...]
[Updates todo 1 to completed when done]
```

### Example 2: Complex Refactoring

```
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: I'll search for all occurrences of getCwd first.
[Uses grep/search tools]
I found 15 instances across 8 files. Let me create a todo list to track these changes.

[Uses TodoWrite to create:]
1. Update getCwd in src/utils/path.js (pending)
2. Update getCwd in src/cli/commands.js (pending)
3. Update getCwd in tests/utils.test.js (pending)
... (one todo per file)

[Systematically works through each file, updating status as they go]
```

### Example 3: Debugging with Unknown Scope

```
User: Can you help optimize my React application? It's rendering slowly.
Assistant: I'll analyze your React application for performance issues.
[Reviews codebase]
I've identified several optimization opportunities. Let me create a todo list.

[Uses TodoWrite to create:]
1. Implement memoization in ProductList component (pending)
2. Add virtualization for Dashboard lists (pending)
3. Optimize image loading in Gallery (pending)
4. Fix state update loops in ShoppingCart (pending)
5. Implement code splitting for large bundles (pending)

Let me start with the ProductList memoization.
[Updates todo 1 to in_progress]
```

## Examples of When NOT to Use the Todo List

### Example 1: Simple Information Request

```
User: What does the git status command do?
Assistant: The git status command shows the current state of your working directory and staging area. It displays which changes have been staged, which haven't, and which files aren't being tracked by Git.
[No todo list needed - purely informational]
```

### Example 2: Single Trivial Task

```
User: Can you add a comment to the calculateTotal function?
Assistant: I'll add a comment to the calculateTotal function.
[Directly edits the file]
[No todo list needed - single straightforward task]
```

### Example 3: Quick Command Execution

```
User: Run npm install for me
Assistant: I'll run npm install.
[Executes command]
The installation completed successfully. All dependencies have been installed.
[No todo list needed - single command with immediate result]
```

## Key Patterns to Emphasize

1. **Immediate Todo Creation**: Create todos as soon as you understand the scope
2. **Real-time Updates**: Update status before starting each task, not after
3. **Granular Tasks**: Break down complex work into specific, actionable items
4. **Complete Only When Done**: Never mark incomplete work as completed
5. **Proactive Usage**: When in doubt about whether to use todos, use them
