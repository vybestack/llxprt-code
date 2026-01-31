# Issue 455: Driver Mode

## Overview
- **Author:** acoliver
- **Created:** 2025-11-04
- **State:** OPEN
- **Labels:** required for 0.9.0

## Original Request

Right now if you:
```bash
echo "say hi" | llxprt --profile-load zai
```

It will process that just as a prompt.

We want a "Driver" mode where it processes it as if it went through the inputbox.

What we want is to be able to have llxprt drive llxprt. Maybe there is a bug so it should be able to open a stream and send the stream and drive like its a user and read the output. Slash commands should be interpreted just like slash commands.

### Why is this needed?
So I don't have to do user testing and it can just debug itself. I'm too busy.

## Key Requirements from Discussion

1. **UI Visibility**: The driver should be able to "see" the UI like a user - stdout with a rendering of the UI
2. **Input Processing**: Instead of input box waiting on keyboard, the client "drives" sending input
3. **Slash Command Support**: Commands like `/profile load synthetic`, `/set modelparam max_tokens 1200`, etc.
4. **Multi-line Input**: Need to distinguish "next line" from "send" (backslash continuation proposed)

## CodeRabbit's Proposed Architecture

### Core Concept
- Add `--driver` flag
- When active, spawn stdin line reader that feeds commands into the input system
- UI renders normally to stdout (parent LLM "sees" this)
- Each line from stdin is processed as if the user typed it and pressed Enter

### Touch Points in Repo
- `packages/cli/index.ts` - Main entry, calls main() from gemini.tsx
- `packages/cli/src/nonInteractiveCli.ts` - Contains runNonInteractive()
- `packages/cli/src/services/CommandService.ts` - Slash command catalog
- `packages/cli/src/services/BuiltinCommandLoader.ts` - Built-in commands
- `packages/cli/src/services/FileCommandLoader.ts` - File-based commands
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts` - How UI does slash commands
- `packages/cli/src/config/config.ts` - CLI argument parsing

### Proposed New Files
1. `packages/cli/src/ui/hooks/useStdinDriver.ts` - Stdin line reader hook
2. `packages/cli/src/driver/DriverClient.ts` - For parent llxprt to spawn/control child
3. `packages/cli/src/driver/DriverCommandProcessor.ts` - Headless slash command processor

### Multi-line Input Solution
Backslash continuation (like shell scripts):
- Line ending with `\` → accumulate, don't send yet
- Line without `\` → send accumulated input

Example:
```bash
cat <<'EOF' | llxprt --driver
/profile load synthetic
write a function that:\
- takes two parameters\
- validates input\
- returns a result
/quit
EOF
```

## Implementation Phases
1. Add `--driver` flag to CLI args
2. Create stdin driver hook for UI
3. Integrate driver mode in App.tsx
4. Wire up in main entry point (gemini.tsx)
5. Create DriverClient for parent-child orchestration
6. Add LLM-driven testing capabilities

## Use Cases
1. **Automated Testing**: llxprt driving dev version to test functionality
2. **Self-Debugging**: Detect errors and try different settings automatically
3. **CI/CD Integration**: Automated regression testing
4. **AI-Driven QA**: Parent LLM analyzes output and decides next commands
