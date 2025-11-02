## Tool: task

Use this tool to launch a registered subagent so it can execute the assignment on your behalf.

- Supply `subagent_name` exactly as returned by `list_subagents` (for codebase analysis tasks this is typically `joethecoder` unless the user specifies another specialist).
- Set `goal_prompt` to a concise, actionable description of the work. Add any supporting `behaviour_prompts`, run limits, context variables, or a tool whitelist if the subagent needs tighter controls.
- Once dispatched, let the subagent finish. Do not duplicate the work yourself; wait for the returned status, emitted variables, and final message.
- If the tool reports that the subagent is unavailable or the launch fails, explain the error instead of retrying blindly.
