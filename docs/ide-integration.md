# VS Code Integration

LLxprt Code integrates with VS Code through a companion extension that gives the CLI awareness of your editor state — open files, cursor position, selected text — and lets you review file changes as native diffs right in the editor.

This works with **Visual Studio Code** and VS Code forks including **Cursor**, **Windsurf**, and any editor that supports VS Code extensions or the [Open VSX Registry](https://open-vsx.org/).

> **Other editors:** For Zed integration, see the [Zed Integration](./zed-integration.md) page.

## Features

- **Workspace Context:** The CLI automatically gains awareness of your workspace to provide more relevant and accurate responses. This context includes:
  - The **10 most recently accessed files** in your workspace.
  - Your active cursor position.
  - Any text you have selected (up to a 16KB limit; longer selections will be truncated).

- **Native Diffing:** When llxprt suggests code modifications, you can view the changes directly within your IDE's native diff viewer. This allows you to review, edit, and accept or reject the suggested changes seamlessly.

- **VS Code Commands:** You can access llxprt features directly from the VS Code Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`):
  - `llxprt: Run`: Starts a new llxprt session in the integrated terminal.
  - `llxprt: Accept Diff`: Accepts the changes in the active diff editor.
  - `llxprt: Close Diff Editor`: Rejects the changes and closes the active diff editor.
  - `llxprt: View Third-Party Notices`: Displays the third-party notices for the extension.

## Installation and Setup

There are three ways to set up the IDE integration:

### 1. Automatic Nudge (Recommended)

When you run llxprt inside a supported editor, it will automatically detect your environment and prompt you to connect. Answering "Yes" will automatically run the necessary setup, which includes installing the companion extension and enabling the connection.

### 2. Manual Installation from CLI

If you previously dismissed the prompt or want to install the extension manually, you can run the following command inside llxprt:

```
/ide install
```

This will find the correct extension for your IDE and install it.

### 3. Manual Installation from a Marketplace

You can also install the extension directly from a marketplace.

- **For Visual Studio Code:** Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=vybestack.llxprt-vscode-ide-companion).
- **For VS Code Forks:** To support forks of VS Code, the extension is also published on the [Open VSX Registry](https://open-vsx.org/extension/vybestack/llxprt-vscode-ide-companion). Follow your editor's instructions for installing extensions from this registry.

> NOTE:
> The "Gemini CLI Companion" extension may appear towards the bottom of search results. If you don't see it immediately, try scrolling down or sorting by "Newly Published".
>
> After manually installing the extension, you must run `/ide enable` in the CLI to activate the integration.

## Usage

### Enabling and Disabling

You can control the IDE integration from within the CLI:

- To enable the connection to the IDE, run:
  ```
  /ide enable
  ```
- To disable the connection, run:
  ```
  /ide disable
  ```

When enabled, llxprt will automatically attempt to connect to the IDE companion extension.

### Checking the Status

To check the connection status and see the context the CLI has received from the IDE, run:

```
/ide status
```

If connected, this command will show the IDE it's connected to and a list of recently opened files it is aware of.

(Note: The file list is limited to 10 recently accessed files within your workspace and only includes local files on disk.)

### Working with Diffs

When you ask llxprt to modify a file, it can open a diff view directly in your editor.

**To accept a diff**, you can perform any of the following actions:

- Click the **checkmark icon** in the diff editor's title bar.
- Save the file (e.g., with `Cmd+S` or `Ctrl+S`).
- Open the Command Palette and run **llxprt: Accept Diff**.
- Respond with `yes` in the CLI when prompted.

**To reject a diff**, you can:

- Click the **'x' icon** in the diff editor's title bar.
- Close the diff editor tab.
- Open the Command Palette and run **llxprt: Close Diff Editor**.
- Respond with `no` in the CLI when prompted.

You can also **modify the suggested changes** directly in the diff view before accepting them.

If you select ‘Yes, allow always’ in the CLI, changes will no longer show up in the IDE as they will be auto-accepted.

## Using with Sandboxing

If you are using llxprt within a sandbox, please be aware of the following:

- **On macOS:** The IDE integration requires network access to communicate with the IDE companion extension. You must use a Seatbelt profile that allows network access.
- **In a Docker Container:** If you run llxprt inside a Docker (or Podman) container, the IDE integration can still connect to the VS Code extension running on your host machine. The CLI is configured to automatically find the IDE server on `host.docker.internal`. No special configuration is usually required, but you may need to ensure your Docker networking setup allows connections from the container to the host.

## Troubleshooting

If you encounter issues with IDE integration, here are some common error messages and how to resolve them.

### Connection Errors

- **Message:** `🔴 Disconnected: Failed to connect to IDE companion extension in [IDE Name]. Please ensure the extension is running. To install the extension, run /ide install.`
  - **Cause:** LLxprt Code could not find the necessary environment variables (`LLXPRT_CODE_IDE_WORKSPACE_PATH` or `LLXPRT_CODE_IDE_SERVER_PORT`) to connect to the IDE. This usually means the IDE companion extension is not running or did not initialize correctly.
  - **Solution:**
    1.  Make sure you have installed the **llxprt Companion** extension in your IDE and that it is enabled.
    2.  Open a new terminal window in your IDE to ensure it picks up the correct environment.

- **Message:** `🔴 Disconnected: IDE connection error. The connection was lost unexpectedly. Please try reconnecting by running /ide enable`
  - **Cause:** The connection to the IDE companion was lost.
  - **Solution:** Run `/ide enable` to try and reconnect. If the issue continues, open a new terminal window or restart your IDE.

### Configuration Errors

- **Message:** `🔴 Disconnected: Directory mismatch. LLxprt Code is running in a different location than the open workspace in [IDE Name]. Please run the CLI from one of the following directories: [List of directories]`
  - **Cause:** The CLI's current working directory is outside the workspace you have open in your IDE.
  - **Solution:** `cd` into the same directory that is open in your IDE and restart the CLI.

- **Message:** `🔴 Disconnected: To use this feature, please open a workspace folder in [IDE Name] and try again.`
  - **Cause:** You have no workspace open in your IDE.
  - **Solution:** Open a workspace in your IDE and restart the CLI.

### General Errors

- **Message:** `IDE integration is not supported in your current environment. To use this feature, run llxprt in one of these supported IDEs: [List of IDEs]`
  - **Cause:** You are running llxprt in a terminal or environment that is not a supported IDE.
  - **Solution:** Run llxprt from the integrated terminal of a supported IDE, like VS Code.

- **Message:** `No installer is available for IDE. Please install the LLxprt Code Companion extension manually from the marketplace.`
  - **Cause:** You ran `/ide install`, but the CLI does not have an automated installer for your specific IDE.
  - **Solution:** Open your IDE's extension marketplace, search for "LLxprt Code Companion", and [install it manually](#3-manual-installation-from-a-marketplace).
