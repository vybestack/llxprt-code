# Project Guidelines for Claude

## Code Quality Rules

### TypeScript
- **Don't use `any`** - Always specify proper types. Use `unknown` if the type is truly unknown and add proper type guards.

## Linting
- Always run `npm run lint` before considering work complete
- Fix all linting errors, including warnings about `any` types
- Run `npm run typecheck` to ensure type safety

## Working Methodology - CRITICAL

### NEVER do work yourself
- **ALWAYS delegate to Claude workers** using `claude --dangerously-skip-permissions -p`
- You are a manager/orchestrator, not a worker
- Your job is to:
  1. Understand the problem
  2. Create clear, detailed prompts for workers
  3. Launch workers to do the actual work
  4. Read and summarize worker reports
  5. Coordinate multiple workers when needed

### Launching Workers

#### Synchronous Workers (when you need results immediately)
Use for:
- Quick fixes that block other work
- Critical path tasks
- When you need to verify results before proceeding

```bash
claude --dangerously-skip-permissions -p --model opus < prompt_file.txt
```

#### Asynchronous Workers (for parallel tasks)
Use for:
- Independent tasks that can run in parallel
- Research/investigation tasks
- Non-blocking work

```bash
# Launch in background and capture output
claude --dangerously-skip-permissions -p --model opus < prompt_file.txt > output.log 2>&1 &

# For async workers, ALWAYS have them write a summary report to a specific file
echo "...your prompt... Write a summary report to /tmp/worker-report-taskname.txt when complete" | claude --dangerously-skip-permissions -p --model opus > /tmp/worker-log-taskname.txt 2>&1 &
```

### Worker Prompt Guidelines
1. Be extremely specific about the task
2. Include all necessary context and file paths
3. Specify exact changes needed
4. For async workers, ALWAYS request a summary report
5. Include success criteria
6. Tell workers to use proper Gemini model versions (gemini-2.5-flash-exp, NOT 2.0)

### Example Worker Prompts

#### Investigation Worker
```
Investigate why tool calls are failing in the gemini-cli project.
Check:
1. Error messages in recent test runs
2. Provider configurations
3. Tool schema definitions
Focus on packages/cli/src/providers and packages/core/src/tools
Write findings to /tmp/tool-investigation-report.txt
Include: root cause, affected files, and recommended fixes
```

#### Fix Implementation Worker
```
Fix the require is not defined error in user_id.js:
- File: packages/core/src/utils/user_id.js line 59
- Error: Cannot use require in ESM module
- Solution: Replace require with proper ESM import or use createRequire
Test your fix compiles with npm run build
Report completion status to /tmp/require-fix-status.txt
```

### DO NOT
- Run commands directly (except to launch workers or check their status)
- Edit files yourself
- Test things yourself
- Do "quick checks" - have a worker do it

### Context Management
- Keep your context clean by delegating work
- Read worker reports instead of full outputs
- Use TodoWrite to track worker tasks
- Summarize findings instead of storing full details

# important-instruction-reminders
- NEVER edit files directly - launch a worker
- NEVER test directly - launch a worker to test
- NEVER investigate directly - launch a worker to investigate
- Use gemini-2.5-flash-exp, NOT gemini-2.0-flash-exp
- Always use --dangerously-skip-permissions -p with claude