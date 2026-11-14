`packages/agents/src/tools/task.ts` has three named exports:

- **`TaskToolParams`**: the input shape for the tool. It includes the subagent name and goal, optional behavior prompts, tool whitelist, expected outputs, context, timeout and turn limits, and an async flag.
- **`TaskToolDependencies`**: the dependencies needed to create the tool, including the child-launch function, task-policy and tool-governance readers, and a message bus. It also accepts optional display, environment, registry, and launch-owner dependencies.
- **`TaskTool`**: the tool class itself. It registers as `task`, validates and normalizes parameters, then creates an invocation that launches a subagent. It supports foreground execution with streaming, timeout and cancellation handling, and async execution. It can also be copied with child-display callbacks using `withChildDisplay()`.

`TaskTool` requires a concrete message bus and a child-launch function; its constructor throws if either is missing. The invocation class and the helper imports are not exported from this file.
