# Issue #4084 code mode: real-model scenario evidence (Phase E)

All runs used the `lunahigh` profile (`codex` provider, `gpt-6-luna`, reasoning effort high) in the interactive CLI under tmux (`bun scripts/tmux-harness.ts --script <file>`), one run at a time, on 2026-11-14. The H subagents used `claude-haiku-5-5` through `claudecode`. No run hit a provider error or a rate limit, so no run was discarded for that reason and there were no waits.

## Summary

- **A and B, prompt that does not name code mode: code mode did not change parent context or cost, because the model never used it.** In all four such runs (A on, C, H1 and B on) `gpt-6-luna` wrote its own Python or TypeScript program and ran it with `run_shell_command`, the same approach it took with code mode off. The on runs carried 698 more tool-declaration tokens per request. Their totals differed from the off runs in both directions (A on lower than A off, B on higher than B off), mostly through the number of shell attempts and requests; single runs cannot separate that from run-to-run variance.
- **A and B, prompt that names `execute_tool_script` (supplementary runs): mixed.** On A, the parent's last request was 29,028 input tokens against 52,098 with code mode off, and total parent input was 129,792 against 200,872. On B it was higher than off: 30,257 against 26,203 on the last request and 134,613 against 73,157 in total. In both named runs the script that produced the answer made a single nested shell call that ran a host program, the same approach as the off runs. On A the model reached that script after a first script stopped at `CALL_LIMIT` (64 nested `git show` calls) and a second failed `RESULT_TOO_LARGE`.
- **C: the model did not pick code mode unprompted.** 0 of 3 runs of the A prompt with code mode on (A on, C, H1), and 0 of 1 for B.
- **D: the model avoided code mode where it should.** It answered with one direct `read_file` with code mode off and on; both answers were correct.
- **E (approval and denial):** the original run below behaved as specified, but displayed JSON on failure. The review-round-1 rerun at [`r1-e-approval-denial/`](r1-e-approval-denial/) confirmed the failed script card now displays after the second approval is denied, with `APPROVAL_DENIED` and call counts `2 (1 ok, 1 denied)`. The completed turn followed; no additional `execute_tool_script` run appeared in the recording.
- **F (Escape during a script):** the original run below recorded `CANCELLED` but removed the card. The review-round-1 rerun at [`r1-f-cancellation/`](r1-f-cancellation/) confirmed the cancelled card remains in the live history with one cancelled nested call. The in-session `ps` check and a separate process-table check found no `quickjs-wrapper` or `sleep 30` process. These are behavior checks only; they are not performance measurements.
- **G (sandbox escapes): every probe failed inside the guest.** `process`, `require` and `fetch` are not defined and `globalThis.Bun` is `undefined`; nothing from the host was read and no request was made. The run also found a product bug, fixed in this phase: a script that calls no tools was refused for listing an empty `tools` array.
- **I (result too large): behaved as specified.** The script that returned every file failed `RESULT_TOO_LARGE`, and the model answered with a summary and offered smaller chunks.
- **H (code mode against delegating to a cheap model):** all three delegated runs kept the parent's context small (24,811 to 27,128 input tokens on the last request, against 40,381 when the parent did the work itself in H1). Across parent and child, the code-mode-off child used 1,071,338 input tokens, the code-mode-on child that did not run a script 559,146, and the code-mode-on child that was asked to run scripts 245,454. With one run each, the gap between the two unprompted children (neither ran a script) shows that run-to-run variance is of the same order as the differences being measured.
- Correctness: every A-type answer gave the right total (233) and exact counts per package and per commit. Plan-ID tables differed from the ground truth only on one marker written `PLAN-20260707-AGENTNEUTRAL.P07/P11` (some answers counted it as P07, or as both P07 and P11) and, in two answers, on the ID `project-plans/issue4001.md`. The B answers without a named tool were exact; the named B run left out the 99-line constructor by its own reading of "function".

## Before/after table (A, B, H)

