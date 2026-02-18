# PROGRESS.md — gmerge-0.20.2

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit(s) | Notes |
| ----: | ---- | --------------- | ------ | ----------------- | ----- |
| 1 | PICK | d97bbd53 3406dc5b 0f12d6c4 450734e3 6a43b312 | DONE | 359c73a41..5de26eaca + 04246b8db | Post-batch lint fix (unused import) |
| 2 | PICK | f98e84f0 2fe609cb f4babf17 70a48a3d 98d7238e | DONE | 71e36562f..29fb1e883 + 9e44dbf51 f0038b964 dab3ec629 | Full verify; formatting + return-await fixes |
| 3 | PICK | 1689e9b6 71b0e7ab ba864380 | DONE | 1284ff27b..1f9c0598e + cc125f519 | Post-batch fix: duplicate code, useCommandCompletion |
| 4 | REIMPLEMENT | 1187c7fd | DONE | 055fe608c | Gemini-3 prompt overrides; full verify |
| 5 | REIMPLEMENT | 4a82b0d8 | DONE | 1c1efb004 | Interactive/non-interactive/subagent prompt mode |
| 6 | REIMPLEMENT | 0d29385e | DONE | 58460743c | Shell inactivity timeout; full verify |
| 7 | REIMPLEMENT | f918af82 | DONE | 68755ca4d | Auto-execute slash commands |
| 8 | REIMPLEMENT | 558c8ece + 5bed9706 | DONE | 0c876702d | Hook integration (tool + LLM); full verify |
| 9 | REIMPLEMENT | bc365f1e + 844d3a4d | DONE | f9600bae9 | MCP server instructions |
| 10 | REIMPLEMENT | 69188c85 | DONE | fd1226801 | Stats quota display; full verify |
| 11 | REIMPLEMENT | 806cd112 | DONE | e9f314cf9 | A2A modelInfo propagation |
| 12 | REIMPLEMENT | 752a5214 | DONE | 7966fb970 + 51a0dea53 | JIT context manager; full verify; fixed prompt-service test; wired JIT into client |
| 13 | REIMPLEMENT | f9997f92 | DONE | 081822780 | Stdio hardening (EPIPE resilience) |
| 14 | REIMPLEMENT | 8872ee0a | DONE | 01280e89d | Shell env sanitization; full verify |

**Total**: 14/14 batches complete. 29 commits on gmerge/0.20.2 branch.
merge/0.20.2 branch.
