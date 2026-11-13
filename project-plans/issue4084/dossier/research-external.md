# Code mode is useful for tool orchestration; subagents still serve a different purpose

**Research date: 2026-11-13.** This dossier covers generated code that invokes agent tools, sometimes called code mode, programmatic tool calling, or code-as-action. It uses official documentation, maintainers' posts, research papers, and implementation source. Repository snapshots and downloaded files are recorded in [`sources/manifest.json`](sources/manifest.json). No application code was changed, and no product benchmark was run for this report.

## Executive findings

Code mode moves loops, joins, filtering, and other tool orchestration into an execution environment. It can keep large intermediate payloads out of the model's context and avoid having the model copy data between calls. Tool discovery can be made lazy at the same time, but these are separate optimizations. Cloudflare's September 2025 article initially loaded the entire generated API; its current SDK adds discovery and a durable approval runtime. Anthropic's November 2025 MCP article describes filesystem-based discovery, while its current API offers a hosted Python implementation with a pause/resume protocol. [CF25] [CF-DURABLE] [A-MCP] [A-PTC]

Adoption is broader than older surveys suggest. Pydantic AI Harness, Cloudflare, Anthropic's API, smolagents, Goose, OpenCode, Amp, Pi, UTCP, and pctx have documented implementations. Codex has a dedicated V8 code-mode host in current source, but the principal `code_mode` flag remains under development and off by default in the inspected snapshot. Claude Code **announced an experimental opt-in JavaScript Code Mode on November 12, 2026**, one day before this report; its linked documentation was unavailable during research. Gemini CLI, Cursor, and Cline have no native implementation verified in the reviewed primary sources. Their ability to connect to a code-mode MCP proxy is a separate matter. [AI-DOC] [CODEX-FEATURES] [CC-RELEASE] [GEMINI] [CURSOR] [CLINE]

The best recent quantitative source found is Pydantic's October 28, 2026 internal benchmark: 5,276 graded runs across eight models, with reported long-task reductions of 58% in cost and 51% in wall time. Those results used `CodeMode(eager=True)` and narrow CRUD applications, not arbitrary coding work. Crucially, native tool calling already batched many independent calls, so request-count reductions were much smaller than cost reductions. Large savings came from context and generated-call-token reductions. This is vendor evidence, not independently reproduced evidence. [AI-BENCH]

Code mode and a cheap research subagent are complementary. A program can fetch 500 records and compute an exact aggregate without another model reading every record. A subagent can investigate an unfamiliar subsystem, interpret ambiguous evidence, and return a focused account. Both reduce the parent's context, but only delegation adds another reasoning context. No credible, controlled head-to-head benchmark comparing code mode with an otherwise equivalent cheap retrieval subagent was found in the reviewed sources. The available research supports workload-specific choices, not a universal winner. [A-MULTI] [CC-SUB] [CODEACT]

## 1. Definitions and scope

For this report, code mode has three parts:

1. A **model-facing program surface**, such as `run_code`, `execute`, or `exec`, in which generated code can invoke existing agent tools.
2. A **runtime and bridge** that execute that program and dispatch calls to the real tools.
3. An **output boundary** through which only selected results, errors, or artifacts reach the model.

Discovery is optional: functions can be described upfront, searched in a catalog, or represented as files. MCP remains the connectivity layer in many implementations. A code-mode wrapper changes how the model orchestrates calls; it does not require replacing the underlying MCP servers. Cloudflare's original post and FastMCP's server transform both make this distinction concrete. [CF25] [FASTMCP]

A shell tool alone does not establish code mode. It might permit a model to write a script, but it does not necessarily expose the agent's existing tools as callable functions with preserved policy checks. Similarly, tool search alone changes definition loading, not execution. Roo's product mode named “Code” is a coding role, which does not by itself imply this pattern. [A-SEARCH] [ROO]

**Native parallel calling is a valid baseline.** Some explanatory articles describe ordinary tool calling as necessarily one call per model turn. That is too restrictive. Pydantic's measured baseline emitted as many as 200 calls in one response. Code mode additionally expresses dependent computation and dataflow between calls without another inference, and can suppress intermediate payloads. Those are the more durable distinctions. [AI-BENCH]

### The dataflow

```text
Direct tools:
  model -> tool A -> result in model context -> model -> tool B

Code mode:
  model -> generated program
             -> tool A -> variable -> filter/join -> tool B
             -> selected output -> model

Delegation:
  parent model -> worker model with its own tools/context
               -> selected evidence or summary -> parent model
```

The diagram is an analytical abstraction. Actual implementations can batch direct calls, execute calls concurrently inside a program, or let a worker use code mode. [A-PTC] [AI-BENCH] [SMOL-INTRO]

## 2. Pydantic AI and Monty

### 2.1 Public API and historical naming

Current Pydantic documentation presents **`CodeMode()` as a Pydantic AI Harness capability**, installed with `pydantic-ai-harness[codemode]`; `code-mode` is an alias for the extra. It wraps eligible tools in one `run_code` tool. The implementation class is still named `CodeModeToolset`. Older examples and the February 27, 2026 Monty launch article use `CodeModeToolset` or the then-planned `CodeExecutionToolset`; those names should not be mistaken for today's preferred setup. [AI-DOC] [AI-TOOLSET] [MONTY-LAUNCH] [MONTY-EXAMPLES]

Current host setup, abbreviated from the documented API:

```python
from pydantic_ai import Agent
from pydantic_ai_harness import CodeMode

agent = Agent('openai:gpt-5', capabilities=[CodeMode()])

@agent.tool_plain
async def get_weather(city: str) -> dict:
    return {'city': city, 'temp_f': 72}
```

The model can then write a snippet like this. The function contract comes from the registered tool; this example assumes normal async, non-sequential exposure:

```python
import asyncio
reports = await asyncio.gather(
    get_weather(city='Paris'),
    get_weather(city='Tokyo'),
)
[{'city': x['city'], 'temp_c': (x['temp_f'] - 32) * 5 / 9}
 for x in reports]
```

Tool functions are already defined in the sandbox and take keyword-only arguments. Non-sequential tools are rendered as `async def`; tools flagged sequential are synchronous and resolved inline. Generated Python signatures, type definitions, descriptions, and type-checking stubs are built from the tools' definitions. The last non-`None` expression returns structured data; `print()` is for supplementary output rather than the preferred result transport. [AI-TOOLSET, lines 508–580, 609–640, 1331–1345, 1619–1631]

### 2.2 Execution and return path

The source path is now `src/pydantic_ai_harness/pydantic_ai_harness/` in `pydantic/pydantic-ai`. This matters because older standalone-repository examples can lag the monorepo. The inspected implementation does the following:

- Partitions eligible tools and leaves framework-control tools, undiscovered deferred tools, native fallbacks, and other execution tools outside the program surface. A selector chooses which tools are folded in. **Unselected tools remain direct tools; the selector does not revoke them.** [AI-CODE-TOOLS] [AI-TOOLSET]
- Checks out a Monty session from a local subprocess pool or a configured remote pool. It uses the snapshot/suspension API, including `feed_start` and resume operations, rather than invoking ordinary CPython `exec` on the model's program. [AI-MONTY-EXEC] [AI-TOOLSET, lines 1351–1386]
- On a sandbox function call, maps the generated function name to a real tool, reserves its budget, and dispatches through a nested framework `ToolManager`. The host tool runs outside the language sandbox. Its value is marshaled back into Monty, where the program continues. [AI-TOOLSET, lines 1501–1555] [AI-CODE-TOOLS, lines 148–208]
- Records nested tool calls and returns in metadata/history. A `ToolReturn.return_value` enters the program, while separate `ToolReturn.content`, such as a screenshot, is delivered to the model alongside the enclosing result instead of being forced into the sandbox. [AI-TOOLSET, lines 721–810] [AI-CODE-TOOLS, lines 204–208]

The output is not limited to a text transcript: a last-expression value can remain structured; print-only returns an `output` wrapper; print plus an ordinary value returns `output` and `result`; multimodal values have a separate native-content path. [AI-TOOLSET, lines 560–579, 1395 onward]

### 2.3 Async execution and policy

Monty supports the async subset needed for this use case. `await asyncio.gather(...)` fans out host tool calls; the executor resolves pending external futures and returns their results to the interpreter. This is not a complete CPython event loop. In particular, the model-facing instructions say not to use `gather` keyword arguments or other task-creation/wait APIs. Global sequential execution policy and each tool's sequential flag still constrain execution. [AI-MONTY-EXEC] [AI-TOOLSET, lines 609–640, 1331–1333] [MONTY-ASYNC]

Nested authorization is preserved rather than implicitly waived. `run_nested_call` waits for input-guardrail approval, checks usage limits, and calls `tool_manager.handle_call`. A denied tool becomes an error at the program call site. Approval-required or deferred calls need an inline `HandleDeferredToolCalls` handler; without one, the source returns an explicit configuration error instead of silently running the tool. This is an important deployment requirement for interactive approvals. [AI-CODE-TOOLS, lines 148–208]

Current docs also describe eager and speculative execution, which can overlap generation with execution. They are additional mechanisms, not part of the definition of code mode. The default capability has `eager=False`; the October benchmark enabled it. Speculation requires a separate allowlist/configuration and changes side-effect timing, so it should not be assumed safe for arbitrary writes. [AI-CAPABILITY] [AI-DOC] [AI-BENCH]

### 2.4 Limits, persistence, and discovery

The inspected Harness defaults are:

| Limit or behavior | Current source behavior |
|---|---|
| Per-snippet execution | 30 seconds; time awaiting host tools does not count |
| Heap | 256 MiB |
| Nested calls | 100 per `run_code`; reserved before scheduling |
| Session suspensions | 1,000 cumulative by default; external calls, OS callbacks, lookups, and future resolutions consume this budget |
| Sleep | Separately charged/bounded; it is not simply CPU execution |
| REPL | State persists between snippets within an agent run; `restart: true` resets it |
| Across agent runs | Fresh by default; configurable `repl_store` can retain state |
| Temporal workflows | Ordinary elapsed execution cap is altered for deterministic replay; do not apply the ordinary timeout description unchanged |

Sources: [AI-TOOLSET, lines 337–383, 560, 915–969, 1351–1376] [AI-DOC]. These are Harness defaults, not blanket limits of every Monty embedding. Host callbacks need their own deadlines and allocation/rate limits because waiting and host allocations are not automatically covered by the sandbox's execution/heap budget. [MONTY-SECURITY]

The preferred `CodeMode` capability defaults to `dynamic_catalog=True`: evolving signatures are placed in append-oriented instructions rather than repeatedly changing the cache-sensitive `run_code` definition. Direct construction of `CodeModeToolset` retains `dynamic_catalog=False` for its existing behavior. Deferred tool discovery remains a separate integration. Code mode does not automatically make every tool definition disappear. [AI-CAPABILITY] [AI-TOOLSET, lines 951–965]

By default, the Harness does not grant filesystem/environment access or clock access through an OS handler. `os_policy` can explicitly supply a clock, time zone, or randomness policy. Mounts can grant file access: overlay writes last only for the current `run_code` call, while read-write mounts affect host files. A host path is not necessarily the same filesystem as an agent's remote coding workspace. [AI-CAPABILITY, lines 140–150] [AI-TOOLSET, lines 515–555] [AI-DOC]

