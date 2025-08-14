# read_many_files Tool

**Parameter**: Use `paths` - array of file paths or glob patterns (required)

Reads multiple files at once. Useful for:

- Getting overview of codebase sections
- Reading all files of a certain type
- Comparing related files

## Usage

With specific files:

```
paths: ["/path/to/file1.js", "/path/to/file2.js"]
```

With glob patterns:

```
paths: ["src/**/*.ts", "tests/**/*.test.js"]
```

## Limits

- Maximum 50 files by default
- Files over 512KB are truncated
- Total output limited to 50,000 tokens

If limits exceeded, the tool will suggest more specific patterns.
