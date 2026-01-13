# CI/CD Automation Recipe

This recipe guides you through using LLxprt Code in CI/CD pipelines for automated code review, generation, and analysis.

## When to Use This Setup

- Automated code review in pull requests
- AI-powered commit message generation
- Documentation generation in pipelines
- Code quality analysis as part of CI
- Automated security scanning with AI interpretation

## Non-Interactive Mode Basics

LLxprt Code supports non-interactive execution for automation:

```bash
# Basic non-interactive usage
llxprt -p "Your prompt here"

# With specific provider
llxprt --provider anthropic --model claude-sonnet-4-5 -p "Review this code"

# Read from stdin
cat file.py | llxprt -p "Explain this code"

# Output to file
llxprt -p "Generate a README" > README.md
```

## Inline Profiles for CI/CD

Use `--profile` to pass configuration as JSON without requiring profile files:

```bash
# Basic inline profile
llxprt --profile '{"provider":"anthropic","model":"claude-sonnet-4-5"}' -p "Hello"

# With API key (use secrets in CI)
llxprt --profile '{"provider":"anthropic","model":"claude-sonnet-4-5","key":"sk-ant-..."}' -p "Review code"

# With model parameters
llxprt --profile '{"provider":"openai","model":"gpt-5.2","modelParams":{"temperature":0.2,"max_tokens":4096}}' -p "Analyze"
```

## Environment Variable Configuration

Set up authentication via environment variables:

```bash
# Provider-specific keys (auto-detected)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."

# Then use without explicit key
llxprt --provider anthropic --model claude-sonnet-4-5 -p "Hello"
```

## GitHub Actions Examples

### Basic Code Review Workflow

Save as `.github/workflows/ai-review.yml`:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install LLxprt Code
        run: npm install -g llxprt-code

      - name: Get changed files
        id: changed
        run: |
          echo "files=$(git diff --name-only origin/main...HEAD | tr '\n' ' ')" >> $GITHUB_OUTPUT

      - name: Run AI Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          git diff origin/main...HEAD | llxprt \
            --provider anthropic \
            --model claude-sonnet-4-5 \
            -p "Review this diff for bugs, security issues, and code quality. Be concise." \
            > review.md

      - name: Post Review Comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const review = fs.readFileSync('review.md', 'utf8');
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## AI Code Review\n\n${review}`
            });
```

### Complete Inline Profile Workflow

```yaml
name: AI Analysis with Inline Profile

on:
  push:
    branches: [main]

jobs:
  analyze:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install LLxprt Code
        run: npm install -g llxprt-code

      - name: Analyze codebase
        env:
          PROFILE: >-
            {
              "provider": "anthropic",
              "model": "claude-sonnet-4-5",
              "key": "${{ secrets.ANTHROPIC_API_KEY }}",
              "modelParams": {
                "temperature": 0.2,
                "max_tokens": 8192
              },
              "ephemeralSettings": {
                "context-limit": 200000
              }
            }
        run: |
          llxprt --profile "$PROFILE" -p "
            Analyze the codebase structure and provide:
            1. Architecture overview
            2. Potential improvements
            3. Security considerations
          " > analysis.md

      - name: Upload analysis
        uses: actions/upload-artifact@v4
        with:
          name: codebase-analysis
          path: analysis.md
```

### Cost-Optimized with Free Tier Fallback

```yaml
name: Cost-Optimized AI Review

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install LLxprt Code
        run: npm install -g llxprt-code

      - name: Run AI Review (with fallback)
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LB_PROFILE: >-
            {
              "provider": "lb",
              "ephemeralSettings": {
                "context-limit": 200000,
                "lb": {
                  "type": "failover",
                  "buckets": [
                    {
                      "provider": "gemini",
                      "model": "gemini-3-flash-preview",
                      "modelParams": {"temperature": 0.2}
                    },
                    {
                      "provider": "anthropic",
                      "model": "claude-haiku-4-5",
                      "modelParams": {"temperature": 0.2}
                    }
                  ]
                }
              }
            }
        run: |
          git diff origin/main...HEAD | llxprt --profile "$LB_PROFILE" \
            -p "Review this code diff. Focus on bugs and security issues." \
            > review.md

      - name: Post Review
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const review = fs.readFileSync('review.md', 'utf8');
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## AI Review\n\n${review}`
            });
```

### Security Scanning Integration

```yaml
name: AI Security Analysis

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0' # Weekly