### 2.5 What Monty actually is

Monty is a from-scratch Rust interpreter for a Python 3.14 subset, intended for generated orchestration code. It is not restricted CPython and does not require a container per snippet. The current repository has Python, JavaScript/TypeScript, and Rust bindings, worker-pool/runtime crates, resource accounting, type checking, and snapshot support. The inspected Cargo workspace version is `1.6.0`; that is source-snapshot metadata, not proof that every distribution has the same released version. [MONTY-README] [MONTY-LIB] [MONTY-RUN] [MONTY-CARGO]

Its host bridge can be very small. Current README example, abbreviated:

```python
from pydantic_monty import Monty

with Monty() as pool:
    with pool.checkout() as session:
        answer = session.feed_run(
            "nutrition('chocolate')['kcal'] * 4184",
            external_lookup={'nutrition': lambda food: {'kcal': 230}},
        )
```

The generated code calls `nutrition`; the function runs on the host, and only its return value crosses back. The interpreter's resumable form lets an async harness dispatch these calls while retaining the program's state. [MONTY-README, lines 43–66] [AI-MONTY-EXEC]

**Security boundary:** Monty's own security documentation calls it a **language-level sandbox, not an OS-level sandbox**. The language lacks ambient sockets, arbitrary host imports, process creation, and unrestricted host object access. Host functions, explicitly wrapped objects/classes, mounts, OS callbacks, and selected host modules grant capabilities. Native Python/JavaScript pools use worker subprocesses for crash isolation; that alone is not equivalent to a kernel-enforced filesystem/network policy. [MONTY-SECURITY]

The clock defaults differ by layer. Bare Monty sessions normally read the system clock in UTC and obtain random entropy; the Harness overrides its default policy to route those through `os_access`, making them unavailable without a handler. A blanket claim that “Monty cannot read a clock” would therefore be wrong. [MONTY-SECURITY, lines 289–334] [AI-CAPABILITY, lines 140–150]

Mount confinement uses descriptor-relative access through `cap_std::fs::Dir`, virtual path normalization, and symlink/path rules. The security document also calls out callback authority, in-process execution, untrusted snapshot loading, and host-side resource use as places where guarantees weaken. These are implementation boundaries, not a claim of an independently audited, escape-proof sandbox. [MONTY-SECURITY]

The current Python subset supports functions, async/await, comprehensions, exceptions, simple classes, controlled imports, and a selected standard library. It does not provide arbitrary third-party packages, inheritance/metaclasses, general generator functions, or full asyncio. Recent support is broader than early articles: consult current limitations rather than assuming launch-era restrictions still apply. [MONTY-LIMITS]

**Maturity:** Monty is distributed software used by Pydantic's framework and other projects, rather than only a proposal. It remains a specialized Python subset with evolving APIs. Harness is documented as 0.x, with API changes possible across minor releases. Pydantic's sub-millisecond startup claims are measurements from its own running-pool setup; they do not establish end-to-end speed for an arbitrary application. [MONTY-README] [AI-DOC] [AI-PACKAGE] [FASTMCP]

IPython Code Mode is a separate alternative: a persistent full-CPython kernel with the agent user's permissions. It can use packages unavailable in Monty, but needs an enclosing sandbox for untrusted or server-side code. Do not transfer Monty's authority restrictions to IPython merely because both expose `run_code`. [AI-IPYTHON]

## 3. Cloudflare: the named Code Mode pattern

### 3.1 September 26, 2025 design

Kenton Varda and Sunil Pai's **“Code Mode: the better way to use MCP”** popularized the term for this MCP pattern. Executable-code actions themselves predate it, including CodeAct in 2024. Cloudflare converted MCP schemas into TypeScript declarations and doc comments, gave the model one code-writing tool, and executed the resulting program inside a dynamically loaded Worker/V8 isolate. [CF25] [CODEACT]

A shortened version of the model-visible surface in that article:

```typescript
declare const codemode: {
  search_agents_code(input: {
    query: string;
    page?: number;
  }): Promise<{ [key: string]: any }>;
};
```

An adapted model program using that contract:

```javascript
const hits = await codemode.search_agents_code({ query: 'WorkerLoader' });
console.log(hits);
```

The supervisor, not the generated program, owns the actual MCP connection and tokens. Worker RPC bindings route calls back to it. The described configuration disables general `fetch()`/`connect()` and grants specific interfaces through bindings instead, keeping API keys out of the sandbox. This reduces key exposure; it does not prevent a permissive tool from returning a key or sending sensitive data to an allowed destination. [CF25]

The original post loaded the **whole** generated TypeScript API into context and described dynamic browsing as future work. It returned output through captured `console.log`. Worker Loader was a production closed beta then. Those statements are historical and should not be copied as the current SDK contract or current platform availability. [CF25]

### 3.2 Current SDK behavior

Current Cloudflare documentation uses `@cloudflare/codemode` and `DynamicWorkerExecutor`, with typed tool providers, generated JavaScript orchestration, and RPC proxies. The executor documentation describes a fresh isolated Worker per execution, a 30-second default timeout, captured output, and `globalOutbound: null` to block general outbound access. Worker Loader itself also supports routed outbound access when explicitly configured. [CF-SDK] [CF-EXECUTOR] [CF-LOADER]

Host configuration, abbreviated:

```typescript
const executor = new DynamicWorkerExecutor({
  loader: env.LOADER,
  timeout: 30_000,
  globalOutbound: null,
});
const codemode = createCodeTool({ tools, executor });
```

The current durable connector runtime adds a higher-level path:

```javascript
async () => {
  const matches = await codemode.search('list saved notes');
  const docs = await codemode.describe(matches.results[0].path);
  const savedNotes = await notes.listNotes();
  return { docs, savedNotes };
};
```

Connector names become globals such as `notes`. Methods can specify `requiresApproval: true`. The durable runtime stores history, pending approvals, and snippets across Durable Object hibernation; approval resumes through replay, returning recorded results for completed calls rather than executing them again. Rejection does not undo prior actions. Rollback is compensation through a connector's optional `revert`, not a general transaction across arbitrary services. The durable guide was last updated July 22, 2026 and still labels Code Mode experimental. [CF-DURABLE]

This current approval support is a concrete counterexample to the claim that code mode necessarily loses per-call human approval. Losing it is an integration failure or a design choice, not an unavoidable property of generated programs. [CF-DURABLE]

## 4. Anthropic: three related but distinct surfaces

### 4.1 The November 4, 2025 MCP engineering article

Adam Jones and Conor Kelly's article describes an architecture, including TypeScript files for each MCP operation. An agent lists server directories and reads selected files rather than loading every definition upfront. Each module wraps a normal `callMCPTool` operation. It can also use a `search_tools` function instead of filesystem navigation. [A-MCP]

Model-facing code from the article, shortened:

```typescript
import * as gdrive from './servers/google-drive';
import * as salesforce from './servers/salesforce';

const transcript = (await gdrive.getDocument({ documentId: 'abc123' })).content;
await salesforce.updateRecord({
  objectType: 'SalesMeeting',
  recordId: '00Q5f000001abcXYZ',
  data: { Notes: transcript },
});
```

The document moves from one service to another without the model reading and then reproducing its contents. Another example filters a 10,000-row spreadsheet and logs five rows. Loops, branches, polling, and error handling execute in code instead of requiring inference for every decision whose rule is already known. [A-MCP]

The article's **150,000 to 2,000 tokens, or 98.7% saving**, is its described discovery example, not a measured universal agent improvement. Privacy is also scoped: intermediate data stays out of the model context if it is not logged/returned. The proposed PII tokenization/untokenization layer is additional harness functionality, not automatic behavior of MCP or all code-mode runtimes. The environment and tool providers still process the data. [A-MCP]

With filesystem access, the agent can save intermediate artifacts and working helper scripts, later package them with `SKILL.md`, and reuse them. Such persistence depends on the configured workspace. It is not a guarantee that a disposable isolate retains variables, nor evidence by itself that Claude Code implemented this architecture in November 2025. [A-MCP]

### 4.2 Claude API programmatic tool calling

The current API offers a separate, concrete **Python** implementation in the hosted code-execution container. It is documented as stable and requires `code_execution_20260120` or later. The November 24, 2025 launch used older beta-era versioning; current examples should follow current documentation. [A-PTC] [A-ADVANCED] [A-EXEC]

Abbreviated host tool definition:

```json
{
  "name": "query_database",
  "description": "Return rows as JSON text",
  "input_schema": {
    "type": "object",
    "properties": { "sql": { "type": "string" } },
    "required": ["sql"]
  },
  "allowed_callers": ["code_execution_20260120"]
}
```

Include `{"type":"code_execution_20260120","name":"code_execution"}` in the request's tools. The model writes Python against **async functions taking one dictionary and returning the text of the supplied tool result**:

```python
import asyncio
import json

raw = await asyncio.gather(
    query_database({'sql': 'SELECT revenue FROM west_sales'}),
    query_database({'sql': 'SELECT revenue FROM east_sales'}),
)
rows = [json.loads(text) for text in raw]
print([sum(row['revenue'] for row in region) for region in rows])
```

This example assumes those read-only queries and JSON contracts exist. Unlike Pydantic's keyword-only generated surface, the current Claude API bridge takes a single dict. [A-PTC]

The pause/resume sequence is important:

1. Claude generates a program and the server starts it.
2. A bridged call pauses execution and returns a normal `tool_use` block to the application, with `caller.type` identifying code execution and `caller.tool_id` identifying its enclosing execution.
3. The application performs the real tool operation, applies its authorization/approval rules, and supplies a `tool_result`.
4. The container resumes without an intervening model inference. Intermediate result text is processed by the program rather than injected into Claude's context.
5. Claude sees the execution's selected output when it completes. [A-PTC]

This saves **model** round trips, not necessarily client/server network exchanges. The tools have not magically moved into Anthropic's infrastructure; client tools still run where the application runs them. [A-PTC]

Security and operational details from the current docs:

- `allowed_callers` guides presentation and is checked against tool-choice configuration, but is **not a hard API-level security block on direct calls**. The client must authorize every request it receives. [A-PTC]
- The hosted container has no general Internet access and provides preinstalled libraries plus Bash/file operations. Broader authority arrives through opted-in client tools. [A-EXEC]
- Reusing the returned container ID preserves files and, with a supporting version/model, Python REPL state. Pending programmatic-call continuations require that container ID and the original tools array. [A-PTC] [A-EXEC]
- Current docs say containers expire 30 days after creation and checkpoint after inactivity. A pending tool call instead times out after about four minutes; `expires_at` on the response is not that deadline. These are separate lifetimes. [A-PTC]
- `code_execution_20260521` uses the same runtime as `20260120` but tells the model about a 90-second per-Python-cell wall-clock limit. Older examples with `20250825` do not define the current PTC contract. [A-EXEC]
- Support varies by model/platform. In particular, Haiku 4.5 can accept newer code-execution versions without supporting programmatic calling or its REPL persistence. The Models API exposes separate capabilities for accepting code execution and for programmatic calling. [A-PTC] [A-EXEC]
- The current documentation marks code execution/PTC as not eligible for zero data retention, with container data retained up to 30 days. Keeping data out of model context is not the same as keeping it off the provider's execution servers. [A-PTC] [A-EXEC]

