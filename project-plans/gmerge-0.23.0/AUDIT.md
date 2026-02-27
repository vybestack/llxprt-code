# Post-Implementation Audit: gmerge/0.23.0

Reconciliation of all 70 upstream commits (v0.22.0..v0.23.0).

| Upstream SHA | Decision | Status | LLxprt Commit(s) | Notes |
|--------------|----------|--------|-------------------|-------|
| `5e21c8c03c` | SKIP | SKIPPED | -- | Google-internal Code Assist telemetry |
| `db643e9166` | PICK | PENDING | | Remove hardcoded foreground colors for terminal compat |
| `26c115a4fb` | PICK | PENDING | | Remove repo-specific tips |
| `3e9a0a7628` | PICK | PENDING | | Remove debug footer message |
| `7f2d33458a` | PICK | PENDING | | no-return-await eslint rule |
| `e79b149985` | SKIP | SKIPPED | -- | Nightly version bump |
| `cc52839f19` | REIMPLEMENT | PENDING | | Hooks docs snake_case tool names |
| `ba100642e3` | NO_OP | NO_OP | -- | Already migrated to ACP SDK v0.14.1 |
| `d02f3f6809` | SKIP | SKIPPED | -- | Incompatible agent framework; filed as future A2A issue |
| `bf90b59935` | SKIP | SKIPPED | -- | Gemini 3 Flash launch (65 files, Gemini-specific) |
| `b465e12747` | SKIP | SKIPPED | -- | Gemini model availability toggle removal |
| `de7e1937f6` | SKIP | SKIPPED | -- | Gemini-specific GenerateContentConfig |
| `a6d1245a54` | SKIP | SKIPPED | -- | Gemini-specific remote flags |
| `bf6d0485ce` | SKIP | SKIPPED | -- | FlashFallback already removed from LLxprt |
| `18698d6929` | SKIP | SKIPPED | -- | Gemini-cli GitHub workflow |
| `da85aed5aa` | PICK | PENDING | | Settings dialog padding fix |
| `bb8f181ef1` | REIMPLEMENT | PENDING | | ripGrep debugLogger migration |
| `948401a450` | PICK | PENDING | | a2a-js/sdk 0.3.2 to 0.3.7 |
| `3d486ec1bf` | PICK | PENDING | | Windows clipboard image + Alt+V paste |
| `c28ff3d5a5` | SKIP | SKIPPED | -- | Gemini changelog |
| `5d13145995` | SKIP | SKIPPED | -- | ClearcutLogger telemetry |
| `6ddd5abd7b` | REIMPLEMENT | PENDING | | Slash completion eager hiding fix |
| `739c02bd6d` | REIMPLEMENT | PENDING | | History length constant |
| `bc168bbae4` | PICK | PENDING | | Table component for model stats |
| `124a6da743` | SKIP | SKIPPED | -- | Nightly version bump |
| `2b426c1d91` | SKIP | SKIPPED | -- | Incompatible agent TOML parser |
| `54466a3ea8` | REIMPLEMENT | PENDING | | Hooks friendly names and descriptions |
| `088f48d60f` | SKIP | SKIPPED | -- | Gemini-specific command file |
| `9e6914d641` | NO_OP | NO_OP | -- | Already have identical 429 handling |
| `322232e514` | REIMPLEMENT | PENDING | | Terminal background color detection |
| `60f0f19d76` | SKIP | SKIPPED | -- | Gemini-specific sensitive keyword lint |
| `2515b89e2b` | REIMPLEMENT | PENDING | | Shell env vars whitelist |
| `0c4fb6afd2` | PICK | PENDING | | Remove unnecessary dependencies |
| `edab979970` | SKIP | SKIPPED | -- | Depends on skipped executor rename |
| `70696e364b` | REIMPLEMENT | PENDING | | Command suggestions on perfect match + sort |
| `80c4225286` | SKIP | SKIPPED | -- | LLxprt already has superior /auth logout |
| `402148dbc4` | REIMPLEMENT | PENDING | | Hooks UI feedback via coreEvents |
| `1e10492e55` | PICK | PENDING | | Infinite loop in prompt completion fix |
| `e0f1590850` | PICK | PENDING | | Simplify tool confirmation labels |
| `7da060c149` | NO_OP | NO_OP | -- | Our api-reference.md already more comprehensive (623 vs 168 lines) |
| `10ba348a3a` | SKIP | SKIPPED | -- | Gemini-specific introspection agent demo |
| `419464a8c2` | PICK | PENDING | | Gate "save to policy" behind opt-in setting |
| `181da07dd9` | PICK | PENDING | | Shell mode input placeholder |
| `9383b54d50` | PICK | PENDING | | Validate OAuth resource matches MCP URL |
| `b828b47547` | SKIP | SKIPPED | -- | GEMINI_SYSTEM_MD documentation |
| `db67bb106a` | PICK | PENDING | | More robust bash command parsing logs |
| `41a1a3eed1` | REIMPLEMENT | PENDING | | CRITICAL: Hook command injection sanitization |
| `8ed0f8981f` | PICK | PENDING | | Trusted folder level validation |
| `6084708cc2` | PICK | PENDING | | Trust dialog right border overflow |
| `e64146914a` | PICK | PENDING | | Accepting-edits policy bug fix |
| `3c92bdb1ad` | SKIP | SKIPPED | -- | Nightly version bump |
| `2e229d3bb6` | REIMPLEMENT | PENDING | | JIT context memory via ContextManager |
| `8feeffb29b` | NO_OP | NO_OP | -- | LLxprt uses exit code 75 + relaunch guard; bug does not apply |
| `b923604602` | SKIP | SKIPPED | -- | ClearcutLogger for hooks |
| `8643d60b88` | SKIP | SKIPPED | -- | Nightly version bump |
| `58fd00a3df` | REIMPLEMENT | PENDING | | .llxprtignore for SearchText/ripgrep |
| `ef1e18a85a` | SKIP | SKIPPED | -- | Preview release |
| `7b772e9dfb` | SKIP | SKIPPED | -- | startupProfiler.ts does not exist in LLxprt |
| `646dc31548` | SKIP | SKIPPED | -- | Preview release |
| `bc40695ce4` | SKIP | SKIPPED | -- | Seasonal snowfall/header feature |
| `703d2e0dcc` | PICK | PENDING | | Policy persistence, confirmation-bus, shell fixes |
| `7d8ab08adb` | SKIP | SKIPPED | -- | Preview release |
| `dbcad90661` | SKIP | SKIPPED | -- | Preview release |
| `518cc1ab63` | SKIP | SKIPPED | -- | Preview release |
| `b7ad7e1035` | REIMPLEMENT | PENDING | | Quota retry with exponential backoff |
| `17fb758664` | PICK | PENDING | | Token calculation + eslint + client fix |
| `ecbab46394` | SKIP | SKIPPED | -- | Preview release |
| `42a36294a8` | SKIP | SKIPPED | -- | Patches FlashFallback (removed from LLxprt) |
| `3ff055840e` | SKIP | SKIPPED | -- | Preview release |
| `2519a7850a` | SKIP | SKIPPED | -- | Final release version bump |
