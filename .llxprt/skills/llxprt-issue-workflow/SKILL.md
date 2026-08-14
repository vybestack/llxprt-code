---
name: llxprt-issue-workflow
description: Use this skill when asked to address, fix, or work on a GitHub issue in the llxprt-code repository. Covers the complete issue lifecycle - branch setup, gh CLI usage, test-first planning, subagent delegation and review loops, the full verification cycle (including the stepfun-37 smoke test), open code review (ocr), PR creation, and CI/CodeRabbit watching.
---

# LLxprt Issue Workflow

End-to-end workflow for taking a GitHub issue in this repository from intake to a
green, review-clean pull request.

## 1. Setup

1. Checkout main and pull latest from origin. Do NOT delete any files or run
   `git clean` — just `git checkout main && git pull`.
2. Create branch `issueNUM` (e.g. `issue1234`).
3. Use `gh` to pull the issue and its comments, AND assign the issue to acoliver:
   `gh issue edit NUM --add-assignee acoliver`.
4. Always use `gh` for issues/PRs/comments — never webfetch. Use proper gh command
   syntax and avoid unescaped backticks in bodies/comments (they trigger shell
   command substitution).

## 2. Research and plan

- Research the issue in the codebase using the description and comments as the
  starting point.
- Create a test-first plan following dev-docs/RULES.md behavioral tests (no mock
  theater). See the `typescript-test-writing` skill for the distilled test rules.
- Plan documents go in `project-plans/`, NEVER in `dev-docs/`. dev-docs/ holds
  durable engineering reference material (PLAN.md, RULES.md, architecture notes);
  project-plans/ holds per-issue and per-feature planning. Writing a plan to
  dev-docs/plans/ is wrong — dev-docs/PLAN.md and dev-docs/PLAN-TEMPLATE.md are
  the methodology you follow, not the destination you write to. This is enforced
  by scripts/check-doc-placement.ts, which fails if dev-docs/plans/ exists.
- Temporary issue state belongs under project-plans/, not dev-docs/.

### Scope rules

- Scope is based on functionality, not line counts. Never add line or file counts
  for issue scope; if an issue contains them, ignore them.
- Do not update unrelated project-plan files owned by other issue efforts except
  when required to resolve conflicts or unblock the current PR. CI, lint, test,
  and formatting failures automatically authorize bounded scope expansion needed
  to make the PR green; do not ask for approval based only on file or line counts.
  Ask only before major functional or architectural expansions beyond the issue
  scope.

## 3. Implement and review via subagents

1. Delegate implementation to the typescriptexpert subagent with exquisite
   detail. It must run the full verification cycle (below) as part of the work.
2. Have deepthinker review for compliance and issue intent (it must also run the
   verification cycle).
3. If review fails: remediate with typescriptexpert (giving feedback, run
   verification), then have deepthinker review again — loop until satisfied.

## 4. Verification cycle (how AND when)

Run ALL of the following before checking in code changes, before pushing, and
before creating PRs. Fix any errors and ensure code is formatted. Re-run the
whole cycle after every remediation round:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Notes on the smoke test (last command):

- Profile: `stepfun-37` (profile name is tracked in .llxprt/LLXPRT.md).
- There is NO scripts/start.js — only scripts/start.ts — so the runner must be
  `bun`, not `node`.
- Run it as part of the verification cycle, and again whenever anything that
  could affect startup changes.

## 5. Open code review (ocr) BEFORE pushing

Also see the `open-code-review` skill.

1. Launch detached, never in the foreground:

   ```bash
   nohup ocr review --audience agent --timeout 20 {{args}} > /tmp/ocr_review.log 2>&1 & echo PID=$!
   ```

2. ALWAYS pass `--timeout 20` for a guaranteed 20-minute floor (ocr's per-task
   default is only 10 minutes).
3. NEVER run in the foreground: the shell's ~2-minute process watchdog
   SIGTERM-kills the foreground process group mid-review, losing all buffered
   output — a high timeout_seconds does NOT save it.
4. POLL and WATCH for it finishing: repeatedly read /tmp/ocr_review.log and check
   the PID (`ps -p $PID` or `kill -0 $PID`) with short tool calls until the
   process is DONE.
5. Ensure tests are NOT filtered out: ocr excludes test/spec files by default, so
   rely on the global ~/.opencodereview/rule.json include patterns
   (**/*.test.*, **/*.spec.*, **/__tests__/**) to re-include them.
6. If stdout is lost anyway, recover findings from
   ~/.opencodereview/sessions/*/*.jsonl (grep for `code_comment` tool calls).
7. Address EVERY ocr finding: remediate with typescriptexpert, re-run the
   verification cycle, and re-run ocr if changes were significant — loop until
   ocr is clean.

## 6. Create the PR

- Use the PR-creator skill when creating PRs if available.
- Title must include the issue number being fixed, e.g.
  `Adds cat pictures to every UI screen (Fixes #1234)`.
- Body must include `closes #NUM` or `fixes #NUM` and exquisite detail.

## 7. Watch CI and address CodeRabbit

1. Watch until workflows finish: `gh pr checks NUM --watch --interval 300`
   (5-minute interval). Give the shell tool a timeout comfortably above the
   interval.
2. GitHub runners usually take up to 15 minutes; loop up to 5 times max if checks
   are not done, printing the current timestamp between iterations. Never make
   unsourced claims about how long things have been pending — report status
   factually.
3. Address every CodeRabbit comment and any CI failure (using the same
   subagents), run the verification cycle, add/commit/push, and watch again —
   loop until all workflows pass and all CodeRabbit issues are resolved.
   Evaluate each CodeRabbit issue against the actual source; never dismiss one
   merely because it is labeled "nit" or "code quality", but dismiss ones that
   are far outside PR scope or factual mistakes. Comment on each CodeRabbit issue
   explaining the action taken and resolve it if addressed or provably invalid.
4. Never assume a CI failure is "unrelated to my changes." The only exception is
   proof via `gh` that the same tests fail on main or other recent PRs — and even
   then, fix the test if possible.
5. NEVER exit to prompt telling the user workflows are still running — you must
   watch, loop, fix, and watch until complete.

## 8. Merge

- DO NOT MERGE PRs YOURSELF. Wait until the user explicitly says to merge.
- Always report PR status (CI green, threads resolved, ready to merge) and ask
  for confirmation before merging.

## Gotchas

- `bun install --frozen-lockfile` is structurally unusable in this repo: Bun
  re-normalizes the lockfile on every pass and fails frozen even immediately
  after a clean `rm bun.lock && bun install` generation. Renaming the private
  root package does NOT fix it. Root cause is the monorepo structure (root
  package, packages/cli, and a self-override all named `@vybestack/llxprt-code`,
  plus file:../ workspace protocol and 26 overrides). Clean generation
  (`rm bun.lock && bun install`) IS deterministic (byte-identical SHA across
  runs, all 16 workspaces incl packages/cli). Plain `bun install` against the
  committed lockfile works (exit 0, all 16 workspaces resolve, postinstall.cjs
  Bun-guard exits 0 without triggering npm build). Therefore any Bun CI smoke
  must use plain `bun install`, NOT --frozen-lockfile. Also: 15/16 workspaces
  symlink to ../../packages/<x>; packages/cli (@vybestack/llxprt-code) resolves
  to the published npm package due to the name collision — a known out-of-scope
  pre-existing issue.
- Check the current year before creating each new file; do not stamp last year
  on a new file's copyright.
- This project is moving to bun/TypeScript: no new .js files or vitest/node
  tests should be created. Everything is TS/Bun and a bun test.
