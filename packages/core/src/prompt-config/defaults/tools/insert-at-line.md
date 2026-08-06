Inserts new content at a specific line in a file. This is the "paste" operation for refactoring. The 'line_number' is 1-based. The new content will be inserted before this line number. To prepend to the top of a file, use 'line_number: 1'. The valid range is 1 .. totalLines + 1; setting 'line_number' to totalLines + 1 appends the content after the last line. A 'line_number' greater than totalLines + 1 is an error.

## Parameters

- `absolute_path` (string, required): The absolute path to the file to modify. Must start with '/' and be within the workspace.
- `line_number` (number, required): The 1-based line number to insert before. Content will be inserted before this line.
- `content` (string, required): The content to insert at the specified line.