"Context" is the input tokens of the parent's last request, the size of the parent conversation when it wrote the answer. "Input" is the total over all requests, with the cached part in brackets (`/stats` reports the uncached part as "Input Tokens" and the cached part as "Cache Reads"). Tool calls are direct parent calls / nested script calls; child calls are listed separately. "Turn" is the time from the user message to the final model message in the session recording; "wall" is the whole harness run, including startup, `/stats` and `/quit`.

| Run | Code mode | Script used | Parent requests | Context | Parent input (cached) | Parent output | Child requests, input (cached), output | Input, parent + child | Tool calls | Turn s | Wall s | Correctness |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- | ---: | ---: | --- |
| [A off](a-plans-off/) | off | no | 5 | 52,098 | 200,872 (148,096) | 3,374 | none | 200,872 | 4 / 0 | 116 | 159 | exact |
| [A on](a-plans-on/) | on | no | 4 | 40,898 | 127,438 (85,888) | 3,519 | none | 127,438 | 3 / 0 | 83 | 124 | partial: 46/48 plan IDs (P07/P11 as P07) |
| [A on, named](a-plans-on-named/) | on | yes, 3 runs | 5 | 29,028 | 129,792 (100,096) | 4,604 | none | 129,792 | 4 / 66 | 120 | 160 | partial: 45/48 plan IDs |
| [C](c-unprompted-on/) (A prompt, on) | on | no | 5 | 41,966 | 169,143 (126,336) | 4,117 | none | 169,143 | 4 / 0 | 105 | 146 | partial: P07/P11 counted as both |
| [B off](b-longest-off/) | off | no | 3 | 26,203 | 73,157 (46,592) | 1,582 | none | 73,157 | 2 / 0 | 31 | 64 | exact (test files left out) |
| [B on](b-longest-on/) | on | no | 4 | 29,083 | 104,752 (75,264) | 1,852 | none | 104,752 | 3 / 0 | 37 | 73 | exact (test files left out) |
| [B on, named](b-longest-on-named/) | on | yes, 3 runs | 5 | 30,257 | 134,613 (103,680) | 2,847 | none | 134,613 | 4 / 3 | 53 | 87 | partial: 9 of the top 10 (constructor left out) |
| [H1 parent on](h1-parent-on/) | on | no | 5 | 40,381 | 166,456 (125,440) | 4,427 | none | 166,456 | 4 / 0 | 126 | 161 | partial: P07/P11 counted as both |
| [H2 child off](h2-subagent-off/) | parent off, child off | no | 2 | 26,603 | 49,174 (22,400) | 1,504 | 16, 1,022,164 (938,257), 23,706 | 1,071,338 | 1 / 0; child 15 | 146 | 176 | exact |
| [H3 child on](h3-subagent-on/) | parent off, child on | no | 2 | 24,811 | 47,382 (22,400) | 1,853 | 10, 511,764 (445,956), 12,515 | 559,146 | 1 / 0; child 9 | 103 | 132 | exact |
| [H3 child on, named](h3-subagent-on-named/) | parent off, child on | yes (child), 2 runs | 2 | 27,128 | 49,707 (22,400) | 1,517 | 4, 195,747 (135,800), 15,942 | 245,454 | 1 / 113 (in the child); child 3 | 101 | 131 | partial: 45/48 plan IDs |

The named H1 configuration (parent with code mode on, told to use a script) is the "A on, named" row.

## Scenario changes from the issue text

