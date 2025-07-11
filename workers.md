# Claude Workers Methodology

## Core Principle

Maintain clean context by delegating work to worker Claudes instead of doing tasks directly. This prevents context corruption and ensures better results.

## Launching Workers

### Background Workers

For investigation, analysis, or long-running tasks:

```bash
claude --dangerously-skip-permissions -p "Your detailed prompt here. Write a report to /path/to/report.txt" &
```

### Synchronous Workers

For immediate, focused tasks:

```bash
claude --dangerously-skip-permissions -p "Your specific task prompt"
```

## Workflow

1. **Never investigate directly** - No "let me quickly check" or "I'll investigate"
2. **Always delegate** - Launch a worker Claude for any substantive work
3. **Sleep while waiting** - Use `sleep 300` (5 min) or `sleep 600` (10 min) after launching background workers
4. **Check reports** - Read the report file after waking up

## Writing Good Worker Prompts

### Structure

- **Context**: Brief explanation of the situation
- **Task**: Clear, specific action to perform
- **Output**: Specify report format and location
- **Constraints**: Any limitations or requirements

### Example Background Prompt

```
"I need you to investigate the database connection issues in the /services directory.
Please:
1. Search for all database-related files
2. Analyze connection patterns and error handling
3. Identify potential issues
4. Write a detailed report to /tmp/db-investigation-report.txt
Include file paths, line numbers, and specific recommendations."
```

### Example Synchronous Prompt

```
"Fix the syntax error in /src/utils/parser.js line 45. Only fix the syntax, do not refactor."
```

## Best Practices

1. **Be specific** - Vague prompts lead to unfocused work
2. **Set boundaries** - Tell workers what NOT to do
3. **Request reports** - Always ask background workers to write findings to a file
4. **Use appropriate timing** - 5 min for simple tasks, 10+ for complex investigations
5. **Batch related work** - Launch one worker for related tasks rather than many

## Common Patterns

### Investigation Pattern

```bash
# Launch investigator
claude --dangerously-skip-permissions -p "Investigate X, write findings to /tmp/x-report.txt" &

# Sleep while it works
sleep 300

# Check results
cat /tmp/x-report.txt
```

### Fix Pattern

```bash
# For simple fixes, use synchronous
claude --dangerously-skip-permissions -p "Fix the import error in file.js"

# For complex fixes, use background
claude --dangerously-skip-permissions -p "Refactor the authentication system, write progress to /tmp/auth-refactor.log" &
sleep 600
```

### Parallel Pattern

```bash
# Launch multiple workers for independent tasks
claude --dangerously-skip-permissions -p "Task 1, report to /tmp/task1.txt" &
claude --dangerously-skip-permissions -p "Task 2, report to /tmp/task2.txt" &
sleep 300
```

## Why This Matters

- Direct investigation corrupts context with too much information
- Workers have fresh context for each task
- Parallel execution is more efficient
- Reports provide clean summaries without polluting main context
- Prevents cascade failures from context overload