Current PTC limitations include lack of support for `strict: true` tools in programmatic calling and inability to force a particular nested programmatic call through `tool_choice`. Confirm these against the deployed API version rather than extrapolating from direct-tool support. [A-PTC]

### 4.3 Tool search and reported savings

Anthropic's tool-search tool uses regex or BM25 discovery and `defer_loading`. Deferred definitions are withheld from model context until discovered, even though the application sends full definitions with requests. This optimizes the catalog rather than running the operations itself. Tool search and PTC can be combined, but one is not a prerequisite for calling every tool programmatically. [A-SEARCH]

The November 24, 2025 advanced-tool-use announcement reports a **37% average token reduction**, from 43,588 to 27,297 on a complex research workflow, plus internal knowledge-retrieval accuracy from 25.6% to 28.5% and GIA from 46.5% to 51.2%. It separately reports tool-definition savings from tool search. Current PTC docs cite dynamic-filtering search results averaging 11% better performance with 24% fewer input tokens. These are different evaluations and must not be merged into one percentage or treated as coding-CLI results. [A-ADVANCED] [A-PTC]

## 5. smolagents and CodeAct

### 5.1 CodeAgent

Hugging Face launched smolagents on December 31, 2024. Its `CodeAgent` is a ReAct-style agent whose actions are Python programs, while `ToolCallingAgent` retains ordinary structured calls. Tools become functions in the execution environment; the program can store objects, define helpers, loop over inputs, and call multiple tools before the next model step. [SMOL-LAUNCH] [SMOL-README] [SMOL-INTRO]

Model-written action adapted directly from the repository example:

```python
requests_to_search = ['gulf of mexico america', 'greenland denmark', 'tariffs']
for request in requests_to_search:
    print(web_search(request))
```

Tools are described as Python functions, rather than requiring the model to emit one JSON action for each search. The action's printed outputs/errors become observations for the next step; this example would not save much result context unless it also filters the results. Code actions enable selective output but do not force it. [SMOL-README] [SMOL-INTRO]

The default local executor is an AST-interpreting Python environment with import allowlisting and operation limits. Official docs explicitly warn that local execution is not completely secure. Optional snippet executors include E2B, Modal, Docker, and Blaxel, with different deployment and credential constraints. Sandboxing the snippet is distinct from sandboxing the entire agent and all its tools. The executor/session can retain variables, but persistence and package availability depend on the executor chosen. There is no universal per-tool human approval model imposed by `CodeAgent`; applications must provide the policy boundary. [SMOL-SECURITY] [SMOL-SOURCE]

The framework can expose managed agents alongside tools, so code actions and delegation can compose within one system. This is a concrete example of why the two patterns are not mutually exclusive. [SMOL-SOURCE] [SMOL-INTRO]

### 5.2 Wang et al., 2024: what the paper found

**“Executable Code Actions Elicit Better LLM Agents”** by Xingyao Wang and colleagues first appeared in February 2024; the inspected v4 is dated June 7, 2024. It introduced CodeAct as executable Python actions with multi-turn observations and self-debugging. Its experiments covered 17 models, API-Bank atomic tool use, and the authors' 82-task M3ToolEval. [CODEACT] [CODEACT-REPO]

Reported findings include up to approximately **20 percentage points higher success** and **30% fewer actions** on complex tasks. The specific GPT-4-1106-preview comparison in Table 3 is 74.4% CodeAct versus 53.7% text and 52.4% JSON, with average turns 5.5 versus 7.7 and 7.6. CodeAct was the best-performing format, counting ties, for 12 of 17 evaluated models on complex-task success. It was not best for every model. [CODEACT, §2.2–2.3 and Table 3]

This evidence should be scoped to its 2024 models, prompts, tool contracts, and ten-turn task limit. The paper does not prove a uniform advantage over current provider-native batched/strict tool calling. Its own small-model results include very low absolute success and cases where JSON/text won. Smolagents' “30% fewer steps” messaging echoes this line of evidence; it is not a guarantee that every contemporary CodeAgent task saves 30%. [CODEACT] [SMOL-README]

## 6. Coding agents and CLI adoption as of 2026-11-13

### 6.1 Goose: implemented, with a changed API

Goose's current built-in Code Mode extension exposes **`list_functions`, `get_function_details`, and `execute_javascript`**. Generated code defines `async function run()` and invokes exact tool identifiers through `tools.call`. Discovery returns original JSON input/output schemas, including recursive schemas, rather than forcing every schema into a guessed static type. [GOOSE-DOC] [GOOSE-EXEC]

```javascript
async function run() {
  const results = await Promise.all([
    tools.call('extension__first_tool', { query: 'example' }),
    tools.call('extension__second_tool', { limit: 5 }),
  ]);
  return results.map(result => result.summary);
}
```

The example is the documented shape; real identifiers/fields come from discovery. A fresh Goose-owned **Boa** JavaScript context executes each program. It has JS built-ins, captured console methods, and the tool bridge, but no ambient filesystem, shell, network, environment, or packages. Instructions, loops, recursion, console output, JSON depth, and item counts are bounded. State is discarded per execution. [GOOSE-DOC] [GOOSE-JS]

Calls retain extension leases, normal permission flow, cancellation, and extension mutation handling. Only assistant-visible text content reaches the script; images and binary result content are ignored. These are material differences from a general JavaScript runner and from Pydantic's multimodal handling. [GOOSE-DOC, lines 42–79] [GOOSE-EXEC]

Historical Goose writing describes `search_modules`, `read_module`, and `execute_code` with TypeScript-style modules and dates initial support to late 2025. Those names should not be used to describe the inspected current implementation. [GOOSE-HISTORY] [GOOSE-DOC]

### 6.2 OpenAI Codex: implementation present, main feature gated

Current Codex source contains `code-mode-host`, `code-mode-protocol`, and core/app-server integration. The generated tool description specifies **raw JavaScript evaluated as an async module in a fresh V8 isolate**, with all nested tools on `tools`. It has no Node APIs, filesystem, network, or console. Output uses `text`, image/audio helpers, or notifications; `store`/`load` retain serializable session values. `exec` can yield to a `wait` tool for long-running cells, and deferred tool search returns declarations. [CODEX-DESCRIPTION, lines 17–56] [CODEX-HOST] [CODEX-CORE]

An adapted model program:

```javascript
const matches = await tools.tool_search({ query: 'repository search', limit: 8 });
text(matches);
```

After discovery, code can call the exact exposed `tools.<name>(args)` methods and return only selected fields with `text`. Host dispatch uses the normal `ToolCallRuntime`; JavaScript's lack of ambient access does not revoke the capabilities of an approved shell or MCP tool. [CODEX-DESCRIPTION] [CODEX-DELEGATE]

The inspected feature registry is precise about status: `code_mode`, `code_mode_tool_search`, and `code_mode_only` are `UnderDevelopment` and `default_enabled: false`. Supporting flags such as the standalone host and gRPC transport are stable/on. **Stable host infrastructure does not mean code mode is enabled by default for users.** This dossier does not claim that current `main` is identical to an installed release. [CODEX-FEATURES, lines 1309–1385]

Older Node-backed `js_repl` material should not be conflated with this V8 host. The inspected registry marks `js_repl_tools_only` removed; use current feature/source evidence rather than describing Codex solely through that older experiment. [CODEX-FEATURES, lines 1387 onward]

### 6.3 Claude Code: newly announced experiment, details unavailable

Claude Code v2.1.323, released **November 12, 2026**, announces “Code Mode,” an **experimental opt-in in which Claude writes JavaScript to call its tools**, with an organizational opt-out. This is corroborated by both the official release and raw changelog, not inferred from the Claude API feature. [CC-RELEASE] [CC-CHANGELOG]

The linked `code.claude.com/docs/en/code-mode` page returned unavailable responses during research, and issue #109442 reports the broken link on November 13. Therefore this report cannot establish the CLI runtime, exact globals, nested approval behavior, state persistence, or enabling configuration. No runnable CLI-specific snippet is supplied because that would invent an interface. The earlier Python API example is **not** evidence of those JavaScript CLI details. [CC-DOC-ISSUE]

Claude Code also has subagents, shell execution, skills, and ordinary MCP integration, but those are separately documented features. Old claims that Claude Code has no Code Mode are now stale; equally, the one-line announcement does not justify filling in its internals from another product. [CC-SUB] [CC-RELEASE]

### 6.4 OpenCode: current product uses a confined interpreter

OpenCode's official docs describe **`execute`** as JavaScript Code Mode, and MCP tools use it by default unless a server sets `codemode:false`. Its `@opencode/codemode` library implements a **JavaScript-like language interpreter**, not a full Node process or an arbitrary-JavaScript VM. Unsupported syntax yields diagnostics. Host tools can be nested under namespaces; Effect schemas validate/copy data, while render-only JSON schemas describe shapes without themselves providing runtime validation. [OC-DOC] [OC-MCP] [OC-README]

Model code from the library's documented contract:

```javascript
const order = await tools.orders.lookup({ id: 'order_42' });
return { id: order.id, needsAttention: order.status !== 'complete' };
```

The library has no ambient filesystem/network/process access. **The OpenCode product adds a `fetch` extension for HTTP**, so “OpenCode code mode has no network” would be incorrect. Product instructions forbid imports, direct filesystem access, and timers; other external operations go through tools. [OC-README, lines 1–25] [OC-TOOL, lines 76–80]

Built-in/MCP nested calls retain their permissions; plugins enforce the permissions they assert. Denying `execute` exposes underlying tools directly rather than revoking them, so the underlying tools must also be denied to remove authority. The library supports snapshots, suspended runs, stable call keys, and before/after hooks that can deny calls. That does not imply the CLI retains arbitrary JavaScript globals between unrelated `execute` calls. [OC-DOC] [OC-README, lines 85–120] [OC-DEFAULTS]

### 6.5 Amp: confirmed discovery plus programmatic execution

Amp's current official MCP docs, last modified November 4, describe **`tool_search` plus `code_exec`**. Remote server IDs become module names used by generated imports. Discovery includes return types from an MCP `outputSchema`; imported calls return promises. Awaiting a remote call yields `structuredContent` when present, otherwise text with object/array JSON parsing. Calling `.raw()` on that promise retrieves the full response from the same call without running the operation twice. [AMP-MCP]

Short API fragment illustrating the documented call-promise behavior, assuming `fn` is an imported discovered operation:

```javascript
const pending = fn(input);
const rawReply = await pending.raw();
```

The reviewed primary page establishes the behavior but not a public sandbox-engine implementation, so this report does **not** assign Amp a V8/QuickJS/Deno runtime or assert arbitrary module/network restrictions. Stable server IDs matter: a catalog edit can redirect later imports to a different server. [AMP-MCP]

Remote tools support Allow, Ask First, and Disabled. Ask First pauses `code_exec` until the owner approves the specific tool/input; subagents cannot call tools requiring an answer they cannot wait for. Policies are checked on every nested call. These rules apply to remote definitions stored on ampcode.com, and should not be generalized to every local executor MCP configuration. General Amp tools default to no approval and can be governed by plugins. [AMP-MCP] [AMP-TOOLS]

