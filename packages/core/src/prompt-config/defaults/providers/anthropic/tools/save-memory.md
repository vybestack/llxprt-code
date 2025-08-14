# save_memory Tool

**Parameter**: Use `fact` - a clear, concise statement to remember (required)

Saves user-specific information for future sessions.

## When to Use

Save facts when:

- User explicitly asks you to remember something
- User shares preferences that would help in future interactions
- User mentions frequently used paths, aliases, or conventions

## What to Save

Good examples:

- "User prefers tabs over spaces for indentation"
- "User's main project is located at /home/user/my-project"
- "User likes descriptive variable names over abbreviations"

Don't save:

- Current session context
- Project-specific information (unless it's their main project)
- Temporary information

## Format

Keep facts concise and self-contained:

```
fact: "User prefers Python type hints in all new code"
```
