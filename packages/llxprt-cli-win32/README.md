# @vybestack/llxprt-cli-win32

Platform-specific launcher payload that provides the `llxprt` command on
Windows (win32). It is an optionalDependency of @vybestack/llxprt-code
and is selected automatically by npm on Windows. It is a plain batch
launcher that locates the bundled Bun runtime and execs the LLxprt Code
entry point (no Node dependency).
