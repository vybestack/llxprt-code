- Use 'read_line_range' to read a specific range of lines from a file. This is very useful for "copying" a function or class after finding its definition.
- The 'start_line' and 'end_line' parameters are 1-based and inclusive.
- Optionally, you can set `showLineNumbers: true` to return each line with a virtual 1-based line number prefix for easier navigation in large files, for example:

  294| occurrences = 0;
  295| } else {
  296| const lineText = lines[replaceLine - 1];

  This numbering is not part of the file itself; it is only a visual aid for precise navigation and editing.
