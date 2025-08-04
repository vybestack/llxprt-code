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