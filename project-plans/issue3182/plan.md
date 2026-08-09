# Issue 3182: Fail-Closed Browser Launches in Tests

## Problem

Bun module mocks are process-wide and order-dependent. If the production secure browser launcher is loaded before its test mock, the launcher retains the real child-process executor and test URLs can reach the operating system browser.

## Requirements

1. Browser-launch tests use explicit fake dependencies rather than a process-wide child-process module mock.
2. Every public browser-launch execution path fails closed in a test process unless `LLXPRT_ALLOW_BROWSER_LAUNCH_IN_TESTS` is exactly `true`.
3. Root and workspace-local raw Bun test commands, plus repository test runners and their children, set `LLXPRT_RUNNING_TESTS=true` before test modules load.
4. Production browser behavior remains unchanged outside detected test processes.
5. Behavioral tests cover blocked, opted-in, non-exact opt-in, `NODE_ENV=test`, and production-like policy branches without launching a real browser.
6. A source-first/module-cache-contamination regression reaches no OS browser command.

## Test-First Implementation

1. Add failing policy tests for all guard branches using a fake executor.
2. Add failing subprocess tests for root and workspace-local Bun configuration with `NODE_ENV` overridden.
3. Move the injectable launcher implementation behind a non-exported package subpath so the public secure-browser-launcher module cannot bypass the test guard.
4. Add the shared browser guard preload to every workspace Bun configuration while preserving existing preloads.
5. Remove the obsolete order-dependent module-mock helper.
6. Run targeted browser and runner tests, the full core suite, lint, typecheck, formatting, build, and the source-first regression.

## Verification

- No test enables real OS browser execution.
- Fake executors prove allowed branches without spawning an OS command.
- Browser-command PATH stubs remain untouched during the source-first regression.
- No lint/type suppression or lint-threshold changes are introduced.