### 6.6 Pi: another documented implementation

Pi's current Code Mode runs raw JavaScript as an async-function body inside **QuickJS**, without ambient Node/filesystem/network/timer APIs. It exposes `tools`, explicit output helpers, `ALL_TOOLS`, BM25 `searchTools`, and declaration lookup. `on` mode can retain direct tools; `only` hides them behind scripts. [PI]

```javascript
const matches = await searchTools('repository search');
text(matches);
store('candidate-tools', matches.map(x => x.name));
```

The documented VM limit is 256 MB. Whole-script timeout is optional and unset by default; two workers per process is the default, with a separate worker-queue timeout. Small JSON store writes commit on successful scripts and persist in session branches. Earlier tool side effects are not rolled back when a script fails, and unfinished calls are cancelled. Pi also allows classifier/image-model operations from scripts, but not arbitrary chat-model subagent calls through that `models` interface. [PI]

### 6.7 Gemini CLI, Cursor, Cline, and Roo: what was and was not verified

| Product | Finding from reviewed primary sources | Important distinction |
|---|---|---|
| Gemini CLI | **No native code-mode tool-orchestration implementation verified.** Official tools/shell/MCP/sandbox documentation describes conventional operations and approvals. [GEMINI] [GEMINI-MCP] [GEMINI-SANDBOX] | A shell can run scripts, and an external SDK/MCP server can add code mode. Neither proves upstream CLI-native support. |
| Cursor | **No native code-mode runtime verified.** Current official MCP docs describe integration, tool approval, and MCP capabilities. [CURSOR] | Connecting Cursor to pctx, UTCP, or FastMCP CodeMode is server-side code mode, not evidence of a Cursor-native interpreter. |
| Cline | **No native implementation verified.** Official MCP documentation covers local/remote servers and granular auto-approval. [CLINE] | Plan/Act is workflow state, not programmatic tool composition. |
| Roo Code | **Its named Code mode is a coding persona/tool role, not evidence of code-as-tool-orchestration.** No separate native implementation verified in the checked material. [ROO] | The name is a collision. No unsupported lifecycle/shutdown claim is needed to answer this question. |

These are bounded negative findings, not claims that every extension, experimental build, or undisclosed implementation lacks the feature. A standard MCP client can use an external execution-tool server without a native runtime change. FastMCP explicitly documents this server-side approach. [FASTMCP]

## 7. Community and server-side projects

### 7.1 UTCP Code Mode

`universal-tool-calling-protocol/code-mode` supplies TypeScript/Python libraries plus an MCP bridge and CLI. It can register manuals for MCP, HTTP, file-described, and other UTCP tools; discovery yields interfaces, and generated programs call namespaced operations through `callToolChain`. [UTCP-README]

Model-written TypeScript from the documented interface, abbreviated:

```typescript
const pr = await github.get_pull_request({
  owner: 'microsoft', repo: 'vscode', pull_number: 1234,
});
return { title: pr.title, state: pr.state };
```

The **TypeScript implementation imports `isolated-vm`**, rather than relying on the README's looser “Node.js VM” wording. The inspected code defaults to 30,000 ms and 128 MB for the isolate, with marshaled host function dispatch. Namespaced tool authority still belongs to the host; generated interfaces and a memory cap do not authorize calls. [UTCP-TS, lines 1–2, 173–329 and bridge implementation]

The **Python implementation is materially different**. The inspected `code_mode_utcp_client.py` compiles with RestrictedPython, executes the wrapper in a context, and runs the function in a `ThreadPoolExecutor`, wrapped in `asyncio.wait_for`. It is **not an OS-isolated subprocess in this source path**. RestrictedPython and an async deadline do not establish killable process isolation; the code itself notes blocking sleep can bypass async timeouts. Treat any stronger cross-language security claim as unverified. This is source analysis, not an executed exploit. [UTCP-PY, lines 268–381]

### 7.2 Port of Context, pctx

pctx is a bring-your-own-model proxy that generates TypeScript namespaces for upstream MCP tools and callbacks. Its current source distinguishes **Catalog**, **Filesystem**, and **Sidecar** disclosure. Catalog defaults to discovery plus typed namespace calls; Filesystem exposes generated declarations through a virtual filesystem; Sidecar uses direct MCP descriptions with a typed `invoke` map. [PCTX-DOC] [PCTX-README]

Model-written code from the documented namespace surface:

```typescript
const orders = await store.getOrders();
const pending = orders.filter(o => o.status === 'pending');
console.log({ count: pending.length,
  total: pending.reduce((sum, o) => sum + o.amount, 0) });
```

It type-checks TypeScript, then executes in Deno and routes calls through `PctxRegistry` to real MCP servers/Rust callbacks. Docs describe a fresh V8 context, no host filesystem/subprocess access, restricted network to configured MCP hosts, and preauthenticated clients; the simpler guide describes a ten-second timeout. The current source's multiple disclosure/workflow modes should not be reduced to one historical three-tool interface. [PCTX-DOC] [PCTX-README, lines 139–165, 583–596] [PCTX-SOURCE]

The familiar “150K to 2K” savings and “10–20x faster iteration” on type errors are project claims, not independent pctx benchmarks established here. No universal human approval workflow or persistent in-memory REPL contract was verified. Credentials staying in a proxy also does not remove the need to authenticate the proxy itself. [PCTX-DOC]

### 7.3 FastMCP and Red Hat codemode-lite

FastMCP 3.1 introduced a server-side `CodeMode` transform on March 3, 2026. It replaces ordinary tools with configurable discovery and execution tools. The default flow is BM25 search, schema retrieval, then a Python program using `await call_tool(name, args)`. Monty is the default sandbox provider; providers are replaceable. Its author labels the feature experimental. [FASTMCP]

```python
a = await call_tool('add', {'x': 3, 'y': 4})
b = await call_tool('multiply', {'x': a, 'y': 2})
return b
```

This program is the transform's accepted script form, not necessarily a complete standalone Python module. The server-side design can benefit clients that only understand ordinary MCP tools. Discovery itself incurs extra steps, so small catalogs can instead use inline schemas. [FASTMCP]

Red Hat Emerging Technologies' **codemode-lite**, described April 23, 2026, exposes `run_python` and internal discovery helpers, with rootless Podman or Pyodide/Node backends. The author reports **53% lower token overhead** in one same-task comparison involving 38 tools across four servers, but **more** turns and calls: 21 to 25 turns and 10 to 15 tool calls. The claim is about overhead, not a demonstrated 53% universal cost reduction. It is an upstream prototype rather than a supported Red Hat product. [REDHAT]

The same article provides a useful failure report: its Node-hosted Pyodide JavaScript bridge exposed host capabilities until the project restricted it. The described patch is not an independent security audit or proof that all escape routes are closed. This illustrates why a runtime label such as “WASM” is insufficient without checking its host imports and bridges. [REDHAT]

## 8. Systems × features comparison

“Host policy” means that tool authorization belongs in the application/bridge; it does not mean an automatic human prompt exists. “Not verified” is intentional. All current documentation was accessed on 2026-11-13; source snapshots are listed below.

| System | Model language / runtime | Tool exposure | Approval model | Persistence | Status/evidence |
|---|---|---|---|---|---|
| Pydantic Harness CodeMode | Python subset / Monty subprocess or remote workers | Generated Python signatures; `run_code`; optional deferred discovery | Nested ToolManager; inline approval/defer handler required | REPL within run; optional cross-run store | Current documented feature; Harness 0.x. [AI-DOC] [AI-CODE-TOOLS] |
| Monty standalone | Python subset / Rust VM | Explicit host functions, objects, mounts/OS policies | Embedding application | Sessions/snapshots | Distributed runtime; source workspace 1.6.0, subset limits. [MONTY-README] [MONTY-SECURITY] [MONTY-CARGO] |
| Pydantic IPython mode | Python / full CPython kernel | `run_code` with tool bridge | Framework plus full kernel authority | Persistent kernel | Needs external isolation for untrusted execution. [AI-IPYTHON] |
| Cloudflare | JS programs with TS declarations / V8 Dynamic Workers | Typed proxies; connector search/describe or inline API | Host policy; durable connectors support per-call approval | Fresh execution isolate; durable history/replay/snippets optional | Current SDK still experimental. [CF-SDK] [CF-DURABLE] |
| Claude API PTC | Python / hosted sandbox container | Async dict-argument functions over API pause/resume | Client authorizes nested `tool_use`; caller hints not security | Container/files/REPL reuse | Stable docs; tool/model dependent. [A-PTC] [A-EXEC] |
| smolagents CodeAgent | Python / local AST interpreter or remote execution | Python functions and managed-agent callables | Application/tool-specific | Executor/session dependent | Available since 2024; local security warning. [SMOL-LAUNCH] [SMOL-SECURITY] |
| Goose | JS / fresh Boa context | Three meta-tools; `tools.call(exactName,args)` | Existing extension permission flow | None between executions | Built-in opt-in extension; API changed. [GOOSE-DOC] |
| Codex | JS / fresh V8 isolate, standalone host | `exec`/`wait`; `tools`; generated declarations/search | Existing host ToolCallRuntime | Explicit session store/load | Main feature under development/off in inspected source. [CODEX-FEATURES] [CODEX-DESCRIPTION] |
| Claude Code | JS / runtime not verified | Experimental programmatic tool calling announced | Internal per-call behavior not verified; org opt-out announced | Not verified | v2.1.323 announcement, 2026-11-12; docs unavailable. [CC-RELEASE] [CC-DOC-ISSUE] |
| OpenCode | JS-like subset / custom interpreter | `execute`, namespaces/catalog, product HTTP fetch | Nested permissions; plugin-defined checks | Library snapshots; no product REPL claim | MCP uses it by default in current docs. [OC-DOC] [OC-README] |
| Amp | JS/TS-style imported call surface / engine not verified | `tool_search`, `code_exec`, server modules | Remote Allow/Ask First/Disabled per call; plugins for general policy | Runtime variable persistence not verified | Current documented feature. [AMP-MCP] [AMP-TOOLS] |
| Pi | JS / QuickJS | `codemode`, `tools`, search/declarations/output helpers | Host tool checks; no separate universal prompt claimed | Small committed session/branch JSON store | Current documented option. [PI] |
| UTCP TS | TS input / transpiled JS in isolated-vm | Manuals, namespaces, discovery, callToolChain | Host integration | No cross-call REPL guarantee established | Community library/MCP bridge. [UTCP-TS] [UTCP-README] |
| UTCP Python | Python / RestrictedPython + host thread executor | Restricted contexts with registered tools | Host integration | No cross-call REPL guarantee established | Different/weaker isolation design than TS. [UTCP-PY] |
| pctx | TS / Deno V8 | Catalog/Filesystem/Sidecar; generated bindings | Host/proxy policy; human gate not verified | Connections/catalogs; REPL not verified | Community proxy/SDK. [PCTX-README] [PCTX-SOURCE] |
| FastMCP CodeMode | Python / Monty by default | Server transform; search/schema/execute | Host/server policy | Provider dependent | Experimental, introduced 3.1 in March 2026. [FASTMCP] |
| codemode-lite | Python / Podman or Pyodide/Node | `run_python` + RPC discovery/tool proxies | Host policy | Podman session; fresh Pyodide process/call | Red Hat upstream prototype. [REDHAT] |
| Gemini CLI / Cursor / Cline | No native language/runtime verified | Normal tools/MCP; external wrappers possible | Existing product approvals | Not applicable to an unverified native mode | Bounded negative findings. [GEMINI] [CURSOR] [CLINE] |
| Roo Code named mode | Coding role, not a verified execution bridge | Mode-specific tools | Normal product policy | Not applicable | Naming collision. [ROO] |

