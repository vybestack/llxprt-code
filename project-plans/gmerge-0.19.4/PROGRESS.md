# PROGRESS.md — gmerge-0.19.4

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit(s) | Notes |
| ----: | ---- | --------------- | ------ | ----------------- | ----- |
| 1 | PICK | `9937fb22` `fec0eba0` `78b10dcc` `5982abef` `613b8a45` | DONE | `45494504f` `0f3bd9f4c` `95cd02828` `9b276b69b` + fix `a4794309e` | fec0eba0 NO_OP (stdio already in tree from prior sync) |
| 2 | PICK | `0f0b463a` `3370644f` `030a5ace` `d351f077` `0713c86d` | DONE | `b3ba5bac8` `01aeef3da` `db5260911` + fix `59e8ea0de` | 030a5ace SKIPPED (auth arch divergence); d351f077 NO_OP (loading phrases already exist) |
| 3 | PICK | `1e715d1e` `8c36b106` `5e218a56` `bdf80ea7` `b3fcddde` | DONE | `362ad29d1` `caaa9da2e` `c8559835f` + fixes `38b4c9626` `cd22cd852` `5a86626e1` + reimpl `892416fdd` `689a39b51` | 8c36b106 reimplemented (conflict too severe); b3fcddde NO_OP (ink already at 6.4.8) |
| 4 | PICK | `7350399a` `569c6f1d` `d53a5c4f` `d14779b2` | DONE | `74966b2a8` `ef325ffab` `d82fff1c0` `b6050f09b` | Clean picks |
| 5 | PICK | `2b41263a` `f2c52f77` `6f9118dc` | DONE | `e2bfc2c28` `371cb8b4c` `85437faee` + fix `a1634ddf3` | URL.parse fix needed remediation for parseGitHubRepoForReleases |
| 6 | REIMPLEMENT | `19d4384f` | DONE | `f6e25f4cd` | Extension docs rewritten from 95→363 lines |
| 7 | REIMPLEMENT | `c21b6899` | DONE | `5af676ac7` + fix `c584f3ba9` | /stats session subcommand added; formatting fix |
| 8 | DOCS | — | DONE | (this commit) | Final tracking docs + full verify passed |
