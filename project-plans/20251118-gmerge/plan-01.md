# 20251118-gmerge Cherry-pick Execution Plan (Plan 01)

## Batch strategy
- Work in five-commit batches as recommended in `dev-docs/cherrypicking.md`.
- After every batch, run the full quality gate (lint → build → test → format) and resolve any issues before moving on.
- Commits flagged as higher risk (tool-chain/abort-signal plumbing or Windows install fixes) are isolated into their own batches.
- Final step: create the empty merge marker with `-s ours` to record that llxprt is synced through upstream tag `v0.6.1` (per the merge-marker instructions in `dev-docs/cherrypicking.md`).

## Batch breakdown

### Batch 1 (stability + security scaffolding)
1. `34cd554a3` – Remove `node-fetch` from externals.
2. `107537c34` – Fix drag-and-drop for macOS Terminal 2.
3. `aea6230bc` – Harden process walking so startup does not fail when listing processes.
4. `af52b04e6` – Add the shared OAuth credential class.
5. `918ab3c2e` – Make OAuth token storage implement the shared interface.

### Batch 2 (trust/config + IDE integration)
6. `036f3a7f9` – Remove special handling for the `folderTrust` flag.
7. `e28a043f3` – Hybrid/encrypted token storage support.
8. `12f584fff` – Validate IDE auth tokens inside the companion server.
9. `079526fd3` – Fix mixed-input crash handling.
10. `2cc0c1a80` – Pass auth tokens from CLI to IDE client.

### Batch 3 (configuration plumbing)
11. `80fa4a310` – Make trusted-folders file path configurable.
12. `d2f87d15e` – Include `workspacePath` in extension variables.
13. `726d2c427` – Add `sso://` protocol support in extensions.
14. `0559040c0` – Fix the automatic compression bug.
15. `35067f12e` – Fix Windows extension install path/permission issues.

### Batch 4 (Abort-signal & edit-tool handling) – **single commit, high risk**
16. `ee0628cb3` – Wire AbortSignal through retry logic and tool execution. (Single-commit batch due to the breadth of changes touching the tool pipeline.)

### Batch 5 (tool cancel + OAuth registration) – **single commit, high risk**
17. `4cab85a8e` – Allow edit-tool executions to be cancelled cleanly. (Isolated because it touches tool scheduler state.)

### Batch 6 (OAuth discovery/registration improvements) – **single commit**
18. `f30781364` – Use provided registration endpoints before performing OAuth discovery for MCP servers.

## Finalization
1. Re-run the full quality gate after Batch 6.
2. Create the merge marker documenting that llxprt-code is synchronized with upstream through commit `v0.6.1` (hash of tag) using:
   ```bash
   git merge -s ours --no-ff v0.6.1 -m "Merge upstream gemini-cli up to v0.6.1

   Cherry-picked commits:
   - 34cd554a3 … f30781364

   Maintains llxprt multi-provider/customizations while tracking upstream improvements."
   ```
3. Capture the results/quality logs per `dev-docs/cherrypicking.md`, then push the branch and open the PR.
