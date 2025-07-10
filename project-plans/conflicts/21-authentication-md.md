# Task: Resolve docs/cli/authentication.md Conflict

## Objective

Resolve the merge conflict in authentication documentation to cover all supported providers while keeping improvements from main.

## File

`docs/cli/authentication.md`

## Context

- **multi-provider branch**: Added authentication docs for multiple providers
- **main branch**: Improved authentication documentation and troubleshooting

## Resolution Strategy

1. Structure docs to cover all providers
2. Include troubleshooting from main
3. Provide clear examples for each provider
4. Maintain consistent formatting

## Key Items to Preserve

### From multi-provider:

- OpenAI authentication setup
- Anthropic authentication setup
- Provider-specific API key configuration
- Environment variable examples

### From main:

- Improved troubleshooting section
- Security best practices
- Clearer examples
- Better organization

## Documentation Structure

```markdown
# Authentication

## Gemini

[Existing Gemini auth]

## OpenAI

[OpenAI setup and configuration]

## Anthropic

[Anthropic setup and configuration]

## Environment Variables

- GEMINI_API_KEY
- OPENAI_API_KEY
- ANTHROPIC_API_KEY

## Troubleshooting

[Enhanced section from main]
```

## Commands to Execute

```bash
# After resolution:
git add docs/cli/authentication.md
```

## Validation

1. All providers documented
2. Examples are accurate
3. Troubleshooting comprehensive
4. Format consistent
