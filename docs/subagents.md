# Subagents

Subagents are specialized assistants you configure to run with their own profile, prompt, and tool limits. They are ideal for repeatable workflows like code review, documentation updates, or analysis tasks without changing your main session settings.

## Why there are no default subagents

LLxprt Code ships with no default subagents because each subagent must bind to a **profile**. Profiles are tied to the provider and model you select, so preloading subagents would assume a specific provider choice. Create subagents that match the profiles you already use.

## Prerequisites

Before creating a subagent, you need at least one profile:

- Model profiles are saved with `/profile save model ...`.
- Load balancer profiles are saved with `/profile save loadbalancer ...`.

If you haven't created profiles yet, review `docs/cli/profiles.md` for setup guidance.

## Manage subagents with `/subagent`

### List subagents

```bash
/subagent list
```

Lists all configured subagents along with their bound profile and mode.

### Save (create) a subagent

```bash
/subagent save <name> <profile> auto|manual "<text>"
```

- `<name>` must be unique and use letters, numbers, or dashes.
- `<profile>` must match an existing profile.
- `auto` and `manual` control how the system prompt is created.

`/subagent create` is an alias for `/subagent save`.

### Show subagent details

```bash
/subagent show <name>
```

Displays the full configuration, including the system prompt and timestamps.

### Edit a subagent

```bash
/subagent edit <name>
```

Opens your editor to update the stored JSON configuration. Changes are validated before saving.

### Delete a subagent

```bash
/subagent delete <name>
```

Deletes the configuration after confirmation.

## Auto vs manual mode

The mode determines how the subagent's system prompt is created:

### Manual mode

Manual mode stores the exact system prompt you provide verbatim. The text you specify becomes the subagent's system prompt without modification.

```bash
/subagent save code-reviewer my-profile manual "You are a careful reviewer focused on security and readability."
```

**Use manual mode when:**

- You know exactly what system prompt you want
- You need precise control over the subagent's behavior
- You're porting a prompt from another tool
- You want reproducible, unchanging behavior

### Auto mode

Auto mode uses your description as input to generate a more detailed system prompt automatically. LLxprt Code sends your description to the bound profile's model and asks it to create an appropriate system prompt.

```bash
/subagent save docs-helper my-profile auto "Help write concise developer documentation."
```

**Use auto mode when:**

- You have a general idea but want the model to flesh out details
- You want the prompt optimized for the specific model
- You're experimenting and want quick iteration

**Note:** Auto mode requires the profile's provider to be available and working. If generation fails (network issues, rate limits), fall back to manual mode.

## Profiles and subagents

Subagents bind to profiles, not directly to providers or models. This means:

- Update a profile to change the provider/model used by every subagent that references it.
- Subagents can point at model profiles or load balancer profiles.
- Multiple subagents can reuse the same profile.

## Storage and files

Subagents are stored under `~/.llxprt/subagents/` as JSON files. Each file includes the profile, mode, system prompt, and timestamps. You can back these up or version them as needed.

## Examples

### Code review helper (manual)

```bash
/subagent save code-reviewer work-claude manual "Review changes for correctness, performance, and security. Provide actionable feedback."
```

### Documentation helper (auto)

```bash
/subagent save docs-helper docs-profile auto "Summarize API changes and draft release notes."
```

### Mixed provider setup

```bash
/subagent save quick-analysis fast-gemini auto "Provide quick code summaries."
/subagent save deep-review claude-max manual "Perform deep architectural analysis and list risks."
```

## Advanced Subagent Configuration

Subagents inherit all capabilities of the profiles they bind to, including load balancing, OAuth buckets, and provider-specific settings.

### Subagent with Load Balancer Profile

Use a load balancer profile for resilient automated tasks that need high availability:

```bash
# First, create individual model profiles
/provider anthropic
/model claude-sonnet-4-5
/profile save model claude-primary

/provider openai
/model gpt-5.1
/profile save model openai-backup

# Create a failover load balancer
/profile save loadbalancer resilient-lb failover claude-primary openai-backup

# Create subagent using the load balancer
/subagent save auto-reviewer resilient-lb manual "Review code changes for correctness and security. Flag any issues."
```

