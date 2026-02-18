# Troubleshooting Guide

This guide provides solutions to common issues and debugging tips.

## Authentication

### Understanding Authentication in LLxprt Code

Authentication in LLxprt Code serves different purposes depending on the provider:

**For Gemini Provider:**

- Authentication options: OAuth, GEMINI_API_KEY, GOOGLE_API_KEY (Vertex AI), or NONE
- Use `/auth` command to select and store your authentication method in `~/.llxprt/settings.json`
- OAuth authentication is lazy-loaded (only happens when you first use the Gemini API)
- Without authentication (NONE), all Gemini operations will fail, including ServerTools (web-search/web-fetch)

**For Other Providers:**

- All non-Gemini providers require API keys
- No OAuth option available for OpenAI, Anthropic, etc.

### How to Provide API Keys

**Environment Variables:**

```bash
# Less commonly used but supported
export OPENAI_API_KEY=your-key-here
export ANTHROPIC_API_KEY=your-key-here
export GEMINI_API_KEY=your-key-here
```

**Command Line:**

```bash
# Direct key
llxprt --provider openai --key $YOUR_KEY

# Key from file
llxprt --provider openai --keyfile ~/.yourkeyfile
```

**Interactive Mode:**

```
/key        # Enter key directly
/keyfile    # Load key from file
```

### Gemini-Specific Authentication

Gemini is used in two ways in LLxprt Code:

1. **As the main provider** - when set via `/provider` or used by default
2. **For ServerTools** - provides web-search and web-fetch capabilities even when using other providers

This means if you're using OpenAI as your main provider but want web search, you'll still need Gemini authentication.

### Common Authentication Errors

