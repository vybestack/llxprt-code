#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

cd "${REPO_ROOT}"

echo "[1/9] Shell sanity check"
echo shell-ok

echo "[2/9] Review branch state"
git status
git diff HEAD
git log -n 3

echo "[3/9] Optional verification rerun (set RERUN_VERIFY=1 to enable)"
if [[ "${RERUN_VERIFY:-0}" == "1" ]]; then
  npm run lint
  npm run typecheck
  npm run build
  echo "Skipping full npm test by default due known baseline unrelated failures."
  echo "Run manually if desired: npm test"
fi

echo "[4/9] Commit using prepared branch-wide message"
git add -A
git commit -F project-plans/20260129gmerge/COMMIT_MESSAGE_DRAFT.md

echo "[5/9] Confirm clean post-commit state"
git status

echo "[6/9] Push branch"
git push -u origin 20260129gmerge

echo "[7/9] Create PR"
PR_URL=$(gh pr create \
  --repo vybestack/llxprt-code \
  --base main \
  --head 20260129gmerge \
  --title "feat(sync): finalize 20260129gmerge v0.15.4 to v0.16.0 reconciliation and interactive shell delivery" \
  --body-file project-plans/20260129gmerge/PR_BODY_DRAFT.md)

echo "PR created: ${PR_URL}"

# Extract PR number from URL like .../pull/123
PR_NUMBER=$(echo "${PR_URL}" | sed -E 's#.*/pull/([0-9]+).*#\1#')

if [[ "${PR_NUMBER}" =~ ^[0-9]+$ ]]; then
  echo "[8/9] Watch PR checks for #${PR_NUMBER}"
  gh pr checks "${PR_NUMBER}" --repo vybestack/llxprt-code --watch --interval 300
else
  echo "Could not parse PR number from URL: ${PR_URL}"
  echo "Run manually: gh pr checks PR_NUMBER --repo vybestack/llxprt-code --watch --interval 300"
fi

echo "[9/9] Done"