If the primary Claude endpoint fails (rate limit, outage), requests automatically fail over to OpenAI without interrupting the subagent's work.

### Subagent with Multi-Bucket OAuth Profile

Combine OAuth buckets with subagents for high-throughput scenarios:

```bash
# Authenticate multiple buckets
/auth anthropic login team1@company.com
/auth anthropic login team2@company.com
/auth anthropic login team3@company.com

# Create profile with all buckets
/provider anthropic
/model claude-sonnet-4-5
/profile save model claude-team team1@company.com team2@company.com team3@company.com

# Create subagent with bucket failover
/subagent save batch-processor claude-team manual "Process files in batch. Output results in JSON format."
```

When the subagent hits rate limits on one bucket, it automatically advances to the next, enabling sustained high-volume work.

### Cost Optimization: Cheaper Model for Routine Work

Use a less expensive model for routine tasks and reserve premium models for complex work:

```bash
# Create profiles for different cost tiers
/provider gemini
/model gemini-2.5-flash
/profile save model gemini-fast

/provider anthropic
/model claude-opus-4-5
/profile save model claude-premium

# Cheap subagent for routine tasks
/subagent save file-scanner gemini-fast auto "Scan files for patterns and report findings. Quick analysis only."

# Premium subagent for complex analysis
/subagent save architect-review claude-premium manual "Perform deep architectural analysis. Evaluate design patterns, dependencies, and long-term maintainability."
```

Delegate simple tasks (file scanning, formatting checks, basic summaries) to the cheaper subagent and reserve expensive models for tasks requiring deep reasoning.

## Workflow Examples

### Code Review Pipeline

This workflow uses multiple subagents with different profiles to create a tiered review process:

```bash
# Step 1: Create profiles
/provider gemini
/model gemini-2.5-flash
/profile save model fast-gemini

/provider anthropic
/model claude-sonnet-4-5
/profile save model claude-review

# Step 2: Create specialized subagents
/subagent save lint-checker fast-gemini manual "Check code for style issues, unused imports, and formatting problems. Output a bulleted list of issues."

/subagent save security-reviewer claude-review manual "Review code for security vulnerabilities. Check for injection risks, authentication issues, and data exposure. Provide severity ratings."

/subagent save arch-reviewer claude-review manual "Evaluate code architecture. Check for SOLID principles, proper abstractions, and maintainability concerns."
```

**Usage pattern:**

1. Run `lint-checker` first for fast, cheap static analysis
2. If lint passes, run `security-reviewer` for vulnerability assessment
3. For significant changes, run `arch-reviewer` for deep analysis

This approach uses the cheaper Gemini model for quick checks and Claude for nuanced review, optimizing both cost and quality.

### Research and Implementation Workflow

This workflow demonstrates handoff between subagents for research and implementation tasks:

```bash
# Step 1: Create profiles (Gemini free tier for research, Claude for implementation)
/provider gemini
/model gemini-2.5-flash
/profile save model gemini-research

/provider anthropic
/model claude-sonnet-4-5
/profile save model claude-impl

# Step 2: Create specialized subagents
/subagent save web-researcher gemini-research auto "Research topics using web search. Summarize findings with source URLs. Focus on recent, authoritative sources."

/subagent save doc-analyst gemini-research auto "Analyze documentation and API references. Extract key patterns and usage examples."

/subagent save implementer claude-impl manual "Implement features based on research findings. Follow project conventions. Write clean, tested code."
```

**Usage pattern:**

1. Use `web-researcher` to gather background on libraries, APIs, or techniques
2. Use `doc-analyst` to process specific documentation
3. Feed research findings to `implementer` for actual code changes

This leverages Gemini's free tier for high-volume research while using Claude's stronger reasoning for implementation.

