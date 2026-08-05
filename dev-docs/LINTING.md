# Linting and Formatting Guide

This project uses multiple linters and formatters to ensure code quality and consistency. All these checks run in CI, so it's important to run them locally before pushing.

## Quick Start

### Setup (First Time Only)

```bash
# Install all required linters
./scripts/setup-linters.sh

# Install git hooks
npx husky install
```

### Before Committing

```bash
# Auto-fix all fixable issues
npm run fix

# Check that everything passes
npm run check
```

### What These Commands Do

- **`npm run fix`** (or `npm run format:all`):
  - Runs Prettier to format all code files
  - Runs ESLint with --fix to auto-correct linting issues
  - Fixes most formatting and style issues automatically

- **`npm run check`** (or `npm run lint:all`):
  - Runs ESLint with --max-warnings 0 (no warnings allowed)
  - Checks Prettier formatting without modifying files
  - Runs yamllint on all YAML files
  - Runs shellcheck on all shell scripts
  - Runs actionlint on GitHub Actions workflows
  - Runs TypeScript type checking
  - Matches exactly what CI runs - if this passes, CI will pass

## Available Commands

### Comprehensive Commands

- `npm run check` or `npm run lint:all` - Run ALL linters (matches what CI runs)
- `npm run fix` or `npm run format:all` - Auto-fix all fixable issues

### Individual Tools

