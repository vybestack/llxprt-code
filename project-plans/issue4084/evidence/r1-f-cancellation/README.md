# Review round 1: scenario F

- Script: `scripts/tmux-script.issue4084-f-escape-on.llxprt.json`
- Profile: `lunahigh` (`gpt-6-luna`); code mode on; harness exit 0.
- Commit: `3b5133062041268b18c384edf49a652f410d89fd`.
- After Escape, the live card showed `Status: failed CANCELLED` and `Tool calls: 1 (1 cancelled)`. The session recording has one script run with `errorCode: CANCELLED` and one nested `run_shell_command` call.
- The captured in-session `ps` check reached `ps-check-done` without matching a `quickjs-wrapper` or `sleep 30` process. A separate process-table check after the harness exited also had no matches.
- Captures: cancelled card, process-check screen, scrollback, session recording, metrics, and final model answer.
- Behavior verification only; token counts and duration are not used as performance evidence.
