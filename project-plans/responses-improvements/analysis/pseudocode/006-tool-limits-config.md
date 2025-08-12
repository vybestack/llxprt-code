# Pseudocode: Configurable Tool Limits (REQ-006)

Note: Pseudocode only. No TypeScript. Maps to REQ-006.1..REQ-006.2.

Function: validateAndAnnotateTools(tools, config)
Inputs:
- tools: array | undefined
- config: { toolsMaxCount?: number; toolsMaxJsonKB?: number; debug?: boolean }
Outputs:
- { ok: boolean, warnings: string[], error?: string }

Algorithm:
1) If tools is undefined or empty → return { ok: true, warnings: [] }
2) maxCount = config.toolsMaxCount || 16
   maxKB = config.toolsMaxJsonKB || 32
3) If tools.length > maxCount:
   - return { ok: false, warnings: [], error: `Too many tools: ${tools.length} > ${maxCount}` } [REQ-006.1, REQ-006.2]
4) Serialize = JSON.stringify(tools)
   sizeKB = bytes(Serialize)/1024
5) If sizeKB > maxKB:
   - return { ok: false, warnings: [], error: `Tools JSON size ${sizeKB.toFixed(2)}KB exceeds ${maxKB}KB` } [REQ-006.1, REQ-006.2]
6) If sizeKB > (maxKB * 0.8) or tools.length > (maxCount * 0.8):
   - warnings.push(`Approaching limits: tools=${tools.length}/${maxCount}, size=${sizeKB.toFixed(2)}KB/${maxKB}KB`) [REQ-006.2]
7) return { ok: true, warnings }

Error Handling:
- On serialization errors: return { ok: false, error: 'Invalid tool schema' }

Notes:
- Do not mutate tools; read-only inspection
- Logging of warnings controlled by DEBUG mode outside of this function
