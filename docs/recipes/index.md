# Profile Recipes

Ready-to-use configuration recipes for common LLxprt Code setups. Each recipe includes copy-paste JSON profiles and interactive command sequences.

## Available Recipes

### [Free Tier Setup](./free-tier-setup.md)

Get started with LLxprt Code without spending a dime using Gemini and Qwen OAuth.

- Gemini OAuth setup (completely free)
- Qwen OAuth setup (completely free)
- Complete profile JSON examples
- When to use which free provider

### [Claude Pro Workflow](./claude-pro-workflow.md)

Maximize your Claude Pro/Max subscription with thinking mode and rate limit failover.

- Claude Pro/Max OAuth setup
- Thinking mode configuration (with budget_tokens)
- Complete profile JSON with thinking enabled
- Multi-bucket failover for rate limits

### [High Availability Multi-Provider](./high-availability.md)

Maximum uptime with load balancing across Claude, OpenAI, and Gemini.

- Load balancer profile across providers
- Failover configuration
- Complete load balancer profile JSON
- Cost vs. capability tradeoffs

## Quick Start

1. Choose a recipe that matches your use case
2. Copy the profile JSON to `~/.llxprt/profiles/<name>.json`
3. Or use the interactive commands to set up step-by-step
4. Load with `/profile load <name>`

## Profile Storage

All profiles are stored in:

```
~/.llxprt/profiles/
```

## See Also

- [Settings and Profiles Guide](../settings-and-profiles.md) - Complete profile management documentation
- [OAuth Setup](../oauth-setup.md) - Detailed OAuth configuration
- [Provider Quick Reference](../providers/quick-reference.md) - Provider-specific settings
