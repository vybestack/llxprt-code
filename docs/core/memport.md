# Memory Imports

You can modularize your `LLXPRT.md` files by importing content from other files
using the `@file.md` syntax. This lets you break large memory files into smaller,
reusable components.

## Syntax

Use the `@` symbol followed by the path to the file you want to import:

```markdown
# Main LLXPRT.md file

This is the main content.

@./components/instructions.md

More content here.

@./shared/configuration.md
```

When LLxprt Code loads your memory files, it resolves each `@` import, inlines
the referenced file's content, and passes the combined result to the model.

## Supported path formats

### Relative paths

- `@./file.md` — import from the same directory
- `@../file.md` — import from the parent directory
- `@./components/file.md` — import from a subdirectory

### Absolute paths

- `@/absolute/path/to/file.md` — import using an absolute path

## Examples

### Basic import

```markdown
# My LLXPRT.md

Welcome to my project!

@./getting-started.md

## Features

@./features/overview.md
```

### Nested imports

Imported files can themselves contain imports, creating a nested structure:

```markdown
# main.md

@./header.md
@./content.md
@./footer.md
```

```markdown
# header.md

# Project Header

@./shared/title.md
```

## Safety features

### Circular import detection

LLxprt Code automatically detects and prevents circular imports. If file A
imports file B, and file B imports file A, the cycle is broken and the repeated
import is skipped.

### File access security

Imports are validated before reading. The resolved path must stay within the
project root directory. URL-based imports (`file://`, `http://`, `https://`) and
path traversal attempts are rejected.

### Maximum import depth

To prevent infinite recursion, imports are limited to a depth of 5 levels. If a
file's import chain exceeds this limit, further imports are stopped and the
remaining content is left as-is.

## Code region detection

The `@` symbol is only treated as an import directive when it appears in normal
Markdown text. Inside fenced code blocks and inline code spans, `@` is left
untouched so examples that use `@` in code are preserved as written.

## Error handling

### Missing files

If a referenced file does not exist, the import fails gracefully. An error
comment is inserted in the output where the import was attempted.

### File access errors

Permission issues or other file system errors produce a readable error message
in the output rather than crashing the session.

## Best practices

1. **Use descriptive file names** for imported components.
2. **Keep imports shallow** — avoid deeply nested import chains.
3. **Document your structure** — maintain a clear hierarchy of imported files.
4. **Test your imports** — ensure all referenced files exist and are accessible.
5. **Use relative paths** when possible for better portability.

## Troubleshooting

### Common issues

1. **Import not working**: Check that the file exists and the path is correct.
2. **Circular import warnings**: Review your import structure for circular
   references.
3. **Permission errors**: Ensure the files are readable and within the project
   root.
4. **Path resolution issues**: Use absolute paths if relative paths are not
   resolving correctly.