## 9. Performance evidence and what it does not establish

### 9.1 The October 2026 Pydantic benchmark

Michael Pfaffenberger's October 28 article reports **5,276 graded runs across eight models** on five small applications: cart, calendar, chat, kanban, and inventory. Operations were paginated and often single-item; there were no shell/filesystem/bulk shortcuts. Graders checked resulting application state. The tested code-mode arm used `CodeMode(eager=True)`, with the published package versions `pydantic-ai 2.56.1.dev13`, Harness `0.56.1.dev13`, and commit `b82f0f258f4d`. [AI-BENCH]

Reported long-task results were cost **-58%**, wall time **-51%**, and correctness **+16 percentage points**, with failures falling from **67/288 to 21/288**. At 200-item scale, task-level cost reductions were **47–75%** and time reductions **42–67%**. Small five-item cases could cost **21–38% more** on three of the tasks. Everyday tasks averaged 16% lower cost with a 1.6-point correctness difference described as noise. [AI-BENCH]

One calendar example makes the mechanism visible:

| Metric | Direct | Code mode |
|---|---:|---:|
| Underlying tool calls | 205 | 215 |
| Model requests | 8 | 6 |
| Input tokens | 183,723 | 34,461 |
| Output tokens | 4,430 | 573 |
| Wall time | 119.5 s | 28.5 s |
| Estimated list-price cost | $0.1425 | $0.0231 |

Source: [AI-BENCH]. The program did **more** tool calls, while the model consumed and emitted much less data. The article reports only 1–22% fewer model requests at the 200-item task scale, and some long-tier Claude cases made more requests. Native batching therefore belongs in any fair evaluation. [AI-BENCH]

Limitations: vendor-run, benchmark code not public at publication, selected small CRUD apps, eager execution included in the treatment, and costs estimated from list prices. The methodology describes randomized blocks, bootstrap intervals, infrastructure retries, and prompt ambiguity. These improve interpretability but do not turn the result into an independent reproduction or a forecast for this repository. [AI-BENCH]

### 9.2 Evidence ledger

| Source/date | Reported result | Scope/caveat |
|---|---|---|
| CodeAct, 2024 | Up to ~20 pp success, ~30% fewer actions | 17 historical models and curated tool benchmarks; not current CLI/code-mode vs subagent test. [CODEACT] |
| Anthropic MCP post, 2025-11-04 | 150K → 2K tokens, 98.7% | Described discovery example; not blanket agent savings. [A-MCP] |
| Anthropic advanced tools, 2025-11-24 | 37% average research-token saving | Vendor workload; distinct from tool-search savings. [A-ADVANCED] |
| Red Hat, 2026-04-23 | 53% lower token overhead; extra calls/turns | Small same-task experiment; developer-reported. [REDHAT] |
| Pydantic, 2026-10-28 | Long tasks -58% cost/-51% time/+16 pp correctness | 5,276 graded runs; internal apps; eager execution; no independent reproduction here. [AI-BENCH] |
| Anthropic current PTC docs | Search improvement 11%, input tokens -24% | Dynamic filtering/search benchmarks, not all PTC tasks. [A-PTC] |
| Anthropic multi-agent research, 2025-06-13 | +90.2% over single Opus 4 | Different models/compute/topology; no code-mode or cheap-worker control arm. [A-MULTI] |

## 10. Criticisms, failure modes, and tradeoffs

### Security and authorization

**The tool bridge grants authority.** A program without sockets can still exfiltrate through a permitted “send message” tool or mutate production through an allowed API. Keeping credentials outside the isolate prevents direct credential reads only if tools/results do not re-expose them. The host must authorize the operation and arguments independently of the generated code. Monty's security docs explicitly discuss callback authority; OpenCode says authorization belongs in tool execution; Anthropic warns that caller hints are not a security boundary. [MONTY-SECURITY] [OC-README] [A-PTC]

**Per-call approval can be lost, but need not be.** If a host approves only the outer `execute`, a loop can perform many writes after one prompt. Goose preserves its permission flow; Amp remote tools can pause on each operation; Cloudflare's durable runtime pauses/replays; Pydantic routes through ToolManager but requires inline deferral handling. A deployment should test its actual bridge rather than assume either complete bypass or complete preservation. [GOOSE-DOC] [AMP-MCP] [CF-DURABLE] [AI-CODE-TOOLS]

**Language isolation, process isolation, and OS isolation differ.** Monty/OpenCode deliberately interpret a limited language; V8/QuickJS/Boa provide different VM boundaries; full CPython in IPython has host authority; UTCP Python's thread execution is not a disposable restricted process. Red Hat's Pyodide bridge incident shows that a seemingly isolated language can regain ambient host capabilities through imports. These facts justify reviewing exposed bridges and callback implementations, not just the runtime's brand. [MONTY-SECURITY] [OC-README] [UTCP-PY] [AI-IPYTHON] [REDHAT]

**Context privacy has a narrow meaning.** Not sending rows to the main model can reduce exposure and prompt-injection surface, but runtime logs, error traces, provider containers, tool providers, and returned summaries may still contain the data. Claude's current hosted execution retention is a concrete counterexample to “not in context means never sent to the provider.” PII replacement and destination allowlists are separate mechanisms. [A-MCP] [A-PTC] [A-EXEC]

### Reliability, schemas, and debugging

**Weak models can write bad programs.** Failures include invented identifiers, invalid imports, unsupported syntax, forgotten awaits, incorrect result fields, and code that is syntactically valid but filters away the important evidence. Red Hat reports exact tool-name mistakes with a smaller model; CodeAct's results vary by model; FastMCP's author reports more mistakes from Haiku-class than Sonnet-class models in early use. These are observations, not a universal parameter-count cutoff. [REDHAT] [CODEACT] [FASTMCP]

**Type generation is only as useful as its contracts.** JSON Schema recursion, union/null handling, invalid language identifiers, names colliding after sanitization, missing output schemas, and text/structured/multimodal responses all affect the generated surface. Goose deliberately returns original recursive JSON schemas. Pydantic checks sanitized-name conflicts and generates stubs. OpenCode separates schema rendering from Effect runtime decoding. Amp distinguishes structured replies from text. Static types cannot repair a wrong server schema or authorize a side effect. [GOOSE-DOC] [AI-CODE-TOOLS] [AI-TOOLSET] [OC-README] [AMP-MCP]

The MCP repository's November 2025 discussion raises output-shape brittleness and argues that execution strategy is above the protocol. Its historical claim that output schemas were not standardized should **not** be repeated as a current fact: current Amp/Goose/MCP implementations explicitly support output schemas. The lasting criticism is incomplete or unenforced output contracts. [MCP-DISCUSSION] [AMP-MCP] [GOOSE-DOC]

**Partial failure is not rollback.** A program may update records 1–19, fail on 20, and then be retried by the model. Whole-script retries can duplicate effects. Pi documents surviving prior side effects; Amp warns to check whether the operation already ran; Pydantic records started calls even when a budget failure interrupts the snippet; Cloudflare's optional replay/compensation addresses parts of the problem but is not a cross-service transaction. [PI] [AMP-MCP] [AI-TOOLSET] [CF-DURABLE]

**Debugging requires nested traces.** A single outer call can hide many operations from a simplistic transcript. Capture program text, discovered contracts, each nested tool/argument/outcome, policy decisions, cancellation, and relevant artifact references. Pydantic, Goose, OpenCode hooks, and Codex have explicit nested-call plumbing; a custom wrapper must not assume the model-facing final output is an adequate audit log. This is a design recommendation grounded in those implementations. [AI-CODE-TOOLS] [GOOSE-EXEC] [OC-README] [CODEX-DELEGATE]

### Latency, cost, and resource use

Discovery, generation, type checking, sandbox startup, data marshaling, and recovery can make a one-tool lookup slower and more expensive. For large independent calls, ordinary parallel invocation may already achieve much of the latency gain. A script can reduce inference overhead while leaving network/service latency unchanged, and unbounded fan-out can overload services or hit quotas. Model requests, tool requests, input/cache/output tokens, and wall time should be measured separately. [AI-BENCH] [A-PTC] [REDHAT]

Limits are not interchangeable. Monty distinguishes execution from suspended time; Claude has a cell limit and a pending-tool deadline; Pi's optional script timeout differs from worker-queue limits. Host calls need cancellation/deadlines even when the language heap is bounded. Otherwise a cheap-looking loop can become an expensive or stuck tool workload. [MONTY-SECURITY] [AI-TOOLSET] [A-PTC] [A-EXEC] [PI]

### When ordinary tools are preferable

Direct tools are often preferable for one or two small operations, tasks where the model must interpret every intermediate result, high-risk writes that need an easily reviewed individual request, or models that cannot reliably use the code surface. They also avoid maintaining a new interpreter/bridge when the existing tool schema is already compact. A well-designed bulk/search/aggregation endpoint may remove the need for generated orchestration altogether. The first cases are documented by Anthropic/Goose/Red Hat; the bulk-endpoint observation is an architectural inference, not a benchmark claim. [A-PTC] [GOOSE-DOC] [REDHAT]

## 11. Code mode versus “send a cheap subagent to gather context”

### 11.1 What the published sources establish

Anthropic's June 13, 2025 multi-agent research article describes an Opus 4 lead with Sonnet 4 workers and reports **90.2% better performance than a single Opus 4** on its internal research evaluation. It attributes gains to parallel exploration and additional context windows. This is a useful real-system account but does not isolate topology from model mix and compute. Sonnet workers in that setup are not evidence about an arbitrarily small/cheap retrieval model. [A-MULTI]

The same article says agents use about **4× chat tokens** and multi-agent systems about **15× chat tokens**. The denominator is chat, **not 15× a single agent**. It favors breadth-first, relatively independent research and says tightly interdependent coding tasks are a poorer fit. Token usage explaining much of benchmark variance is observational evidence about effort, not proof that simply spawning more agents causes better answers. [A-MULTI]

Claude Code's current subagent docs directly recommend delegating side work that would flood the main context. Each worker has its own context, prompt, tools, and permissions; its requests still count toward usage. A custom agent can choose a cheaper model. However, **current built-in Explore is not universally Haiku**: its documented model selection is now parent/provider-dependent, and a custom `Explore` with `model: haiku` is one route to explicitly cheaper exploration. Amp's current Task documentation likewise says it uses the thread's model and effort. Delegation does not automatically imply a cheap model. [CC-SUB] [AMP-TOOLS]

Cognition's Walden Yan, June 12, 2025, argues against multi-agent designs that split interdependent work without shared context, because actions contain implicit decisions that summaries lose. It favors shared context/full traces and compression. This is a maintainers' design argument with examples, not a controlled proof against all delegation; its references to then-current Claude Code do not define today's product. The concern remains relevant when a worker silently chooses assumptions the parent does not receive. [COGNITION]

