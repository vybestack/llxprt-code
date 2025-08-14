# replace Tool (Edit)

**Parameters**:

- `file_path`: Absolute path to the file (required)
- `old_string`: Exact text to find and replace (required)
- `new_string`: Replacement text (required)
- `expected_replacements`: Number of occurrences to replace (optional)

## Critical Requirements

**old_string** must be EXACT, including:

- All whitespace and indentation
- Line breaks exactly as they appear
- At least 3 lines of context before and after the target

**Context is Essential**: Include enough surrounding code to uniquely identify the location. The tool will fail if old_string matches multiple locations unexpectedly.

## Example Usage

Wrong (too little context):

```
old_string: "user_id = None"
```

Right (with context):

```
old_string: "    def __init__(self):\n        self.user_id = None\n        self.session_token = None"
```

## Common Patterns

For multiple replacements in one file:

1. Set `expected_replacements` to the count you expect
2. Or make multiple separate replace calls for different sections

The tool preserves file formatting and encoding automatically.
