# Merge Conflict Resolution Plan

## Overview

This directory contains tasks for resolving merge conflicts between the `multi-provider` branch and `main` branch. Each task file is self-contained and can be executed by an autonomous Claude instance without any conversational context.

## Context

- **Source Branch**: `multi-provider` - Contains new multi-provider support, todo tool implementation, and various provider integrations (OpenAI, Anthropic, Qwen3)
- **Target Branch**: `main` - Contains latest updates including new release workflows, dependency updates, command improvements, and bug fixes

## Critical Features to Preserve

### From multi-provider branch:

1. Multi-provider architecture (ProviderManager, IProvider interfaces)
2. OpenAI provider implementation with Responses API support
3. Anthropic provider implementation
4. Qwen3 provider support
5. Todo tool implementation (todo-read, todo-write)
6. Provider selection dialog
7. Tool formatting system for different providers
8. Token tracking enhancements
9. Provider-aware content generation

### From main branch:

1. New GitHub release workflows
2. Dependency updates (npm packages)
3. Command service improvements
4. Memory management commands
5. Clear command implementation
6. User startup warnings
7. Quota error detection
8. Bug fixes and performance improvements

## Conflict Categories

### 1. Package Files (5 files)

- package.json
- package-lock.json
- packages/cli/package.json
- packages/core/package.json

### 2. Configuration (7 files)

- packages/cli/src/config/auth.ts
- packages/cli/src/config/config.ts
- packages/cli/src/config/config.test.ts
- packages/cli/src/config/settings.ts
- packages/core/src/config/config.ts

### 3. UI Components (11 files)

- packages/cli/src/ui/App.tsx
- packages/cli/src/ui/components/AuthDialog.tsx
- packages/cli/src/ui/components/Footer.tsx
- packages/cli/src/ui/components/Help.tsx
- packages/cli/src/ui/components/InputPrompt.tsx
- packages/cli/src/ui/components/StatsDisplay.tsx
- packages/cli/src/ui/components/shared/MaxSizedBox.test.tsx
- packages/cli/src/ui/components/shared/text-buffer.test.ts
- packages/cli/src/ui/components/shared/text-buffer.ts
- packages/cli/src/ui/contexts/SessionContext.tsx
- packages/cli/src/ui/utils/MarkdownDisplay.tsx

### 4. Hooks (6 files)

- packages/cli/src/ui/hooks/slashCommandProcessor.test.ts
- packages/cli/src/ui/hooks/slashCommandProcessor.ts
- packages/cli/src/ui/hooks/useCompletion.ts
- packages/cli/src/ui/hooks/useGeminiStream.test.tsx
- packages/cli/src/ui/hooks/useGeminiStream.ts

### 5. Core Components (12 files)

- packages/core/src/core/client.test.ts
- packages/core/src/core/client.ts
- packages/core/src/core/contentGenerator.ts
- packages/core/src/core/coreToolScheduler.test.ts
- packages/core/src/core/turn.ts
- packages/core/src/index.ts

### 6. Tools (4 files)

- packages/core/src/tools/grep.ts
- packages/core/src/tools/mcp-client.test.ts
- packages/core/src/tools/mcp-client.ts
- packages/core/src/tools/read-file.ts
- packages/core/src/tools/shell.ts

### 7. Documentation (4 files)

- README.md
- docs/cli/authentication.md
- docs/cli/configuration.md
- docs/troubleshooting.md

### 8. Other Files (8 files)

- packages/cli/src/ui/utils/errorParsing.test.ts
- packages/cli/src/ui/utils/errorParsing.ts
- packages/core/src/code_assist/codeAssist.ts
- packages/core/src/code_assist/oauth2.test.ts
- packages/core/src/code_assist/oauth2.ts
- packages/core/src/code_assist/server.ts
- packages/core/src/code_assist/setup.ts
- packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts
- packages/core/src/utils/fileUtils.ts
- packages/core/src/utils/flashFallback.integration.test.ts
- packages/core/src/utils/user_id.ts

## Execution Instructions

1. Each task file can be executed independently
2. Tasks should be executed in numerical order for best results
3. After all conflicts are resolved, run `git add .` and `git commit` to complete the merge

## Verification

After resolving all conflicts:

1. Run `npm run lint` to ensure code quality
2. Run `npm run typecheck` to ensure type safety
3. Run `npm test` to ensure all tests pass
4. Verify multi-provider functionality works
5. Verify todo tool functionality works