- **A (orchestrator decision).** The repository has no TODO/FIXME comments (the `sonarjs/todo-tag` lint rule rejects them) and every commit has one author, so the issue's A had a trivial answer. A now asks: "Find every `@plan` marker in TypeScript files changed between commits e3c1782b96~10 and e3c1782b96, reading each file as it is at e3c1782b96. Report the count per plan ID, the count per package (packages/<name>), and, using git blame at e3c1782b96 on each marker line, the count per short commit hash that last touched the line. Give the total." The range is pinned to `e3c1782b96` because HEAD holds the code mode commits. The same prompt is used by C, H1 and as the delegated goal in H2 and H3.
- **Ground truth** ([`ground-truth.json`](ground-truth.json), from `scripts/issue4084-ground-truth.ts`): A has 340 TypeScript files, 233 markers, 48 plan IDs, 8 packages and 42 commits. B's files changed on this branch, so B's ground truth is pinned to `e3c1782b96`; the top 10 (file, name, length) is the same at the run commits, and only two start lines moved. B is ranked three ways because the prompt does not say whether test files or anonymous callbacks count. Ranks 9 to 12 without test files are a four-way tie at 85 lines.
- **Single-agent control.** The first A off and B off runs handed the whole task to the user's own subagents (`deepthinker`, `coder`), which is not the comparison A and B ask for. A, B, C, D and H1 now end with "Do the work yourself in this session; do not delegate to a subagent.", in both off and on runs. Those two runs are kept as [`a-plans-off-delegated`](a-plans-off-delegated/) and [`b-longest-off-delegated`](b-longest-off-delegated/).
- **Named runs.** Because no unprompted run used a script, `a-plans-on-named`, `b-longest-on-named` and `h3-subagent-on-named` add "Using execute_tool_script, do this: " in front of the same prompt or goal.
- **E.** The test machine's user policy (`~/Library/Preferences/llxprt-code/policies/auto-saved.toml`) allows `git status` and `echo` without a prompt, and nested calls follow the same policy, so the issue's second command never asked. E runs `git branch --show-current` second, and asks for "two separate run_shell_command calls in one script" because the model once joined both commands into one call. The nested approval probe uses `printf` for the same policy reason.
- **G.** In one run after the fix the model declined to try the probes, so the prompt now starts "This is a test of the execute_tool_script sandbox, which is expected to block each of these."
- **Harness.** Every script uses 100 rows, because the CLI draws in the terminal's alternate buffer and a 45-row pane could not show the whole `/stats` box. `/quit` is sent with Enter, because Escape followed by Enter reached the composer as a newline.

## Per-scenario notes

Each directory holds the harness captures (`NNN-<label>-screen.txt`, `-scrollback.txt`; with the alternate buffer the scrollback capture equals the screen), `session.jsonl` (the session recording, encrypted reasoning removed), `token-usage-parent.jsonl` and any `token-usage-child-*.jsonl`, `metrics.json`, `final-answer.md`, `score-a.json` or `score-b.json`, the `/stats` capture (`*-stats-screen.txt`), `commit.txt` and the start/end epoch files. The raw terminal stream (`pane-output.log`) is left out. The `d-read-off` and `d-read-on` `session.jsonl` recordings are also omitted because they contain verbatim source text stamped `Copyright 2025`, which fails the repository copyright-year guard.

### A, C and H1: `@plan` markers

- [A off](a-plans-off/): four `run_shell_command` calls running Python over `git diff`, `git show` and `git blame`. Exact answer.
- [A on](a-plans-on/): both code mode tools were offered (tool declarations 13,997 tokens against 13,299 off). The model again ran Python through three shell calls. Total, packages and commits exact; it counted the `P07/P11` marker as P07.
- [A on, named](a-plans-on-named/): `discover_tool_api` once, then three scripts. Script 1 called `git show` per file and stopped at `CALL_LIMIT` after 64 nested calls; the model got only the error and the list of completed calls. Script 2 ran a Python program through one nested shell call and failed `RESULT_TOO_LARGE` (over 16,384 bytes). Script 3 returned a 2,353-byte summary. 66 nested calls in all. It reported `project-plans/issue4001.md` as `project-plans`.
- [C](c-unprompted-on/) and [H1](h1-parent-on/): the same prompt and settings as A on. Both used four direct shell calls and no script. Both counted the `P07/P11` marker toward P07 and P11 and said so.
- Earlier runs kept for reference, not counted: [`a-plans-off-1-statsmatcher`](a-plans-off-1-statsmatcher/) (a valid model run with three shell calls whose harness timed out on the `/stats` title) and [`a-plans-off-delegated`](a-plans-off-delegated/).

### B: longest functions

