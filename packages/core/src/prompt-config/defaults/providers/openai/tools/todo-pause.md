# {{TOOL_NAME}} Tool

**Purpose**: Pause the AI continuation loop when encountering errors or blockers.

**Parameters**:

- `reason` (string): A concise reason why continuation must be paused.

**When to Use**:

- Missing required files or resources
- Configuration issues preventing progress
- Blocked dependencies or services
- Unexpected errors requiring human intervention

**When NOT to Use**:

- For normal task completion (use `todo_write` to update status instead)
- When needing clarification (continue with best understanding)
- For minor issues that can be worked around

**Example**:

```json
{
  "reason": "Cannot find config file 'app.config.js' required for the next step"
}
```