jobs:
  security-scan:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install tools
        run: |
          npm install -g llxprt-code
          pip install bandit  # Python security scanner

      - name: Run security scanners
        run: |
          # Run traditional scanner
          bandit -r . -f json > bandit-report.json || true

      - name: AI Security Analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          llxprt --provider anthropic --model claude-sonnet-4-5 -p "
            I have a security scan report. Please:
            1. Prioritize findings by severity
            2. Explain each issue in plain language
            3. Provide specific fix recommendations
            4. Identify any false positives

            Report:
            $(cat bandit-report.json)
          " > security-analysis.md

      - name: Create Issue for Critical Findings
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const analysis = fs.readFileSync('security-analysis.md', 'utf8');
            if (analysis.toLowerCase().includes('critical') || 
                analysis.toLowerCase().includes('high severity')) {
              await github.rest.issues.create({
                owner: context.repo.owner,
                repo: context.repo.repo,
                title: 'Security Scan: Critical/High Findings',
                body: analysis,
                labels: ['security', 'priority:high']
              });
            }
```

## Complete Profile JSON Examples for CI/CD

### Fast Review Profile

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-haiku-4-5",
  "modelParams": {
    "temperature": 0.2,
    "max_tokens": 4096
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

### Deep Analysis Profile

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "modelParams": {
    "temperature": 0.3,
    "max_tokens": 16384,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 8192
    }
  },
  "ephemeralSettings": {
    "context-limit": 200000
  }
}
```

### High Availability CI Profile

```json
{
  "version": 1,
  "provider": "lb",
  "model": "claude-sonnet-4-5",
  "ephemeralSettings": {
    "context-limit": 200000,
    "lb": {
      "type": "failover",
      "buckets": [
        {
          "provider": "gemini",
          "model": "gemini-3-flash-preview",
          "modelParams": {
            "temperature": 0.2,
            "max_tokens": 4096
          }
        },
        {
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "modelParams": {
            "temperature": 0.2,
            "max_tokens": 4096
          }
        },
        {
          "provider": "openai",
          "model": "gpt-5.2",
          "modelParams": {
            "temperature": 0.2,
            "max_tokens": 4096
          }
        }
      ]
    }
  }
}
```

## Shell Escaping Tips

When using inline profiles in different shells:

### Bash/Zsh

```bash
# Use single quotes for the profile
llxprt --profile '{"provider":"anthropic","model":"claude-sonnet-4-5"}' -p "Hello"
```

### GitHub Actions YAML

```yaml
# Use environment variable to avoid escaping issues
env:
  PROFILE: '{"provider":"anthropic","model":"claude-sonnet-4-5"}'
run: llxprt --profile "$PROFILE" -p "Hello"

# Or use multi-line YAML
env:
  PROFILE: >-
    {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5"
    }
```

### PowerShell

```powershell
# Escape inner quotes
llxprt --profile '{\"provider\":\"anthropic\",\"model\":\"claude-sonnet-4-5\"}' -p "Hello"

# Or use here-string
$profile = @'
{"provider":"anthropic","model":"claude-sonnet-4-5"}
'@
llxprt --profile $profile -p "Hello"
```

## Best Practices

1. **Use secrets**: Never hardcode API keys in workflow files
2. **Set low temperatures**: Use 0.2-0.3 for consistent, deterministic outputs
3. **Limit tokens**: Set reasonable `max_tokens` to control costs
4. **Use failover**: Configure multiple providers for reliability
5. **Cache installations**: Speed up pipelines by caching npm installs
6. **Handle failures gracefully**: Use `|| true` or proper error handling
7. **Rate limit awareness**: Add delays between requests if running many

## Troubleshooting

### Command Not Found

```yaml
# Ensure npm global bin is in PATH
- run: |
    npm install -g llxprt-code
    echo "$(npm bin -g)" >> $GITHUB_PATH
```

### JSON Parsing Errors

```yaml
# Use environment variables instead of inline JSON
env:
  PROFILE: '{"provider":"anthropic"}'
run: llxprt --profile "$PROFILE" -p "Hello"
```

### Rate Limits

```yaml
# Add delay between requests
- run: |
    for file in *.py; do
      llxprt -p "Review $file"
      sleep 2
    done
```

### Large Diffs

```bash
# Truncate large diffs
git diff origin/main...HEAD | head -c 50000 | llxprt -p "Review this diff"
```

## Next Steps

- [High Availability Setup](./high-availability.md) - Multi-provider redundancy
- [Free Tier Setup](./free-tier-setup.md) - Cost-effective options
- [Claude Pro Workflow](./claude-pro-workflow.md) - Advanced Claude features
