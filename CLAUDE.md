# Project Guidelines for Claude

## Code Quality Rules

### TypeScript

- **Don't use `any`** - Always specify proper types. Use `unknown` if the type is truly unknown and add proper type guards.

## logging

- We have a whole sophisticated logging system you designed do not use console.out or debug -- use our debug logging system
- The log files are written to ~/.llxprt/debug/ - do not look for them in stderr or stdout

## Linting and Formatting

- **Always run `npm run format` FROM THE MAIN llxprt-code directory before committing** - Never push without formatting
- Always run `npm run lint` FROM THE MAIN llxprt-code directory before considering work complete
- Fix all linting errors, including warnings about `any` types
- Run `npm run typecheck` to ensure type safety

## Working Methodology

### Use Subagents for Complex Tasks

- **Use the Task tool with subagents** for multi-step tasks, research, and complex implementations
- Subagents are specialized for different types of work:
  - `general-purpose`: For research, searching, and multi-step tasks
  - `typescript-code-reviewer`: For reviewing TypeScript code compliance
  - `typescript-coder`: For writing production-ready TypeScript code

### When to Use Subagents

Use subagents for:

- Complex multi-step tasks requiring coordination
- Research and investigation across multiple files
- Writing new features with proper tests
- Code review and quality enforcement
- Tasks requiring extensive file searching

### When to Work Directly

Work directly for:

- Simple file edits with clear requirements
- Quick fixes in known locations
- Running straightforward commands
- Reading specific files you already know

### Example Subagent Usage

#### Research Subagent

```
Task(
  description="Research auth flow",
  prompt="Investigate the authentication flow in the llxprt-code project. Find all auth-related files, understand the flow, and document how OAuth and API keys are handled.",
  subagent_type="general-purpose"
)
```

#### TypeScript Implementation Subagent

```
Task(
  description="Implement user service",
  prompt="Create a new UserService class in packages/core/src/services with proper TypeScript types, comprehensive tests, and following all project conventions. The service should handle user CRUD operations.",
  subagent_type="typescript-coder"
)
```

#### Code Review Subagent

```
Task(
  description="Review auth changes",
  prompt="Review the recent changes to the authentication module for compliance with project standards, type safety, and test coverage.",
  subagent_type="typescript-code-reviewer"
)
```

### Best Practices

1. Launch multiple subagents concurrently for independent tasks
2. Be specific about expected outputs in your prompts
3. Use TodoWrite to track subagent tasks
4. Subagents are stateless - provide all context in the initial prompt
5. Trust subagent outputs - they're specialized for their tasks

### Context Management

- Delegate complex work to subagents to keep your context clean
- Subagents return summaries - you don't need to store full details
- Use direct tools (Read, Edit, Bash) for simple, targeted tasks

## Git Commit Signing Policy

### Never Co-sign Commits

NEVER include the Claude commit signature/co-authorship.

## Code Verification and Deployment Rules

### Never Declare Done Without Full Verification

- **NEVER** declare something done unless it has compiled, tested, and linted
- **NEVER** push without: test → lint → format → `git add -A` → build → commit
- **CRITICAL**: After running `npm run format`, ALWAYS run `git add -A` to stage the formatted changes before committing
- **CRITICAL**: ALWAYS run build commands from the main project directory (llxprt-code), NOT from subdirectories like packages/cli
- **ANY** code changes require restarting the entire verification cycle
- If you compile, test, lint and get an error and change code, you MUST compile, test, lint again
- You may commit locally before risky changes, but NEVER push until the whole cycle passes
- **NEVER** push without explicit user permission - they need to test the UI first
- Documentation-only changes (\*.md files, docs/) do NOT require build/test/lint cycle

### CI-Aligned Verification (MUST DO BEFORE PUSH)

Run these checks in this exact order to match GitHub Actions CI:

1. `npm run lint:ci` - Zero warnings allowed (eslint with --max-warnings 0)
2. `npm run typecheck` - Type safety check
3. `npm run format`
4. `npm run build` - Build all packages
5. `npm run bundle` - Create bundle
6. `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`

For shell scripts:

```bash
shellcheck --enable=all --exclude=SC2002,SC2129,SC2310 shell-scripts/*.sh
```

Or use the pre-push check script: `./scripts/pre-push-check.sh`

### Communication Style

- **BANNED PHRASES**: "You're absolutely right", "You're right", "Absolutely", "Indeed", "Correct"
  - Instead just say "Ok" or skip acknowledgment entirely and do the task
- Never apologize ("Sorry", "My apologies", "I apologize")
- Skip all agreement/validation theater - just DO THE THING
- Be direct and focus on the task

# Git Hooks and Code Quality

**IMPORTANT**: A Git pre-commit hook is installed that enforces code quality. It will:

- Run `npm run lint` and block commit if it fails
- Run `npm run typecheck` and block commit if it fails
- Run `npm run format` and block commit if files were changed

If the pre-commit hook fails, you MUST:

1. Fix any lint/type errors
2. Run `npm run format` and stage the changes
3. Only then try to commit again

**NEVER USE `SKIP_HOOKS=1`** - This is for human emergencies only, not for bypassing quality checks. If the hooks are failing, FIX THE CODE, don't skip the checks. The user installed these hooks specifically because you keep forgetting to run these checks.

# important-instruction-reminders

- Use subagents for complex multi-step tasks
- Work directly only for simple, well-defined tasks
- Launch multiple subagents concurrently when possible
- Always provide complete context to subagents
- Trust subagent outputs - they're specialized for their domains
- NEVER push without full verification cycle AND user permission
- Git pre-commit hooks enforce lint, typecheck, and format - respect them!
- We do not send pull requests to gemnini-cli. This is a perminant fork downstream.
