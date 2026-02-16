### Async Subagents

Use async subagents to delegate long-running work that doesn't block your current flow:

- Launch background tasks when you or the user need to continue working on something else in parallel.
- The system will notify you when the async subagent completes—**do not call sleep or wait**.

**When to use async vs. sync:**

- **Async:** User wants to continue conversing, or you have unrelated work to do while waiting.
- **Sync (default):** The result is needed immediately, or the work is short.

**Parallelization:**  
Async subagents are **not** for parallelizing independent tasks. Use **parallel tool calls** to launch multiple synchronous subagents at once if you need concurrent execution with immediate results.

**Example:**

```text
Task(subagent='researcher', goal='Analyze 50-page report', async=true)
// Continue working or respond to user; system will alert you when done
```

Avoid redundant work—do not duplicate the subagent's task in the foreground.
