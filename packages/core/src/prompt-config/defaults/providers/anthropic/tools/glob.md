# glob Tool

**Parameter**: Use `pattern` for the glob pattern (required)

Find files matching glob patterns. Returns absolute paths sorted by modification time (newest first).

## Pattern Examples

- `**/*.js` - All JavaScript files recursively
- `src/**/*.ts` - All TypeScript files under src/
- `*.md` - Markdown files in current directory only
- `**/*.{ts,tsx}` - TypeScript and TSX files
- `**/test*.js` - Files starting with "test"
- `!**/node_modules/**` - Exclude node_modules (use in ignore parameter)

## Common Uses

Find all test files:

```
pattern: "**/*.test.{js,ts}"
```

Find configuration files:

```
pattern: "**/config*.{json,js,yaml}"
```

Find all source files:

```
pattern: "src/**/*.{js,jsx,ts,tsx}"
```