- **Error: `Failed to login. Message: Request contains an invalid argument`**
  - Users with Google Workspace accounts, or users with Google Cloud accounts
    associated with their Gmail accounts may not be able to activate the free
    tier of the Google Code Assist plan.
  - For Google Cloud accounts, you can work around this by setting
    `GOOGLE_CLOUD_PROJECT` to your project ID.
  - You can also grab an API key from [AI
    Studio](https://aistudio.google.com/app/apikey), which also includes a
    separate free tier.

- **Error: API key not found**
  - If you specify `--key` without providing a value, or if the environment variable is empty
  - Solution: Ensure your API key is properly set in the environment or provided via command line

- **Error: Invalid API key**
  - The provided API key is malformed or revoked
  - Solution: Check your API key in the provider's dashboard and ensure it's active

- **Error: `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` or `unable to get local issuer certificate`**
  - **Cause:** You may be on a corporate network with a firewall that intercepts and inspects SSL/TLS traffic. This often requires a custom root CA certificate to be trusted by Node.js.
  - **Solution:** Set the `NODE_EXTRA_CA_CERTS` environment variable to the absolute path of your corporate root CA certificate file.
    - Example: `export NODE_EXTRA_CA_CERTS=/path/to/your/corporate-ca.crt`

## Frequently asked questions (FAQs)

- **Q: How do I update LLxprt Code to the latest version?**
  - A: If installed globally via npm, update LLxprt Code using the command `npm install -g @vybestack/llxprt-code@latest`. If run from source, pull the latest changes from the repository and rebuild using `npm run build`.

- **Q: Where are LLxprt Code configuration files stored?**
  - A: The CLI configuration is stored within two `settings.json` files: one in your home directory and one in your project's root directory. In both locations, `settings.json` is found in the `.llxprt/` folder. Refer to [CLI Configuration](./cli/configuration.md) for more details.

- **Q: Why don't I see cached token counts in my stats output?**
  - A: Cached token information is only displayed when cached tokens are being used. This feature is available for API key users (Gemini API key or Vertex AI) but not for OAuth users (Google Personal/Enterprise accounts) at this time, as the Code Assist API does not support cached content creation. You can still view your total token usage with the `/stats` command.

## Streaming / Retry issues

- **Message:** `stream interrupted, retrying` (sometimes followed by `attempt 2/6`)
  - **Cause:** LLxprt detected a transient network problem (SSE disconnect, socket hang-up, etc.) and automatically queued a retry using the global `retries`/`retrywait` settings.
  - **Resolution:** Normally no action is required; the CLI will retry up to six times with exponential backoff. If you consistently hit this message, consider increasing `/set retrywait <ms>` or `/set retries <n>`, or inspect local proxies/firewalls.

- **Error:** `Request would exceed the <limit> token context window even after compression (… including system prompt and a <completion> token completion budget).`
  - **Cause:** After PR #315, system prompts and the contents of your loaded `LLXPRT.md` files are counted in `context-limit`. Even after compression there isn’t enough room for the pending turn plus the reserved completion budget.
  - **Resolution:** Shorten or remove entries from your `LLXPRT.md`, run `/compress`, lower `/set maxOutputTokens <n>` (or provider-specific `max_tokens`), or temporarily disable large memories before trying again.

## PowerShell @ Symbol Issues

### Problem

When using LLxprt Code in PowerShell, typing the `@` symbol to reference files (e.g., `@example.txt`) causes severe input lag and performance issues.

### Cause

PowerShell's IntelliSense treats `@` as the start of a hashtable literal, triggering tab completion and causing the terminal to freeze or lag significantly. This is a known issue with PowerShell that affects any CLI tool using `@` for file references.

### Solution

LLxprt Code automatically detects when running in PowerShell and provides an alternative `+` prefix for file references:

```powershell
# Instead of:
@path/to/file.txt

# Use:
+path/to/file.txt
```

Both syntaxes work in PowerShell, but `+` avoids the IntelliSense interference. The CLI will show a helpful tip on first use and update the placeholder text accordingly.

**Note:** This workaround is only active in PowerShell environments. In other shells (bash, zsh, etc.), continue using the standard `@` prefix.

## Common error messages and solutions

- **Error: `EADDRINUSE` (Address already in use) when starting an MCP server.**
  - **Cause:** Another process is already using the port that the MCP server is trying to bind to.
  - **Solution:**
    Either stop the other process that is using the port or configure the MCP server to use a different port.

- **Error: Command not found (when attempting to run LLxprt Code).**
  - **Cause:** LLxprt Code is not correctly installed or not in your system's PATH.
  - **Solution:**
    1.  Ensure LLxprt Code installation was successful.
    2.  If installed globally, check that your npm global binary directory is in your PATH.
    3.  If running from source, ensure you are using the correct command to invoke it (e.g., `node packages/cli/dist/index.js ...`).

- **Error: `MODULE_NOT_FOUND` or import errors.**
  - **Cause:** Dependencies are not installed correctly, or the project hasn't been built.
  - **Solution:**
    1.  Run `npm install` to ensure all dependencies are present.
    2.  Run `npm run build` to compile the project.

- **Error: "Operation not permitted", "Permission denied", or similar.**
  - **Cause:** If sandboxing is enabled, then the application is likely attempting an operation restricted by your sandbox, such as writing outside the project directory or system temp directory.
  - **Solution:** See [Sandboxing](./cli/configuration.md#sandboxing) for more information, including how to customize your sandbox configuration.

- **CLI is not interactive in "CI" environments**
  - **Issue:** The CLI does not enter interactive mode (no prompt appears) if an environment variable starting with `CI_` (e.g., `CI_TOKEN`) is set. This is because the `is-in-ci` package, used by the underlying UI framework, detects these variables and assumes a non-interactive CI environment.
  - **Cause:** The `is-in-ci` package checks for the presence of `CI`, `CONTINUOUS_INTEGRATION`, or any environment variable with a `CI_` prefix. When any of these are found, it signals that the environment is non-interactive, which prevents the CLI from starting in its interactive mode.
  - **Solution:** If the `CI_` prefixed variable is not needed for the CLI to function, you can temporarily unset it for the command. e.g., `env -u CI_TOKEN llxprt`

- **DEBUG mode not working from project .env file**
  - **Issue:** Setting `DEBUG=true` in a project's `.env` file doesn't enable debug mode for gemini-cli.
  - **Cause:** The `DEBUG` and `DEBUG_MODE` variables are automatically excluded from project `.env` files to prevent interference with gemini-cli behavior.
  - **Solution:** Use a `.gemini/.env` file instead, or configure the `excludedProjectEnvVars` setting in your `settings.json` to exclude fewer variables.

## Exit Codes

LLxprt Code uses specific exit codes to indicate the reason for termination. This is especially useful for scripting and automation.

| Exit Code | Error Type                 | Description                                                                                         |
| --------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| 41        | `FatalAuthenticationError` | An error occurred during the authentication process.                                                |
| 42        | `FatalInputError`          | Invalid or missing input was provided to the CLI. (non-interactive mode only)                       |
| 44        | `FatalSandboxError`        | An error occurred with the sandboxing environment (e.g., Docker, Podman, or Seatbelt).              |
| 52        | `FatalConfigError`         | A configuration file (`settings.json`) is invalid or contains errors.                               |
| 53        | `FatalTurnLimitedError`    | The maximum number of conversational turns for the session was reached. (non-interactive mode only) |

## Sandbox Issues

### Container Engine Problems

#### Docker daemon not running

**Symptom:** `Cannot connect to the Docker daemon. Is the docker daemon running?`

**Solutions:**

- **macOS/Windows:** Start Docker Desktop
- **Linux:** Run `sudo systemctl start docker` or `sudo service docker start`

#### Podman machine not running (macOS)

**Symptom:** `Error: cannot connect to Podman socket`

**Solution:**

```bash
podman machine start
podman machine ls  # Verify it's running
```

If the machine is stuck:

```bash
podman machine stop
podman machine rm
podman machine init
podman machine start
```

#### Image pull failures

**Symptom:** `Unable to find image 'ghcr.io/vybestack/llxprt-code/sandbox:latest'`

**Causes and solutions:**

- No network: Check internet connection
- Registry auth required: `docker login ghcr.io`
- Rate limited: Wait and retry, or use authenticated pull

### Credential Proxy Errors

#### Failed to start credential proxy

**Symptom:** `Failed to start credential proxy: <error message>`

**Causes:**

The credential proxy requires a working OS keyring. Common issues:

- Linux: `gnome-keyring-daemon` not running or D-Bus unavailable
- Keyring locked after login

**Solutions:**

```bash
# Linux: Check keyring status
gnome-keyring-daemon --check

# Linux: Start keyring if needed
eval "$(gnome-keyring-daemon -s)"
export SSH_AUTH_SOCK

# Fallback: Use explicit API key
llxprt --key $YOUR_API_KEY --sandbox
```

#### LLXPRT_CREDENTIAL_SOCKET not set

**Symptom:** Inside the sandbox, authentication fails or `/auth` commands do not work.

**Cause:** The credential proxy socket was not properly passed to the container.

**Diagnosis:**

```bash
# Check if the env var is set inside sandbox
llxprt --sandbox "run shell command: echo $LLXPRT_CREDENTIAL_SOCKET"
```

If empty, the proxy did not start correctly on the host.

**Solution:** Restart the session. If the problem persists, check host keyring availability.

#### Credential proxy connection lost

**Symptom:** `Credential proxy connection lost. Restart the session.`

**Cause:** The container lost its connection to the host-side credential proxy. This usually happens after:

- Host system sleep/hibernate
- Container crash
- Network interface changes

**Solution:** Exit and restart the llxprt session.

#### socat not found (Podman macOS)

**Symptom:** `ERROR: socat not found — credential proxy relay requires socat in the sandbox image`

**Cause:** The sandbox image lacks the `socat` utility needed for credential proxy bridging on Podman macOS.

**Solutions:**

- Update to a newer sandbox image
- Use Docker Desktop instead of Podman on macOS
- Build a custom image with `socat` installed

### SSH Agent Passthrough

#### SSH_AUTH_SOCK not set

**Symptom:** `SSH agent requested but SSH_AUTH_SOCK is not set.`

**Solution:**

```bash
# Start the agent
eval "$(ssh-agent -s)"

# Add your key
ssh-add ~/.ssh/id_ed25519

# Verify
ssh-add -l
```

#### SSH socket not found

**Symptom:** `SSH_AUTH_SOCK path not found at /path/to/socket`

**Cause:** The SSH agent is not running or the socket path is incorrect.

**Solution:**

```bash
# Check if agent is running
ps aux | grep ssh-agent

# Restart the agent
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

#### Podman macOS SSH issues

**Symptom:** Git clone fails with `Permission denied (publickey)` even though keys are loaded.

**Cause:** Podman on macOS runs in a VM. Launchd-managed sockets (paths containing `/private/tmp/com.apple.launchd.*`) are not accessible from the VM.

**Solution:**

Create a dedicated SSH agent socket at a normal filesystem path:

```bash
# Stop any existing agents
killall ssh-agent 2>/dev/null

# Start agent with dedicated socket
ssh-agent -a ~/.llxprt/ssh-agent.sock
export SSH_AUTH_SOCK=~/.llxprt/ssh-agent.sock

# Add keys
ssh-add ~/.ssh/id_ed25519

# Test
ssh-add -l

# Now run llxprt
llxprt --sandbox-engine podman --sandbox-profile-load dev
```

### Sandbox Profile Issues

#### Profile not found

**Symptom:** `Profile 'custom' not found`

**Solution:**

```bash
# Check existing profiles
ls ~/.llxprt/sandboxes/

# Create the profile if missing
echo '{"engine":"auto"}' > ~/.llxprt/sandboxes/custom.json
```

#### Invalid profile JSON

**Symptom:** `Failed to parse sandbox profile`

**Solution:** Validate the JSON syntax:

```bash
# Check syntax
cat ~/.llxprt/sandboxes/custom.json | jq .
```

If `jq` reports errors, fix the JSON and try again.

#### Operation not permitted

**Symptom:** `Operation not permitted` when running commands in sandbox

**Cause:** The operation requires access outside the sandbox boundaries.

**Solutions:**

- Use a less restrictive profile (`dev` instead of `safe`)
- Add the required path to `mounts` in the profile
- Disable network restrictions if network access is needed

### Resource Limits

#### Container killed (OOM)

**Symptom:** Container exits unexpectedly, possibly with `OOMKilled` status.

**Cause:** The process exceeded the memory limit in the profile.

**Solution:** Increase the memory limit in your profile:

```json
{
  "resources": { "memory": "8g" }
}
```

#### Process limit reached

**Symptom:** Commands fail with `fork: Resource temporarily unavailable`

**Cause:** The container hit the process count limit (`pids` in profile).

**Solution:** Increase the process limit:

```json
{
  "resources": { "pids": 512 }
}
```

### Debugging Sandbox Issues

#### Enable debug output

```bash
DEBUG=1 llxprt --sandbox "your prompt here"
```

#### Inspect the sandbox environment

```bash
# Check sandbox environment variables
llxprt --sandbox "run shell command: env | grep -E 'LLXPRT|SANDBOX'"

# Check credential proxy socket
llxprt --sandbox "run shell command: ls -la $LLXPRT_CREDENTIAL_SOCKET"

# Check mounts
llxprt --sandbox "run shell command: mount | grep workspace"

# Test network access
llxprt --sandbox "run shell command: curl -I https://example.com 2>&1"
```

#### Run container manually for debugging

```bash
# Find the image
docker images | grep llxprt-code-sandbox

# Run interactively
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.llxprt:/home/node/.llxprt \
  llxprt-code-sandbox:latest \
  bash

# Inside container, debug
env | grep LLXPRT
ls -la /workspace
```

## Debugging Tips

- **CLI debugging:**
  - Use the `--verbose` flag (if available) with CLI commands for more detailed output.
  - Check the CLI logs, often found in a user-specific configuration or cache directory.

- **Core debugging:**
  - Check the server console output for error messages or stack traces.
  - Increase log verbosity if configurable.
  - Use Node.js debugging tools (e.g., `node --inspect`) if you need to step through server-side code.

- **Tool issues:**
  - If a specific tool is failing, try to isolate the issue by running the simplest possible version of the command or operation the tool performs.
  - For `run_shell_command`, check that the command works directly in your shell first.
  - For file system tools, double-check paths and permissions.

- **Pre-flight checks:**
  - Always run `npm run preflight` before committing code. This can catch many common issues related to formatting, linting, and type errors.

If you encounter an issue not covered here, consider searching the project's issue tracker on GitHub or reporting a new issue with detailed information.
