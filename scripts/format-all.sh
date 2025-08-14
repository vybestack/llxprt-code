#!/bin/bash
# Auto-format all code to match project standards
# Run this before committing to ensure consistent formatting

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🎨 Auto-formatting all code..."

# Run Prettier
echo -e "\n${YELLOW}Running Prettier...${NC}"
npm run format
echo -e "${GREEN}✓ Prettier formatting complete${NC}"

# Run ESLint with --fix
echo -e "\n${YELLOW}Running ESLint auto-fix...${NC}"
npm run lint:fix || true  # Don't fail if there are unfixable issues
echo -e "${GREEN}✓ ESLint auto-fix complete${NC}"

# Note about manual fixes
echo -e "\n${YELLOW}Note:${NC}"
echo "- YAML files follow rules in .yamllint"
echo "- Shell scripts need manual fixes for shellcheck warnings"
echo "- GitHub Actions need manual fixes for actionlint warnings"
echo ""
echo "Run './scripts/lint-all.sh' to check for remaining issues"

echo -e "\n${GREEN}✓ Auto-formatting complete!${NC}"