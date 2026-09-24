# Codex through Praxis (tracking issue #3753)

This work was originally planned under issue 3745. That issue became inaccessible when its authoring account was flagged, so the tracking issue was recreated as #3753. This plan file and the `tmp/issue3745/` evidence directory keep their original issue-3745 naming for continuity with the recorded evidence paths.

Provider identity determines Codex request, authentication, account-header and transport behavior independently of the configured endpoint. The alias factory previously set identity after construction, while Responses construction and execution inferred Codex from the URL.

## Implementation

The alias factory now passes the alias name into Responses construction. The constructor sets the provider identity and Codex OAuth configuration together. Request preparation and WebSocket selection use that configuration, never a hostname substring. Plain Responses instances remain generic even when their URL resembles the Codex endpoint.

Existing Codex test fixtures now explicitly select `codex`. The construction-rules regression uses an explicit custom model rule instead of relying on a differently named alias being implicitly classified by its URL.

## Test-first evidence

`tmp/issue3745/red.log` captured two regression failures before implementation: proxy Codex could not resolve OAuth, and generic Responses at a Codex-shaped URL incorrectly required a Codex account. The direct Codex alias control passed. The completed regression suite covers proxy and direct endpoints, a per-call endpoint override, WebSocket-to-HTTP fallback, bearer/account headers, unsupported parameter removal, and generic Responses controls.

## Local acceptance

A new token-free profile was created, without replacing any existing profile:

- Name: `praxis-luna`
- Path: `~/Library/Preferences/llxprt-code/profiles/praxis-luna.json`
- Provider: `codex`
- Model: `gpt-5.6-luna`
- Endpoint: `http://127.0.0.1:18443/backend-api/codex`
- Reasoning effort: `high`
- Existing OAuth storage supplies authentication; the profile contains no credentials.

Workspace invocations:

```sh
bun scripts/start.ts --profile-load praxis-luna 'Reply with exactly PRAXIS_OK and no other text. Do not call tools.'
bun scripts/start.ts --profile-load praxis-luna --approval-mode yolo 'Use the write_file tool to create tmp/issue3745/praxis-roundtrip.txt containing PRAXIS_TOOL_OK. Then use read_file to read that file. Finally reply with exactly PRAXIS_TOOL_OK. Do not modify any other files or run shell commands.'
bun scripts/start.ts --profile-load lunahigh --set base-url=https://chatgpt.com/backend-api/codex --prompt 'Reply with exactly DIRECT_CODEX_OK and no other text. Do not call tools.'
```

All three exited 0. Outputs were `PRAXIS_OK`, `PRAXIS_TOOL_OK`, and `DIRECT_CODEX_OK`. The tool run created and read the requested workspace file. A repeated text request also exited 0 while `lsof` recorded the Bun CLI connected to Praxis PID 35159 at port 18443. Sanitized configuration evidence identifies the `/backend-api/codex` route and `chatgpt.com:443` upstream with `chatgpt.com` TLS SNI. No service settings were changed.

Evidence is under `tmp/issue3745/`: `praxis-text.log`, `praxis-tool.log`, `direct-control.log`, `praxis-routing-text.log`, `routing.log`, and `praxis-config-routing.log`, with companion `.exit` files. An initial direct command without `--prompt` exited 1 because the array-valued `--set` consumed its positional prompt; the explicit-prompt invocation above succeeded.

## Verification status

Final checks passed with exit 0: `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`. Logs and exit markers are `tmp/issue3745/{format,lint,typecheck,test,build}-verified.{log,exit}`. The full test run passed every workspace, including 643 provider test files and 763 CLI test files. The CLI reported 9,809 passing cases, zero failures, five skipped and 13 todo.

The five new regression cases passed with 32 assertions (`regression-verified.log`). The test-audit scan exited 0, with no findings in the new regression file and no added findings in changed files. Nine existing duplicate-assertion findings remain unchanged. `git diff --check` also passed. A final workspace Praxis text request returned `PRAXIS_OK`, exit 0 (`praxis-final.log`).

The initial broad raw `bun test` invocation encountered cross-file mock contamination; final verification used the repository's isolated runners. Overlapping an early build with checks also temporarily removed compiled dependencies, causing lint/typecheck errors and one CLI test import failure. Checks were rerun without concurrent builds, and the entire final test run passed. No source changes were made to hide those verification-order failures.

The required `zai-glm-flash` smoke reached `https://api.z.ai/api/anthropic` but failed with status 429, code 1113: `Insufficient balance or no resource package. Please recharge.` This is an external credential/account limitation, not a passing smoke. See `tmp/issue3745/smoke.log`. The global `ollamakimi` profile is absent.

Final independent review approved the implementation with no blocking defects; 460 independent tests passed. OCR was not run.

## Follow-up

Consider parameterizing the stateful/media fixture with a proxy endpoint. Direct-endpoint media and proxy-endpoint text behavior already have separate coverage; this additional combination is a nonblocking coverage improvement, not a requirement of this fix.

The `praxis-luna` profile is local and untracked. Acceptance used the workspace CLI; it did not update the installed published CLI.
