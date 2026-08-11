# Plan: Bound External HTTP, API, and MCP Response Acquisition (Issue #3204)

Plan ID: PLAN-20260810-ISSUE3204
Generated: 2026-08-10
Parent: #3202

## Accepted Problem

LLxprt-owned HTTP readers currently call `Response.arrayBuffer()` or
`Response.text()` before enforcing a local byte limit. MCP transports materialize
tool results inside `@modelcontextprotocol/sdk` before LLxprt receives them, and
LLxprt then transforms and retains content blocks without an aggregate budget.
This issue bounds those existing acquisition paths without introducing a network
framework, public setting, package, dependency, or unrelated refactor.

## Verified Ownership Boundaries

| Path | Current acquisition owner | Materialize-first risk | Accepted action |
| --- | --- | --- | --- |
| Direct web fetch | `packages/tools/src/tools/direct-web-fetch.ts` | `response.arrayBuffer()` precedes the post-read check | Stream through a bounded HTTP adapter; preserve the existing 5 MiB policy |
| Exa web search | `packages/tools/src/tools/exa-web-search.ts` | success and error bodies use `response.text()` | Reuse the bounded HTTP adapter with the existing 4 MiB acquisition default |
| Code search | `packages/tools/src/tools/codesearch.ts` | success and error bodies use `response.text()` | Reuse the bounded HTTP adapter with the existing 4 MiB acquisition default |
| GitHub tool | injected GitHub broker invokes `gh`; `packages/tools` owns no HTTP body loop | no LLxprt-owned HTTP response body in this tool path | Audit evidence only; no transport change |
| MCP stdio/SSE/streamable HTTP | `@modelcontextprotocol/sdk` v1.29.0 | SDK parses/materializes messages before `McpCallableTool` receives the result | Validate one aggregate budget immediately after SDK `callTool()` returns; fail the call on overflow |

The installed MCP SDK exposes timeout and queue-size options but no message-byte,
response-byte, or frame-size option on `Client`, `StdioClientTransport`,
`SSEClientTransport`, or `StreamableHTTPClientTransport`. LLxprt owns none of
those transport read loops. A pre-materialization MCP cap is therefore not
implementable in this issue without replacing/wrapping an SDK transport or
changing dependencies, both outside the accepted architecture. This limitation
will be stated in the PR and tracked separately; it does not weaken the owned
HTTP fix.

## Reused Contracts and Adapter Boundary

- Reuse `ByteBudget`, `createByteBudget`, `createDefaultByteBudget`,
  `BoundedStreamCollector`, `AcquisitionResult`, and truncation metadata from
  `@vybestack/llxprt-code-tools/acquisition.js`.
- Add only an HTTP-specific adapter in `packages/tools`; do not add HTTP, MCP,
  SDK, settings, or error-policy concerns to the acquisition primitives.
- The HTTP adapter owns stream iteration, `Content-Length` early rejection,
  abort handling, and stream cleanup. It returns bounded acquisition data;
  each tool owns its error/result wording.
- MCP reuses the validated byte budget but fails atomically. It must never use
  head/tail truncation because partial text or base64 would produce malformed
  protocol content.
- `packages/mcp` gains no runtime dependency on `packages/core` and no new
  dependency. Existing unrelated imports are not refactored in this issue.

## Accepted Behavior and Boundary Cases

### AC-01: Direct HTTP streaming cap

**Given** a direct-web-fetch response with no `Content-Length` or chunked
transfer encoding, **when** cumulative body bytes exceed the existing 5 MiB
budget, **then** reading stops during stream acquisition, the body is closed,
and the tool returns a clear fetch error without producing partial content.

Evidence:
- a real local HTTP response without `Content-Length` exceeds the cap;
- the server cannot complete delivery before the client closes the body;
- no `arrayBuffer()`/`text()` materialize-first path remains.

### AC-02: `Content-Length` is optimization, not trust boundary

**Given** a response advertises a body at or below the cap but sends more,
**when** the streamed bytes exceed the cap, **then** the same overflow failure
occurs. **Given** an advertised length above the cap, **then** the body is
rejected and closed before body iteration.

### AC-03: Exact byte boundary

**Given** an HTTP body whose UTF-8 byte length equals the configured budget,
**when** it is read, **then** the complete body succeeds. **Given** one more
byte, **then** the read fails and returns no partial tool result. Byte count,
not JavaScript character count, defines the boundary.

### AC-04: Abort and cleanup

**Given** an HTTP read in progress, **when** its signal aborts, **then** the read
fails as an abort, no retry is started for body acquisition, listeners are
removed, and the Node response stream is destroyed/closed. Normal completion,
early rejected `Content-Length`, overflow, abort, and read errors all release
the reader/stream ownership they acquired.

### AC-05: Exa and code-search local acquisition caps

**Given** Exa web search or code search receives an oversized success or error
body, **when** the owned response reader runs, **then** it stops at the shared
4 MiB byte budget and returns the tool's existing structured error category
with a clear size-limit message. Valid bounded SSE responses and current
malformed-line semantics remain unchanged.

### AC-06: MCP aggregate content budget

