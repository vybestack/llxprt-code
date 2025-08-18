# LLxprt Code Companion

The LLxprt Code Companion extension pairs with [LLxprt Code](https://github.com/acoliver/llxprt-code) to provide seamless IDE integration for AI-assisted coding. This extension is compatible with both VS Code and VS Code forks.

## Features

### Open Editor File Context

LLxprt Code gains awareness of the files you have open in your editor, providing it with a richer understanding of your project's structure and content.

### Selection Context

LLxprt Code can easily access your cursor's position and selected text within the editor, giving it valuable context directly from your current work.

### Native Diffing

Seamlessly view, modify, and accept code changes suggested by LLxprt Code directly within the editor. Changes are displayed in a familiar diff view with easy accept/reject controls.

### Quick Launch

Start a new LLxprt Code session from the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`) by running the "LLxprt Code: Run" command.

## Getting Started

1. **Install LLxprt Code**: First, install LLxprt Code:

   ```bash
   npm install -g @vybestack/llxprt-code
   ```

2. **Install this Extension**: Install the LLxprt Code Companion extension from the VS Code Marketplace.

3. **Enable IDE Mode**: In your terminal, run LLxprt Code and enable IDE integration:

   ```bash
   llxprt-code
   /ide enable
   ```

4. **Start Coding**: LLxprt Code now has full context of your workspace and can assist with your coding tasks!

## Requirements

- VS Code version 1.99.0 or newer
- LLxprt Code (installed separately)
- Node.js 20.0 or newer

## Commands

- `LLxprt Code: Run` - Launch LLxprt Code in the integrated terminal
- `LLxprt Code: Accept Diff` - Accept the current diff changes (when viewing a diff)
- `LLxprt Code: Close Diff Editor` - Close the diff without accepting changes
- `LLxprt Code: View Third-Party Notices` - View open source licenses

## Keyboard Shortcuts

- `Cmd+S` / `Ctrl+S` - Accept diff changes (when viewing a diff)

## Extension Settings

This extension contributes no configurable settings. All configuration is managed through the LLxprt Code CLI.

## Known Issues

- IDE mode must be explicitly enabled in LLxprt Code for full functionality
- The extension requires LLxprt Code to be running in the integrated terminal

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

## Support

- Report issues: [GitHub Issues](https://github.com/acoliver/llxprt-code/issues)
- Documentation: [LLxprt Code Docs](https://github.com/acoliver/llxprt-code#readme)

## License

Distributed under the terms of the Apache Software License 2.0.
