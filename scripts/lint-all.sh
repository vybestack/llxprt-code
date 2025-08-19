#!/bin/bash
# Comprehensive linting script that runs all linters
# This matches what CI runs to catch issues locally before pushing

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Running comprehensive lint checks..."

# Track if any linter fails
FAILED=0

# JavaScript/TypeScript linting
echo -e "\n${YELLOW}Running ESLint...${NC}"
if npm run lint; then
    echo -e "${GREEN}✓ ESLint passed${NC}"
else
    echo -e "${RED}✗ ESLint failed${NC}"
    FAILED=1
fi

# Format check (doesn't modify, just checks)
echo -e "\n${YELLOW}Checking Prettier formatting...${NC}"
if npx prettier --check .; then
    echo -e "${GREEN}✓ Prettier check passed${NC}"
else
    echo -e "${RED}✗ Prettier check failed${NC}"
    echo "Run 'npm run format' to fix formatting issues"
    FAILED=1
fi

# YAML linting (if yamllint is installed)
if command -v yamllint &> /dev/null; then
    echo -e "\n${YELLOW}Running yamllint...${NC}"
    YAML_FILES=$(git ls-files | grep -E '\.(yaml|yml)$' || true)
    if [[ -n "${YAML_FILES}" ]]; then
        if echo "${YAML_FILES}" | xargs yamllint; then
            echo -e "${GREEN}✓ yamllint passed${NC}"
        else
            echo -e "${RED}✗ yamllint failed${NC}"
            FAILED=1
        fi
    else
        echo -e "${GREEN}✓ No YAML files to check${NC}"
    fi
else
    echo -e "${YELLOW}⚠ yamllint not installed - skipping YAML linting${NC}"
    echo "Install with: pip install yamllint (or brew install yamllint on macOS)"
fi

# Shell script linting (if shellcheck is installed)
if command -v shellcheck &> /dev/null; then
    echo -e "\n${YELLOW}Running shellcheck...${NC}"
    # shellcheck disable=SC2312
    SHELL_FILES=$(git ls-files | grep -E '^([^.]+|.*\.(sh|zsh|bash))$' | xargs file --mime-type 2>/dev/null | grep "text/x-shellscript" | awk '{ print substr($1, 1, length($1)-1) }' || true)
    
    if [[ -n "${SHELL_FILES}" ]]; then
        if echo "${SHELL_FILES}" | xargs shellcheck \
            --check-sourced \
            --enable=all \
            --exclude=SC2002,SC2129,SC2310 \
            --severity=style; then
            echo -e "${GREEN}✓ shellcheck passed${NC}"
        else
            echo -e "${RED}✗ shellcheck failed${NC}"
            FAILED=1
        fi
    else
        echo -e "${GREEN}✓ No shell scripts to check${NC}"
    fi
else
    echo -e "${YELLOW}⚠ shellcheck not installed - skipping shell script linting${NC}"
    echo "Install with: brew install shellcheck (macOS) or apt-get install shellcheck (Linux)"
fi

# GitHub Actions linting (if actionlint is installed)
if command -v actionlint &> /dev/null; then
    echo -e "\n${YELLOW}Running actionlint...${NC}"
    if actionlint; then
        echo -e "${GREEN}✓ actionlint passed${NC}"
    else
        echo -e "${RED}✗ actionlint failed${NC}"
        FAILED=1
    fi
else
    echo -e "${YELLOW}⚠ actionlint not installed - skipping GitHub Actions linting${NC}"
    echo "Install with: brew install actionlint (macOS) or go install github.com/rhysd/actionlint/cmd/actionlint@latest"
fi

# TypeScript type checking
echo -e "\n${YELLOW}Running TypeScript type check...${NC}"
if npm run typecheck; then
    echo -e "${GREEN}✓ TypeScript check passed${NC}"
else
    echo -e "${RED}✗ TypeScript check failed${NC}"
    FAILED=1
fi

# Summary
echo -e "\n================================"
if [[ ${FAILED} -eq 0 ]]; then
    echo -e "${GREEN}✓ All lint checks passed!${NC}"
else
    echo -e "${RED}✗ Some lint checks failed. Please fix the issues above.${NC}"
    exit 1
fi