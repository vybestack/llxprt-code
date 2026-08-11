# Pseudocode 01 — Schema, derivation, and tolerant reader

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/telemetry/src/perf/perfRecords.ts` (new), reader in same package.

**Contract-first.** Inputs: an `operation` payload (cli) + a `memory_sample`
payload (cli). Outputs: a versioned JSONL line. Reader input: arbitrary lines
from disk (external). Reader output: parsed record or null (never throws).

```
10:  CONST PERF_SCHEMA_VERSION = 1
11:  CONST PERF_RECORD_TYPE_OPERATION = "operation"
12:  CONST PERF_RECORD_TYPE_MEMORY_SAMPLE = "memory_sample"
13:
14:  // --- Envelope (shared) ---
15:  Zod PerfEnvelopeSchema =
16:    schema_version: z.number()
17:    record_type: z.enum(["operation","memory_sample"])
18:    ts: z.string()                       // ISO 8601, operation/sample end
19:
20:  // --- Identity (reuses #3130 key names verbatim) ---
21:  PerfIdentitySchema =
22:    session_id: z.string()
23:    operation_id: z.string()             // DERIVED, see lines 60-66
24:    runtime_id: z.string()
25:    parent_runtime_id: z.string().nullable()
26:    subagent_name: z.string().nullable()
27:    project_hash: z.string()
28:    // D1: NO prompt_ids/turn_ids arrays and NO true-count/cap fields. The
29:    // child continuation ids do not arrive via AgentEvent; operation_id is the
30:    // sole join key. The report derives it from token-usage prompt_id at
31:    // read time (see READ-TIME JOIN, lines 104-115).
29:
30:  // --- Build identity (x-axis) ---
31:  PerfBuildSchema =
32:    llxprt_version: z.string()
33:    git_sha: z.string()
34:    runtime: z.string()
35:    platform: z.string()
36:
37:  // --- Comparison dimensions (compare like-with-like) ---
38:  PerfDimensionsSchema =
39:    provider: z.string()
40:    model: z.string()
41:    context_tokens: z.number()
42:    output_tokens: z.number()
43:    terminal_cols: z.number()
44:    terminal_rows: z.number()
45:    render_mode: z.string()
46:    concurrent_instances: z.number()
47:
48:  // --- operation record: discriminated union keyed on record_type ---
49:  PerfOperationRecordSchema = PerfEnvelope ⊕ { record_type: "operation" }
50:    ⊕ PerfIdentity ⊕ PerfBuild ⊕ PerfDimensions
51:    ⊕ { status: z.enum([7 terminal values]) }      // §1.3 incl. "superseded"
52:    ⊕ client-measurement fields (see pseudocode 05, lines 10-30)
53:    ⊕ provider/tool sum+union fields               // see pseudocode 05 lines 40-55
54:    ⊕ { operation_elapsed_ms, approval_wait_ms, unclassified_elapsed_ms }
55:    ⊕ memory fields (OPTIONAL — present iff memory enabled)   // pseudocode 07
56:    ⊕ session_operation_index, uptime_ms
57:    // D1: NO prompt_ids/turn_ids/totals here. operation_id (identity) is the
58:    // sole join key.
58:
59:  // --- operation_id derivation (settled §3 / §9 — NOT minted+propagated) ---
60:  FUNCTION deriveOperationId(promptId: string): string
61:    RETURN promptId.split("#continuation#")[0]
62:  END
63:  // First/initial prompt id has no continuation suffix ⇒ operation_id === it.
64:  // Continuations are "...#continuation#n" ⇒ prefix recovered. Subagents use
65:  // runtime_id/parent_runtime_id/subagent_name (separate namespace).
66:
67:  // --- Tolerant reader (external input — defensive parsing justified) ---
68:  FUNCTION isStringRecord(v): boolean  // type guard
69:  FUNCTION parsePerfRecord(line: unknown): PerfRecord | null
70:    IF NOT isStringRecord(line) RETURN null
71:    hasVersion = "schema_version" in line
72:    hasType    = "record_type" in line
73:    IF NOT hasVersion AND NOT hasType
74:      // legacy/unversioned → normalise to v0, validate as operation
75:      normalized = { ...line, schema_version: 0, record_type: "operation" }
76:      r = PerfOperationRecordSchema.safeParse(normalized)
77:      RETURN r.success ? r.data : null
78:    END
79:    IF line.schema_version > PERF_SCHEMA_VERSION
80:      // unknown future version → skip+count, NEVER coerce
81:      RETURN null  // caller counts via the "skipped" path
82:    END
83:    r = PerfRecordUnionSchema.safeParse(line)  // discriminated on record_type
84:    RETURN r.success ? r.data : null
85:  END
86:
87:  // --- Streaming line iterator with truncation tolerance ---
88:  FUNCTION* readPerfLines(filePath):
89:    open file for reading
90:    leftover = ""
91:    FOR EACH chunk in stream:
92:      data = leftover + decode(chunk)
93:      parts = data.split("\n")
94:      leftover = parts.pop()      // last partial line kept
95:      FOR EACH line in parts:
96:        yield parsePerfRecord(line)
97:    // truncated final line: if leftover is non-empty AND not valid JSON
98:    // → count as truncated (SIGKILL mid-append); if it IS valid, parse it.
99:    IF leftover.trim() != "":
100:     r = parsePerfRecord(leftover)
101:     yield r  // null ⇒ caller counts truncated
102:  END
103:
104:  // --- READ-TIME JOIN (D1 — zero-plumbing correlation) ---
105:  // The perf operation record carries operation_id = deriveOperationId(initialPromptId).
106:  // Token-usage / session-recording rows each carry their own prompt_id (one per
107:  // send, incl. continuations). The report derives operation_id from each such
108:  // prompt_id and joins multi-continuation rows to the SINGLE perf operation.
109:  FUNCTION joinKeyFromPromptId(promptId: string): string
110:    RETURN promptId.split("#continuation#")[0]   // same derivation as line 61
111:  END
112:  // Behavioural evidence: N continuation rows (prompt_ids S#..#U#continuation#1..N)
113:  // all derive to operation_id === S#..#U and join to the one perf operation —
114:  // with NO child id copied into the perf record. This avoids inventing an
115:  // unobservable array (the child ids do not arrive via AgentEvent).
```

**Anti-patterns (must NOT):**
- `as PerfRecord` on external input (use the schema).
- Throw on a bad line (return null + count).
- Mint/propagate operation_id through agents (derive at line 60-66).
- Add `prompt_ids`/`turn_ids` arrays or true-count/cap fields to the perf record
  (D1 — child ids do not arrive via AgentEvent; join at read time, lines 104-115).
- Write zeros for memory-disabled fields (omit them — line 56).
