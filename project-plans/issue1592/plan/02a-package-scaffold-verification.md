# Phase 02a: Package Scaffold Verification

## Phase ID

`PLAN-20260610-ISSUE1592.P02A`

## Checks

1. `npm install && npm run build && npm run typecheck && npm run lint` — paste outputs.
2. Diff review of package.json/workflow/script changes against the providers precedent (PR #1953/#1957). Every providers touchpoint must have an agents twin:
   ```bash
   grep -rn "llxprt-code-providers" package.json .github/workflows scripts/*.js | sed 's/providers/agents/' # use as checklist
   grep -rn "llxprt-code-agents" package.json .github/workflows scripts/*.js
   ```
3. Lockfile sanity: `node scripts/check-lockfile.js` (if present) and `git diff package-lock.json --stat`.
4. Dependency direction: agents package.json must NOT list providers or cli.
5. Workspaces order: agents after core, before cli (npm resolves topologically but order documents intent).

## Holistic Assessment + Verdict

Written assessment; PASS/FAIL in `.completed/P02A.md`.
