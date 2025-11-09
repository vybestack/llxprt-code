# Issue #501 – Chat Completions Tool Failure Visibility

## Goals
- Preserve tool responses (including failures) in OpenAI Chat Completion payloads so `tool_call_id` relationships remain valid and models see structured errors.
- Prevent malformed requests created by `undefined` parameters/results and oversized tool outputs.
- Validate the fix end-to-end via the `polaris-alpha` profile and ensure CI + e2e suites pass.

## Test-First Workflow
1. **Characterize the bug**
   - Read the relevant sections of `packages/core/src/providers/openai/OpenAIProvider.ts` and `packages/core/src/services/history/IContent.ts`.
   - Inspect recent traces in `~/.llxprt/debug/*.jsonl` to confirm how tool failures are currently serialized.
2. **Add/adjust unit tests**
   - Extend/introduce `convertToOpenAIMessages` tests covering:
     - tool calls with `undefined`, stringified, and object parameters;
     - tool responses with error-only payloads;
     - oversized outputs and Unicode replacement characters.
   - Run `npx vitest run packages/core/src/providers/openai/OpenAIProvider.convertToOpenAIMessages.test.ts` to prove they fail.
3. **Implement fixes**
   - Normalize tool-call arguments (always valid JSON string, `{}` fallback).
   - Map `ToolResponseBlock.error` into a structured error payload, truncate large blobs, and sanitize Unicode before sending to OpenAI.
   - Re-run the focused tests to prove they now pass, then run the full workspace suite.

## Polaris & Debug Validation
- Use the Polaris alpha profile to exercise real tool calls:
  ```bash
  node scripts/start.js --profile-load polaris-alpha --prompt "review the source and tell me what it does" --yolo
  ```
  (The prompt explicitly asks the agent to inspect source via tools.)
- After each run, inspect the latest `~/.llxprt/debug/llxprt-debug-*.jsonl` entries to verify tool responses carry `error` details and matching `tool_call_id`s.
- Repeat until the transcript shows compliant tool call / tool response pairs without 400s.

## Full CI / QA Matrix
1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test` (workspace default)
5. `npm run test:e2e`
6. `npm run test:ci` (ensure `CI=1` plus any secrets pulled from the `cerebrasglm46` profile; fall back to `synthetic` profile variables if needed)
7. `npm run build`
8. `node scripts/start.js --profile-load synthetic --prompt "just say hi"`
9. `node scripts/start.js --profile-load polaris-alpha --prompt "review the source and tell me what it does" --yolo`

## Delivery
- Stage all changes with `git add`.
- Commit with a descriptive message referencing `#501` (e.g., `fix(openai): normalize chat tool responses (#501)`).
- Push `issue501` and open a PR summarizing the bug, the new tests, the Polaris validation, and referencing `#501`.
