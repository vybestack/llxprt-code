# {{TOOL_NAME}} Tool

**Purpose**: Pause the AI continuation loop when encountering errors or blockers that prevent productive progress (e.g., missing files, unresolved configuration, blocked dependencies).

**Parameters**:

- `reason` (string): A concise explanation of why continuation must be paused.

**When to Use**:

- Required files or resources are missing.
- Configuration issues prevent execution.
- Dependencies or services are blocked or unavailable.
- Unexpected errors require human intervention before proceeding.

**When _Not_ to Use**:

- Normal task completion—update status via todo tools instead.
- Requests for clarification—continue with your best understanding or ask the user.
- Minor issues that can be worked around within the current session.

**Example**:

```json
{
  "reason": "Cannot find config file 'app.config.js' required for the next step"
}
```
