#!/bin/bash
set -e

echo "Running pre-push checks to align with CI..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    if [[ "${status}" == "success" ]]; then
        echo -e "${GREEN}✓${NC} ${message}"
    elif [[ "${status}" == "error" ]]; then
        echo -e "${RED}✗${NC} ${message}"
    else
        echo -e "${YELLOW}⚠${NC} ${message}"
    fi
}

# Function to run a check
run_check() {
    local name=$1
    shift
    echo "Running: ${name}..."
    if "$@"; then
        print_status "success" "${name} passed"
    else
        print_status "error" "${name} failed"
        exit 1
    fi
}

# Kill any running vitest processes first
echo "Cleaning up any running test processes..."
pkill -f vitest || true
sleep 1

# JavaScript/TypeScript checks
run_check "Format check" npm run format:check
run_check "Lint" npm run lint:ci
run_check "Integration tests lint" npx eslint integration-tests --max-warnings 0
run_check "Integration tests format" npx prettier --check integration-tests
run_check "Typecheck" npm run typecheck
run_check "Build" npm run build
run_check "Bundle" npm run bundle

# Tests
echo "Running tests (this may take a while)..."
run_check "Tests" npm run test:ci

# Kill any leftover vitest processes
pkill -f vitest || true

# Shell script checks (if shellcheck is installed)
if command -v shellcheck &> /dev/null; then
    echo "Running shellcheck on shell scripts..."
    git ls-files | grep -E '^([^.]+|.*\.(sh|zsh|bash))$' | xargs file --mime-type \
        | grep "text/x-shellscript" | awk '{ print substr($1, 1, length($1)-1) }' \
        | xargs shellcheck \
            --check-sourced \
            --enable=all \
            --exclude=SC2002,SC2129,SC2310 \
            --severity=style \
            --format=gcc \
            --color=never | sed -e 's/note:/warning:/g' -e 's/style:/warning:/g' || {
        print_status "error" "Shellcheck found issues"
        exit 1
    }
    print_status "success" "Shellcheck passed"
else
    print_status "warning" "Shellcheck not installed, skipping shell script checks"
fi

print_status "success" "All pre-push checks passed!"
echo "Safe to push to CI."