### Automated CI/CD Analysis Pipeline

Combine load balancer profiles with specialized subagents for CI/CD integration:

```bash
# Create high-availability profile
/profile save loadbalancer ci-resilient failover claude-primary openai-backup gemini-fallback

# Create CI-focused subagents
/subagent save test-failure-analyst ci-resilient manual "Analyze test failures. Identify root cause and suggest fixes. Output in structured format."

/subagent save pr-summarizer ci-resilient auto "Summarize pull request changes. List modified files, key changes, and potential impacts."

/subagent save release-noter ci-resilient auto "Generate release notes from commit history. Group by feature, fix, and breaking change."
```

These subagents remain available even during provider outages, ensuring CI/CD pipelines continue functioning.

## Profile Requirements for Subagents

### Why Subagents Bind to Profiles

Subagents must bind to profiles rather than providers directly for several reasons:

1. **Configuration encapsulation**: Profiles capture provider, model, auth method, and settings as a single unit. Subagents inherit all of these without specifying each individually.

2. **Centralized updates**: Change a profile once to update every subagent that uses it. If you switch from Claude Sonnet to Claude Opus, update the profile and all referencing subagents immediately use the new model.

3. **Auth abstraction**: Profiles handle OAuth buckets, API keys, and load balancer auth transparently. Subagents don't need to know authentication details.

4. **Reproducibility**: The same subagent definition works across environments if the profile name exists, even when underlying credentials differ.

### Updating All Subagents via Profile Changes

When you update a profile, all subagents using that profile automatically inherit the changes:

```bash
# Initial setup
/provider anthropic
/model claude-sonnet-4-5
/profile save model team-claude

/subagent save reviewer team-claude manual "Review code."
/subagent save documenter team-claude manual "Write docs."
/subagent save tester team-claude manual "Analyze tests."

# Later: upgrade all subagents to a new model
/provider anthropic
/model claude-opus-4-5
/profile save model team-claude   # Overwrites existing profile

# All three subagents now use claude-opus-4-5
```

This pattern is especially useful for:

- Rolling out model upgrades across teams
- Switching OAuth buckets when credentials rotate
- Adding load balancing to existing subagents

### Restricting Tool Access for Subagents

You can create profiles that restrict which tools a subagent can access. This is useful for:

- Read-only analysis subagents that shouldn't modify files
- Documentation subagents that only need read and search tools
- Security-sensitive workflows where you want to limit potential impact

Configure tool restrictions in your settings before saving a profile:

```bash
# Create a read-only profile
/provider anthropic
/model claude-sonnet-4-5-20250929
# Configure coreTools in settings to restrict to read-only tools
/profile save model read-only-claude

# Create subagent with restricted tools
/subagent save analyzer read-only-claude manual "Analyze code without making changes. Report findings only."
```

Tool restrictions are configured via `coreTools` and `excludeTools` in `settings.json`. See the [configuration documentation](./cli/configuration.md) for details.

### Security Considerations for Subagent Tool Access

Subagents operate within the same tool access policies as your main session:

1. **Tool inheritance**: Subagents have access to the same tools as the main session unless the profile restricts them via `coreTools` or `excludeTools` settings.

2. **Approval mode**: If your session requires approval for file writes, subagents also require approval for file writes.

3. **Sandboxing**: Subagents run in the same sandbox (or lack thereof) as the main session.

4. **OAuth scope**: Subagents using OAuth-authenticated profiles operate under the same OAuth scopes and permissions.

**Best practices:**

- Create purpose-specific profiles with appropriate tool restrictions for automated work
- Use `coreTools` to create read-only profiles for analysis subagents
- Use load balancer profiles for unattended subagent work to handle transient failures
- Monitor subagent activity through session logs
- Consider using profiles with lower-capability models for routine tasks to limit potential impact

## Related commands

- `/profile list` to see available profiles.
- `/profile save model ...` or `/profile save loadbalancer ...` to create profiles.
- `/task` to invoke subagents programmatically.
