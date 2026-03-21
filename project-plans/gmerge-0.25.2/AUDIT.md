# Audit: gmerge-0.25.2

Post-implementation reconciliation. Update continuously as batches complete.

## Upstream Range

- **Range:** `v0.24.5..v0.25.2`
- **Total upstream commits audited:** 169
- **Frozen disposition counts from `CHERRIES.md`:**
  - PICK: 48
  - SKIP: 78
  - REIMPLEMENT: 28
  - NO_OP: 15

## Execution Status

- Batch execution has **not started** yet.
- `PROGRESS.md` is still fully unstarted (`TODO` for all 55 batches).
- `LLxprt Commit(s)` fields below are intentionally blank until each batch lands.

## Audit Update Rules

- For every executed batch, fill in the corresponding `LLxprt Commit(s)` values as soon as commits exist.
- Record format-only follow-up commits, fix commits, or remediation commits in the same row as the owning upstream SHA(s).
- If an execution-time discovery forces a deviation, document it in `NOTES.md` and reference that note from the relevant row here.
- SKIP and NO_OP rows are pre-seeded from the frozen planning decisions and normally should not change.

## PICK Commits (48)

| # | Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|---|-------------|----------|-------------------|-------|
| 1 | `da85e3f8f23` | PICKED | | Batch B1 |
| 4 | `982eee63b61` | PICKED | | Batch B1 |
| 5 | `a26463b056d` | PICKED | | Batch B1 |
| 7 | `2d683bb6f8a` | PICKED | | Batch B1 |
| 10 | `8f9bb6bccc6` | PICKED | | Batch B4 |
| 14 | `57012ae5b33` | PICKED | | Batch B6 |
| 28 | `1bd4f9d8b6f` | PICKED | | Batch B10 |
| 31 | `d48c934357c` | PICKED | | Batch B10 |
| 33 | `3e2f4eb8ba1` | PICKED | | Batch B10 |
| 34 | `722c4933dc3` | PICKED | | Batch B10 |
| 46 | `1a4ae413978` | PICKED | | Batch B15 |
| 47 | `f8138262fa7` | PICKED | | Batch B16 |
| 48 | `fbfad06307c` | PICKED | | Batch B16 |
| 50 | `01d2d437372` | PICKED | | Batch B16 |
| 54 | `e5f7a9c4240` | PICKED | | Batch B16 |
| 61 | `4ab1b9895ad` | PICKED | | Batch B16 |
| 67 | `88f1ec8d0ae` | PICKED | | Batch B20 |
| 71 | `8bc3cfe29a6` | PICKED | | Batch B22 |
| 72 | `c1401682ed0` | PICKED | | Batch B22 |
| 75 | `14f0cb45389` | PICKED | | Batch B22 |
| 78 | `ea7393f7fd5` | PICKED | | Batch B24 |
| 79 | `e04a5f0cb0e` | PICKED | | Batch B24 |
| 81 | `1fb55dcb2e0` | PICKED | | Batch B24 |
| 96 | `93b57b82c10` | PICKED | | Batch B28 |
| 100 | `64c75cb767c` | PICKED | | Batch B30 |
| 106 | `15891721ad0` | PICKED | | Batch B33 |
| 108 | `64cde8d4395` | PICKED | | Batch B34 |
| 109 | `3b678a4da0f` | PICKED | | Batch B35 |
| 113 | `8437ce940a1` | PICKED | | Batch B35 |
| 114 | `e049d5e4e8f` | PICKED | | Batch B35 |
| 117 | `95d9a339966` | PICKED | | Batch B36 |
| 118 | `2e8c6cfdbb8` | PICKED | | Batch B37 |
| 119 | `ca6786a28bd` | PICKED | | Batch B38 |
| 120 | `e9c9dd1d672` | PICKED | | Batch B39 |
| 123 | `8d3e93cdb0d` | PICKED | | Batch B40 |
| 125 | `2fc61685a32` | PICKED | | Batch B42 |
| 127 | `6adae9f7756` | PICKED | | Batch B43 |
| 133 | `91fcca3b1c7` | PICKED | | Batch B47 |
| 134 | `e931ebe581b` | PICKED | | Batch B47 |
| 137 | `e8be252b755` | PICKED | | Batch B49 |
| 142 | `c7c409c68fb` | PICKED | | Batch B49 |
| 143 | `778de55fd8c` | PICKED | | Batch B49 |
| 144 | `8dbaa2bceaf` | PICKED | | Batch B49 |
| 145 | `eda47f587cf` | PICKED | | Batch B50 |
| 152 | `bb6c5741443` | PICKED | | Batch B53 |
| 157 | `f6a5fa0e03a` | PICKED | | Batch B53 |
| 158 | `ea0e3de4302` | PICKED | | Batch B54 |
| 163 | `217f2775805` | PICKED | | Batch B55 |

