# @vybestack/llxprt-cli-posix

Platform-specific launcher payload that provides the `llxprt` command on
POSIX systems (darwin, linux, freebsd). It is an optionalDependency of
@vybestack/llxprt-code and is selected automatically by npm on matching
platforms. It ships the POSIX shell launcher unchanged and runs under the
bundled Bun runtime (no Node dependency).
