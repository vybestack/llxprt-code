# Task 17 – Batch Picks (4 commits)

**Task Type:** Batch PICK\n**Commit Count:** 4\n**Results File:** `project-plans/20250916-cherries-v2/results/task-17.md`\n
## Commits
- `a167f28e` — Fix diff stats to correctly capture the edits (tools, risk: low)
- `17044876` — Fix duplicate LOC counting in diff_stat (tools, risk: low)
- `f331e5d5` — Merge general settings from different sources (config, risk: medium)
- `c7c709fb` — Fix failing integration tests (tests, risk: medium)

## Execution Steps
1. Ensure you are on the cherry-pick branch for this cycle.
2. Cherry-pick the commits in the exact order shown:
   ```bash
git cherry-pick -x a167f28e
git cherry-pick -x 17044876
git cherry-pick -x f331e5d5
git cherry-pick -x c7c709fb
   ```
3. If any conflict occurs, resolve it while preserving llxprt multi-provider patterns and document the resolution in the results file.
4. Copy `RESULTS-TEMPLATE.md` to `project-plans/20250916-cherries-v2/results/task-17.md` (or update it if it already exists) and fill in every section before running validation.
5. Run the automated quality gate and stop immediately on failure:
   ```bash
   ./project-plans/20250916-cherries-v2/run-quality-gates.sh project-plans/20250916-cherries-v2/results/task-17.md
   ```
6. Only proceed when the script exits 0. If it fails, fix the issue, update the results file, and rerun.
7. Stage the updated results/log files once everything passes.
8. Ask Claude to run the Codex audit (10-minute shell timeout):
   ```bash
   CLAUDE_PROMPT=$(cat <<'PROMPT'
   codex exec "Evaluate the cherry-pick task results in project-plans/20250916-cherries-v2/results/task-17.md. Check:
     1. Were ALL commits listed in the task file actually cherry-picked? Use \"git log --oneline -n 4\" to verify. List any missing commits.
     2. Review the actual code changes with \"git diff HEAD~4\" - do they match what the task intended? Check for:
        - Unauthorized settings migrations or schema changes
        - Package name changes beyond @vybestack/llxprt-code-core replacements
        - Removal of multi-provider support code
        - Addition of Gemini-specific code that breaks provider abstraction
     3. Did the quality gate script pass? Check the log file at project-plans/20250916-cherries-v2/.quality-logs/task-17 for any failures.
     4. Run "npm test" and verify ZERO test failures. List all failing tests if any.
     5. Run "npm run lint" and "npm run typecheck" - must have ZERO errors.
     6. Check "git status" - working tree MUST be clean with no uncommitted changes.
     7. Does the results file document all conflicts and resolutions?

     VERDICT: Provide one of these EXACT responses:
     - 'DO NOT CONTINUE. YOU MUST FIX: [specific issues]' if ANY check fails
     - 'THIS PASSED. YOU MAY PROCEED TO NEXT TASK' if ALL checks pass

     Be extremely critical. Any test failure, lint error, or unauthorized change means DO NOT CONTINUE."
   PROMPT
   )
   claude --dangerously-bypass-approvals-and-sandbox \
     -C "$REPO_ROOT" \
     exec --timeout 600000 "$CLAUDE_PROMPT"
   ```
   Proceed only if Claude replies `THIS PASSED. YOU MAY PROCEED TO NEXT TASK`.



## Reminders
- Do not skip tests, lint, typecheck, or build. The script enforces these gates.
- Keep commit messages untouched; `-x` adds the upstream hash reference automatically.
- Call out any adaptation made for llxprt (branding, provider handling, settings shape) in the results file.