## REIMPLEMENT Commits (28)

| # | Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|---|-------------|----------|-------------------|-------|
| 8 | `5fe5d1da467` | REIMPLEMENTED | | Batch B2 — see `5fe5d1da467-plan.md` |
| 9 | `416d243027d` | REIMPLEMENTED | | Batch B3 — see `416d243027d-plan.md` |
| 12 | `97b31c4eefa` | REIMPLEMENTED | | Batch B5 — see `97b31c4eefa-plan.md` |
| 15 | `c64b5ec4a3a` | REIMPLEMENTED | | Batch B7 — see `c64b5ec4a3a-plan.md` |
| 17 | `4c961df3136` | REIMPLEMENTED | | Batch B8 — see `4c961df3136-plan.md` |
| 18 | `17b3eb730a9` | REIMPLEMENTED | | Batch B9 — see `17b3eb730a9-plan.md` |
| 35 | `030847a80a4` | REIMPLEMENTED | | Batch B11 — see `030847a80a4-plan.md` |
| 39 | `97ad3d97cba` | REIMPLEMENTED | | Batch B12 — see `97ad3d97cba-plan.md` |
| 40 | `660368f2490` | REIMPLEMENTED | | Batch B13 — see `660368f2490-plan.md` |
| 41 | `eb3f3cfdb8a` | REIMPLEMENTED | | Batch B14 — see `eb3f3cfdb8a-plan.md` |
| 63 | `18dd399cb57` | REIMPLEMENTED | | Batch B17 — see `18dd399cb57-plan.md` |
| 64 | `e1e3efc9d04` | REIMPLEMENTED | | Batch B18 — see `e1e3efc9d04-plan.md` |
| 65 | `41e627a7ee4` | REIMPLEMENTED | | Batch B19 — see `41e627a7ee4-plan.md` |
| 70 | `77e226c55fe` | REIMPLEMENTED | | Batch B21 — see `77e226c55fe-plan.md` |
| 77 | `c7d17dda49d` | REIMPLEMENTED | | Batch B23 — see `c7d17dda49d-plan.md` |
| 84 | `b08b0d715b5` | REIMPLEMENTED | | Batch B25 — see `b08b0d715b5-plan.md` |
| 86 | `461c277bf2d` | REIMPLEMENTED | | Batch B26 — see `461c277bf2d-plan.md` |
| 95 | `0e955da1710` | REIMPLEMENTED | | Batch B27 — see `0e955da1710-plan.md` |
| 97 | `9703fe73cf9` | REIMPLEMENTED | | Batch B29 — see `9703fe73cf9-plan.md` |
| 101 | `950244f6b00` | REIMPLEMENTED | | Batch B31 — see `950244f6b00-plan.md` |
| 105 | `8a2e0fac0d8` | REIMPLEMENTED | | Batch B32 — see `8a2e0fac0d8-plan.md` |
| 124 | `c572b9e9ac6` | REIMPLEMENTED | | Batch B41 — see `c572b9e9ac6-plan.md` |
| 128 | `304caa4e43a` | REIMPLEMENTED | | Batch B44 — see `304caa4e43a-plan.md` |
| 129 | `a6dca02344b` | REIMPLEMENTED | | Batch B45 — see `a6dca02344b-plan.md` |
| 132 | `aa524625503` | REIMPLEMENTED | | Batch B46 — see `aa524625503-plan.md` |
| 135 | `92e31e3c4ae` | REIMPLEMENTED | | Batch B48 — see `92e31e3c4ae-plan.md` |
| 150 | `8030404b08b` | REIMPLEMENTED | | Batch B51 — see `8030404b08b-plan.md` |
| 151 | `66e7b479ae4` | REIMPLEMENTED | | Batch B52 — see `66e7b479ae4-plan.md` |