**Given** the MCP SDK has returned a `CallToolResult`, **when** `McpCallableTool`
examines its content, **then** one shared 4 MiB byte budget covers all retained
content blocks before they are wrapped or transformed. UTF-8 text bytes and the
encoded bytes of image/audio `data`, embedded resource `text`/`blob`, and
transformed resource-link strings contribute to the same aggregate.

Exact-boundary aggregate content succeeds. One byte over, whether in one block
or accumulated across blocks, fails the whole call with a clear MCP tool error.
No partial content array is returned.

### AC-07: MCP block coverage

Oversized text, image base64, audio base64, embedded text resource, and embedded
blob resource responses each fail atomically. Multiple individually valid
blocks that collectively exceed the budget also fail. Existing valid content
transformations remain unchanged.

### AC-08: Dependency and transport boundaries

`packages/mcp` imports the acquisition budget from `packages/tools`, does not add
a runtime dependency on `packages/core`, and does not wrap or replace SDK
transports. The GitHub broker audit and the SDK-cap limitation are documented;
no broker, OAuth/discovery, provider protocol, or dependency change is made.

## Behavioral Test Matrix (Bun + `bun:test`)

Tests are written first and observed failing before production changes.
Infrastructure may be substituted, but the collector/adapter/tool under test is
real and assertions target observable results rather than mock call counts.

1. Bounded HTTP adapter reads a real local chunked response under budget.
2. Missing-`Content-Length` local response exceeds budget and closes early.
3. Advertised small `Content-Length` plus a larger stream fails on observed bytes.
4. Advertised over-limit length rejects before iteration and closes the stream.
5. Exact budget succeeds; one-byte-over fails, including multibyte UTF-8 input.
6. Abort mid-stream rejects as abort and destroys/closes the body.
7. Stream read error releases ownership and propagates the original failure.
8. Direct web fetch succeeds at the exact 5 MiB boundary and returns a structured
   size error one byte over without retrying response-body acquisition.
9. Exa success/error bodies and code-search success/error bodies return their
   existing error types when the shared 4 MiB cap is exceeded; bounded valid and
   malformed SSE cases preserve current behavior.
10. `McpCallableTool` accepts exact-boundary aggregate text.
11. It fails one-byte-over text, image, audio, embedded text, and embedded blob.
12. It fails multiple blocks whose aggregate crosses the budget and returns no
    partial transformed content.
13. Existing valid MCP mixed-block transformation tests remain green.
14. Package typecheck/build prove the tools-to-MCP dependency direction remains
    valid.

## Expected Files

- `packages/tools/src/utils/bounded-http-response.ts` (new transport adapter)
- `packages/tools/src/utils/bounded-http-response.test.ts` (new Bun behavioral fixture tests)
- `packages/tools/src/tools/direct-web-fetch.ts`
- `packages/tools/src/tools/direct-web-fetch.test.ts`
- `packages/tools/src/tools/direct-web-fetch-real-transport.bun.test.ts` (new real
  `node-fetch` transport fixture, isolated from the unit test's process-global mock)
- `packages/tools/src/tools/exa-web-search.ts`
- `packages/tools/src/tools/exa-web-search.test.ts`
- `packages/tools/src/tools/codesearch.ts`
- `packages/tools/src/tools/codesearch.test.ts`
- `packages/tools/src/tools/codesearch-endpoint.bun.test.ts` (existing endpoint
  fixture updated to provide a streamed response body)
- `packages/mcp/src/client/mcp-callable-tool.ts`
- an existing MCP Bun test file, preferably `neutral-types.test.ts` for the
  callable adapter; `mcp-tool.execute.test.ts` only if end-to-end error evidence
  is not already covered

A change outside these files requires a direct acceptance-criterion reason. No
workflow, agent-memory, quality-tool, package dependency, or public setting
change is accepted.

## Explicit Scope Triage

### In-scope

- Owned HTTP stream acquisition for direct fetch, Exa, and code search
- Aggregate MCP post-materialization validation at the earliest LLxprt-owned point
- Clear atomic overflow errors and behavioral evidence
- Documentation/tracking of the verified SDK limitation and GitHub broker boundary

### Reject

- Moving HTTP or MCP concerns into `packages/tools/src/acquisition`
- Silent truncation of MCP protocol content
- New generic network framework/package or public response-limit setting
- Replacing or wrapping MCP SDK transports when no supported cap option exists
- MCP OAuth/discovery redesign, provider streaming redesign, or unrelated cleanup
- Treating server request/token limits as an acquisition boundary

### Defer

- A pre-materialization MCP frame cap until the SDK exposes a supported option or
  a separately approved transport-ownership change is designed
- GitHub broker/subprocess output policy changes; the tool path owns no HTTP body
- Non-tool provider/auth/telemetry response readers, which are not the API-backed
  tool paths named by this issue

## Verification and Completion Gate

Run focused Bun tests during each red/green cycle, then run:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Completion additionally requires DeepThinker review, detached Open Code Review
(within the issue's review limits), triage of every finding as Blocker-Fix,
In-scope-Fix, Reject, or Defer, green CI on the candidate head, resolved PR
threads, conflict-free status, and correct ancestry. Stop when these accepted
behaviors and gates are satisfied; do not continue optional hardening or cleanup.
