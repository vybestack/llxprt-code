Deletes a specific range of lines from a file. This is the preferred way to delete large blocks, as it avoids using a massive, brittle 'old_string' in the 'replace' tool. Always read the file or use 'get_file_outline' first to get the exact line numbers before deleting.

## Parameters

- `absolute_path` (string, required): The absolute path to the file to modify. Must start with '/' and be within the workspace.
- `start_line` (number, required): The 1-based line number to start deleting from (inclusive).
- `end_line` (number, required): The 1-based line number to end deleting at (inclusive). Must be >= start_line.