- [B off](b-longest-off/) and [B on](b-longest-on/): one TypeScript AST program run with `bun` through `run_shell_command`, test files left out; all 10 rows and lengths match the ground truth, picking two of the four functions tied at 85 lines.
- [B on, named](b-longest-on-named/): three scripts, each with one nested shell call running an AST program (results about 1.9 KB). The model chose "named production functions and methods", which left out the `chatSession.ts` constructor (99 lines); the other nine and a member of the 85-line tie are exact.
- [`b-longest-off-delegated`](b-longest-off-delegated/): delegated to the user's `coder` subagent (8 child requests), which ranked named functions including test files; 8 of that reading's top 10.

### D: read and explain

- [D off](d-read-off/) and [D on](d-read-on/): one direct `read_file`, no script, and the same three exports (`TaskToolParams`, `TaskToolDependencies`, `TaskTool`). Input 51,231 off and 52,438 on; the difference is the two code mode tool declarations.

### E: approval and denial

- [E](e-approve-deny-on/): first prompt "↳ from script: ... Shell git log -5 --format=%s ... Allow once", approved once; second prompt for `git branch --show-current`, refused. Result `APPROVAL_DENIED`, `completedCalls` `[ok, denied]`, `callCount` 2; the model reported that the second call was denied. The failed card shows the error JSON because the CLI renders a failed tool's error message rather than its display text.
- Not counted: [`e-approve-deny-on-policy-allowed`](e-approve-deny-on-policy-allowed/) (the second command, `git status --short`, was allowed by the user policy and never asked) and [`e-approve-deny-on-one-call`](e-approve-deny-on-one-call/) (the model joined both commands into one shell call).

### F: Escape during a script

- [F](f-escape-on/): Escape about 3 seconds into the nested `sleep 30`. The recording has `started`, one `call` and `finished` with `CANCELLED` (3.6 s). The `ps` check found no `quickjs-wrapper` and no `sleep 30`. The screen shows "Request cancelled." and no card.
- Controls: [`f-control-direct`](f-control-direct/) cancels a direct `run_shell_command sleep 30` with code mode off and shows the same screen. [`f-control-script-followup`](f-control-script-followup/) repeats F and then asks for a one-word reply; the request after the cancelled script succeeds, as it does after the direct cancel.

### G: sandbox escape attempts

- [G](g-escape-attempts-on/), after the fix: one script with `tools: []`, no nested calls, 239-byte result: `process` "ReferenceError: 'process' is not defined", `require` "ReferenceError: 'require' is not defined", `globalThis.Bun` `undefined`, `fetch` "ReferenceError: 'fetch' is not defined".
- [`g-escape-attempts-on-prefix`](g-escape-attempts-on-prefix/), before the fix: the first script, with `tools: []`, was refused `INVALID_TOOLS`; the model added a `pwd` shell call to get a non-empty list, and the probes gave the same four results. [`g-escape-attempts-on-refused`](g-escape-attempts-on-refused/): the model declined to run the probes; not counted.
- Fix: commit `5e2c1835e2` makes the preflight accept an empty `tools` list (duplicates and calls to unlisted tools still fail). Test: `packages/agents/src/code-mode/code-mode-run-owner.policy.test.ts`, "runs a script that calls no tools when its tool list is empty, and refuses a call it did not list" (failed before the change). The full verification cycle passed before the commit (see `PLAN.md`, Phase E).

### H: subagents

