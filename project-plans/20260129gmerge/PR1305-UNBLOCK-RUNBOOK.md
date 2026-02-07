# PR #1305 Unblock Runbook (execute once shell works again)

Purpose: finish the remaining verification/commit/push workflow immediately after shell command execution is restored.

## 1) Quick health check

Run first:

- echo healthcheck
- which bash
- which git
- node -v
- npm -v

If any fail, stop and fix environment first.

## 2) Fast regression checks (targeted)

Run these before the full queue to fail fast:

- npm run test --workspace @vybestack/llxprt-code -- src/ui/hooks/shellCommandProcessor.test.ts
- npm run test:scripts -- scripts/tests/generate-keybindings-doc.test.ts
- npm run test --workspace @vybestack/llxprt-code -- src/ui/hooks/useGeminiStream.dedup.test.tsx
- npm run test --workspace @vybestack/llxprt-code-core -- src/config/config.test.ts

## 3) CI-equivalent verification queue

Execute in order:

1. npm run check:lockfile
2. npm ci
3. npm run format
4. git diff --exit-code -- . ':!project-plans/' ':!packages/ui/bun.lock'
5. npm run lint:ci
6. npx eslint integration-tests --max-warnings 0
7. npx prettier --check integration-tests
8. npm run build
9. npm run bundle
10. npm run typecheck
11. node scripts/lint.js --sensitive-keywords
12. npm run test
13. npm run test:scripts
14. node ./bundle/llxprt.js --version

## 4) Scoped staging set for this follow-up

Use targeted adds only (avoid unrelated branch edits):

- docs/keyboard-shortcuts.md
- packages/cli/src/config/keyBindings.ts
- packages/cli/src/ui/hooks/shellCommandProcessor.ts
- packages/cli/src/ui/hooks/shellCommandProcessor.test.ts
- packages/cli/src/ui/hooks/useGeminiStream.dedup.test.tsx
- scripts/generate-keybindings-doc.ts
- scripts/tests/generate-keybindings-doc.test.ts
- packages/core/src/config/config.test.ts
- project-plans/20260129gmerge/PR1305-CODERABBIT-3762879629-NOTES.md
- project-plans/20260129gmerge/PR1305-UNBLOCK-RUNBOOK.md

Then inspect:

- git status
- git diff --staged

## 5) Commit draft

Suggested commit message:

- chore(pr1305): finalize CodeRabbit follow-ups and docs/test consistency

## 6) Post-push check monitoring

- gh pr checks 1305 --repo vybestack/llxprt-code --watch --interval 300

## 7) Thread response order (after user confirmation)

Use prepared text in:

- project-plans/20260129gmerge/PR1305-CODERABBIT-3762879629-NOTES.md

Post responses first, then resolve threads, then re-query unresolved set.
