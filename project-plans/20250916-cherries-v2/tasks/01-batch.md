# Task 01 – Batch Picks (4 commits)

**Task Type:** Batch PICK\n**Commit Count:** 4\n**Results File:** `project-plans/20250916-cherries-v2/results/task-01.md`\n
## Commits
- `4b400f8c` — Fix import.meta.url polyfill for cjs build (ide, risk: low)
- `58f68288` — Create base class for handling tokens stored in files (auth, risk: medium)
- `92bb34fa` — Replace wmic with powershell for windows process (tools, risk: low)
- `fb7a34dc` — Remove settings migration console logs (config, risk: low)

## Execution Steps
1. Ensure you are on the cherry-pick branch for this cycle.
2. Cherry-pick the commits in the exact order shown:
   ```bash
git cherry-pick -x 4b400f8c
git cherry-pick -x 58f68288
git cherry-pick -x 92bb34fa
git cherry-pick -x fb7a34dc
   ```
3. If any conflict occurs, resolve it while preserving llxprt multi-provider patterns and document the resolution in the results file.
4. Copy `RESULTS-TEMPLATE.md` to `project-plans/20250916-cherries-v2/results/task-01.md` (or update it if it already exists) and fill in every section before running validation.
5. Run the automated quality gate and stop immediately on failure:
   ```bash
   ./project-plans/20250916-cherries-v2/run-quality-gates.sh project-plans/20250916-cherries-v2/results/task-01.md
   ```
6. Only proceed when the script exits 0. If it fails, fix the issue, update the results file, and rerun.
7. Stage the updated results/log files once everything passes.
8. Ask Claude to run the Codex audit (10-minute shell timeout):
   ```bash
   CLAUDE_PROMPT=$(cat <<'PROMPT'
   codex exec "Evaluate the cherry-pick task results in project-plans/20250916-cherries-v2/results/task-01.md. Check:
     1. Were ALL commits listed in the task file actually cherry-picked? Use \"git log --oneline -n 4\" to verify. List any missing commits.
     2. Review the actual code changes with \"git diff HEAD~4\" - do they match what the task intended? Check for:
        - Unauthorized settings migrations or schema changes
        - Package name changes beyond @vybestack/llxprt-code-core replacements
        - Removal of multi-provider support code
        - Addition of Gemini-specific code that breaks provider abstraction
     3. Did the quality gate script pass? Check the log file at project-plans/20250916-cherries-v2/.quality-logs/task-01 for any failures.
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
