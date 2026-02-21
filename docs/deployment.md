# LLxprt Code Execution and Deployment

This document describes how to run LLxprt Code and explains the deployment architecture that LLxprt Code uses.

## Running LLxprt Code

There are several ways to run LLxprt Code. The option you choose depends on how you intend to use LLxprt Code.

---

### 1. Standard installation (Recommended for typical users)

- **npm (global install):**

  ```bash
  npm install -g @vybestack/llxprt-code
  llxprt
  ```

- **Homebrew (macOS/Linux):**

  ```bash
  brew tap vybestack/tap
  brew install llxprt-code
  llxprt
  ```

- **npx (no install):**

  ```bash
  npx @vybestack/llxprt-code
  ```

- **Nightly builds:**

  ```bash
  npm install -g @vybestack/llxprt-code@nightly
  ```

  Nightly builds are published from the latest commit on main. They may contain unreleased features and breaking changes.

---

### 2. Running in a sandbox (Docker or Podman)

LLxprt Code can run inside a container for security isolation. Both Docker and Podman are supported.

- **Using the `--sandbox` flag:**

  ```bash
  # Auto-detect Docker or Podman
  llxprt --sandbox

  # Explicitly choose the engine
  llxprt --sandbox-engine docker
  llxprt --sandbox-engine podman
  ```

- **Directly from the container image:**

  ```bash
  docker run --rm -it ghcr.io/vybestack/llxprt-code/sandbox:latest
  ```

  Or with Podman:

  ```bash
  podman run --rm -it ghcr.io/vybestack/llxprt-code/sandbox:latest
  ```

See [Sandboxing](./sandbox.md) for full documentation including credential proxying, SSH agent passthrough, and custom sandbox profiles.

---

### 3. Running from source (Recommended for LLxprt Code contributors)

Contributors to the project will want to run the CLI directly from the source code.

- **Development Mode:**
  This method provides hot-reloading and is useful for active development.
  ```bash
  # From the root of the repository
  npm run start
  ```
- **Production-like mode (Linked package):**
  This method simulates a global installation by linking your local package. It's useful for testing a local build in a production workflow.

  ```bash
  # Link the local cli package to your global node_modules
  npm link packages/cli

  # Now you can run your local version using the `llxprt` command
  llxprt
  ```

---

### 4. Running the latest LLxprt Code commit from GitHub

You can run the most recently committed version of LLxprt Code directly from the GitHub repository. This is useful for testing features still in development.

```bash
# Execute the CLI directly from the main branch on GitHub
npx https://github.com/vybestack/llxprt-code
```

## Deployment architecture

The execution methods described above are made possible by the following architectural components and processes:

**NPM packages**

LLxprt Code project is a monorepo that publishes two core packages to the NPM registry:

- `@vybestack/llxprt-code-core`: The backend, handling logic and tool execution.
- `@vybestack/llxprt-code`: The user-facing frontend.

These packages are used when performing the standard installation and when running LLxprt Code from the source.

**Build and packaging processes**

There are two distinct build processes used, depending on the distribution channel:

- **NPM publication:** For publishing to the NPM registry, the TypeScript source code in `@vybestack/llxprt-code-core` and `@vybestack/llxprt-code` is transpiled into standard JavaScript using the TypeScript Compiler (`tsc`). The resulting `dist/` directory is what gets published in the NPM package. This is a standard approach for TypeScript libraries.

- **GitHub `npx` execution:** When running the latest version of LLxprt Code directly from GitHub, a different process is triggered by the `prepare` script in `package.json`. This script uses `esbuild` to bundle the entire application and its dependencies into a single, self-contained JavaScript file. This bundle is created on-the-fly on the user's machine and is not checked into the repository.

**Docker sandbox image**

The Docker-based execution method is supported by the `llxprt-code-sandbox` container image, published at `ghcr.io/vybestack/llxprt-code/sandbox`. This image contains a pre-installed, global version of LLxprt Code.

```bash
docker run --rm -it ghcr.io/vybestack/llxprt-code/sandbox:0.7.0
```

## Release process

The release process is automated through GitHub Actions. The release workflow performs the following actions:

1.  Build the NPM packages using `tsc`.
2.  Publish the NPM packages to the artifact registry.
3.  Create GitHub releases with bundled assets.
