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
- `npm run format` - Run Prettier to format code
- `npm run format:check` - Check formatting without modifying files
- `npm run typecheck` - Run TypeScript type checking

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
