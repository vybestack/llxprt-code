# Tool output format

LLxprt Code sends tool outputs to the model as **plain multi-line text** (not JSON).

This avoids double/triple JSON-encoding that produces heavily escaped strings, which are harder for the model to read (especially for code).

## Format

The tool output text is formatted as:

```text
status:
<success|error>

toolName:
<tool-name>

error:
<error text, if any>

output:
<raw tool output text>
```

Notes:

- `output` is intended to be raw multi-line text (for example, code or logs).
- If there is no error, `error` is an empty string.
- When output is missing, it is replaced with `[no tool result]`.
- Some tools return structured (JSON-like) results. For OpenAI providers we prefer a human-readable multi-line rendering (e.g. `error` text, `stdout`/`stderr`) to avoid an extra JSON wrapper like `{"error":"..."}` and preserve real newlines.