### 11.2 Side-by-side analysis

The following table is synthesis, based on the mechanisms above. It is not a published head-to-head result. “Program” assumes correct generated code and stable structured inputs; “cheap worker” assumes the application actually routes to a cheaper model.

| Dimension | Code-mode context gathering | Cheap subagent context gathering |
|---|---|---|
| Main context | Program + selected result; raw payloads can stay outside it | Delegation prompt + returned report/artifacts; worker's transcript stays separate |
| Total tokens/cost | Main-model code generation plus small results; runtime/tool charges remain | Parent tokens plus worker prompts, tool results, reasoning/output, and retries; cheap token pricing can still win |
| Latency | Avoids inference between known control/dataflow steps; can parallelize tools | Adds worker inference but can parallelize independent investigations; avoids parent doing all semantic reading |
| Determinism | Once fixed, the program follows explicit rules; tools/time/concurrency can remain nondeterministic | Worker can choose different search paths, interpretations, and summaries on each run |
| Main failure | Code/schema bug, omitted case, wrong predicate, unsupported runtime feature | Missed evidence, hallucinated account, lossy summary, hidden assumption, delegation misunderstanding |
| Information loss | Explicit projection/filter can discard the wrong fields, but retained source data can be queried again | Summary can erase uncertainty, negative evidence, contradictions, or dependencies; source references help |
| Security | Confined runtime plus actual bridged-tool policy; loops increase fan-out/side effects | Separate prompt/context alone is no sandbox; restrict tools/credentials and workspace independently |
| Best fit | Exact counts, joins, pagination, record transfer, log filtering, polling, batch API work | Unfamiliar codebase exploration, relevance judgment, ambiguous bug investigation, independent source assessment |
| Poor fit | Every step requires new semantic judgment not encoded in the program | Mechanical transformations a small deterministic function already handles; tightly coupled unsplit decisions |
| Debugging | Inspect code and nested tool trace; deterministic replay possible in some systems | Inspect worker transcript and provenance; reproduce model/seed/settings where supported |

Mechanism sources: [A-PTC] [AI-BENCH] [A-MULTI] [CC-SUB] [COGNITION] [MONTY-SECURITY]. Both approaches can hide evidence from the parent, and either can be expensive if repeatedly rediscovering or reprocessing the same data.

A simple cost model explains why “cheap” is not sufficient:

```text
Program route = main-model program tokens + selected-result tokens
                + runtime/tool cost + expected repair cost

Worker route  = parent delegation/result tokens
                + worker input/output/reasoning at worker prices
                + runtime/tool cost + expected rework/escalation cost
```

This is an accounting model, not a measured estimate. Include prompt-cache rates, retained state, tool/service charges, and failed attempts. A worker that reads everything can consume more total tokens while still costing less money; a program that emits a huge table can fail to save parent context. [AI-BENCH] [A-MULTI] [CC-SUB]

### 11.3 Which approach to choose

For “fetch every open issue, group by label, return counts and the IDs of unassigned blockers,” code mode has a natural exact-data path once the API contract and blocker definition are known. A small worker adds little value to the counting operation. For “find why this authentication behavior differs between two code paths,” a worker can make relevance decisions and follow unfamiliar dependencies that a short fixed program cannot infer. The program can still gather candidate files and compress mechanical output for that worker. These are workload judgments, not claims of measured superiority. [A-PTC] [CC-SUB] [COGNITION]

The patterns compose at several levels:

- A worker can use code mode to search, filter, and aggregate before doing semantic analysis.
- A parent's generated program can invoke a tool that represents a bounded worker, provided the host authorizes that tool and the implementation allows it.
- Programs can return IDs, file paths, source spans, or structured evidence; the parent or worker can then reason over only the relevant material.

smolagents exposes managed-agent callables; Amp's plugin API can register a tool backed by a custom agent; Anthropic's research system used artifact references to reduce lossy handoffs. Conversely, Pi's `models` surface explicitly does not run chat models, showing that composition must be checked against the actual product interface. [SMOL-SOURCE] [AMP-PLUGIN] [A-MULTI] [PI]

### 11.4 A useful evaluation design

Before selecting a default, compare four arms on the same tasks and tools: direct tool calling with native parallelism; direct plus deferred search; code mode; and a deliberately cheap worker. Add a worker-with-code-mode arm if composition is the intended design. Hold tool permissions, output budgets, and success criteria fixed. Record task success, omitted evidence, main-context growth, total/cache/output tokens by model, tool calls, wall time, policy prompts, partial side effects, and repair/escalation cost. This is a proposed test plan, not an experiment performed here.

Include small lookups, paginated structured queries, large-result filtering, ambiguous repository research, malformed output schemas, unsupported syntax, and a write that fails halfway through. These cases discriminate the mechanisms identified in Pydantic's scaling study, Red Hat's failures, current approval implementations, and the subagent literature. [AI-BENCH] [REDHAT] [CF-DURABLE] [A-MULTI] [COGNITION]

## 12. Remaining uncertainties and scope limits

1. **Claude Code's new mode:** release/changelog verified, but the linked docs were unavailable. Runtime, enabling setting, persistence, and nested permission details remain unverified. [CC-RELEASE] [CC-DOC-ISSUE]
2. **Codex distribution status:** implementation and feature defaults are pinned-source facts. Release-specific availability and server-side rollout may differ; no installed CLI was exercised. [CODEX-FEATURES]
3. **Amp internals:** current public docs establish discovery, imports, result handling, and remote per-call policy; they do not establish an engine/isolation implementation in the material reviewed. [AMP-MCP]
4. **Negative adoption findings:** no native mode was verified for Gemini CLI, Cursor, Cline, or a distinct Roo orchestration feature. This cannot prove absence from every branch/plugin. [GEMINI] [CURSOR] [CLINE] [ROO]
5. **Benchmarks:** no results were reproduced, and no controlled code-mode-versus-cheap-research-worker comparison was found. Vendor percentages have different denominators and workloads. [AI-BENCH] [A-ADVANCED] [A-MULTI] [REDHAT]
6. **Security:** implementation/document review is not a penetration test. Runtime claims depend on the configured host bridge, OS restrictions, tool callbacks, and exact library versions. [MONTY-SECURITY] [OC-README] [UTCP-PY]

## 13. Sources and reproducibility

All links below are primary sources except that the public MCP discussion and documentation-bug issue contain their authors' observations rather than vendor guarantees. Dates are publication/release dates where available; undated living docs were accessed on **2026-11-13**. The source-code references appended below use pinned commits. The local manifest maps repository paths to downloaded files; `*-tree.json` records source-tree inventories.

### Dated articles, papers, and releases

- **[CF25]** Cloudflare, Kenton Varda and Sunil Pai, *Code Mode: the better way to use MCP*, **2025-09-26**. https://blog.cloudflare.com/code-mode/ . The page metadata shows later edits; its beta/API passages are treated as historical.
- **[A-MCP]** Anthropic, Adam Jones and Conor Kelly, *Code execution with MCP: Building more efficient agents*, **2025-11-04**. https://www.anthropic.com/engineering/code-execution-with-mcp
- **[A-ADVANCED]** Anthropic, *Introducing advanced tool use*, **2025-11-24**. https://www.anthropic.com/research/advanced-tool-use
- **[A-MULTI]** Anthropic, *How we built our multi-agent research system*, **2025-06-13**. https://www.anthropic.com/engineering/multi-agent-research-system
- **[COGNITION]** Cognition, Walden Yan, *Don't Build Multi-Agents*, **2025-06-12**. https://cognition.ai/blog/dont-build-multi-agents
- **[CODEACT]** Wang et al., *Executable Code Actions Elicit Better LLM Agents*, initial **2024-02**, inspected **v4 2024-06-07**, especially §2.2–2.3/Table 3. https://arxiv.org/html/2402.01030v4 ; abstract/history: https://arxiv.org/abs/2402.01030
- **[CODEACT-REPO]** Authors' implementation and evaluation repository, associated with the 2024 paper. https://github.com/xingyaoww/code-act
- **[SMOL-LAUNCH]** Hugging Face, *Introducing smolagents*, **2024-12-31**. https://huggingface.co/blog/smolagents
- **[MONTY-LAUNCH]** Pydantic, Samuel Colvin, *Pydantic Monty*, **2026-02-27**. https://pydantic.dev/articles/pydantic-monty
- **[AI-BENCH]** Pydantic, Michael Pfaffenberger, *Code mode: make your agents 2x faster and 2x cheaper on long tasks*, **2026-10-28**. https://pydantic.dev/articles/why-code-mode-is-the-future . Full retrieved Markdown retained as `sources/pydantic-benchmark.md`.
- **[FASTMCP]** Jeremiah Lowin, *Stop Calling Tools, Start Writing Code (Mode)*, **2026-03-03**, FastMCP 3.1 announcement. https://jlowin.dev/blog/fastmcp-3-1-code-mode ; project docs: https://gofastmcp.com/servers/transforms/code-mode
- **[REDHAT]** Red Hat Emerging Technologies, Rounak Bende, *Code execution with MCP: How sandboxed Python replaces tool schema bloat in AI agents*, **2026-04-23**. https://next.redhat.com/2026/04/23/how-sandboxed-python-reduces-tool-schema-overhead-in-ai-agents/ ; author's source: https://github.com/redhat-et/codemode-lite
- **[GOOSE-HISTORY]** Goose, *8 Things You Didn't Know About Code Mode*, **2026-02-06**. https://goose-docs.ai/blog/2026/02/06/8-things-you-didnt-know-about-code-mode/
- **[CC-RELEASE]** Anthropic Claude Code **v2.1.323, 2026-11-12**. https://github.com/anthropics/claude-code/releases/tag/v2.1.323
- **[CC-CHANGELOG]** Official changelog, v2.1.323 first item, accessed **2026-11-13**. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md ; raw copy retained as `sources/claude-changelog.md`.
- **[CC-DOC-ISSUE]** Claude Code documentation issue #109442, opened **2026-11-13**, reporting the Code Mode page's 404. https://github.com/anthropics/claude-code/issues/109442 . This is evidence of the broken public link, not implementation documentation.
- **[MCP-DISCUSSION]** MCP repository discussion #1780, **November 2025**, *Code execution with MCP: Building more efficient agents*. https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1780

### Living official documentation and source entry points

