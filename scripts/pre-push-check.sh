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
    # Get list of files first to avoid SC2312
    files=$(git ls-files)
    shell_files=$(echo "${files}" | grep -E '^([^.]+|.*\.(sh|zsh|bash))$' || true)
    
    if [[ -n "${shell_files}" ]]; then
        # Process files to find shell scripts
        shell_scripts=""
        while IFS= read -r file; do
            if [[ -f "${file}" ]]; then
                mime_type=$(file --mime-type -b "${file}" 2>/dev/null || true)
                if [[ "${mime_type}" == "text/x-shellscript" ]]; then
                    shell_scripts="${shell_scripts}${file} "
                fi
            fi
        done <<< "${shell_files}"
        
        if [[ -n "${shell_scripts}" ]]; then
            # Run shellcheck on the found scripts
            # shellcheck disable=SC2086,SC2312
            if ! shellcheck \
                --check-sourced \
                --enable=all \
                --exclude=SC2002,SC2129,SC2310,SC2312 \
                --severity=style \
                --format=gcc \
                --color=never ${shell_scripts} | sed -e 's/note:/warning:/g' -e 's/style:/warning:/g'; then
                print_status "error" "Shellcheck found issues"
                exit 1
            fi
        fi
    fi
    print_status "success" "Shellcheck passed"
else
    print_status "warning" "Shellcheck not installed, skipping shell script checks"
fi

print_status "success" "All pre-push checks passed!"
echo "Safe to push to CI."