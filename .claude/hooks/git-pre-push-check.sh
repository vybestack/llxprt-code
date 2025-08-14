#!/bin/bash
# Hook to ensure code quality before git operations
# This runs before any Bash command that contains git push or git commit

# Read all input from stdin
input=$(cat)

# Extract the actual command from the JSON
# The input format is: {"tool": "Bash", "args": {"command": "..."}}
command=$(echo "$input" | jq -r '.args.command // empty' 2>/dev/null)

# Check if this is a git push or commit command
if echo "$command" | grep -qE "git (push|commit)"; then
    echo "🔍 Pre-commit/push check: Running code quality checks..."
    
    # Change to project directory
    cd "$CLAUDE_PROJECT_DIR" || exit 1
    
    # Check if Git pre-commit hook exists, create if missing
    if [[ ! -f ".git/hooks/pre-commit" ]]; then
        echo "📝 Creating missing Git pre-commit hook..."
        cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# Git pre-commit hook to ensure code quality

echo "🔍 Running pre-commit checks..."

# Skip if we're in a rebase
if [ -d "$(git rev-parse --git-dir)/rebase-merge" ] || [ -d "$(git rev-parse --git-dir)/rebase-apply" ]; then
    echo "⏭️  Skipping pre-commit during rebase"
    exit 0
fi

# Skip if SKIP_HOOKS is set
if [ "$SKIP_HOOKS" = "1" ]; then
    echo "⏭️  Skipping pre-commit (SKIP_HOOKS=1)"
    exit 0
fi

# Run lint
echo "📋 Running lint..."
if ! npm run lint; then
    echo "❌ Lint failed! Please fix linting errors before committing."
    exit 1
fi

# Run typecheck
echo "🔍 Running typecheck..."
if ! npm run typecheck; then
    echo "❌ Typecheck failed! Please fix type errors before committing."
    exit 1
fi

# Run format CHECK only - don't modify files
echo "✨ Checking formatting..."
if ! npx prettier --check . > /dev/null 2>&1; then
    echo "❌ Code is not formatted! Please run 'npm run format' and stage the changes."
    echo "💡 Run: npm run format && git add -A && git commit"
    exit 1
fi

echo "✅ All pre-commit checks passed!"
exit 0
EOF
        chmod +x .git/hooks/pre-commit
        echo "✅ Git pre-commit hook created!"
    fi
    
    # Run lint
    echo "📋 Running lint..."
    if ! npm run lint; then
        echo "❌ Lint failed! Please fix linting errors before committing/pushing."
        echo "💡 Tip: Run 'npm run lint' to see the errors."
        exit 1
    fi
    
    # Run typecheck
    echo "🔍 Running typecheck..."
    if ! npm run typecheck; then
        echo "❌ Typecheck failed! Please fix type errors before committing/pushing."
        echo "💡 Tip: Run 'npm run typecheck' to see the errors."
        exit 1
    fi
    
    # Run format
    echo "✨ Running format..."
    npm run format
    
    # Check if format made any changes
    if ! git diff --quiet; then
        echo "📝 Formatter made changes. Adding formatted files..."
        git add -A
        echo "✅ Formatted files have been staged."
    fi
    
    echo "✅ All checks passed!"
fi

# Always exit 0 to allow the command to proceed
exit 0