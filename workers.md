# Claude Workers Methodology

## Core Principle

Maintain clean context by delegating work to worker Claudes instead of doing tasks directly. This prevents context corruption and ensures better results.

## Launching Workers

### Background Workers

For investigation, analysis, or long-running tasks:

```bash
claude --dangerously-skip-permissions -p "Your detailed prompt here. Write a report to ./reports/your-report.md" &
```

### Background Workers with PID Tracking

To prevent duplicate workers and monitor progress:

```bash
# Capture PID when launching
WORKER_PID=$(claude --dangerously-skip-permissions -p "Your task..." > ./reports/worker-$$.log 2>&1 & echo $!)
echo "Worker PID: $WORKER_PID" >> ./reports/worker-pids.txt
echo "Started worker with PID: $WORKER_PID"
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
4. Write a detailed report to ./reports/db-investigation-report.md
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

## Report Writing Best Practices

1. **Use markdown format** - Workers more reliably write .md files to a reports/ subdirectory
2. **Create report immediately** - Tell workers to create the report file at the very start of their work, before doing anything else
3. **Log progressively** - Instruct workers to update the report continuously as they work, not just at the end
4. **Note completion** - Workers should explicitly note when they have finished their work with a completion timestamp
5. **Avoid txt/log extensions** - These are written less reliably than .md files
6. **Use reports subdirectory** - Create reports in `./reports/` rather than `/tmp/`

### Example Report Prompt

```
"Create a report at ./reports/test-fixes.md immediately. Log all your actions and findings as you work.
At the start, write:
- Task description
- Start time
- Initial observations

During work, log:
- Each file examined
- Each change made
- Any errors encountered

At completion, add:
- Summary of all changes
- Final results
- Note completion time
- Recommendations"
```

## Common Patterns

### Investigation Pattern

```bash
# Launch investigator
claude --dangerously-skip-permissions -p "Investigate X, write findings to ./reports/x-report.md" &

# Sleep while it works
sleep 300

# Check results
cat ./reports/x-report.md
```

### Fix Pattern

```bash
# For simple fixes, use synchronous
claude --dangerously-skip-permissions -p "Fix the import error in file.js"

# For complex fixes, use background
claude --dangerously-skip-permissions -p "Refactor the authentication system, write progress to ./reports/auth-refactor.md" &
sleep 600
```

### Parallel Pattern

```bash
# Launch multiple workers for independent tasks
claude --dangerously-skip-permissions -p "Task 1, report to ./reports/task1.md" &
claude --dangerously-skip-permissions -p "Task 2, report to ./reports/task2.md" &
sleep 300
```

## Worker Management

### PID Tracking Pattern

Track worker PIDs to prevent duplicates and monitor progress:

```bash
# Create PID tracking file
touch ./reports/worker-pids.txt

# Launch worker with PID capture
WORKER1_PID=$(claude --dangerously-skip-permissions -p "Task 1..." > ./reports/worker1-$$.log 2>&1 & echo $!)
echo "Worker 1 PID: $WORKER1_PID" >> ./reports/worker-pids.txt

# Monitor active workers
ps aux | grep -E "PID|$WORKER1_PID" | grep -v grep
```

### Worker Monitoring Script

Create a monitoring script to track all workers:

```bash
#!/bin/bash
echo "=== Worker Status Monitor ==="
if [ -f ./reports/worker-pids.txt ]; then
    while IFS= read -r line; do
        if [[ $line =~ PID:\ ([0-9]+) ]]; then
            PID="${BASH_REMATCH[1]}"
            if ps -p $PID > /dev/null 2>&1; then
                echo "$line - RUNNING"
            else
                echo "$line - COMPLETED"
            fi
        fi
    done < ./reports/worker-pids.txt
fi
```

### Preventing Worker Overload

Before launching new workers, check system load:

```bash
# Check active test processes
NPM_COUNT=$(ps aux | grep -E "(npm test|vitest)" | grep -v grep | wc -l)
if [ $NPM_COUNT -gt 5 ]; then
    echo "Too many test processes ($NPM_COUNT). Waiting for completion..."
    sleep 300
fi
```

## Why This Matters

- Direct investigation corrupts context with too much information
- Workers have fresh context for each task
- Parallel execution is more efficient
- Reports provide clean summaries without polluting main context
- Prevents cascade failures from context overload
- PID tracking prevents duplicate workers and system overload
