# Declarative Agent Framework (DAF) Analysis

**⚠️ WARNING: DO NOT IMPLEMENT DAF IN THIS MERGE CYCLE ⚠️**

**This document is for analysis purposes only. Commit 794d92a79 is EXCLUDED from the current cherry-pick plan.**
**DAF may be reconsidered as a separate Q1 2026 initiative. See "Decision for Current Merge Cycle" section below.**

---

**Date:** 2025-11-21
**Upstream Commit:** `794d92a79` - refactor(agents): Introduce Declarative Agent Framework (#9778)
**Status:** Skip for current merge cycle, plan hybrid implementation for Q1 2026

---

## Executive Summary

Upstream's Declarative Agent Framework (DAF) introduces 2,746 lines of sophisticated agent infrastructure with automatic tool wrapping, composability, and input validation. However, it has fundamental philosophical differences from our Claude Code-inspired subagent system.

**Key Finding:** DAF is designed for **behavioral control of Gemini** (low agency, rigid scripts), while our subagents are designed for **autonomous delegation** (high agency, trusted models). We should adopt DAF's composability architecture while rejecting its behavioral rigidity.

**Recommendation:** Skip DAF in this merge cycle. Plan a dedicated Q1 2026 project to build a hybrid system that combines:
- Our high-agency autonomous approach
- DAF's composability (agents calling agents)
- DAF's input validation and resource controls
- Our multi-provider flexibility

---

## Philosophical Differences

### LLxprt Subagents: Autonomous Delegates (Claude Code Style)

**Design Philosophy:**
- **Context isolation** - Keep separate conversations clean
- **Cost optimization** - Use cheaper models for specific tasks
- **Autonomous agency** - "Go figure this out and report back"
- **Trust the model** - Give it space to work
- **Multi-provider** - Can use Claude, GPT-4, OpenAI, or any provider

**Current Architecture:**
```json
// ~/.llxprt/subagents/researcher.json
{
  "name": "researcher",
  "profile": "anthropic-sonnet-4",  // ← References profile with model/provider
  "systemPrompt": "You are a research agent...",
  "createdAt": "2025-11-21T...",
  "updatedAt": "2025-11-21T..."
}

// ~/.llxprt/profiles/anthropic-sonnet-4.json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "temperature": 0.7,
  "tools": ["web_search", "read_file", "grep"]
}
```

**Characteristics:**
- ✅ High agency - agent decides strategy autonomously
- ✅ Separate context - doesn't pollute main conversation
- ✅ Model flexibility - any provider, any model
- ✅ User editable - JSON files, no compilation
- ✅ Runtime creation - `/subagent create` command
- ✅ Tool allowlists - already have this via profiles
- ❌ No composability - subagents can't call other subagents (intentional design choice)
- ❌ No input validation - no schema enforcement
- ❌ No resource limits - no max turns/time constraints

**Design Intent:**
Subagents are autonomous workers that operate independently, use cheaper models when appropriate, and keep context clean. They're trusted to figure out how to accomplish their goal.

---

### DAF Agents: Constrained Task Executors (Gemini Behavioral Control)

**Design Philosophy:**
- **Behavioral constraints** - Force Gemini to follow patterns
- **Deterministic execution** - Predictable, scripted behavior
- **Hand-holding** - Don't trust model to figure things out
- **Process enforcement** - Must follow exact methodology
- **Single provider** - Hardcoded to Gemini

**DAF Architecture:**
```typescript
// packages/core/src/agents/codebase-investigator.ts
export const CodebaseInvestigatorAgent: AgentDefinition = {
  name: 'codebase_investigator',
  displayName: 'Codebase Investigator Agent',
  description: 'Analyzes codebase structure and technologies',

  // Input schema with validation
  inputConfig: {
    inputs: {
      investigation_focus: {
        description: 'What to investigate',
        type: 'string',
        required: true
      }
    }
  },

  // Output contract
  outputConfig: {
    description: 'Detailed markdown report',
    completion_criteria: [
      'Report must directly address investigation_focus',
      'Cite specific files as evidence',
      'Conclude with summary of technologies found'
    ]
  },

  // Model settings (hardcoded)
  modelConfig: {
    model: DEFAULT_GEMINI_MODEL,  // ← Always Gemini
    temp: 0.2,
    top_p: 1.0,
    thinkingBudget: -1
  },

  // Execution constraints
  runConfig: {
    max_time_minutes: 5,
    max_turns: 15
  },

  // Tool allowlist
  toolConfig: {
    tools: [LSTool.Name, ReadFileTool.Name, GlobTool.Name, GrepTool.Name]
  },

  // Rigid methodology enforcement
  promptConfig: {
    systemPrompt: `You are the Codebase Investigator agent.

# Task
Your focus: \${investigation_focus}

# Methodology (YOU MUST FOLLOW THIS)
1. **Discovery:** Start by looking at package.json, README.md
2. **Structure Analysis:** Use 'glob' and 'ls' to understand layout
3. **Deep Dive:** Use 'read_file' and 'grep' to analyze contents
4. **Synthesis:** Synthesize findings into report

# Rules
* You MUST ONLY use the tools provided
* You CANNOT modify the codebase
* You must be thorough
* Once sufficient info gathered, STOP calling tools

# Report Format
Structured markdown, citing evidence...`
  }
};
```

**Characteristics:**
- ⚠️ Low agency - follows rigid step-by-step script
- ⚠️ Behavioral control - extensive guardrails and "MUST" statements
- ⚠️ Single provider - hardcoded to Gemini, no multi-provider
- ⚠️ Compiled TypeScript - users can't create/edit agents
- ⚠️ No runtime flexibility - must recompile to change
- ✅ Composability - agents can call other agents as tools
- ✅ Input validation - JSON schema enforcement
- ✅ Resource limits - max turns, max time
- ✅ Automatic tool wrapping - agents become callable tools
- ✅ Output contracts - completion criteria

**Design Intent:**
DAF agents are rigid, process-driven executors designed to force Gemini to behave predictably and follow exact methodologies. The framework compensates for Gemini's tendencies toward tool overuse and non-determinism.

---

## Why the Difference?

### The Gemini Problem

Gemini (especially earlier versions) had reliability issues:
- **Tool overuse** - Would call tools excessively and unnecessarily
- **Going off-script** - Wouldn't follow instructions reliably
- **Non-determinism** - Unpredictable behavior patterns
- **Tool misuse** - Would use write tools when told to only read
- **Looping** - Would get stuck in repeated patterns

**DAF's Solution:**
- Lock down tools: "You can ONLY use these 4 read tools"
- Enforce process: "You MUST follow steps 1-4 in order"
- Strict completion: "You must meet ALL criteria before stopping"
- Hard limits: "Max 15 turns or forced termination"
- Constant reminders: "You CANNOT modify code", "You MUST be thorough"

### The Claude/GPT-4 Advantage

Claude Sonnet and GPT-4 are more reliable:
- Follow instructions accurately without constant reminders
- Self-limit tool usage appropriately
- Work autonomously with high-level goals
- Less prone to looping or excessive tool calls
- Better at following nuanced instructions

**LLxprt's Solution:**
- Trust the model more - give high-level goals, not rigid scripts
- Give autonomy within a profile - agent decides strategy
- Focus on context isolation, not behavioral control
- Use better models that don't need "training wheels"

---

## What DAF Does Well

Despite the philosophical mismatch, DAF has excellent architectural features:

### 1. Automatic Tool Wrapping (Composability)

**The Killer Feature:**
```typescript
// Define an agent
const FileReaderAgent: AgentDefinition = {
  name: 'file_reader',
  inputConfig: { inputs: { path: { type: 'string', required: true } } },
  toolConfig: { tools: [ReadFileTool.Name] }
};

// Automatically wrap as a tool
import { wrapAgentAsTool } from './subagent-tool-wrapper';
const fileReaderTool = wrapAgentAsTool(FileReaderAgent);

// Other agents can now call it
const CodeAnalyzerAgent: AgentDefinition = {
  name: 'code_analyzer',
  toolConfig: {
    tools: [GlobTool.Name, fileReaderTool]  // ← Agent as tool!
  }
};
```

**Why This Is Powerful:**
- Zero boilerplate for agent-as-tool
- Automatic JSON schema generation from inputConfig
- Agents can naturally call other agents
- Enables hierarchical agent architectures
- Build complex capabilities from simple agents

**Example DAG:**
```
arch_reviewer (Anthropic Sonnet 4)
  ↓ calls code_analyzer tool
  code_analyzer (GPT-4)
    ↓ calls file_reader tool
    file_reader (Fast cheap model)
      ↓ calls read_file tool
      read_file (actual file I/O)
```

### 2. Input Validation

```typescript
inputConfig: {
  inputs: {
    investigation_focus: {
      description: 'High-level description of what to investigate',
      type: 'string',
      required: true
    },
    max_depth: {
      description: 'How deep to search directory tree',
      type: 'number',
      required: false
    }
  }
}
```

**Benefits:**
- Fail fast - invalid inputs caught before execution
- Self-documenting - inputs describe themselves
- Type safety - runtime validation against schema
- Better DX - IDE/CLI can show what inputs are valid
- Prevents runtime errors from missing/wrong data

### 3. Template System

```typescript
systemPrompt: `Your focus is: \${investigation_focus}
Max depth to search: \${max_depth}
Available tools: \${GlobTool.Name}, \${ReadFileTool.Name}`

// Variables from inputConfig get substituted at runtime
```

**Benefits:**
- Dynamic prompts - customize per invocation
- DRY - one template, many uses
- Type-safe - variables must be in inputConfig
- Clear intent - see what varies vs what's fixed

### 4. Resource Limits

```typescript
runConfig: {
  max_time_minutes: 5,   // Hard timeout
  max_turns: 15          // Prevent infinite loops
}
```

**Benefits:**
- Cost control - won't run forever
- Capacity planning - see max cost upfront
- Timeout guarantees - won't hang indefinitely
- Safety - prevents runaway agents

### 5. Data-Driven Configuration

```typescript
// Agent is self-contained TypeScript object
export const MyAgent: AgentDefinition = { /* complete spec */ };

// Can serialize to JSON
const json = JSON.stringify(agentDef);

// Can generate from templates
const agent = generateAgent(template, params);
```

**Benefits:**
- Portability - complete spec in one place
- Versionable - track changes in git
- Generatable - can build from UI or AI
- Discoverable - registry pattern enables catalogs

### 6. Registry Pattern

```typescript
import { AgentRegistry } from './registry';

const registry = new AgentRegistry();
registry.register(CodebaseInvestigatorAgent);
registry.register(TestWriterAgent);
registry.register(RefactoringAgent);

// Discovery
const codeAgents = registry.findByTag('code');
const allAgents = registry.listAll();
```

**Benefits:**
- Plugin architecture - dynamically discover agents
- Decoupled - don't need direct imports
- Extensible - users can add custom agents
- Marketplace-ready - can build agent catalogs

---

## What Doesn't Fit LLxprt

### 1. Rigid Behavioral Scripts

```typescript
systemPrompt: `# Methodology (YOU MUST FOLLOW THIS)
1. **Discovery:** Start by looking at package.json
2. **Structure Analysis:** Use 'glob' and 'ls'
3. **Deep Dive:** Use 'read_file' and 'grep'
4. **Synthesis:** Synthesize findings

# Rules
* You MUST ONLY use the tools provided
* You CANNOT modify the codebase
* You must be thorough`
```

**Why We Don't Want This:**
- Claude/GPT-4 don't need this level of hand-holding
- Reduces agent autonomy and flexibility
- Feels infantilizing for capable models
- Limits creative problem-solving approaches
- Our models are reliable enough to trust with high-level goals

### 2. Forced Completion Criteria

```typescript
outputConfig: {
  completion_criteria: [
    'Report must directly address investigation_focus',
    'Cite specific files as evidence',
    'Conclude with summary of technologies'
  ]
}
```

**Why This Is Limiting:**
- Reduces flexibility in how agents solve problems
- May force busywork to check boxes
- Our models can determine when they're done
- High-level quality expectations work better

### 3. Single Provider Lock-In

```typescript
modelConfig: {
  model: DEFAULT_GEMINI_MODEL,  // ← Always Gemini
  temp: 0.2
}
```

**Why This Doesn't Work:**
- LLxprt's core value is multi-provider support
- Users choose models based on task/cost/capability
- Different agents should use different providers
- Can't leverage best model for each task

### 4. Compiled TypeScript Agents

```typescript
// Agents are TypeScript exports
export const CodebaseInvestigatorAgent: AgentDefinition = { /* ... */ };
```

**Why This Limits Users:**
- Can't create agents via CLI commands
- Can't edit without code changes and recompilation
- Can't distribute without source code
- No runtime flexibility
- Requires TypeScript knowledge

---

## Proposed Hybrid Approach

Combine the best of both worlds: **High-agency autonomous agents with DAF's composability**.

### Enhanced SubagentConfig Schema

```typescript
/**
 * Enhanced subagent configuration (backward compatible)
 */
export interface SubagentConfig {
  /** Subagent identifier (matches filename without .json) */
  name: string;

  /** Description of what this agent does */
  description?: string;

  /** Reference to profile name in ~/.llxprt/profiles/ */
  profile: string;

  /** System prompt text for this subagent */
  systemPrompt: string;

  // ===== NEW: DAF-inspired additions =====

  /** Input schema for validation and tool wrapping */
  inputConfig?: {
    inputs: Record<string, {
      description: string;
      type: 'string' | 'number' | 'boolean' | 'integer' | 'string[]' | 'number[]';
      required: boolean;
      default?: unknown;
    }>;
  };

  /** Output description (not rigid criteria) */
  outputConfig?: {
    description: string;
  };

  /** Execution constraints for resource control */
  runConfig?: {
    maxTimeMinutes?: number;
    maxTurns?: number;
    maxCost?: number;  // ← LLxprt addition
  };

  /** Tool allowlist override (supplements profile tools) */
  toolConfig?: {
    tools: string[];  // Tool names or other agent names
    mode: 'allow' | 'deny';  // Allowlist or denylist
  };

  /** Whether this agent can be called as a tool by other agents */
  canBeCalledAsTool?: boolean;

  /** Tags for discovery and categorization */
  tags?: string[];

  // ===== Existing fields =====

  /** ISO 8601 timestamp when subagent was created */
  createdAt: string;

  /** ISO 8601 timestamp when subagent was last updated */
  updatedAt: string;
}
```

### Example: High-Agency Composable Agent

```json
// ~/.llxprt/subagents/researcher.json
{
  "name": "researcher",
  "description": "Autonomous research agent for investigating topics",
  "profile": "anthropic-sonnet-4",

  "inputConfig": {
    "inputs": {
      "research_topic": {
        "description": "The topic to research in detail",
        "type": "string",
        "required": true
      },
      "depth": {
        "description": "Investigation depth: 'quick' | 'thorough' | 'comprehensive'",
        "type": "string",
        "required": false,
        "default": "thorough"
      }
    }
  },

  "outputConfig": {
    "description": "Detailed research report with findings and sources"
  },

  "runConfig": {
    "maxTimeMinutes": 15,
    "maxTurns": 40,
    "maxCost": 0.50
  },

  "toolConfig": {
    "tools": ["web_search", "read_file", "grep", "code_analyzer"],
    "mode": "allow"
  },

  "systemPrompt": "You are an autonomous research agent. Research: ${research_topic}. Depth: ${depth}. Use your judgment and available tools effectively. Report your findings when complete.",

  "canBeCalledAsTool": true,
  "tags": ["research", "autonomous", "high-agency"],

  "createdAt": "2025-11-21T10:00:00Z",
  "updatedAt": "2025-11-21T10:00:00Z"
}
```

### Example: Agent Composition DAG

```json
// Level 1: File analysis (fast model)
// ~/.llxprt/subagents/file-analyzer.json
{
  "name": "file_analyzer",
  "description": "Analyzes individual files",
  "profile": "openai-gpt-4o-mini",
  "inputConfig": {
    "inputs": {
      "file_path": { "type": "string", "required": true }
    }
  },
  "toolConfig": {
    "tools": ["read_file"]
  },
  "systemPrompt": "Analyze file: ${file_path}. Provide concise summary.",
  "canBeCalledAsTool": true,
  "tags": ["file", "analysis"]
}

// Level 2: Module analysis (medium model, calls file-analyzer)
// ~/.llxprt/subagents/module-analyzer.json
{
  "name": "module_analyzer",
  "description": "Analyzes code modules and their structure",
  "profile": "anthropic-haiku-3.5",
  "inputConfig": {
    "inputs": {
      "module_path": { "type": "string", "required": true }
    }
  },
  "toolConfig": {
    "tools": ["glob", "grep", "file_analyzer"]
  },
  "systemPrompt": "Analyze module: ${module_path}. Use file_analyzer for individual files. Synthesize findings.",
  "canBeCalledAsTool": true,
  "tags": ["code", "module", "analysis"]
}

// Level 3: Architecture review (powerful model, calls module-analyzer)
// ~/.llxprt/subagents/arch-reviewer.json
{
  "name": "arch_reviewer",
  "description": "Reviews overall architecture and patterns",
  "profile": "anthropic-sonnet-4",
  "inputConfig": {
    "inputs": {
      "review_focus": { "type": "string", "required": true }
    }
  },
  "toolConfig": {
    "tools": ["module_analyzer"]
  },
  "runConfig": {
    "maxTimeMinutes": 20,
    "maxCost": 1.00
  },
  "systemPrompt": "Review architecture focusing on: ${review_focus}. Use module_analyzer to investigate specific areas. Provide comprehensive assessment.",
  "tags": ["architecture", "review", "comprehensive"]
}
```

**Execution DAG:**
```
arch_reviewer (Anthropic Sonnet 4, $1 budget)
  ↓ calls module_analyzer("src/auth")
  module_analyzer (Anthropic Haiku 3.5)
    ↓ calls file_analyzer("src/auth/login.ts")
    file_analyzer (GPT-4o-mini)
      ↓ calls read_file("src/auth/login.ts")
```

**Benefits:**
- ✅ Each agent uses appropriate model/provider
- ✅ Cost optimization (cheap models for simple tasks)
- ✅ High agency at each level
- ✅ Composable DAG
- ✅ Input validation
- ✅ Resource limits
- ✅ User editable JSON

---

## Implementation Plan

### Phase 1: Schema & Validation (2 weeks)

**Goal:** Add DAF-inspired fields to SubagentConfig, maintain backward compatibility.

**Tasks:**
1. Update `packages/core/src/config/types.ts`:
   - Add optional `inputConfig`, `outputConfig`, `runConfig`, `toolConfig`
   - Add `canBeCalledAsTool`, `description`, `tags`
   - Maintain backward compatibility (all new fields optional)

2. Create `packages/core/src/agents/validation.ts`:
   - `validateInputs(inputConfig, inputs)` - JSON schema validation
   - `validateToolConfig(toolConfig)` - Tool existence checks
   - `validateRunConfig(runConfig)` - Constraint validation

3. Update SubagentManager:
   - Load and validate new fields
   - Apply defaults for missing fields
   - Migration path for old configs

**Tests:**
- Backward compatibility with existing configs
- Input validation edge cases
- Schema validation

### Phase 2: Template System (1 week)

**Goal:** Support `${variable}` substitution in systemPrompt.

**Tasks:**
1. Create `packages/core/src/agents/template.ts`:
   - `substituteTemplates(prompt, inputs)` - Variable replacement
   - Support `${variable}` syntax
   - Validate variables exist in inputConfig

2. Update SubagentOrchestrator:
   - Apply template substitution before execution
   - Pass validated inputs

**Tests:**
- Template substitution correctness
- Missing variable detection
- Nested variables, escaping

### Phase 3: Resource Limits (1 week)

**Goal:** Enforce maxTimeMinutes, maxTurns, maxCost.

**Tasks:**
1. Update SubagentOrchestrator:
   - Track turn count, enforce maxTurns
   - Track elapsed time, enforce maxTimeMinutes
   - Track cost (if maxCost specified)
   - Terminate with appropriate reason

2. Add termination reasons:
   - `MAX_TURNS_EXCEEDED`
   - `TIMEOUT_EXCEEDED`
   - `COST_LIMIT_EXCEEDED`

**Tests:**
- Turn limit enforcement
- Time limit enforcement
- Cost tracking accuracy

### Phase 4: Tool Wrapping (2 weeks)

**Goal:** Allow subagents to be called as tools by other subagents.

**Tasks:**
1. Create `packages/core/src/agents/subagent-tool-wrapper.ts`:
   - `wrapSubagentAsTool(config)` - Generate FunctionDeclaration
   - `generateSchemaFromInputConfig(inputConfig)` - JSON schema
   - `executeSubagentTool(config, inputs)` - Execute wrapped subagent

2. Update ToolRegistry:
   - Support registering subagents as tools
   - Load subagent tools from toolConfig
   - Handle subagent tool calls

3. Update SubagentOrchestrator:
   - Check if tool call is for a subagent
   - Execute nested subagent
   - Return structured result

**Tests:**
- Schema generation correctness
- Nested subagent execution
- DAG execution (3+ levels)
- Circular dependency detection

### Phase 5: CLI Integration (1 week)

**Goal:** Update `/subagent` commands to support new fields.

**Tasks:**
1. Update `/subagent create`:
   - Prompt for inputConfig (optional)
   - Prompt for runConfig (optional)
   - Prompt for canBeCalledAsTool

2. Update `/subagent edit`:
   - Show all new fields in editor
   - Validate on save

3. Add `/subagent list --composable`:
   - Filter to agents with canBeCalledAsTool=true

4. Add `/subagent call <name> --input key=value`:
   - Test calling a subagent as a tool directly

**Tests:**
- CLI command integration
- Input validation in CLI
- Error messages

### Phase 6: Registry & Discovery (1 week)

**Goal:** Enable agent discovery and tagging.

**Tasks:**
1. Create `packages/core/src/agents/registry.ts`:
   - `AgentRegistry` class
   - `register(config)`, `find(criteria)`, `listAll()`
   - Tag-based filtering

2. Update SubagentManager:
   - Maintain registry of all subagents
   - Auto-register on load
   - Query by tags

3. Add `/subagent discover --tag <tag>`:
   - Find agents by tag
   - Show composable agents
   - Show agent capabilities

**Tests:**
- Registry operations
- Tag filtering
- Discovery queries

---

## Timeline & Effort

**Total Estimate:** 8 weeks (1 engineer)

| Phase | Duration | Complexity | Risk |
|-------|----------|------------|------|
| 1. Schema & Validation | 2 weeks | Medium | Low |
| 2. Template System | 1 week | Low | Low |
| 3. Resource Limits | 1 week | Medium | Medium |
| 4. Tool Wrapping | 2 weeks | High | High |
| 5. CLI Integration | 1 week | Low | Low |
| 6. Registry | 1 week | Low | Low |

**Critical Path:** Phase 4 (Tool Wrapping) - Most complex, enables composability

**Risks:**
- Phase 4: Circular dependency handling, debugging nested execution
- Phase 3: Cost tracking accuracy across providers
- Backward compatibility throughout

---

## Decision for Current Merge Cycle

### Recommendation: **SKIP DAF (commit 794d92a79)**

**Reasons:**
1. **Scope Too Large:** 2,746 lines, 8-week implementation, not suitable for merge cycle
2. **Philosophical Mismatch:** DAF's rigid behavioral control doesn't fit our high-agency model
3. **Architecture Divergence:** Complete rewrite vs incremental enhancement
4. **Multi-Provider:** DAF is Gemini-only, conflicts with our core value proposition
5. **User Experience:** Compiled TypeScript vs runtime JSON editing

### Alternative: **Plan Hybrid Implementation for Q1 2026**

**What to Build:**
- High-agency autonomous agents (keep current approach)
- DAF-style composability (agents calling agents)
- Input validation and resource limits (safety)
- Multi-provider support (core value)
- JSON-based, user-editable (accessibility)
- Optional rigidity (let users choose behavioral control if desired)

**Project Name:** "Composable Subagents"
**Target:** Q1 2026
**Effort:** 8 weeks
**Priority:** High (valuable capability improvement)

---

## Open Questions

1. **Subagent Nesting Policy:**
   - Currently intentionally prevent subagents calling other subagents
   - Why? Performance? Complexity? Context management?
   - Do we want to change this policy?

2. **Cost Tracking:**
   - How to accurately track costs across providers?
   - Different pricing models (per-token, per-request, etc.)
   - Should maxCost be per-agent or cumulative?

3. **Circular Dependencies:**
   - How to prevent agent A → agent B → agent A loops?
   - Static analysis? Runtime detection? Max depth?

4. **Tool Allowlist Precedence:**
   - Profile has tools
   - Subagent toolConfig has tools
   - Which wins? Merge? Override?

5. **Hybrid Agents:**
   - Should we support BOTH high-agency and low-agency agents?
   - Could `rigidityLevel` field let users choose?
   - Some tasks benefit from rigid scripts, others from autonomy

---

## References

### Upstream Commit
- **Hash:** `794d92a79dd25361f535ffa36a83aa9cc309cf21`
- **Title:** refactor(agents): Introduce Declarative Agent Framework (#9778)
- **Author:** Abhi
- **Date:** 2025-09-30
- **Lines:** +2,746

### Key Files
- `packages/core/src/agents/types.ts` - Core type definitions
- `packages/core/src/agents/executor.ts` - Agent execution loop (574 lines)
- `packages/core/src/agents/subagent-tool-wrapper.ts` - Automatic tool wrapping
- `packages/core/src/agents/registry.ts` - Agent registry pattern
- `packages/core/src/agents/codebase-investigator.ts` - Example agent

### Related Documents
- `project-plans/20251121gmerge/commit-analysis.md` - Initial commit analysis
- `project-plans/20251121gmerge/commit-research-detailed.md` - Detailed research

---

## Conclusion

DAF represents sophisticated agent infrastructure with excellent composability features. However, it's designed for a different problem (controlling Gemini's behavior) than ours (autonomous delegation with multi-provider support).

We should **skip DAF in this merge cycle** and instead plan a **Q1 2026 hybrid project** that adopts DAF's composability architecture while maintaining our high-agency, multi-provider philosophy.

The result will be agents that can call other agents (like DAF), use different models/providers (like ours), validate inputs (like DAF), maintain autonomy (like ours), and give users runtime control (like ours) - the best of both worlds.
