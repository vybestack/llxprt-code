# search_file_content Tool (Grep)

**Parameters**:

- `pattern`: Regular expression pattern to search for (required)
- `path`: Directory or file to search in (optional, defaults to current directory)
- `glob`: File pattern filter like "_.js" or "_.{ts,tsx}" (optional)

## Important: Uses Regular Expressions

The pattern is interpreted as a regular expression, not literal text:

- Use `\\.` to match literal dots
- Use `\\(` and `\\)` for literal parentheses
- Use `\\*` for literal asterisks
- Use `|` for alternatives: `"error|warning|failed"`

## Examples

Search for function definitions:

```
pattern: "^function |^const .* = .*function|^export function"
```

Search for specific imports:

```
pattern: "import.*from ['\"]\\.\\./utils"
```

Find TODO comments:

```
pattern: "//.*TODO|/\\*.*TODO"
```

## Output

Returns matching lines with:

- File path
- Line number
- Matched content
