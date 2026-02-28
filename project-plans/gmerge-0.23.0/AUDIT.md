# gmerge/0.23.0 Audit

## Upstream Range: v0.22.0..v0.23.0

## Summary

- **Total batches:** 22
- **All passed:** Yes
- **Upstream commits processed:** 30
- **Upstream commits applied:** 28
- **Upstream commits skipped:** 2 (26c115a4fb tips removal — already done; 7f2d33458a eslint no-return-await — deferred)
- **Final test count:** 809+ test files, 12,824+ tests, all passing
- **Lint/typecheck/build:** All clean
- **Smoke test:** Passes

## Per-Batch Audit

| Batch | Upstream SHA(s) | Type | Outcome | LLxprt Commit(s) | Notes |
|-------|-----------------|------|---------|-------------------|-------|
| B1 | cc52839f19 | REIMPLEMENT | PASS | f40b100ba | Hook docs snake_case tool names |
| B2 | db643e9166, 26c115a4fb, 3e9a0a7628, 7f2d33458a, da85aed5aa | PICK x5 | PASS (3/5) | 24a74539b, ecbaca0d5, d0e03eaba | 2 skipped: tips already deleted, eslint mass change deferred |
| B3 | bb8f181ef1 | REIMPLEMENT | PASS | dce02e28e | ripGrep debugLogger |
| B4 | 948401a450, 3d486ec1bf | PICK x2 | PASS | 15a3bb670, 2f8095af5, 387b5b0ae | Windows clipboard fix-up needed |
| B5 | 6ddd5abd7b | REIMPLEMENT | PASS | 1a385d9e2 | Slash completion eager fix |
| B6 | 739c02bd6d | REIMPLEMENT | PASS | 9c2883a4a | History length constant |
| B7 | bc168bbae4 | PICK x1 | PASS | d61503017 | Table component |
| B8 | 54466a3ea8 | REIMPLEMENT | PASS | 6645697c0 | Hooks friendly names |
| B9 | 322232e514 | REIMPLEMENT (SELECTIVE) | PASS | 3da1b20a8 | Background color detection — selective scope |
| B10 | 2515b89e2b | REIMPLEMENT | PASS | b0ea19422 | Shell env vars allowlist |
| B11 | 0c4fb6afd2, 1e10492e55 | PICK x2 | PASS | 30fe4afe1, 58a0ce01e | Remove deps, fix prompt loop |
| B12 | 70696e364b | REIMPLEMENT | PASS | d7eafe844 | Command suggestions on perfect match |
| B13 | 402148dbc4 | REIMPLEMENT | PASS | ca8967a07 | Hooks UI feedback |
| B14 | e0f1590850 | PICK x1 | PASS | 831786d7f | Tool confirmation labels |
| B15 | 2e229d3bb6 | REIMPLEMENT | PASS | 7c47188d8 | JIT context memory / ContextManager |
| B16 | 419464a8c2, 181da07dd9, 9383b54d50, db67bb106a | PICK x4 | PASS | d9348ed1a..23455054b | Security: approval gate, shell placeholder, OAuth, parsing logs |
| B17 | 41a1a3eed1 | REIMPLEMENT | PASS | 0a323ce83 | CRITICAL: Hook injection fix |
| B18 | 8ed0f8981f, 6084708cc2, e64146914a | PICK x3 | PASS | ff480194a..0defba2d4 | Folder trust, dialog border, accepting-edits (smart-edit skipped) |
| B19 | 58fd00a3df | REIMPLEMENT | PASS | 467570b16 | .llxprtignore support |
| B20 | 703d2e0dcc | PICK x1 | PASS | f1b751bbe | Policy/shell patch |
| B21 | b7ad7e1035 | REIMPLEMENT | PASS | 8c4607197 | Quota retry exponential backoff |
| B22 | 17fb758664 | PICK x1 | PASS | 7bab0fd0d | Token calc patch (FINAL) |

## Non-Negotiable Checks (Final)

- No new `@google/gemini-cli-core` imports introduced (pre-existing refs in tmp/ are out of scope)
- No new `.gemini/` paths introduced
- No new `ClearcutLogger` references introduced
- No new `GEMINI.md` references in production code
- Copyright headers preserved (Google LLC on Google-sourced files)
- No `smart-edit.ts` re-introduced
- `LLXPRT_PROJECT_DIR` used exclusively (no GEMINI_PROJECT_DIR/CLAUDE_PROJECT_DIR)