## SKIP Commits (78)

These rows are frozen from `CHERRIES.md` and normally remain unchanged during execution.

| # | Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|---|-------------|----------|-------------------|-------|
| 2 | `521dc7f26c3` | SKIPPED | | Telemetry / Clearcut |
| 3 | `b54215f0a55` | SKIPPED | | Release-only bump |
| 6 | `7956eb239e8` | SKIPPED | | Upstream-specific home/test isolation |
| 11 | `d1eb87c81ff` | SKIPPED | | keytar does not match LLxprt keyring stack |
| 13 | `db99beda369` | SKIPPED | | Superseded by revert / later reimplementation |
| 16 | `143bb63483a` | SKIPPED | | Telemetry |
| 20 | `a1dd19738e3` | SKIPPED | | Auto model routing out of scope |
| 21 | `d5996fea999` | SKIPPED | | Upstream CI workflow |
| 22 | `0be8b5b1ed2` | SKIPPED | | Gemini quota dialog UX |
| 23 | `1c77bac146a` | SKIPPED | | A2A deferred to #1675 |
| 24 | `bd77515fd93` | SKIPPED | | Repo workflow automation |
| 25 | `d4b418ba01f` | SKIPPED | | Upstream cli-help agent architecture |
| 26 | `51d3f44d510` | SKIPPED | | Upstream changelog / release docs |
| 27 | `1aa35c87960` | SKIPPED | | Absent cli_help agent |
| 29 | `dd04b46e86d` | SKIPPED | | CI for forks |
| 30 | `41cc6cf105d` | SKIPPED | | Workflow tuning |
| 32 | `aca6bf6aa03` | SKIPPED | | Paid Gemini upgrade UX |
| 37 | `eb75f59a96e` | SKIPPED | | Diverged model/profile architecture |
| 38 | `cf021ccae46` | SKIPPED | | A2A deferred to #1675 |
| 43 | `76d020511fd` | SKIPPED | | Minor upstream docs |
| 49 | `16da6918cb5` | SKIPPED | | Diverged scheduler refactor |
| 51 | `41a8809280f` | SKIPPED | | Automatic model routing banned |
| 52 | `7e02ef697dd` | SKIPPED | | Upstream /agents command |
| 55 | `d75792703a0` | SKIPPED | | GitHub-specific env redaction behavior |
| 56 | `e51f3e11f1f` | SKIPPED | | Workflow config |
| 57 | `26505b580cc` | SKIPPED | | Upstream docs reshaping |
| 58 | `a7f758eb3a4` | SKIPPED | | Upstream branding docs |
| 59 | `84710b19532` | SKIPPED | | Upstream test timeout tweak |
| 62 | `ffb80c2426d` | SKIPPED | | Telemetry tooling |
| 64 | `6166d7f6ec6` | SKIPPED | | Workflow guard |
| 65 | `f1ca7fa40a2` | SKIPPED | | Workflow guard |
| 66 | `aa480e5fbbb` | SKIPPED | | Gemini-model constants churn |
| 68 | `f7b97ef55ec` | SKIPPED | | Redundant hooks migration |
| 69 | `b9f8858bfb6` | SKIPPED | | Redundant hooks migration |
| 73 | `041463d1122` | SKIPPED | | Upstream /agents refresh |
| 74 | `ca486614233` | SKIPPED | | GEMINI_EXP / experiment override |
| 76 | `9d187e041c8` | SKIPPED | | Diverged compression architecture |
| 80 | `d74bf9ef2f2` | SKIPPED | | Google platform admin settings |
| 82 | `356f76e545d` | SKIPPED | | Legacy settings migration removal |
| 83 | `c87d1aed4c5` | SKIPPED | | Gemini quota fallback behavior |
| 85 | `b54e688c75f` | SKIPPED | | Dependency bump only |
| 87 | `3090008b1c0` | SKIPPED | | Non-interactive restart UX mismatch |
| 89 | `72dae7e0eeb` | SKIPPED | | Triage workflow cleanup |
| 90 | `d130d99ff02` | SKIPPED | | Triage workflow trigger |
| 91 | `446058cb1c7` | SKIPPED | | Triage workflow token fallback |
| 92 | `33e3ed0f6ce` | SKIPPED | | Actionlint / workflow fixes |
| 93 | `b9762a3ee1b` | SKIPPED | | Hooks experimental-note docs |
| 94 | `39b3f20a228` | SKIPPED | | Passive activity logging out of scope |
| 98 | `d315f4d3dad` | SKIPPED | | DelegateToAgentTool absent |
| 99 | `7b7f2fc69e3` | SKIPPED | | Markdown/frontmatter agents |
| 102 | `465ec9759db` | SKIPPED | | Upstream runtime sub-agent refresh |
| 103 | `ed7bcf9968e` | SKIPPED | | Reverted upstream examples change |
| 104 | `8656ce8a274` | SKIPPED | | Flash fallback / revert path |
| 110 | `2306e60be45` | SKIPPED | | PR triage performance |
| 111 | `d65eab01d25` | SKIPPED | | Google OAuth restart UX |
| 112 | `7d922420110` | SKIPPED | | cli-help agent prompt |
| 115 | `d7bff8610f8` | SKIPPED | | A2A deferred to #1675 |
| 121 | `6ef2a92233b` | SKIPPED | | Hardware telemetry |
| 122 | `548641c952a` | SKIPPED | | Upstream /agents parser feedback |
| 126 | `b81fe683258` | SKIPPED | | Smart Edit setting |
| 130 | `8faa23cea6c` | SKIPPED | | YAML-frontmatter agents docs |
| 131 | `0f7a136612e` | SKIPPED | | Cloud Monitoring telemetry docs |
| 138 | `b518125c461` | SKIPPED | | Absent AgentsStatus component |
| 141 | `d66ec38f829` | SKIPPED | | Upstream settings.json agent architecture |
| 146 | `04f65d7b4ef` | SKIPPED | | Model dialog persist-mode UX mismatch |
| 147 | `428e6028822` | SKIPPED | | A2A utility cleanup |
| 149 | `933bc5774fe` | SKIPPED | | Diverged MaxSizedBox implementation |
| 153 | `cd7a5c96045` | SKIPPED | | Release bump |
| 155 | `46079d9daae` | SKIPPED | | Upstream branding / tsconfig patch |
| 156 | `de86bccd0d7` | SKIPPED | | Release bump |
| 159 | `b1f7a7e6f7d` | SKIPPED | | Release bump |
| 160 | `6289c3ee3f6` | SKIPPED | | Extension-config feature flag patch |
| 161 | `982fd1fc294` | SKIPPED | | Release bump |
| 164 | `eb883434196` | SKIPPED | | Release bump |
| 165 | `c9dbf700433` | SKIPPED | | Release bump |
| 166 | `2a8e1a8cc1c` | SKIPPED | | Upstream auth/startup recovery patch |
| 167 | `29d4b1e6b84` | SKIPPED | | Release bump |
| 169 | `83a3b070505` | SKIPPED | | Release bump |

