Keep this as a running log while executing batches.

## Rules
- Add a complete entry after every batch (PICK or REIMPLEMENT).
- Include actual command output (no summaries).
- Document deviations from plan and follow-ups.

## Record Template

### Selection Record

```
Batch: NN
Type: PICK | REIMPLEMENT
Upstream SHA(s): <sha(s)>
Subject: <subject>
Playbook: <path if REIMPLEMENT, N/A for PICK>
Prerequisites Checked:
  - Previous batch record exists: YES | NO | N/A
  - Previous batch verification: PASS | FAIL | N/A
  - Previous batch pushed: YES | NO | N/A
  - Special dependencies: <list or None>
Ready to Execute: YES | NO
```

### Execution Record

```
$ git cherry-pick <sha...>
<output>
```

### Verification Record

```
$ npm run lint
<output>
$ npm run typecheck
<output>
```

### Feature Landing Verification

```
<evidence: git show / grep / diff>
```

### Commit/Push Record

```
$ git status --porcelain
<output>
$ git commit -m "..."
<output>
$ git push
<output>
```

---

## Batch 01 — REIMPLEMENT — b8df8b2a

### Selection Record

```
Batch: 01
Type: REIMPLEMENT
Upstream SHA(s): b8df8b2a
Subject: feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630)
Playbook: project-plans/20260104gmerge/b8df8b2a-plan.md
Prerequisites Checked:
  - Previous batch record exists: N/A
  - Previous batch verification: N/A
  - Previous batch pushed: N/A
  - Special dependencies: None
Ready to Execute: YES
```

### Execution Record

```
$ git status --short
 M packages/core/src/confirmation-bus/message-bus.ts
 M packages/core/src/tools/google-web-fetch.ts
 M packages/core/src/tools/tools.ts
```

### Verification Record

```
$ npm run lint
> @vybestack/llxprt-code@0.7.0 lint
> eslint . --ext .ts,.tsx && eslint integration-tests

$ npm run typecheck
> @vybestack/llxprt-code@0.7.0 typecheck
> npm run typecheck --workspaces --if-present


> @vybestack/llxprt-code-core@0.7.0 typecheck
> tsc --noEmit


> @vybestack/llxprt-code@0.7.0 typecheck
> tsc --noEmit


> @vybestack/llxprt-code-a2a-server@0.6.1 typecheck
> tsc --noEmit


> @vybestack/llxprt-code-test-utils@0.7.0 typecheck
> tsc --noEmit
```

### Feature Landing Verification

```
$ git show b8df8b2a --stat
<upstream reference used for diff inspection; web-fetch applied to google-web-fetch in llxprt>

$ git status --short
 M packages/core/src/confirmation-bus/message-bus.ts
 M packages/core/src/tools/google-web-fetch.ts
 M packages/core/src/tools/tools.ts
```

### Skeptical Verification

```
Subagent: codereviewer
Verdict: CLEAN - No LLxprt invariant violations.
Notes: No Clearcut telemetry, no tool name changes, no Google-only auth regressions; applied web-fetch logic to google-web-fetch (llxprt divergence).
```

### Commit/Push Record

```
$ git status --porcelain
M packages/core/src/confirmation-bus/message-bus.ts
M packages/core/src/tools/google-web-fetch.ts
M packages/core/src/tools/tools.ts
M project-plans/20260104gmerge/AUDIT.md
M project-plans/20260104gmerge/NOTES.md
M project-plans/20260104gmerge/PROGRESS.md

$ git commit -m "reimplement: feat(core): wire up UI for ASK_USER policy decisions in message bus (upstream b8df8b2a)"
[20260104gmerge 27ef2ae40] reimplement: feat(core): wire up UI for ASK_USER policy decisions in message bus (upstream b8df8b2a)
 6 files changed, 383 insertions(+), 197 deletions(-)

$ git push
Enumerating objects: 29, done.
Counting objects: 100% (29/29), done.
Delta compression using up to 12 threads
Compressing objects: 100% (15/15), done.
Writing objects: 100% (15/15), 7.92 KiB | 676.00 KiB/s, done.
Total 15 (delta 13), reused 0 (delta 0), pack-reused 0
remote: Resolving deltas: 100% (13/13), completed with 13 local objects.
To https://github.com/vybestack/llxprt-code.git
   822791454..27ef2ae40  20260104gmerge -> 20260104gmerge
```

---

## Preflight File Existence Check

```
$ python3 scripts/check_reimpl_files.py
/docs/cli/headless.md :: 937c15c6
/docs/get-started/configuration-v1.md :: 937c15c6
/docs/get-started/configuration.md :: 937c15c6
/integration-tests/flicker.test.ts :: dcf362bc
/packages/cli/src/config/policy.test.ts :: bf80263b, c9c633be
/packages/cli/src/config/policy.ts :: bf80263b, c8518d6a, c9c633be
/packages/cli/src/services/prompt-processors/atFileProcessor.ts :: 995ae717
/packages/cli/src/ui/AppContainer.test.tsx :: f4330c9f
/packages/cli/src/ui/auth/AuthDialog.tsx :: b364f376
/packages/cli/src/ui/auth/useAuth.ts :: b364f376
/packages/cli/src/ui/components/views/ExtensionsList.test.tsx :: cc7e1472
/packages/cli/src/ui/components/views/ExtensionsList.tsx :: cc7e1472
/packages/cli/src/ui/components/views/McpStatus.tsx :: cc7e1472
/packages/cli/src/ui/hooks/useSlashCompletion.ts :: b364f376
/packages/core/src/routing/strategies/classifierStrategy.ts :: b364f376
/packages/core/src/telemetry/activity-monitor.ts :: b364f376
/packages/core/src/telemetry/clearcut-logger/clearcut-logger.test.ts :: 08e87a59
/packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts :: 08e87a59, b364f376
/packages/core/src/tools/message-bus-integration.test.ts :: b8df8b2a
/packages/core/src/tools/web-fetch.test.ts :: 05930d5e, b8df8b2a, bf80263b
/packages/core/src/tools/web-fetch.ts :: 05930d5e, 7dd2d8f7, 98eef9ba, b364f376, b8df8b2a, bf80263b, c8518d6a, c9c633be
/packages/core/src/tools/web-search.ts :: 7dd2d8f7, bf80263b, c8518d6a
/packages/core/src/tools/write-todos.ts :: 7dd2d8f7, c8518d6a
/packages/core/src/utils/debugLogger.test.ts :: 9b9ab609
/packages/core/src/utils/debugLogger.ts :: 9b9ab609
/packages/core/src/utils/delay.test.ts :: 8731309d
/packages/core/src/utils/delay.ts :: 8731309d
/packages/core/src/utils/editCorrector.test.ts :: 937c15c6
/packages/core/src/utils/nextSpeakerChecker.ts :: b364f376
```
