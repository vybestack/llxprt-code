## Tool: execute_tool_script

Code mode is on: you can run a short sandboxed JavaScript program that calls read/search tools and foreground shell commands and returns one compact JSON value.

- Use it for mechanical gathering: the same lookup over many files, commits or directories, joins and counts across tool outputs, or large outputs you only need summarized.
- Do not use it for one small lookup, or for content you must read yourself to edit or explain; call that tool directly.
- List every tool the script calls in `tools`. Call `discover_tool_api` when you are unsure of argument names or result shapes.
- Return a small value. A result over the size limit fails with `RESULT_TOO_LARGE`; return counts or a summary instead.
