# Conflict Resolution Task Groups

## Overview

Tasks are grouped by which files can be resolved in parallel without interfering with each other. Each group can be executed simultaneously.

## Group 1: Package Files (Sequential - Dependencies)

These must be done in order due to dependencies:

- [x] 01-package-json.md - Root package.json
- [x] 02-package-lock-json.md - Root package-lock.json (depends on 01)
- [x] 03-cli-package-json.md - CLI package.json
- [x] 04-core-package-json.md - Core package.json

## Group 2: Documentation (Parallel)

Can all be done simultaneously:

- [x] 20-readme-md.md - README.md
- [x] 21-authentication-md.md - docs/cli/authentication.md
- [ ] docs/cli/configuration.md (from task 25)
- [ ] docs/troubleshooting.md (from task 25)
- [ ] docs/quota-and-pricing.md (from task 26)

## Group 3: Configuration Files (Parallel)

Can all be done simultaneously:

- [x] 05-auth-ts.md - packages/cli/src/config/auth.ts
- [x] 06-config-ts.md - packages/cli/src/config/config.ts
- [x] 07-config-test-ts.md - packages/cli/src/config/config.test.ts
- [x] 08-settings-ts.md - packages/cli/src/config/settings.ts
- [x] 22-core-config-ts.md - packages/core/src/config/config.ts

## Group 4: UI Components (Parallel)

Can all be done simultaneously:

- [x] 09-app-tsx.md - packages/cli/src/ui/App.tsx
- [x] 10-auth-dialog-tsx.md - packages/cli/src/ui/components/AuthDialog.tsx
- [x] 11-footer-tsx.md - packages/cli/src/ui/components/Footer.tsx
- [x] 12-help-tsx.md - packages/cli/src/ui/components/Help.tsx
- [x] 13-input-prompt-tsx.md - packages/cli/src/ui/components/InputPrompt.tsx
- [ ] packages/cli/src/ui/components/StatsDisplay.tsx (from task 25)

## Group 5: Shared Components (Parallel)

Can all be done simultaneously:

- [ ] packages/cli/src/ui/components/shared/MaxSizedBox.test.tsx (from task 25)
- [ ] packages/cli/src/ui/components/shared/text-buffer.test.ts (from task 25)
- [ ] packages/cli/src/ui/components/shared/text-buffer.ts (from task 25)
- [ ] packages/cli/src/ui/contexts/SessionContext.tsx (from task 25)
- [ ] packages/cli/src/ui/utils/MarkdownDisplay.tsx (from task 25)
- [ ] packages/cli/src/ui/utils/MarkdownDisplay.test.tsx (from task 26)
- [ ] packages/cli/src/ui/utils/TableRenderer.tsx (from task 26)

## Group 6: Hooks (Parallel)

Can all be done simultaneously:

- [x] 14-slash-command-processor-ts.md - packages/cli/src/ui/hooks/slashCommandProcessor.ts
- [ ] packages/cli/src/ui/hooks/slashCommandProcessor.test.ts (from task 25)
- [ ] packages/cli/src/ui/hooks/useCompletion.ts (from task 25)
- [x] 15-use-gemini-stream-ts.md - packages/cli/src/ui/hooks/useGeminiStream.ts
- [ ] packages/cli/src/ui/hooks/useGeminiStream.test.tsx (from task 25)

## Group 7: Core Components (Parallel)

Can all be done simultaneously:

- [x] 16-client-ts.md - packages/core/src/core/client.ts
- [ ] packages/core/src/core/client.test.ts (from task 25)
- [x] 17-content-generator-ts.md - packages/core/src/core/contentGenerator.ts
- [ ] packages/core/src/core/coreToolScheduler.test.ts (from task 25)
- [x] 23-turn-ts.md - packages/core/src/core/turn.ts
- [x] 24-index-ts.md - packages/core/src/index.ts

## Group 8: Tools (Parallel)

Can all be done simultaneously:

- [x] 18-shell-ts.md - packages/core/src/tools/shell.ts
- [ ] packages/core/src/tools/shell.test.ts (from task 26)
- [x] 19-mcp-client-ts.md - packages/core/src/tools/mcp-client.ts
- [ ] packages/core/src/tools/mcp-client.test.ts (from task 25)
- [ ] packages/core/src/tools/grep.ts (from task 25)
- [ ] packages/core/src/tools/read-file.ts (from task 25)

## Group 9: Code Assist (Parallel)

Can all be done simultaneously:

- [ ] packages/core/src/code_assist/codeAssist.ts (from task 25)
- [ ] packages/core/src/code_assist/oauth2.test.ts (from task 25)
- [ ] packages/core/src/code_assist/oauth2.ts (from task 25)
- [ ] packages/core/src/code_assist/server.ts (from task 25)
- [ ] packages/core/src/code_assist/setup.ts (from task 25)

## Group 10: Utils and Misc (Parallel)

Can all be done simultaneously:

- [ ] packages/cli/src/ui/utils/errorParsing.test.ts (from task 25)
- [ ] packages/cli/src/ui/utils/errorParsing.ts (from task 25)
- [ ] packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts (from task 25)
- [ ] packages/core/src/utils/fileUtils.ts (from task 25)
- [ ] packages/core/src/utils/flashFallback.integration.test.ts (from task 25)
- [ ] packages/core/src/utils/user_id.ts (from task 25)
- [ ] packages/core/src/utils/user_id.test.ts (from task 26)

## Group 11: GitHub Workflows (Parallel)

Can all be done simultaneously:

- [ ] .github/workflows/community-report.yml (from task 26)
- [ ] .github/workflows/gemini-automated-issue-triage.yml (from task 26)
- [ ] .github/workflows/gemini-scheduled-issue-triage.yml (from task 26)

## Execution Strategy

### Phase 1: Package Files (Sequential)

Complete Group 1 in order

### Phase 2: Maximum Parallelization

Launch all groups 2-11 simultaneously (up to system limits)

### Recommended Parallel Execution

Based on the demonstration with tasks 01 and 20, you can launch multiple Claude instances:

- Launch 5-10 instances at once for different groups
- Monitor completion with status files
- As instances complete, launch new ones for remaining tasks

### Example Launch Commands

```bash
# Launch 5 parallel instances for different groups
claude --dangerously-skip-permissions -p "Read project-plans/conflicts/05-auth-ts.md..." &
claude --dangerously-skip-permissions -p "Read project-plans/conflicts/09-app-tsx.md..." &
claude --dangerously-skip-permissions -p "Read project-plans/conflicts/16-client-ts.md..." &
claude --dangerously-skip-permissions -p "Read project-plans/conflicts/18-shell-ts.md..." &
claude --dangerously-skip-permissions -p "Read docs and resolve .github/workflows/community-report.yml..." &
```

## Progress Tracking

- Check status files: `ls -la project-plans/conflicts/*status*`
- Check finished files: `ls -la project-plans/conflicts/*finished*`
- Monitor git status: `git status --porcelain | grep "^UU" | wc -l`
