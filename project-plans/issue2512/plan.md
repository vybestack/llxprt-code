# Issue #2512 — Prevent Windows browser launch from hiding the parent console

Plan ID: PLAN-20260722-ISSUE2512
Issue: https://github.com/vybestack/llxprt-code/issues/2512
Branch: `issue2512`
Baseline: `c28806b8cc4db1898efe514c4aa501c30a2c16c8`

## Goal

Keep the existing `openBrowserSecurely(url)` API and the shared Codex, Anthropic, and MCP call path while ensuring Windows default-browser launch cannot hide or manipulate the caller's shared console. Preserve URL validation, injection resistance, non-Windows command/fallback behavior, and contextual errors.

## Grounded findings

- The baseline Windows implementation launched `powershell.exe -WindowStyle Hidden`, which can affect a console shared with the parent PowerShell session.
- Explicit `/auth codex login` and lazy Codex authentication converge on `openBrowserSecurely`; Anthropic and MCP OAuth use the same helper.
- The baseline interpolated an escaped URL into PowerShell source. The remediated design keeps URL data out of source entirely.
- `windowsHide: true` is already an established process-creation option in this repository and suppresses the child window without asking PowerShell to hide a potentially shared console.
- `execFile` supports `windowsHide` and `shell`, but its option type does not support the previous `detached` and `stdio` fields. Those fields were removed rather than represented by a test-only abstraction.
- The public function must remain one-argument. Tests use the existing mocked child-process infrastructure boundary and do not expose a production test seam.

## Behavioral requirements

### REQ-2512-001 — Never manipulate the shared console

For Windows browser launch, PowerShell arguments contain no `-WindowStyle`, `Hidden`, or other console-window manipulation command.

### REQ-2512-002 — Suppress only the helper window

The Windows PowerShell helper is created with `windowsHide: true` and `shell: false`. It does not use `cmd.exe`, `shell: true`, or Windows detachment.

### REQ-2512-003 — Keep URL data out of PowerShell source

The exact validated URL is supplied through `LLXPRT_BROWSER_URL`. Constant PowerShell source copies it into a scalar, removes the environment entry, and only then launches the associated application:

```powershell
$browserUrl = $env:LLXPRT_BROWSER_URL; Remove-Item Env:LLXPRT_BROWSER_URL; Start-Process -FilePath $browserUrl
```

This keeps apostrophes, double quotes, spaces, dollar expressions, semicolons, pipes, backticks, ampersands, redirects, and fragments as data. Removing the environment entry before `Start-Process` prevents the launched browser or association process from inheriting it.

### REQ-2512-004 — Preserve validation

Valid HTTP and HTTPS URLs launch. Invalid URLs, non-HTTP(S) protocols, and URLs containing control characters fail before process execution.

### REQ-2512-005 — Preserve other platforms

macOS continues to execute `open <URL>`. Linux, FreeBSD, and OpenBSD continue to execute `xdg-open <URL>` and retain the existing fallback order. Unsupported platforms and launch failures retain contextual errors.

### REQ-2512-006 — Preserve callers and API

`openBrowserSecurely` remains `(url: string) => Promise<void>`. Codex, Anthropic, and MCP call sites require no edits.

## Test-first implementation

### Initial RED

Before the first production change, the Windows harmless-child test failed with one failed and seventeen passed tests because the baseline ignored the attempted runner injection and retained the old `-WindowStyle Hidden`/interpolated command. That failure established missing behavior but did not directly exercise the console hazard, so the test design was strengthened during review.

### Review RED

Before the final remediation, the strengthened all-host Windows contract test failed with one failed and nineteen passed tests. It expected the bind/remove/launch command but received `Start-Process -FilePath $env:LLXPRT_BROWSER_URL`, proving that the launched association process would inherit the OAuth URL environment entry. Compiler inspection also showed the rejected public signature `(url: string, processRunner?: BrowserProcessRunner) => Promise<void>`.

Focused RED command:

```powershell
npm run test --workspace @vybestack/llxprt-code-core -- src/utils/secure-browser-launcher.test.ts
```

### GREEN

- Restored the one-argument public API and removed the test-only process-runner abstraction.
- Typed internal launch data with Node's actual `ExecFileOptions`.
- Replaced `-WindowStyle Hidden` with `windowsHide: true` at process creation.
- Added explicit `shell: false`.
- Kept the PowerShell source constant and removed the URL environment entry before `Start-Process`.
- Removed unsupported `detached`/`stdio` claims without changing effective macOS/Linux/BSD commands or fallback behavior.
- Added an all-host Windows contract test so non-Windows CI catches a return of `-WindowStyle Hidden`, URL interpolation, or unsafe process options.
- Added a Windows-only real-process test through the existing mocked `execFile` infrastructure boundary.

## Safe real-process regression

The Windows-only test calls the public `openBrowserSecurely` function. Before creating its temporary fixture, the test derives the installed Windows directory from `process.env.SystemRoot ?? process.env.windir` and fails with an actionable fixture error if neither variable is defined. It uses that directory only to locate the built-in `System32\where.exe` test target; this fixture resolution does not exercise or claim production fallback behavior. At the existing infrastructure mock boundary, it replaces only the `LLXPRT_BROWSER_URL` target, then delegates the unchanged production executable, argument vector, and remaining options to native Node `child_process.execFile`.

The real `powershell.exe` therefore executes the production bind/remove/`Start-Process` source. `where.exe` is a short-lived built-in target and does not open a browser or authentication flow. After the helper returns, the test writes and reads a temporary sentinel, proving the parent test process remains operational. A ten-second test timeout bounds the test without introducing process-killing behavior.

The automated test does not prove taskbar visibility, exercise a registered browser association, directly inspect the target's inherited environment, or execute under Bun. Two Bun-hosted Vitest attempts failed before collection with `TypeError: File URL path must be an absolute path`; zero Bun-hosted tests executed. Manual Windows OAuth validation remains required.

## Verification record

Focused and caller verification passed:

- Browser launcher: 1 file, 19 tests passed.
- Core: 284 files passed; 5,212 tests passed and 50 skipped.
- Provider callers: 4 files, 21 tests passed.
- MCP callers: 2 files, 28 tests passed.
- Core, providers, and MCP typechecks passed.
- Focused ESLint and Prettier checks passed.
- `git diff --check` passed.

Mandatory repository verification passed:

- `npm run test`: 509 files; 10,320 tests passed and 100 skipped.
- `npm run lint`.
- `npm run typecheck`.
- `npm run format`.
- `npm run build`.
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` returned a valid haiku.

Non-fatal existing Windows diagnostics concerning `locale`, provider-reference parsing, and node-pty fallback appeared during verification, but every required command exited successfully.

## Safety constraints

- Never launch a real browser or authentication flow during automated verification.
- Never hide, close, or terminate the developer terminal or another process.
- Do not use `cmd.exe`, `shell: true`, or interpolate URL data into PowerShell source.
- Do not add dependencies, modify `.llxprt/`, run `git clean`, or edit OAuth callers needlessly.

## Remaining manual validation

After the PR and review cycle, manually run `/auth codex login` on Windows and confirm:

1. The registered browser opens.
2. The existing PowerShell window remains visible, accessible from the taskbar, and usable.
3. The callback and authentication complete successfully.
4. Lazy authentication has the same safe behavior.

That manual validation is intentionally deferred to the user because it opens a real browser and exercises live OAuth.