- **[AI-DOC]** Pydantic AI Harness Code Mode, accessed **2026-11-13**. https://pydantic.dev/docs/ai/harness/code-mode/
- **[MONTY-EXAMPLES]** Monty examples, including an older `CodeModeToolset` integration, accessed **2026-11-13**. https://pydantic.dev/docs/monty/reference/examples/
- **[MONTY-LIMITS]** Current Python subset limitations, accessed **2026-11-13**. https://pydantic.dev/docs/monty/limitations/
- Pydantic's distinction between code mode and whole-agent sandboxes, accessed **2026-11-13**. https://pydantic.dev/articles/code-mode-vs-sandboxes
- **[CF-SDK]** Cloudflare Code Mode docs, page last updated **2026-06-24**, accessed **2026-11-13**. https://developers.cloudflare.com/agents/tools/codemode/ ; implementation/package README: https://github.com/cloudflare/agents/tree/main/packages/codemode
- **[CF-EXECUTOR]** Dynamic Workers Code Mode example, accessed **2026-11-13**. https://developers.cloudflare.com/dynamic-workers/examples/codemode/
- **[CF-LOADER]** Worker Loader binding, accessed **2026-11-13**. https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/
- **[CF-DURABLE]** Durable Code Mode runtime guide, last updated **2026-07-22**, accessed **2026-11-13**. https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/
- **[A-PTC]** Claude API programmatic tool calling, accessed **2026-11-13**. https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling
- **[A-EXEC]** Claude API code execution tool and version/lifecycle documentation, accessed **2026-11-13**. https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool
- **[A-SEARCH]** Claude API tool search tool, accessed **2026-11-13**. https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
- **[CC-SUB]** Claude Code subagents, accessed **2026-11-13**. https://code.claude.com/docs/en/sub-agents
- **[SMOL-README]** smolagents repository README, accessed **2026-11-13**. https://github.com/huggingface/smolagents
- **[SMOL-INTRO]** smolagents introduction/code-agent concepts, accessed **2026-11-13**. https://huggingface.co/docs/smolagents/en/conceptual_guides/intro_agents
- **[SMOL-SECURITY]** smolagents secure execution tutorial, accessed **2026-11-13**. https://huggingface.co/docs/smolagents/en/tutorials/secure_code_execution
- **[SMOL-SOURCE]** `src/smolagents/agents.py`, `CodeAgent` and managed-agent integration, accessed **2026-11-13**, live main rather than a pinned snapshot. https://github.com/huggingface/smolagents/blob/main/src/smolagents/agents.py
- **[OC-DOC]** OpenCode tools, accessed **2026-11-13**. https://opencode.ai/docs/tools/
- **[OC-MCP]** OpenCode MCP configuration, accessed **2026-11-13**. https://opencode.ai/docs/mcp-servers/
- **[AMP-MCP]** Amp MCP, last modified **2026-11-04**, accessed **2026-11-13**. https://ampcode.com/docs/customize/mcp ; Markdown: https://ampcode.com/docs/markdown/customize/mcp
- **[AMP-TOOLS]** Amp Tools, last modified **2026-11-05**, accessed **2026-11-13**. https://ampcode.com/docs/tools ; retained Markdown `sources/amp-tools.md`.
- **[AMP-PLUGIN]** Amp Plugin API, accessed **2026-11-13**. https://ampcode.com/docs/plugin-api
- **[PI]** Pi Code Mode, accessed **2026-11-13**. https://pi.dev/docs/latest/codemode
- **[GEMINI]** Gemini CLI tools, accessed **2026-11-13**. https://geminicli.com/docs/reference/tools/ ; shell: https://geminicli.com/docs/tools/shell/
- **[GEMINI-MCP]** Gemini CLI MCP, accessed **2026-11-13**. https://geminicli.com/docs/tools/mcp-server/
- **[GEMINI-SANDBOX]** Gemini CLI sandboxing, accessed **2026-11-13**. https://geminicli.com/docs/cli/sandbox/
- **[CURSOR]** Cursor MCP docs, accessed **2026-11-13**. https://cursor.com/docs/context/mcp
- **[CLINE]** Cline MCP overview, accessed **2026-11-13**. https://docs.cline.bot/mcp/mcp-overview
- **[ROO]** Roo Code official README, modes and capabilities, accessed **2026-11-13**. https://github.com/RooCodeInc/Roo-Code

### Pinned implementation sources

The entries below are generated from the downloaded source manifest. Their labels are used throughout the report. Relevant line ranges are included in the analysis where they help distinguish implementations.

