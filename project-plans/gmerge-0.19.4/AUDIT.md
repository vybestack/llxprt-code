# AUDIT.md — gmerge-0.19.4 Post-Implementation Reconciliation

| Upstream SHA | Decision | LLxprt Commit(s) | Notes |
| -----------: | -------- | ----------------- | ----- |
| `9937fb22` | PICKED | `45494504f` | MCP lenient schema validator |
| `3e50be16` | SKIPPED | — | Banner persistence; different LLxprt banner logic |
| `f92e79eb` | SKIPPED | — | Upstream HTTP proxy docs |
| `fec0eba0` | NO_OP | — | Move stdio; already in tree from prior sync (`75abfc44a`) |
| `85bc25a7` | SKIPPED | — | Nightly version bump |
| `78b10dcc` | PICKED | `0f3bd9f4c` | Skip pre-commit hooks for shadow repo |
| `5982abef` | PICKED | `95cd02828` | Wide-character cursor fix |
| `613b8a45` | PICKED | `9b276b69b` | Bash @P prompt detection |
| `61582678` | SKIPPED | — | Config test coverage; high conflict risk |
| `8d082a90` | SKIPPED | — | Privacy notice tests; different LLxprt notices |
| `0f0b463a` | PICKED | `b3ba5bac8` | Typo fixes |
| `3370644f` | PICKED | `01aeef3da` | Zed integration tests (1,121 lines) |
| `b9766155` | SKIPPED | — | Session browser; tracked by #1385 |
| `030a5ace` | SKIPPED | — | Auth flow fixes; massive architecture divergence (profile-based multi-provider vs Gemini-only) |
| `aeffa2a4` | SKIPPED | — | Gemini-only model availability service |
| `d72f35c2` | SKIPPED | — | Grammar typo in tutorials.md |
| `d351f077` | NO_OP | — | Custom loading phrases; usePhraseCycler already exists in LLxprt |
| `19d4384f` | REIMPLEMENTED | `f6e25f4cd` | Extension docs parity (95→363 lines) |
| `fe67ef63` | SKIPPED | — | Thinking budget on fallback; Gemini-specific |
| `99c5bf2e` | SKIPPED | — | useModelRouter removal; already done in LLxprt |
| `0713c86d` | PICKED | `db5260911` | Multiline JS object rendering in docs |
| `64eb14ab` | SKIPPED | — | ClearcutLogger exp ID; telemetry removed |
| `9f9a2fa8` | SKIPPED | — | ClearcutLogger client ID; telemetry removed |
| `1e715d1e` | PICKED | `362ad29d1` | Bracketed paste restoration |
| `42c2e1b2` | SKIPPED | — | Model config aliases; no modelConfigService |
| `8c36b106` | REIMPLEMENTED | `892416fdd` `689a39b51` | BaseLlmClient.generateContent; cherry-pick conflicts too severe |
| `5e218a56` | PICKED | `caaa9da2e` | Alternate buffer off by default |
| `bdf80ea7` | PICKED | `c8559835f` `38b4c9626` `cd22cd852` | Extension stdout/stderr patching fix + test fixes |
| `e205a468` | SKIPPED | — | UI component test coverage; high conflict |
| `b3fcddde` | NO_OP | — | Ink 6.4.6 update; LLxprt already at 6.4.8 |
| `dadd606c` | SKIPPED | — | Nightly version bump |
| `e177314a` | SKIPPED | — | Nightly version bump |
| `c2a741ee` | SKIPPED | — | Nightly version bump |
| `7350399a` | PICKED | `74966b2a8` | PDF context overflow warning fix |
| `569c6f1d` | PICKED | `ef325ffab` | Extension explore messaging |
| `95693e26` | SKIPPED | — | Massive test coverage; 47 files, too divergent |
| `c21b6899` | REIMPLEMENTED | `5af676ac7` `c584f3ba9` | /stats session subcommand + formatting fix |
| `e50bf6ad` | SKIPPED | — | Compression migration; LLxprt has different system |
| `f6ee025c` | SKIPPED | — | Hook telemetry; LLxprt has independent hooks |
| `d53a5c4f` | PICKED | `d82fff1c0` | Config/package improvements |
| `20340987` | SKIPPED | — | Hook event handling; LLxprt has independent hooks |
| `5411f4a6` | SKIPPED | — | Hook lifecycle; LLxprt has independent hooks |
| `d14779b2` | PICKED | `b6050f09b` | Alternate system prompt bool |
| `ba0e053f` | SKIPPED | — | Default compression config; depends on e50bf6ad |
| `87712a0a` | SKIPPED | — | Gemini model policy/fallback chains |
| `f6d97d44` | SKIPPED | — | Empty commit (no file changes) |
| `c8540b57` | SKIPPED | — | Model availability setting; service skipped |
| `7f67c7f9` | SKIPPED | — | Nightly version bump |
| `404a4468` | SKIPPED | — | Remove console.error; fallback handler doesn't exist |
| `2b41263a` | PICKED | `e2bfc2c28` | $schema in settings.schema.json |
| `f2c52f77` | PICKED | `371cb8b4c` | Non-GitHub SCP URLs for extensions |
| `098e5c28` | SKIPPED | — | Resume stdin prompt; tracked by #1385 |
| `94c3eecb` | SKIPPED | — | /resume slash command; tracked by #1385 |
| `d0b6701f` | SKIPPED | — | Session management docs; tracked by #1385 |
| `6f9118dc` | PICKED | `85437faee` `a1634ddf3` | URL.parse Node.js < v22 fix + remediation for parseGitHubRepoForReleases |
| `d8a3d08f` | SKIPPED | — | Flash fallback for TerminalQuota; removed |
| `03845198` | SKIPPED | — | Upstream README badge |
| `acf5ed59` | SKIPPED | — | Databricks auth; Gemini-specific proxy |
| `d2a6cff4` | SKIPPED | — | MCP SDK 1.23.0; evaluate independently |
| `e1ea2480` | SKIPPED | — | Release v0.19.0-preview.0 |
| `403d29c6` | SKIPPED | — | SessionBrowser test fix; tracked by #1385 |
| `90a5dc3d` | SKIPPED | — | Release v0.19.0-preview.1 |
| `933e0dc8` | SKIPPED | — | Release v0.19.0 |
| `6169ef04` | SKIPPED | — | Release-branch patch (ThemeDialog) |
| `578c4974` | SKIPPED | — | Release v0.19.1 |
| `95f9032b` | SKIPPED | — | Release-branch patch (shellExecution) |
| `a35d001f` | SKIPPED | — | Release v0.19.2 |
| `ee6b01f9` | SKIPPED | — | Release-branch patch (shellExecution) |
| `de13a2cc` | SKIPPED | — | Release v0.19.3 |
| `93511487` | SKIPPED | — | Release-branch patch (a2a task) |
| `54c90d73` | SKIPPED | — | Release v0.19.4 |

## Summary

- **PICKED**: 18 upstream commits landed (some with remediation fixes)
- **REIMPLEMENTED**: 3 upstream commits reimplemented (8c36b106, 19d4384f, c21b6899)
- **SKIPPED**: 47 upstream commits skipped (Gemini-specific, telemetry, version bumps, releases, session features deferred to #1385)
- **NO_OP**: 3 upstream commits were no-ops (fec0eba0, d351f077, b3fcddde — functionality already in LLxprt)
