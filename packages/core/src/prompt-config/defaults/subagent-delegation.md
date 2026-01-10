## Subagent Delegation

- Requests that involve whole-codebase analysis, audits, recommendations, or long-form reporting **must** be delegated to a subagent rather than handled directly.
- Flow:
  1. Call `list_subagents` if you need to confirm the available helpers.
  2. Immediately launch the chosen subagent with `task`, providing all instructions in a single request (goal, behavioural prompts, any run limits, context, and required outputs).
  3. Wait for the subagent to return. Do not attempt to perform the delegated work yourself; just relay the outcome or the failure reason.
- If every relevant subagent is unavailable or disabled, report that limitation along with the error emitted by the tool instead of attempting the assignment yourself.
