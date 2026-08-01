# Installing and Running LLxprt Code

There are several ways to run LLxprt Code. The option you choose depends on how
you intend to use it.

## Standard installation

Recommended for most users.

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

  Nightly builds are published from the latest commit on main. They may contain
  unreleased features and breaking changes.

## Running in a sandbox

LLxprt Code can run inside a container for security isolation. Both Docker and
Podman are supported.

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

See [Sandboxing](./sandbox.md) for full documentation including credential
proxying, SSH agent passthrough, and custom sandbox profiles.

## Running the latest commit from GitHub

You can run the most recently committed version of LLxprt Code directly from
the GitHub repository. This is useful for testing features still in development.

```bash
# Execute the CLI directly from the main branch on GitHub
npx https://github.com/vybestack/llxprt-code
```

## Contributing

If you want to contribute to LLxprt Code — build from source, run tests, or
prepare a pull request — see [CONTRIBUTING.md](../CONTRIBUTING.md). For the
packaging layout, Bun runtime internals, and release workflow, see
`dev-docs/npm.md` and `dev-docs/bun.md` in a repository checkout.