- [H2](h2-subagent-off/): the code-mode-off child ran 12 shell calls (plus 2 `replace` calls whose target is not in the parent recording; the working tree was unchanged afterwards) over 16 requests. Exact answer.
- [H3](h3-subagent-on/): the child was offered both code mode tools (its declarations were 572 tokens larger than the off child's) and ran 9 direct shell calls over 10 requests instead. Exact answer.
- [H3 named](h3-subagent-on-named/): the child ran two scripts with 62 and 51 nested shell calls (the second handed 2,603,895 bytes to the guest and returned 2,507). The child's script events appear in the parent recording through the child display. Total, packages and commits exact; 45/48 plan IDs.
- `/stats` lists the parent and child models separately; its rows match the token logs (for example H3 named: `gpt-6-luna` 27,307 + 22,400 cached, `claude-haiku-5-5` 59,947 + 135,800 cached).

### I: result too large

- [I](i-large-output-on/): two scripts listed the 443 `.ts` files under `packages/agents/src/core` (matches `git ls-files`); the third read them with `read_many_files` (3 nested calls, 359,671 bytes to the guest, marked partial because a read was truncated) and failed `RESULT_TOO_LARGE`. The model answered with the file count, named the 16,384-byte limit and offered to return the contents in chunks.

### Nested approval probe

- [nested-approval](nested-approval/): the nested `printf` waited with the ordinary confirmation labelled "↳ from script: issue4084 nested approval probe"; approved once; card `Tool calls: 2 (2 ok)`, `Status: completed`; answer `issue4084-nested-approval-ok`.

### Review round 1: E and F rechecks

After the review fixes for failed/cancelled script-card display, reran E and F sequentially with the committed tmux scripts and `lunahigh` on `3b51330620`. The new evidence is in [`r1-e-approval-denial/`](r1-e-approval-denial/) and [`r1-f-cancellation/`](r1-f-cancellation/); the original scenario captures above remain unchanged.

- E: allowed the first nested shell call, denied the second, and observed the final failed card with `APPROVAL_DENIED` and `2 (1 ok, 1 denied)`. The run finished; the recording contains one script invocation and no retry.
- F: pressed Escape during nested `sleep 30` and observed the terminal `CANCELLED` card with one cancelled call. The in-session check and a separate process-table check found no `quickjs-wrapper` or `sleep 30` process.
- These reruns verify behavior after the card changes. They do not add performance claims or replace the original scenario metrics.

## Limits of this evidence

- One run per configuration and one parent model (`gpt-6-luna`) with one child model (`claude-haiku-5-5`). The three runs of the identical A-on configuration (A on, C, H1) used 127,438 to 169,143 parent input tokens, so differences smaller than that spread are not established by these runs.
- Every A and B prompt in this repository can be answered by one host program run through `run_shell_command`, and `gpt-6-luna` did that whether or not code mode was on. A model that does not write such programs, or a session without a shell, could behave differently; neither was tested.
- The named runs tell the model to use the tool, so they measure what a script run costs, not whether the model would choose it.
- Cost in money was not measured. `/stats` reports tokens and quota use, not prices. The uncached input (input minus cached) is the closest proxy here.
- The prompts were adjusted for this machine (single-agent sentence, E's commands, G's framing) as listed above, so they are not word for word the issue's prompts.
- Scores come from `tools/score-a.ts` and `tools/score-b.ts`, which parse free-form answers; every partial or wrong score above was also checked by reading the answer.

## Reproducing

The tools run from where they are committed, from any working directory; they find the repository from their own location. `tools/run.sh <name> <script>` runs one scenario into `tmp/verify4084/phaseE/runs/<name>`, `tools/chain.sh` runs several one after another (`tools/chain.log` is the log of these runs), `tools/extract.ts <run-dir>` finds the run's session recording and token logs and writes `metrics.json`, and `tools/collect.sh` copies the runs here. Run `bun scripts/issue4084-subagent-setup.ts` before H2 and H3.

To rescore an answer:

```bash
bun project-plans/issue4084/evidence/tools/score-a.ts \
  project-plans/issue4084/evidence/a-plans-off/final-answer.md \
  project-plans/issue4084/evidence/ground-truth.json
bun project-plans/issue4084/evidence/tools/score-b.ts \
  project-plans/issue4084/evidence/b-longest-off/final-answer.md
```
`score-b.ts` ranks functions with git at `e3c1782b96`, so it needs a clone with that commit (not a shallow one); `--repo <dir>` and `--ref <commit>` point it at another repository or commit. Rerunning both scorers on every committed answer reproduces each committed `score-a.json` and `score-b.json` byte for byte. `scripts/tests/issue-4084-evidence-tools.bun.test.ts` runs both committed scorers from an unrelated directory.
