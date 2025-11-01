## Tool: task

Launches a named subagent to work on a specific goal.

- Provide the `subagent_name` plus a clear `goal_prompt`.
- Add any run limits, behavioural prompts, context variables, or tool whitelist the subagent needs.
- After calling this tool, wait for the resulting subagent status and outputs; do not try to perform the task yourself.
- Use this when the assignment should be delegated to another specialized agent.
