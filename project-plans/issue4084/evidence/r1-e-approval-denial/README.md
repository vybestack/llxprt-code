# Review round 1: scenario E

- Script: `scripts/tmux-script.issue4084-e-approve-deny-on.llxprt.json`
- Profile: `lunahigh` (`gpt-6-luna`); code mode on; harness exit 0.
- Commit: `3b5133062041268b18c384edf49a652f410d89fd`.
- The live card ended with `Status: failed APPROVAL_DENIED` and `Tool calls: 2 (1 ok, 1 denied)`. The recording has one script run with `errorCode: APPROVAL_DENIED` and two nested `run_shell_command` calls. The CLI completed the turn after denial; no retry script call appears in the recording.
- Captures: final card, scrollback, session recording, metrics, and final model answer.
- Behavior verification only; token counts and duration are not used as performance evidence.
