# Phase 02: Pseudocode

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P02`

## Prerequisites

- Required: Phase 01 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P01" .`
- Expected files from previous phase:
  - `project-plans/20260126issue1176/plan/01-analysis.md`
  - `project-plans/20260126issue1176/architecture.md`

## Pseudocode Conventions

- Number every line
- No TypeScript, only numbered pseudocode
- Include interface contracts, integration points, and anti-pattern warnings

## Pseudocode: settingsRegistry.ts

### Interface Contracts

Inputs:
- mixed settings: Record<string, unknown>
- providerName?: string

Outputs:
- SeparatedSettings { cliSettings, modelBehavior, modelParams, customHeaders }

Dependencies:
- SETTINGS_REGISTRY: readonly SettingSpec[]
- resolveAlias(), normalizeSetting(), getSettingSpec(), isPlainObject()

### Integration Points (Line-by-Line)

- Line 24: called by ProviderManager.buildSeparatedSnapshot
- Line 30: called by RuntimeInvocationContext factory (compat shim)
- Line 46: used by CLI for validation and alias normalization

### Anti-Pattern Warnings

- Do NOT include unknown settings in modelParams
- Do NOT normalize header keys into underscore form
- Do NOT drop provider-scoped overrides

### Numbered Pseudocode

01: FUNCTION resolveAlias(key)
02:   IF key in ALIAS_NORMALIZATION_RULES
03:     RETURN ALIAS_NORMALIZATION_RULES[key]
04:   FIND spec in SETTINGS_REGISTRY where aliases includes key
05:   IF spec found
06:     RETURN spec.key
07:   IF key lowercased is in HEADER_PRESERVE_SET
08:     RETURN key
09:   RETURN key with '-' replaced by '_'

10: FUNCTION normalizeSetting(key, value)
11:   resolvedKey = resolveAlias(key)
12:   spec = getSettingSpec(resolvedKey)
13:   IF spec has normalize
14:     RETURN spec.normalize(value)
15:   IF resolvedKey == 'reasoning' AND value is plain object
16:     sanitized = remove internal keys
17:     RETURN sanitized if not empty else undefined
18:   RETURN value

19: FUNCTION separateSettings(mixed, providerName?)
20:   INIT cliSettings/modelBehavior/modelParams/customHeaders = {}
21:   providerOverrides = plain object at mixed[providerName] if exists
22:   MERGE custom-headers from mixed and providerOverrides into customHeaders
23:   effectiveSettings = shallow merge of mixed + providerOverrides
24:   IF effectiveSettings.reasoning is plain object
25:     FOR each entry subKey/subValue in reasoning
26:       fullKey = "reasoning." + subKey
27:       IF fullKey not in effectiveSettings
28:         effectiveSettings[fullKey] = subValue
29:   FOR each rawKey/value in effectiveSettings
30:     SKIP null/undefined values
31:     SKIP if rawKey == providerName and value is object
32:     SKIP if rawKey == 'custom-headers'
33:     resolvedKey = resolveAlias(rawKey)
34:     normalizedValue = normalizeSetting(resolvedKey, value)
35:     IF normalizedValue is undefined
36:       CONTINUE
37:     spec = getSettingSpec(resolvedKey)
38:     IF spec missing
39:       cliSettings[resolvedKey] = normalizedValue
40:       CONTINUE
41:     IF spec.category == model-param AND spec.providers defined AND providerName defined
42:       IF providerName not in spec.providers
43:         CONTINUE
44:     SWITCH spec.category
45:       provider-config -> ignore
46:       cli-behavior -> cliSettings[resolvedKey] = normalizedValue
47:       model-behavior -> modelBehavior[resolvedKey] = normalizedValue
48:       model-param -> modelParams[resolvedKey] = normalizedValue
49:       custom-header -> if normalizedValue is string, customHeaders[resolvedKey] = normalizedValue
50:   RETURN separated buckets

## Pseudocode: RuntimeInvocationContext

### Interface Contracts

Inputs:
- init with settings snapshot and providerName
Outputs:
- RuntimeInvocationContext with separated fields + ephemerals shim

Dependencies:
- separateSettings
- SettingsService

### Integration Points

- Line 68: ProviderManager uses factory to create invocation
- Line 82: Providers read invocation.modelParams

### Anti-Pattern Warnings

- Do NOT return live settings reference
- Do NOT omit ephemerals shim

### Numbered Pseudocode

01: FUNCTION createRuntimeInvocationContext(init)
02:   snapshot = freeze copy of init.ephemeralsSnapshot or settings service snapshot
03:   separated = separateSettings(snapshot, init.providerName)
04:   ephemeralsShim = Proxy of snapshot with deprecation warning behavior
05:   context = object with cliSettings/modelBehavior/modelParams/customHeaders from separated
06:   context.ephemerals = ephemeralsShim
07:   context.getCliSetting(key) returns separated.cliSettings[key]
08:   context.getModelBehavior(key) returns separated.modelBehavior[key]
09:   context.getModelParam(key) returns separated.modelParams[key]
10:   context.getProviderOverrides(providerName) returns snapshot[providerName] if plain object
11:   RETURN frozen context

## Pseudocode: ProviderManager

### Interface Contracts

Inputs:
- settingsService, providerName
Outputs:
- separated snapshot + ephemerals

Dependencies:
- separateSettings

### Integration Points

- Line 40: called by provider invocation creation

### Numbered Pseudocode

01: FUNCTION buildSeparatedSnapshot(settingsService, providerName)
02:   globalSettings = settingsService.getAllGlobalSettings()
03:   providerSettings = settingsService.getProviderSettings(providerName)
04:   merged = shallow merge globalSettings + providerName override object
05:   separated = separateSettings(merged, providerName)
06:   RETURN separated + ephemerals: merged

## Pseudocode: Providers

### Interface Contracts

Inputs:
- invocation with modelParams, modelBehavior, customHeaders
Outputs:
- provider request payload and headers

### Integration Points

- Use invocation.modelParams
- Use invocation.modelBehavior for reasoning translation
- Use invocation.customHeaders merged with provider defaults

### Numbered Pseudocode

01: FUNCTION getModelParamsFromInvocation(options)
02:   RETURN options.invocation?.modelParams ?? {}

03: FUNCTION getCustomHeadersFromInvocation(options)
04:   baseHeaders = getCustomHeaders() ?? {}
05:   invocationHeaders = options.invocation?.customHeaders ?? {}
06:   RETURN merge(baseHeaders, invocationHeaders)

07: FUNCTION translateReasoningToBehavior(behavior)
08:   provider-specific mapping (see architecture)
09:   RETURN provider-specific config

10: FUNCTION buildRequest(options)
11:   modelParams = getModelParamsFromInvocation(options)
12:   behavior = options.invocation?.modelBehavior ?? {}
13:   headers = getCustomHeadersFromInvocation(options)
14:   request = base request
15:   apply modelParams to request
16:   apply translated behavior to request
17:   apply headers
18:   RETURN request

## Pseudocode: CLI Profile Alias Normalization

01: FUNCTION loadProfile(profileData)
02:   normalized = empty object
03:   FOR each key/value in profileData
04:     canonicalKey = resolveAlias(key)
05:     normalized[canonicalKey] = value
06:   APPLY normalized to settings service

## Output Artifacts

- `project-plans/20260126issue1176/plan/02-pseudocode.md`
