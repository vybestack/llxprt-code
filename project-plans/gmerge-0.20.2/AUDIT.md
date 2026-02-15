# AUDIT.md — gmerge-0.20.2

Post-implementation reconciliation. Updated as batches complete.

| Upstream SHA | Decision | LLxprt Commit(s) | Notes |
| ------------ | -------- | ----------------- | ----- |
| d97bbd53 | PICKED | 359c73a41 | Batch 1 |
| 3406dc5b | PICKED | 3bfe562a6 | Batch 1 |
| 0f12d6c4 | PICKED | bf1edc599 | Batch 1 — MCP auth headers |
| 450734e3 | PICKED | 609c9eb94 | Batch 1 — LICENSE revert |
| 6a43b312 | PICKED | 5de26eaca | Batch 1 — telemetry finish_reasons |
| f98e84f0 | PICKED | 71e36562f | Batch 2 |
| 2fe609cb | PICKED | b0fdbc222 | Batch 2 — EPIPE fix |
| f4babf17 | PICKED | 29fb1e883 | Batch 2 — async error handling |
| 70a48a3d | PICKED | bfd242838 | Batch 2 — markdown rendering |
| 98d7238e | PICKED | 8e6909e08 | Batch 2 |
| 1689e9b6 | PICKED | 1f9c0598e | Batch 3 — React state fix |
| 71b0e7ab | PICKED | 1284ff27b | Batch 3 — cleanup error handling |
| ba864380 | PICKED | 596763831 | Batch 3 — IDE auth |
| 1187c7fd | REIMPLEMENTED | 055fe608c | Batch 4 — gemini-3 prompts |
| 4a82b0d8 | REIMPLEMENTED | 1c1efb004 | Batch 5 — interactive mode |
| 0d29385e | REIMPLEMENTED | 58460743c | Batch 6 — inactivity timeout |
| f918af82 | REIMPLEMENTED | 68755ca4d | Batch 7 — auto-execute slash |
| 558c8ece | REIMPLEMENTED | 0c876702d | Batch 8 — hook tool integration |
| 5bed9706 | REIMPLEMENTED | 0c876702d | Batch 8 — hook LLM integration |
| bc365f1e | REIMPLEMENTED | f9600bae9 | Batch 9 — MCP instructions |
| 844d3a4d | REIMPLEMENTED | f9600bae9 | Batch 9 — always use MCP instructions |
| 69188c85 | REIMPLEMENTED | fd1226801 | Batch 10 — stats quota |
| 806cd112 | REIMPLEMENTED | e9f314cf9 | Batch 11 — A2A modelInfo |
| 752a5214 | REIMPLEMENTED | 7966fb970 | Batch 12 — JIT context manager |
| f9997f92 | REIMPLEMENTED | 081822780 | Batch 13 — stdio hardening |
| 8872ee0a | REIMPLEMENTED | 01280e89d | Batch 14 — shell env sanitization |
| 36a0a3d3 | SKIPPED | | Nightly version bump |
| e1d2653a | SKIPPED | | Gemini-specific token calc |
| 87edeb4e | SKIPPED | | Fallback/availability absent |
| b2bdfcf1 | SKIPPED | | Auth UI absent |
| 5949d563 | SKIPPED | | ConfigInitDisplay absent |
| b9dc8eb1 | SKIPPED | | Pager already cat |
| cf7f6b49 | SKIPPED | | Nightly version bump |
| 7a4280a4 | SKIPPED | | Hook test harness absent |
| 576fda18 | SKIPPED | | Session/hook test patch |
| bbd61f37 | SKIPPED | | Semantic telemetry diverged |
| f2466e52 | SKIPPED | | /clear history already present |
| 4228a751 | SKIPPED | | Web-fetch already disabled |
| 613fb2fe | SKIPPED | | Nightly version bump |
| db027dd9 | SKIPPED | | Startup profiler absent |
| 62f890b5 | SKIPPED | | Executor already stateless |
| bde8b78a | SKIPPED | | Emoji policy |
| 26f050ff | SKIPPED | | Docs ToC only |
| b4df7e35 | SKIPPED | | Availability stack absent |
| fcb85e61 | SKIPPED | | A2A logging low value |
| 784d3c6c | SKIPPED | | Issue template only |
| 4df43c80 | SKIPPED | | Screenshot only |
| 0c463e66 | SKIPPED | | Docs grammar only |
| 57296425 | SKIPPED | | Zed ACP already fixed |
| 5fa6d87c | SKIPPED | | Gemini model-config docs |
| d24e5cf3 | SKIPPED | | Docs refresh only |
| f7f04793 | SKIPPED | | Workflow label cleanup |
| 2a3c0edd | SKIPPED | | Test file absent |
| 2b1a791a | SKIPPED | | Test file absent |
| c78f2574 | SKIPPED | | GEMINI.md branding |
| aa544c40 | SKIPPED | | Session menu WIP |
| 2d935b37 | SKIPPED | | Release workflow only |
| 29085554 | SKIPPED | | Release tag |
| 356eb7ce | SKIPPED | | Shell already superseded |
| aae64683 | SKIPPED | | Release tag |
| 9d7b9e6c | SKIPPED | | Release tag |
| d0ce3c4c | SKIPPED | | Release tag |
| b05fb545 | SKIPPED | | Release tag |
| c9b9435c | SKIPPED | | Release tag |
| af894e46 | SKIPPED | | Policy already present |
| e666b26d | SKIPPED | | Release tag |
