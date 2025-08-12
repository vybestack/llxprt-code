# Pseudocode: Base URL Override for Responses (REQ-005)

Note: Pseudocode only. No TypeScript. Maps to REQ-005.1..REQ-005.2.

Function: shouldUseResponses(model, baseURL, env, config)
Inputs:
- model: string
- baseURL: string | undefined
- env: { OPENAI_RESPONSES_DISABLE?: string }
- config: { openaiResponsesEnabled?: boolean }
Outputs:
- boolean // whether to use /v1/responses

Algorithm:
1) If env.OPENAI_RESPONSES_DISABLE === 'true' → return false [REQ-005.2]
2) If config.openaiResponsesEnabled === true → return true [REQ-005.1]
3) If baseURL is undefined → treat as 'https://api.openai.com/v1'
4) If baseURL !== 'https://api.openai.com/v1' → return false
5) Else → return model startsWith any RESPONSES_API_MODELS prefix

Notes:
- Positive override (step 2) allows custom gateways that implement /responses.
- Env disable supersedes all other logic. [REQ-005.2]
- Do not perform network pings in unit tests; rely on config flag only.