- `npm run lint` - Run ESLint for JavaScript/TypeScript
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run lint:scoped -- <target> [<target> ...]` - Lint only the named package targets (fast local lint; see below)
- `npm run lint:changed [-- --base <ref>]` - Lint only what differs from the merge base (see below)
- `npm run format` - Run Prettier to format code
- `npm run format:check` - Check formatting without modifying files
- `npm run typecheck` - Run TypeScript type checking

## Scoped and Changed-Files Linting (Fast Local Lint)

`npm run lint` runs a single type-aware ESLint pass over the whole monorepo.
That is correct but slow (~9 min) and memory-hungry (~10 GB peak). The two
commands below surface the runner's already-existing scoped-target mode for
local iteration, without changing CI behavior or the full-run command shape.

### Lint explicit targets

```bash
npm run lint:scoped -- packages/cli
npm run lint:scoped -- packages/cli/ packages/core/ --fix
```

`lint:scoped` forwards the named targets to `scripts/run-lint.ts` as a JSON
array on `--targets`. The runner always adds `integration-tests` and
deduplicates/sorts the list. Trailing slashes are normalized
(`packages/cli/` → `packages/cli`) so shell tab-completion output works.

Flags:

- `--fix` - forward `--fix` to ESLint (auto-fix).
- `--cache` - enable the opt-in ESLint cache (see below).
- `--dry-run` - print the resolved plan and exit 0 without spawning ESLint.
- `-h`, `--help` - print usage and exit 0.

`lint:scoped` does **not** inject `--max-warnings 0`: it is `npm run lint`,
scoped. Invalid invocations fail fast with usage text and exit code 2 — an
unknown flag, `--base` without `--changed`, `--changed` combined with explicit
targets, `--base` with a missing/flag-looking value, and an invocation with
neither `--changed` nor any target. There is never a silent fallback to a
full-tree run.

### Lint changed files

```bash
npm run lint:changed
npm run lint:changed -- --base origin/main
```

`lint:changed` derives the changed paths relative to the merge base and
delegates target selection to `selectLintTargets` from
`scripts/affected-lint-targets.ts`:

- Base ref resolution: an explicit `--base` wins; otherwise the first of
  `origin/main`, `main` that `git rev-parse --verify` resolves.
- Changed paths = `git diff -z --no-renames --name-only <merge-base>`
  (committed, staged and unstaged work) unioned with untracked files from
  `git ls-files -z --others --exclude-standard`, so newly added files are
  linted. `--no-renames` is required so a moved file reports **both** its old
  and new path — otherwise the source package of a rename would silently go
  unlinted. `-z` keeps pathnames byte-exact regardless of `core.quotePath`.
- **Fail-closed cases** (a full-tree lint is run and the reason is printed):
  - **Shared install/build/test/tooling inputs** — the exact list checked into
    `scripts/affected-test-shards.data.json` under `sharedInputs`:
    `package.json`, `package-lock.json`, `bun.lock`, `tsconfig.json`, `.nvmrc`,
    `.bun-version`, `scripts/test.ts`, `scripts/postinstall.cjs`.
  - **Harness/workflow paths** — `scripts/**`, `.github/**`,
    `integration-tests/**`.
  - **Unknown paths** — any path the selector cannot classify fails closed to a
    full run. For example `eslint.config.js` is not a shared input and is not a
    package source, so it reaches the unknown-path fallback (not the
    shared-inputs case).
- If the base ref or merge base cannot be resolved, it fails fast with a clear,
  ref-naming message and exit 2 — never a silent full-tree run.
- **Empty diff**: it prints an explicit "nothing to lint" message and exits 0.

`lint:changed` accepts the same `--fix`, `--cache`, and `--dry-run` flags as
`lint:scoped`.

### Opt-in ESLint cache

Caching is **never** enabled implicitly. Pass `--cache` to `lint:scoped` /
`lint:changed` to forward the opt-in cache flags to the runner, or set
`LLXPRT_LINT_CACHE=true` for the runner directly. The runner owns the cache
flags centrally and derives them from this single opt-in switch.

`LLXPRT_LINT_TARGETS` (the runner's CI-facing target env var) is deliberately
**stripped** from the environment `lint:scoped` / `lint:changed` pass to the
runner. The wrapper always decides the targets itself, so an exported
`LLXPRT_LINT_TARGETS` can never silently narrow a fail-closed full run.

### Heap requirement and the OOM exit code

The full-tree run needs the **12 GB heap** that `npm run lint` sets via
`cross-env NODE_OPTIONS=--max-old-space-size=12288`. A bare
`npx eslint .` (without that heap) dies with a V8
`JavaScript heap out of memory` fatal error and exits **134** — this is an
out-of-memory crash, **not** a lint failure. Always use `npm run lint`
(full) or the scoped commands above rather than invoking ESLint directly.

### Signal-termination diagnostic

When the ESLint child is terminated by a signal (harness watchdog, OOM
killer), `scripts/run-lint.ts` prints an explicit stderr diagnostic naming the
signal and stating that this is an interruption/kill rather than a lint
failure, then exits with `128 + signum` (e.g. `137` for `SIGKILL`,
`143` for `SIGTERM`). For `SIGKILL`, the diagnostic notes that an
out-of-memory kill is a likely cause given the full-tree run's memory profile.
An ordinary lint failure (non-zero `exitCode`) propagates that exit code with
no extra message, since ESLint's own report already went to the inherited
stdio.

## What Gets Checked

### JavaScript/TypeScript

- **ESLint**: Catches code quality issues, bugs, and style violations
- **Prettier**: Ensures consistent code formatting
- **TypeScript**: Type checking for type safety

### YAML Files

- **yamllint**: Validates YAML syntax and style
- Configuration in `.yamllint`

### Shell Scripts

- **shellcheck**: Finds bugs and style issues in shell scripts
- Checks all `.sh`, `.bash`, and `.zsh` files

### GitHub Actions

- **actionlint**: Validates GitHub Actions workflow files
- Ensures workflows are syntactically correct

## Git Hooks

Pre-commit hooks automatically run on staged files to catch issues before committing:

- ESLint on `.ts`, `.tsx`, `.js`, `.jsx` files
- Prettier format check
- yamllint on YAML files (if installed)
- shellcheck on shell scripts (if installed)

### Bypassing Hooks (Emergency Only)

```bash
# Skip pre-commit hooks if absolutely necessary
git commit --no-verify -m "message"
```

**Warning**: Only use this if you're certain the checks will pass in CI

## CI Requirements

The CI pipeline runs all these checks and will fail if any issues are found:

1. **ESLint** with `--max-warnings 0` (no warnings allowed)
2. **Prettier** format check (must match exactly)
3. **yamllint** on all YAML files (using `.yamllint` config)
4. **shellcheck** on all shell scripts (all warnings must be fixed)
5. **actionlint** on GitHub Actions workflows
6. **TypeScript** type checking (no type errors allowed)
7. **Ratchet** for pinning GitHub Action versions to SHA

### Key Differences from Local Development

- CI uses `--max-warnings 0` for ESLint (stricter than local)
- All linters must pass with zero errors/warnings
- Uses exact versions of linters specified in CI workflow

## Troubleshooting

### "command not found" Errors

Run `./scripts/setup-linters.sh` to install missing linters.

### Prettier Conflicts with ESLint

Run `npm run fix` which runs both Prettier and ESLint auto-fix in the correct order.

### CI Passes Locally but Fails in GitHub

Make sure you're running `npm run check` which matches exactly what CI runs. The CI is more strict than local development defaults.

### Common CI Failures and Solutions

#### ESLint Warnings

```bash
# CI uses --max-warnings 0, fix all warnings:
npm run lint:fix
# Then check:
npm run lint:ci
```

#### Prettier Formatting

```bash
# Auto-format all files:
npm run format
# Then verify:
npm run format:check
```

#### YAML Linting

```bash
# Check YAML files:
yamllint .
# Most issues are auto-fixable by following the error messages
```

#### Shell Script Issues

```bash
# Check all shell scripts:
find . -name "*.sh" -o -name "*.bash" | xargs shellcheck
# Fix issues manually based on SC codes
```

#### GitHub Actions

```bash
# Check workflow files:
actionlint
# Common fixes:
# - Quote all variables: ${{ env.VAR }} → "${{ env.VAR }}"
# - Pin actions to SHA: actions/checkout@v4 → actions/checkout@SHA
```

### Windows-Specific Issues

- Use Git Bash or WSL for running shell scripts
- Install linters through WSL or use Windows alternatives
- The npm scripts use `cross-env` for Windows compatibility

## Manual Linter Installation

If the setup script doesn't work for your system:

### macOS (Homebrew)

```bash
brew install shellcheck yamllint actionlint
```

### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install shellcheck yamllint
# actionlint requires manual installation or Go
```

### Python pip

```bash
pip install yamllint
```

### Using Go

```bash
go install github.com/rhysd/actionlint/cmd/actionlint@latest
```

## Configuration Files

- `.eslintrc.js` - ESLint configuration
- `.prettierrc` - Prettier configuration
- `.yamllint` - YAML linting rules (relaxed for practical use)
- `.husky/pre-commit` - Git pre-commit hook
- `scripts/lint-all.sh` - Comprehensive linting script (matches CI)
- `scripts/format-all.sh` - Auto-formatting script
- `scripts/setup-linters.sh` - Installer for all required tools

## Workflow Summary

### Daily Development

1. Write code normally
2. Before committing: `npm run fix` (auto-fixes most issues)
3. Then: `npm run check` (verifies everything passes)
4. Commit (pre-commit hooks run automatically)

### After Pulling/Merging

1. Run `npm run fix` to ensure consistent formatting
2. Run `npm run check` to catch any new issues
3. Fix any remaining issues manually

### CI Failed?

1. Run `npm run check` locally to reproduce
2. Run `npm run fix` to auto-fix what's possible
3. Fix remaining issues manually
4. Run `npm run check` again to verify
5. Push the fixes
