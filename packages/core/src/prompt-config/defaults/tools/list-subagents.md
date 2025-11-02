## Tool: list_subagents

Call this tool to discover which subagents are registered and currently available. The response includes each subagent’s name, the profile it will run under, and any summary notes supplied by the user. Look for analysis-focused helpers such as `joethecoder` before attempting any whole-repository review yourself.

- Use this before delegating work so you reference a real subagent name.
- Never guess or fabricate subagent identifiers—if it is not in the tool output, you cannot launch it.
- Treat the result as read-only metadata; if you need the subagent to act, follow up with the `task` tool using one of the returned names.
