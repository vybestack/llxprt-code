# Project Guidelines for Claude

## Code Quality Rules

### TypeScript

- **Don't use `any`** - Always specify proper types. Use `unknown` if the type is truly unknown and add proper type guards.

## Linting and Formatting

- **Always run `npm run format` before committing** - Never push without formatting
- Always run `npm run lint` before considering work complete
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

**Do NOT add:**

```
🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Code Verification and Deployment Rules

### Never Declare Done Without Full Verification

- **NEVER** declare something done unless it has compiled, tested, and linted
- **NEVER** push without: compile → test → lint → format
- **ANY** code changes require restarting the entire verification cycle
- If you compile, test, lint and get an error and change code, you MUST compile, test, lint again
- You may commit locally before risky changes, but NEVER push until the whole cycle passes
- **NEVER** push without explicit user permission - they need to test the UI first
- Documentation-only changes (\*.md files, docs/) do NOT require build/test/lint cycle

### Communication Style

- Never bother with apologies or "You're absolutely right"
- Be direct and focus on the task

# important-instruction-reminders

- Use subagents for complex multi-step tasks
- Work directly only for simple, well-defined tasks
- Launch multiple subagents concurrently when possible
- Always provide complete context to subagents
- Trust subagent outputs - they're specialized for their domains
- NEVER push without full verification cycle AND user permission
