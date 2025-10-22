## 2025-10-22 Upstream Main Integration Plan

### Objective
Bring the upstream `main` branch changes onto the current `agentic` branch without losing any of the agentic/stateless-provider/subagent work we have already delivered. We will replay the missing upstream commits via cherry-pick, grouped into logical task batches, resolve conflicts deliberately, and finish with a “marking commit” that records the upstream commit SHA we synchronized with (per `dev-docs/cherrypicking.md`).

### Strategy
1. Cherry-pick upstream commits in chronological order (oldest → newest) using the groupings documented in the task files below. Skip merge commits; apply only the direct commits listed.
2. Limit each task to at most five low-risk commits. Conflict-prone or high-impact changes are isolated into their own task file so we can focus on them.
3. For every conflict:
   - Preserve our stateless-provider, subagent, bootstrap, and provider-auth work.
   - Integrate upstream fixes so behaviour remains current (especially in provider/auth, CLI runtime, MCP tooling).
   - Add notes back into the task file documenting any manual adjustments.
4. After all tasks are complete and tests pass, create the marking commit to record the upstream main SHA we synchronized to (see `task-08-mark-upstream-sync.md`).

### Task Index
- `task-01-cli-rendering-and-output.md` – CLI rendering & output fixes (resize handling, shell output, tool output limiter, read-many-files, compression precheck).
- `task-02-qwen-streaming-and-queueing.md` – Qwen tool streaming, prompt queueing, Windows tokenizer workaround.
- `task-03-postinstall-and-tool-registry.md` – Postinstall script for npx, tool registry race fixes, `--prompt-interactive` behaviour.
- `task-04-release-chore-updates.md` – Version bump, contributor credits, sandbox image publication.
- `task-05-mcp-tool-namespacing.md` – MCP tool namespacing and related tests.
- `task-06-model-param-and-todo-fixes.md` – Model parameter propagation, `/todo_pause` dialog fix.
- `task-07-oauth-and-gemini-config.md` – Lazy OAuth initialization, Gemini provider base-config call.
- `task-08-mark-upstream-sync.md` – Final marking commit instructions.


