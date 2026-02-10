# Shell Recovery Guide (`posix_spawnp failed`)

This guide is for restoring command execution so final branch wrap-up can continue.

## Symptom

Agent-side command execution fails immediately with:

- `posix_spawnp failed`

Because `run_shell_command` internally uses `bash -c ...`, this usually indicates the runtime cannot spawn `bash` (or cannot resolve it via `PATH`).

## Quick checks to run manually in your own terminal

Run these directly in your local shell (outside the agent):

1. Check basic shell availability:

- `which bash`
- `ls -l /bin/bash`
- `/bin/bash -lc 'echo bash-ok'`

2. Check PATH and environment sanity:

- `echo "$PATH"`
- `env | grep -E '^(PATH|SHELL)='`

3. Check process/resource limits:

- `ulimit -a`
- `ps aux | wc -l`

4. Check if a minimal spawn works in Node:

- `node -e "require('node:child_process').spawn('bash',['-lc','echo spawn-ok'],{stdio:'inherit'})"`

## If checks fail

- If `which bash` or `/bin/bash` fails, restore shell executable/path.
- If Node spawn fails but shell commands work interactively, restart the agent/terminal session to refresh inherited environment.
- If process/resource limits are exhausted, reduce process count and retry.

## After recovery

Once shell execution works again, run:

- `project-plans/20260129gmerge/FINALIZE_ON_RECOVERY.sh`

That script performs:

- git review (`status/diff/log`)
- commit using prepared draft message
- push branch
- create PR with prepared branch-wide body
- watch PR checks

## Prepared artifacts

- `project-plans/20260129gmerge/COMMIT_MESSAGE_DRAFT.md`
- `project-plans/20260129gmerge/PR_BODY_DRAFT.md`
- `project-plans/20260129gmerge/VERIFICATION_SUMMARY.md`
- `project-plans/20260129gmerge/CHANGES_SUMMARY.md`
- `project-plans/20260129gmerge/CLEANUP_CHECKLIST.md`
- `project-plans/20260129gmerge/PR_CHECKLIST.md`
- `project-plans/20260129gmerge/FINALIZATION_PACKET.md`
