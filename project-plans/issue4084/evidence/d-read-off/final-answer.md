`packages/agents/src/tools/task.ts` has **three named exports** and no default export:

- **`TaskToolParams`** — the TypeScript interface for the tool’s input. It includes the subagent name and goal, optional behavior prompts and tool whitelist, context and expected outputs, plus timeout, grace-period, turn-limit, and async options.
- **`TaskToolDependencies`** — the interface for dependencies supplied when constructing the tool. It requires a child-launch function, task-policy and tool-governance readers, and a message bus. Tool registry, display callbacks, environment detection, and task-launch ownership are optional.
- **`TaskTool`** — the class implementing the declarative `task` tool. It validates and normalizes parameters, then launches a subagent through the supplied dependencies. It supports foreground and async execution, optional child display callbacks, and streamed progress.

The file also defines `TaskToolInvocation` and several helper functions and types, but they are **not exported** from this module.
