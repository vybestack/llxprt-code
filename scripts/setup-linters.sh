#!/bin/bash
# Setup script to install all required linters for local development
# This ensures your local environment matches CI

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Setting up linters for local development...${NC}"
echo ""

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
fi

echo -e "${YELLOW}Detected OS: $OS${NC}"
echo ""

# Check for package managers
HAS_BREW=false
HAS_APT=false
HAS_PIP=false

if command -v brew &> /dev/null; then
    HAS_BREW=true
fi

if command -v apt-get &> /dev/null; then
    HAS_APT=true
fi

if command -v pip3 &> /dev/null || command -v pip &> /dev/null; then
    HAS_PIP=true
fi

# Install shellcheck
echo -e "${YELLOW}Checking shellcheck...${NC}"
if ! command -v shellcheck &> /dev/null; then
    echo "shellcheck not found. Installing..."
    if [ "$OS" = "macos" ] && [ "$HAS_BREW" = true ]; then
        brew install shellcheck
    elif [ "$OS" = "linux" ] && [ "$HAS_APT" = true ]; then
        sudo apt-get update && sudo apt-get install -y shellcheck
    else
        echo -e "${RED}Please install shellcheck manually:${NC}"
        echo "  macOS: brew install shellcheck"
        echo "  Linux: apt-get install shellcheck"
        echo "  Other: https://github.com/koalaman/shellcheck#installing"
    fi
else
    echo -e "${GREEN}✓ shellcheck is already installed${NC}"
fi

# Install yamllint
echo -e "\n${YELLOW}Checking yamllint...${NC}"
if ! command -v yamllint &> /dev/null; then
    echo "yamllint not found. Installing..."
    if [ "$HAS_PIP" = true ]; then
        pip3 install yamllint || pip install yamllint
    elif [ "$OS" = "macos" ] && [ "$HAS_BREW" = true ]; then
        brew install yamllint
    elif [ "$OS" = "linux" ] && [ "$HAS_APT" = true ]; then
        sudo apt-get update && sudo apt-get install -y yamllint
    else
        echo -e "${RED}Please install yamllint manually:${NC}"
        echo "  Using pip: pip install yamllint"
        echo "  macOS: brew install yamllint"
        echo "  Linux: apt-get install yamllint"
    fi
else
    echo -e "${GREEN}✓ yamllint is already installed${NC}"
fi

# Install actionlint
echo -e "\n${YELLOW}Checking actionlint...${NC}"
if ! command -v actionlint &> /dev/null; then
    echo "actionlint not found. Installing..."
    if [ "$OS" = "macos" ] && [ "$HAS_BREW" = true ]; then
        brew install actionlint
    elif command -v go &> /dev/null; then
        go install github.com/rhysd/actionlint/cmd/actionlint@latest
        echo -e "${YELLOW}Note: Make sure $(go env GOPATH)/bin is in your PATH${NC}"
    else
        echo -e "${RED}Please install actionlint manually:${NC}"
        echo "  macOS: brew install actionlint"
        echo "  With Go: go install github.com/rhysd/actionlint/cmd/actionlint@latest"
        echo "  Other: https://github.com/rhysd/actionlint#installation"
    fi
else
    echo -e "${GREEN}✓ actionlint is already installed${NC}"
fi

# Setup git hooks with husky
echo -e "\n${YELLOW}Setting up git hooks...${NC}"
if [ -d ".husky" ]; then
    npx husky install
    echo -e "${GREEN}✓ Git hooks configured${NC}"
else
    echo -e "${YELLOW}Husky not configured. Run 'npx husky install' to enable git hooks${NC}"
fi

# Summary
echo -e "\n================================"
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo -e "${BLUE}Available commands:${NC}"
echo "  npm run check     - Run all linters (comprehensive check)"
echo "  npm run fix       - Auto-fix all fixable issues"
echo "  npm run lint:all  - Run all linters (same as 'check')"
echo "  npm run format:all - Format all code (same as 'fix')"
echo ""
echo -e "${BLUE}Individual commands:${NC}"
echo "  npm run lint      - Run ESLint"
echo "  npm run lint:fix  - Run ESLint with auto-fix"
echo "  npm run format    - Run Prettier"
echo "  npm run typecheck - Run TypeScript type checking"
echo ""
echo -e "${BLUE}Before committing:${NC}"
echo "  1. Run 'npm run fix' to auto-format"
echo "  2. Run 'npm run check' to verify all checks pass"
echo "  3. Git hooks will automatically check staged files"