- **[AI-TOOLSET]** `pydantic/pydantic-ai` @ `357ca4ec438f`, `src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py`. [Pinned source](https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py); [local copy](sources/ai--src__pydantic_ai_harness__pydantic_ai_harness__code_mode___toolset.py). Accessed **2026-11-13**.
- **[AI-CAPABILITY]** `pydantic/pydantic-ai` @ `357ca4ec438f`, `src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_capability.py`. [Pinned source](https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_capability.py); [local copy](sources/ai--src__pydantic_ai_harness__pydantic_ai_harness__code_mode___capability.py). Accessed **2026-11-13**.
- **[AI-CODE-TOOLS]** `pydantic/pydantic-ai` @ `357ca4ec438f`, `src/pydantic_ai_harness/pydantic_ai_harness/_code_tools.py`. [Pinned source](https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/_code_tools.py); [local copy](sources/ai--src__pydantic_ai_harness__pydantic_ai_harness___code_tools.py). Accessed **2026-11-13**.
- **[AI-MONTY-EXEC]** `pydantic/pydantic-ai` @ `357ca4ec438f`, `src/pydantic_ai_harness/pydantic_ai_harness/_monty_exec.py`. [Pinned source](https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/_monty_exec.py); [local copy](sources/ai--src__pydantic_ai_harness__pydantic_ai_harness___monty_exec.py). Accessed **2026-11-13**.
- **[AI-IPYTHON]** `pydantic/pydantic-ai` @ `357ca4ec438f`, `docs/harness/ipython-code-mode.md`. [Pinned source](https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/docs/harness/ipython-code-mode.md); [local copy](sources/ai--docs__harness__ipython-code-mode.md). Accessed **2026-11-13**.
- **[AI-PACKAGE]** `pydantic/pydantic-ai` @ `357ca4ec438f`, `src/pydantic_ai_harness/pyproject.toml`. [Pinned source](https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pyproject.toml); [local copy](sources/ai--src__pydantic_ai_harness__pyproject.toml). Accessed **2026-11-13**.
- **[MONTY-README]** `pydantic/monty` @ `afdfb54f1adb`, `README.md`. [Pinned source](https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/README.md); [local copy](sources/monty--README.md). Accessed **2026-11-13**.
- **[MONTY-SECURITY]** `pydantic/monty` @ `afdfb54f1adb`, `docs/security.md`. [Pinned source](https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/docs/security.md); [local copy](sources/monty--docs__security.md). Accessed **2026-11-13**.
- **[MONTY-LIB]** `pydantic/monty` @ `afdfb54f1adb`, `crates/monty/src/lib.rs`. [Pinned source](https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/crates/monty/src/lib.rs); [local copy](sources/monty--crates__monty__src__lib.rs). Accessed **2026-11-13**.
- **[MONTY-RUN]** `pydantic/monty` @ `afdfb54f1adb`, `crates/monty/src/run.rs`. [Pinned source](https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/crates/monty/src/run.rs); [local copy](sources/monty--crates__monty__src__run.rs). Accessed **2026-11-13**.
- **[MONTY-CARGO]** `pydantic/monty` @ `afdfb54f1adb`, `Cargo.toml`. [Pinned source](https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/Cargo.toml); [local copy](sources/monty--Cargo.toml). Accessed **2026-11-13**.
- **[MONTY-ASYNC]** `pydantic/monty` @ `afdfb54f1adb`, `crates/monty/src/asyncio.rs`. [Pinned source](https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/crates/monty/src/asyncio.rs); [local copy](sources/monty--crates__monty__src__asyncio.rs). Accessed **2026-11-13**.
- **[CODEX-DESCRIPTION]** `openai/codex` @ `69231e119bfc`, `codex-rs/code-mode-protocol/src/description.rs`. [Pinned source](https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/code-mode-protocol/src/description.rs); [local copy](sources/codex--codex-rs__code-mode-protocol__src__description.rs). Accessed **2026-11-13**.
- **[CODEX-FEATURES]** `openai/codex` @ `69231e119bfc`, `codex-rs/features/src/lib.rs`. [Pinned source](https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/features/src/lib.rs); [local copy](sources/codex--codex-rs__features__src__lib.rs). Accessed **2026-11-13**.
- **[CODEX-HOST]** `openai/codex` @ `69231e119bfc`, `codex-rs/code-mode-host/src/lib.rs`. [Pinned source](https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/code-mode-host/src/lib.rs); [local copy](sources/codex--codex-rs__code-mode-host__src__lib.rs). Accessed **2026-11-13**.
- **[CODEX-CORE]** `openai/codex` @ `69231e119bfc`, `codex-rs/core/src/tools/code_mode/mod.rs`. [Pinned source](https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/core/src/tools/code_mode/mod.rs); [local copy](sources/codex--codex-rs__core__src__tools__code_mode__mod.rs). Accessed **2026-11-13**.
- **[CODEX-DELEGATE]** `openai/codex` @ `69231e119bfc`, `codex-rs/core/src/tools/code_mode/delegate.rs`. [Pinned source](https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/core/src/tools/code_mode/delegate.rs); [local copy](sources/codex--codex-rs__core__src__tools__code_mode__delegate.rs). Accessed **2026-11-13**.
- **[GOOSE-DOC]** `block/goose` @ `73b0f040a813`, `documentation/docs/guides/managing-tools/code-mode.md`. [Pinned source](https://github.com/block/goose/blob/73b0f040a81369b4f0654ef64074cd3cd654b1da/documentation/docs/guides/managing-tools/code-mode.md); [local copy](sources/goose--documentation__docs__guides__managing-tools__code-mode.md). Accessed **2026-11-13**.
- **[GOOSE-EXEC]** `block/goose` @ `73b0f040a813`, `crates/goose/src/agents/platform_extensions/code_execution.rs`. [Pinned source](https://github.com/block/goose/blob/73b0f040a81369b4f0654ef64074cd3cd654b1da/crates/goose/src/agents/platform_extensions/code_execution.rs); [local copy](sources/goose--crates__goose__src__agents__platform_extensions__code_execution.rs). Accessed **2026-11-13**.
- **[GOOSE-JS]** `block/goose` @ `73b0f040a813`, `crates/goose/src/agents/platform_extensions/javascript.rs`. [Pinned source](https://github.com/block/goose/blob/73b0f040a81369b4f0654ef64074cd3cd654b1da/crates/goose/src/agents/platform_extensions/javascript.rs); [local copy](sources/goose--crates__goose__src__agents__platform_extensions__javascript.rs). Accessed **2026-11-13**.
- **[OC-README]** `anomalyco/opencode` @ `f6e0c2d0833f`, `packages/codemode/README.md`. [Pinned source](https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/codemode/README.md); [local copy](sources/opencode--packages__codemode__README.md). Accessed **2026-11-13**.
- **[OC-TOOL]** `anomalyco/opencode` @ `f6e0c2d0833f`, `packages/core/src/codemode/tool.ts`. [Pinned source](https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/core/src/codemode/tool.ts); [local copy](sources/opencode--packages__core__src__codemode__tool.ts). Accessed **2026-11-13**.
- **[OC-DEFAULTS]** `anomalyco/opencode` @ `f6e0c2d0833f`, `packages/core/src/plugin/mcp-codemode-defaults.ts`. [Pinned source](https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/core/src/plugin/mcp-codemode-defaults.ts); [local copy](sources/opencode--packages__core__src__plugin__mcp-codemode-defaults.ts). Accessed **2026-11-13**.
- **[UTCP-README]** `universal-tool-calling-protocol/code-mode` @ `e5fdc319bfae`, `README.md`. [Pinned source](https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/README.md); [local copy](sources/utcp--README.md). Accessed **2026-11-13**.
- **[UTCP-TS]** `universal-tool-calling-protocol/code-mode` @ `e5fdc319bfae`, `typescript-library/src/code_mode_utcp_client.ts`. [Pinned source](https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/typescript-library/src/code_mode_utcp_client.ts); [local copy](sources/utcp--typescript-library__src__code_mode_utcp_client.ts). Accessed **2026-11-13**.
- **[UTCP-PY]** `universal-tool-calling-protocol/code-mode` @ `e5fdc319bfae`, `python-library/src/utcp_code_mode/code_mode_utcp_client.py`. [Pinned source](https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/python-library/src/utcp_code_mode/code_mode_utcp_client.py); [local copy](sources/utcp--python-library__src__utcp_code_mode__code_mode_utcp_client.py). Accessed **2026-11-13**.
- **[PCTX-DOC]** `portofcontext/pctx` @ `499379dfb6a1`, `docs/code-mode.md`. [Pinned source](https://github.com/portofcontext/pctx/blob/499379dfb6a145185f2f8021bb9751584f8ed6fd/docs/code-mode.md); [local copy](sources/pctx--docs__code-mode.md). Accessed **2026-11-13**.
- **[PCTX-README]** `portofcontext/pctx` @ `499379dfb6a1`, `crates/pctx_code_mode/README.md`. [Pinned source](https://github.com/portofcontext/pctx/blob/499379dfb6a145185f2f8021bb9751584f8ed6fd/crates/pctx_code_mode/README.md); [local copy](sources/pctx--crates__pctx_code_mode__README.md). Accessed **2026-11-13**.
- **[PCTX-SOURCE]** `portofcontext/pctx` @ `499379dfb6a1`, `crates/pctx_code_mode/src/code_mode.rs`. [Pinned source](https://github.com/portofcontext/pctx/blob/499379dfb6a145185f2f8021bb9751584f8ed6fd/crates/pctx_code_mode/src/code_mode.rs); [local copy](sources/pctx--crates__pctx_code_mode__src__code_mode.rs). Accessed **2026-11-13**.

### Citation links

[A-ADVANCED]: https://www.anthropic.com/research/advanced-tool-use
[A-EXEC]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool
[A-MCP]: https://www.anthropic.com/engineering/code-execution-with-mcp
[A-MULTI]: https://www.anthropic.com/engineering/multi-agent-research-system
[A-PTC]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling
[A-SEARCH]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
[AI-BENCH]: https://pydantic.dev/articles/why-code-mode-is-the-future
[AI-CAPABILITY]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_capability.py
[AI-CAPABILITY, lines 140–150]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_capability.py#L140-L150
[AI-CODE-TOOLS]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/_code_tools.py
[AI-CODE-TOOLS, lines 148–208]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/_code_tools.py#L148-L208
[AI-CODE-TOOLS, lines 204–208]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/_code_tools.py#L204-L208
[AI-DOC]: https://pydantic.dev/docs/ai/harness/code-mode/
[AI-IPYTHON]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/docs/harness/ipython-code-mode.md
[AI-MONTY-EXEC]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/_monty_exec.py
[AI-PACKAGE]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pyproject.toml
[AI-TOOLSET]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py
[AI-TOOLSET, lines 1351–1386]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L1351-L1386
[AI-TOOLSET, lines 1501–1555]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L1501-L1555
[AI-TOOLSET, lines 337–383, 560, 915–969, 1351–1376]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L337-L383
[AI-TOOLSET, lines 508–580, 609–640, 1331–1345, 1619–1631]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L508-L580
[AI-TOOLSET, lines 515–555]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L515-L555
[AI-TOOLSET, lines 560–579, 1395 onward]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L560-L579
[AI-TOOLSET, lines 609–640, 1331–1333]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L609-L640
[AI-TOOLSET, lines 721–810]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L721-L810
[AI-TOOLSET, lines 951–965]: https://github.com/pydantic/pydantic-ai/blob/357ca4ec438ff067a4dc89573b1671fc1829964f/src/pydantic_ai_harness/pydantic_ai_harness/code_mode/_toolset.py#L951-L965
[AMP-MCP]: https://ampcode.com/docs/customize/mcp
[AMP-PLUGIN]: https://ampcode.com/docs/plugin-api
[AMP-TOOLS]: https://ampcode.com/docs/tools
[CC-CHANGELOG]: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
[CC-DOC-ISSUE]: https://github.com/anthropics/claude-code/issues/109442
[CC-RELEASE]: https://github.com/anthropics/claude-code/releases/tag/v2.1.323
[CC-SUB]: https://code.claude.com/docs/en/sub-agents
[CF-DURABLE]: https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/
[CF-EXECUTOR]: https://developers.cloudflare.com/dynamic-workers/examples/codemode/
[CF-LOADER]: https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/
[CF-SDK]: https://developers.cloudflare.com/agents/tools/codemode/
[CF25]: https://blog.cloudflare.com/code-mode/
[CLINE]: https://docs.cline.bot/mcp/mcp-overview
[CODEACT]: https://arxiv.org/html/2402.01030v4
[CODEACT, §2.2–2.3 and Table 3]: https://arxiv.org/html/2402.01030v4
[CODEACT-REPO]: https://github.com/xingyaoww/code-act
[CODEX-CORE]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/core/src/tools/code_mode/mod.rs
[CODEX-DELEGATE]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/core/src/tools/code_mode/delegate.rs
[CODEX-DESCRIPTION]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/code-mode-protocol/src/description.rs
[CODEX-DESCRIPTION, lines 17–56]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/code-mode-protocol/src/description.rs#L17-L56
[CODEX-FEATURES]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/features/src/lib.rs
[CODEX-FEATURES, lines 1309–1385]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/features/src/lib.rs#L1309-L1385
[CODEX-FEATURES, lines 1387 onward]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/features/src/lib.rs#L1387
[CODEX-HOST]: https://github.com/openai/codex/blob/69231e119bfca0b14453515e97d99688ce1c47c9/codex-rs/code-mode-host/src/lib.rs
[COGNITION]: https://cognition.ai/blog/dont-build-multi-agents
[CURSOR]: https://cursor.com/docs/context/mcp
[FASTMCP]: https://jlowin.dev/blog/fastmcp-3-1-code-mode
[GEMINI]: https://geminicli.com/docs/reference/tools/
[GEMINI-MCP]: https://geminicli.com/docs/tools/mcp-server/
[GEMINI-SANDBOX]: https://geminicli.com/docs/cli/sandbox/
[GOOSE-DOC]: https://github.com/block/goose/blob/73b0f040a81369b4f0654ef64074cd3cd654b1da/documentation/docs/guides/managing-tools/code-mode.md
[GOOSE-DOC, lines 42–79]: https://github.com/block/goose/blob/73b0f040a81369b4f0654ef64074cd3cd654b1da/documentation/docs/guides/managing-tools/code-mode.md#L42-L79
[GOOSE-EXEC]: https://github.com/block/goose/blob/73b0f040a81369b4f0654ef64074cd3cd654b1da/crates/goose/src/agents/platform_extensions/code_execution.rs
[GOOSE-HISTORY]: https://goose-docs.ai/blog/2026/02/06/8-things-you-didnt-know-about-code-mode/
[GOOSE-JS]: https://github.com/block/goose/blob/73b0f040a81369b4f0654ef64074cd3cd654b1da/crates/goose/src/agents/platform_extensions/javascript.rs
[MCP-DISCUSSION]: https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1780
[MONTY-ASYNC]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/crates/monty/src/asyncio.rs
[MONTY-CARGO]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/Cargo.toml
[MONTY-EXAMPLES]: https://pydantic.dev/docs/monty/reference/examples/
[MONTY-LAUNCH]: https://pydantic.dev/articles/pydantic-monty
[MONTY-LIB]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/crates/monty/src/lib.rs
[MONTY-LIMITS]: https://pydantic.dev/docs/monty/limitations/
[MONTY-README]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/README.md
[MONTY-README, lines 43–66]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/README.md#L43-L66
[MONTY-RUN]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/crates/monty/src/run.rs
[MONTY-SECURITY]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/docs/security.md
[MONTY-SECURITY, lines 289–334]: https://github.com/pydantic/monty/blob/afdfb54f1adb0d7ca943ec7fd8f9db34f06e0100/docs/security.md#L289-L334
[OC-DEFAULTS]: https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/core/src/plugin/mcp-codemode-defaults.ts
[OC-DOC]: https://opencode.ai/docs/tools/
[OC-MCP]: https://opencode.ai/docs/mcp-servers/
[OC-README]: https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/codemode/README.md
[OC-README, lines 1–25]: https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/codemode/README.md#L1-L25
[OC-README, lines 85–120]: https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/codemode/README.md#L85-L120
[OC-TOOL]: https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/core/src/codemode/tool.ts
[OC-TOOL, lines 76–80]: https://github.com/anomalyco/opencode/blob/f6e0c2d0833ffe772035f221fed923e1cd5fb408/packages/core/src/codemode/tool.ts#L76-L80
[PCTX-DOC]: https://github.com/portofcontext/pctx/blob/499379dfb6a145185f2f8021bb9751584f8ed6fd/docs/code-mode.md
[PCTX-README]: https://github.com/portofcontext/pctx/blob/499379dfb6a145185f2f8021bb9751584f8ed6fd/crates/pctx_code_mode/README.md
[PCTX-README, lines 139–165, 583–596]: https://github.com/portofcontext/pctx/blob/499379dfb6a145185f2f8021bb9751584f8ed6fd/crates/pctx_code_mode/README.md#L139-L165
[PCTX-SOURCE]: https://github.com/portofcontext/pctx/blob/499379dfb6a145185f2f8021bb9751584f8ed6fd/crates/pctx_code_mode/src/code_mode.rs
[PI]: https://pi.dev/docs/latest/codemode
[REDHAT]: https://next.redhat.com/2026/04/23/how-sandboxed-python-reduces-tool-schema-overhead-in-ai-agents/
[ROO]: https://github.com/RooCodeInc/Roo-Code
[SMOL-INTRO]: https://huggingface.co/docs/smolagents/en/conceptual_guides/intro_agents
[SMOL-LAUNCH]: https://huggingface.co/blog/smolagents
[SMOL-README]: https://github.com/huggingface/smolagents
[SMOL-SECURITY]: https://huggingface.co/docs/smolagents/en/tutorials/secure_code_execution
[SMOL-SOURCE]: https://github.com/huggingface/smolagents/blob/main/src/smolagents/agents.py
[UTCP-PY]: https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/python-library/src/utcp_code_mode/code_mode_utcp_client.py
[UTCP-PY, lines 268–381]: https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/python-library/src/utcp_code_mode/code_mode_utcp_client.py#L268-L381
[UTCP-README]: https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/README.md
[UTCP-TS]: https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/typescript-library/src/code_mode_utcp_client.ts
[UTCP-TS, lines 1–2, 173–329 and bridge implementation]: https://github.com/universal-tool-calling-protocol/code-mode/blob/e5fdc319bfae1ceec57e7bce37048337635ffb51/typescript-library/src/code_mode_utcp_client.ts#L1-L2