## NO_OP Commits (15)

These rows represent work already present or effectively neutral in LLxprt.

| # | Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|---|-------------|----------|-------------------|-------|
| 19 | `19bdd95eab6` | NO_OP | | Revert of skipped extensions-disabled attempt |
| 42 | `02cf264ee10` | NO_OP | | Extension linking already exists |
| 44 | `ced5110dab1` | NO_OP | | Trivial JSDoc typo |
| 45 | `75bc41fc20e` | NO_OP | | Trivial MCP settings typo |
| 53 | `9062a943e73` | NO_OP | | Immediately obsoleted docs fix |
| 88 | `6f7d7981894` | NO_OP | | Removed upstream sessionHookTriggers path absent locally |
| 107 | `0167392f226` | NO_OP | | Minor docs formatting |
| 116 | `b8cc414d5b3` | NO_OP | | Minor docs internal-link fix |
| 129 | `7bbfaabffa7` | NO_OP | | Already-covered MCP policy/config cleanup |
| 136 | `334285d4f6e` | NO_OP | | Extension prompt/test churn already covered locally |
| 139 | `63c918fe7de` | NO_OP | | Sticky header regression already fixed/equivalent |
| 140 | `4afd3741df7` | NO_OP | | Retry UX already present/equivalent |
| 154 | `1d5e792a411` | NO_OP | | Patch already covered by existing logic |
| 162 | `02e68e45547` | NO_OP | | Thought-part processing fix already equivalent |
| 168 | `18e854c3309` | NO_OP | | Editor patch already covered/equivalent |
