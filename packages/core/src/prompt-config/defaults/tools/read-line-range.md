Reads a specific range of lines from a file. This is very useful for "copying" a function or class after finding its definition. The 'start_line' and 'end_line' parameters are 1-based and inclusive.

## Parameters

- `absolute_path` (string, required): The absolute path to the file to read (e.g., '/home/user/project/file.txt'). Relative paths are not supported. You must provide an absolute path.
- `start_line` (number, required): The 1-based line number to start reading from (inclusive).
- `end_line` (number, required): The 1-based line number to end reading at (inclusive). Must be >= start_line.
