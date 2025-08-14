# todo_write Tool

**Parameter**: Use `todos` - an array of todo objects

Each todo object requires:

- `id`: String identifier (e.g., "1", "2", "task-1")
- `content`: String description of the task
- `status`: One of "pending", "in_progress", "completed"
- `priority`: One of "high", "medium", "low"

Example structure:

```json
{
  "todos": [
    {
      "id": "1",
      "content": "Implement user authentication",
      "status": "pending",
      "priority": "high"
    }
  ]
}
```

## Usage Guidelines

Use todos when:

- Task has 3+ distinct steps
- Managing multiple related changes
- User provides a list of items to complete

Update status as you work:

- Mark "in_progress" before starting
- Mark "completed" immediately when done
- Only one task "in_progress" at a time

Skip todos for:

- Single, simple operations
- Purely informational responses
- Tasks that complete in one tool call
