# Preflight Verification Results Template

Plan ID: PLAN-20260608-ISSUE1585

P00a must copy this file to analysis/preflight-results.md and paste actual command outputs. Do not proceed to production-code phases until this gate is reviewed.

## Dependency And Package Existence Verification

| Check | Command | Output | Status |
| --- | --- | --- | --- |
| packages/tools absent or existing state known | ls -la packages/tools 2>&1 | | |
| packages/settings exists | ls -la packages/settings 2>&1 | | |
| packages/storage exists | ls -la packages/storage 2>&1 | | |
| packages/mcp exists | ls -la packages/mcp 2>&1 | | |
| root workspaces baseline | node -e "console.log(require('./package.json').workspaces.join('\n'))" | | |
| providers package metadata pattern | cat packages/providers/package.json | | |
| core package tool exports baseline | node -e "const p=require('./packages/core/package.json'); console.log(Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/')).join('\n'))" | | |

## Type And Interface Verification

| Type/Interface | Expected By Plan | Actual Definition/Evidence | Match? |
| --- | --- | --- | --- |
| ToolContext | narrow session/agent/interactive context | packages/core/src/tools/tool-context.ts | |
| ToolRegistry | imports Config and MessageBus before migration | packages/core/src/tools/tool-registry.ts | |
| BaseTool/BaseToolInvocation | imports MessageBus/IDE/schema utilities before migration | packages/core/src/tools/tools.ts | |
| Config tool registry factory host | existing narrow ToolRegistryHost in config/toolRegistryFactory.ts | packages/core/src/config/toolRegistryFactory.ts | |
| MessageBus confirmation API | can be adapted to tools-owned interface | packages/core/src/confirmation-bus/message-bus.ts | |

## Import Graph Verification

| Graph Check | Command | Output Summary | Status |
| --- | --- | --- | --- |
| core imports tools | rg -n "from ['\"]\.\./tools/|from ['\"]\.\./\.\./tools/" packages/core/src -g "*.ts" | | |
| providers import core tools | rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts" | | |
| tools import core config/message/services | rg -n "from ['\"]\.\./\(config\|confirmation-bus\|services\|core\|mcp\|ide\|lsp\|storage\|debug\|utils\)/" packages/core/src/tools -g "*.ts" | | |
| A2A server tool consumers | rg -n "getToolRegistry|ToolRegistry" packages/a2a-server/src -g "*.ts" | | |

## Release Verification

| Check | Command | Output | Status |
| --- | --- | --- | --- |
| current publish steps | rg -n "npm publish --workspace=@vybestack/llxprt-code" .github/workflows/release.yml | | |
| release process tests mention providers but not tools | rg -n "providers|tools" scripts/tests/release-process.test.js | | |
| sandbox pack baseline | rg -n "npm pack -w @vybestack/llxprt-code" scripts/build_sandbox.js | | |
| Docker tarball baseline | rg -n "vybestack-llxprt-code.*\.tgz" Dockerfile | | |
| missing packages reconciliation | find packages -maxdepth 1 -type d \( -name settings -o -name storage -o -name mcp \) | | |
| core services for temp interfaces | rg -n "SettingsService|SecureStore|McpClientManager|PromptRegistry" packages/core/src packages/cli/src packages/providers/src -g "*.ts" | | |

## Blocking Issues Found

- [ ] Missing packages/settings resolved or approved temporary adapter path documented.
- [ ] Missing packages/storage resolved or approved temporary adapter path documented.
- [ ] MCP ownership decision documented.
- [ ] Complete file inventory generated.
- [ ] Release/trusted publishing work included.

## Verification Gate

- [ ] All dependencies/packages verified.
- [ ] All type/interface assumptions match actual code.
- [ ] All call paths are possible with the proposed adapter design.
- [ ] Test infrastructure exists or phases create it before implementation.
- [ ] No unapproved package cycle remains in the proposed design.


# Actual P00a Command Outputs

## Package existence

### ls -la packages/tools 2>&1

```text
ls: packages/tools: No such file or directory
```

### ls -la packages/settings 2>&1

```text
ls: packages/settings: No such file or directory
```

### ls -la packages/storage 2>&1

```text
ls: packages/storage: No such file or directory
```

### ls -la packages/mcp 2>&1

```text
ls: packages/mcp: No such file or directory
```

### find packages -maxdepth 1 -type d (settings/storage/mcp)

```text
```

## Core services for temporary interfaces

### rg -n "SettingsService|SecureStore|McpClientManager|PromptRegistry" packages/core/src packages/cli/src packages/providers/src -g "*.ts"

```text
packages/cli/src/nonInteractiveCli.ts:57:      const settingsService = config.getSettingsService() as Omit<
packages/cli/src/nonInteractiveCli.ts:58:        ReturnType<Config['getSettingsService']>,
packages/cli/src/nonInteractiveCli.ts:287:      settingsService: config.getSettingsService(),
packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts:354:        this.resolveSettingsService().getProviderSettings(this.name);
packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts:381:        () => `Failed to compute model params from SettingsService: ${error}`,
packages/cli/src/services/McpPromptLoader.test.ts:163:      getMcpClientManager: () => ({
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts:11:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts:31:        settingsService: new SettingsService(),
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts:48:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts:114:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts:178:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts:242:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts:308:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningEffort.test.ts:8:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningEffort.test.ts:28:        settingsService: new SettingsService(),
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningEffort.test.ts:45:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/openaiResponses.stateless.test.ts:6:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-responses/__tests__/openaiResponses.stateless.test.ts:138:  const svc = new SettingsService();
packages/providers/src/openai-responses/__tests__/openaiResponses.stateless.test.ts:163:        settingsService: new SettingsService(),
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts:10:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts:30:        settingsService: new SettingsService(),
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts:47:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts:109:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts:171:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts:233:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts:294:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts:13:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts:85:        settingsService: new SettingsService(),
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts:133:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts:204:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts:288:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts:372:    const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts:438:    const settings = new SettingsService();
packages/providers/src/IProvider.ts:20:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/IProvider.ts:51:  settings?: SettingsService;
packages/providers/src/ProviderManager.test.ts:12:  registerSettingsService,
packages/providers/src/ProviderManager.test.ts:13:  resetSettingsService,
packages/providers/src/ProviderManager.test.ts:15:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/ProviderManager.test.ts:34:    resetSettingsService();
packages/providers/src/ProviderManager.test.ts:75:    resetSettingsService();
packages/providers/src/ProviderManager.test.ts:77:    registerSettingsService(new SettingsService());
packages/providers/src/ProviderManager.test.ts:148:    resetSettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:26:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:46:        settingsService: new SettingsService(),
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:64:      const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:126:      const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:191:      const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:254:      const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:328:      const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:407:      const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:479:      const settings = new SettingsService();
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts:574:      const settings = new SettingsService();
packages/providers/src/providerManager.context.test.ts:9:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/providerManager.context.test.ts:40:    const settingsService = new SettingsService();
packages/providers/src/providerManager.context.test.ts:59:    const settingsService = new SettingsService();
packages/providers/src/integration/multi-provider.integration.test.ts:14:import { resetSettingsService } from '@vybestack/llxprt-code-core/settings/settingsServiceInstance.js';
packages/providers/src/integration/multi-provider.integration.test.ts:16:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/integration/multi-provider.integration.test.ts:33:  let settingsService: SettingsService;
packages/providers/src/integration/multi-provider.integration.test.ts:67:    resetSettingsService();
packages/providers/src/integration/multi-provider.integration.test.ts:95:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/integration/multi-provider.integration.test.ts:178:        resetSettingsService();
packages/providers/src/integration/multi-provider.integration.test.ts:198:        openaiProvider.setRuntimeSettingsService(runtime.settingsService);
packages/providers/src/integration/multi-provider.integration.test.ts:354:      openaiProvider.setRuntimeSettingsService(runtime.settingsService);
packages/providers/src/integration/multi-provider.integration.test.ts:400:      resetSettingsService();
packages/providers/src/integration/multi-provider.integration.test.ts:420:      openaiProvider.setRuntimeSettingsService(runtime.settingsService);
packages/providers/src/integration/multi-provider.integration.test.ts:485:        openaiProvider.setRuntimeSettingsService(runtime.settingsService);
packages/providers/src/integration/multi-provider.integration.test.ts:580:      resetSettingsService();
packages/providers/src/integration/multi-provider.integration.test.ts:600:      openaiProvider.setRuntimeSettingsService(runtime.settingsService);
packages/providers/src/BaseProvider.test.ts:21:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/BaseProvider.test.ts:24:  getSettingsService,
packages/providers/src/BaseProvider.test.ts:25:  registerSettingsService,
packages/providers/src/BaseProvider.test.ts:26:  resetSettingsService,
packages/providers/src/BaseProvider.test.ts:62:  settingsService?: SettingsService,
packages/providers/src/BaseProvider.test.ts:65:  const settings = settingsService ?? getSettingsService();
packages/providers/src/BaseProvider.test.ts:88:    settingsOverride?: SettingsService,
packages/providers/src/BaseProvider.test.ts:90:    const settingsService = settingsOverride ?? getSettingsService();
packages/providers/src/BaseProvider.test.ts:178:    resetSettingsService();
packages/providers/src/BaseProvider.test.ts:179:    registerSettingsService(new SettingsService());
packages/providers/src/BaseProvider.test.ts:189:    it('should prioritize SettingsService auth-key over all other methods', async () => {
packages/providers/src/BaseProvider.test.ts:190:      const settingsService = getSettingsService();
packages/providers/src/BaseProvider.test.ts:213:      // Then: Should use SettingsService auth-key
packages/providers/src/BaseProvider.test.ts:220:    it('should fall back to environment variable when no SettingsService auth', async () => {
packages/providers/src/BaseProvider.test.ts:298:      const defaultSettings = getSettingsService();
packages/providers/src/BaseProvider.test.ts:318:      const customSettings = new SettingsService();
packages/providers/src/BaseProvider.test.ts:433:      const settings = getSettingsService();
packages/providers/src/BaseProvider.test.ts:508:      const settingsService = getSettingsService();
packages/providers/src/BaseProvider.test.ts:541:      const settingsService = getSettingsService();
packages/providers/src/BaseProvider.test.ts:555:      const settingsService = getSettingsService();
packages/providers/src/BaseProvider.test.ts:577:      const settingsService = getSettingsService();
packages/providers/src/BaseProvider.test.ts:579:      // When: Update API key through SettingsService
packages/providers/src/BaseProvider.test.ts:611:      // Update to use API key via SettingsService
packages/providers/src/BaseProvider.test.ts:612:      const settingsService = getSettingsService();
packages/providers/src/openai-responses/OpenAIResponsesProvider.headers.test.ts:6:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/openai-responses/OpenAIResponsesProvider.headers.test.ts:27:    getSettingsService: () => mockSettingsService,
packages/providers/src/openai-responses/OpenAIResponsesProvider.headers.test.ts:42:    mockSettingsService.getSettings.mockResolvedValue({});
packages/providers/src/BaseProvider.ts:33:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/BaseProvider.ts:34:import { getSettingsService } from '@vybestack/llxprt-code-core/settings/settingsServiceInstance.js';
packages/providers/src/BaseProvider.ts:68:  settings: SettingsService;
packages/providers/src/BaseProvider.ts:100:  private defaultSettingsService: SettingsService;
packages/providers/src/BaseProvider.ts:120:    settingsService?: SettingsService,
packages/providers/src/BaseProvider.ts:127:    let fallbackSettingsService: SettingsService;
packages/providers/src/BaseProvider.ts:129:      fallbackSettingsService = settingsService;
packages/providers/src/BaseProvider.ts:132:        fallbackSettingsService = getSettingsService();
packages/providers/src/BaseProvider.ts:134:        fallbackSettingsService = new SettingsService();
packages/providers/src/BaseProvider.ts:138:    this.defaultSettingsService = fallbackSettingsService;
packages/providers/src/BaseProvider.ts:154:      fallbackSettingsService,
packages/providers/src/BaseProvider.ts:164:  setRuntimeSettingsService(
packages/providers/src/BaseProvider.ts:165:    settingsService: SettingsService | null | undefined,
packages/providers/src/BaseProvider.ts:170:    this.defaultSettingsService = settingsService;
packages/providers/src/BaseProvider.ts:171:    this.authResolver.setSettingsService(settingsService);
packages/providers/src/BaseProvider.ts:181:  protected resolveSettingsService(): SettingsService {
packages/providers/src/BaseProvider.ts:188:    if (this.defaultSettingsService !== undefined) {
packages/providers/src/BaseProvider.ts:189:      return this.defaultSettingsService;
packages/providers/src/BaseProvider.ts:195:      stage: 'resolveSettingsService',
packages/providers/src/BaseProvider.ts:219:   * 2. Provider-specific settings in SettingsService
packages/providers/src/BaseProvider.ts:229:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:239:   * 2. Provider-specific settings in SettingsService
packages/providers/src/BaseProvider.ts:248:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:252:  private computeBaseURL(settingsService: SettingsService): string | undefined {
packages/providers/src/BaseProvider.ts:301:  private computeModel(settingsService: SettingsService): string {
packages/providers/src/BaseProvider.ts:340:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:368:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:431:      settingsService: this.resolveSettingsService(),
packages/providers/src/BaseProvider.ts:443:      settingsService: this.resolveSettingsService(),
packages/providers/src/BaseProvider.ts:455:      settingsService: this.resolveSettingsService(),
packages/providers/src/BaseProvider.ts:463:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:521:          settingsService: this.resolveSettingsService(),
packages/providers/src/BaseProvider.ts:708:        this.authResolver.setSettingsService(this.defaultSettingsService);
packages/providers/src/BaseProvider.ts:731:      this.defaultSettingsService,
packages/providers/src/BaseProvider.ts:746:      defaultSettingsService: settings,
packages/providers/src/BaseProvider.ts:759:    settings: SettingsService,
packages/providers/src/BaseProvider.ts:776:    settings?: SettingsService | null;
packages/providers/src/BaseProvider.ts:841:   * Get setting value from SettingsService
packages/providers/src/BaseProvider.ts:847:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:857:          `Failed to get ${key} from SettingsService for ${this.name}:`,
packages/providers/src/BaseProvider.ts:866:   * Set setting value in SettingsService
packages/providers/src/BaseProvider.ts:872:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:885:          `Failed to set ${key} in SettingsService for ${this.name}:`,
packages/providers/src/BaseProvider.ts:893:   * Get API key from SettingsService if available
packages/providers/src/BaseProvider.ts:900:   * Set API key in SettingsService if available
packages/providers/src/BaseProvider.ts:907:   * Get model from SettingsService if available
packages/providers/src/BaseProvider.ts:914:   * Set model in SettingsService if available
packages/providers/src/BaseProvider.ts:921:   * Get base URL from SettingsService if available
packages/providers/src/BaseProvider.ts:928:   * Set base URL in SettingsService if available
packages/providers/src/BaseProvider.ts:935:   * Get model parameters from SettingsService
packages/providers/src/BaseProvider.ts:940:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:968:          `Failed to get model params from SettingsService for ${this.name}:`,
packages/providers/src/BaseProvider.ts:977:   * Set model parameters in SettingsService
packages/providers/src/BaseProvider.ts:982:    const settingsService = this.resolveSettingsService();
packages/providers/src/BaseProvider.ts:1013:          `Failed to set model params in SettingsService for ${this.name}:`,
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:44:  SettingsService,
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:113:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:148:        const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:194:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:231:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:259:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:285:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:326:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:379:  let settingsService: SettingsService;
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:394:    settingsService = config.getSettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:529:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:568:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts:638:    const settingsService = new SettingsService();
packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:160:          getMcpClientManager?: () =>
packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:168:    const mcpClientManager = configWithManagers?.getMcpClientManager?.();
packages/providers/src/provider-manager-behavior.test.ts:47:// Import SettingsService for proper ProviderManager construction
packages/providers/src/provider-manager-behavior.test.ts:48:import { SettingsService } from '@vybestack/llxprt-code-core';
packages/providers/src/provider-manager-behavior.test.ts:55: * Uses real SettingsService and a lightweight config stub, matching
packages/providers/src/provider-manager-behavior.test.ts:58:function createTestConfig(settingsService: SettingsService) {
packages/providers/src/provider-manager-behavior.test.ts:75:    getSettingsService: () => settingsService,
packages/providers/src/provider-manager-behavior.test.ts:136:      const settingsService = new SettingsService();
packages/providers/src/provider-manager-behavior.test.ts:162:      const settingsService = new SettingsService();
packages/providers/src/provider-manager-behavior.test.ts:181:    const settingsService = new SettingsService();
packages/providers/src/provider-manager-behavior.test.ts:200:      const settingsService = new SettingsService();
packages/providers/src/anthropic/AnthropicProvider.test.ts:17:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.test.ts:205:  let settingsService: SettingsService;
packages/providers/src/utils/toolFormatDetection.ts:48: * toolFormat overrides. Matches the subset of SettingsService used for
packages/cli/src/integration-tests/ephemeral-settings.integration.test.ts:19:  SettingsService,
packages/cli/src/integration-tests/ephemeral-settings.integration.test.ts:50:      settingsService: new SettingsService(),
packages/cli/src/integration-tests/ephemeral-settings.integration.test.ts:247:        settingsService: new SettingsService(),
packages/cli/src/integration-tests/ephemeral-settings.integration.test.ts:292:        settingsService: new SettingsService(),
packages/providers/src/gemini/GeminiProvider.mediaBlock.test.ts:45:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/gemini/GeminiProvider.mediaBlock.test.ts:56:    getSettingsService: vi.fn(() => mockSettingsService),
packages/providers/src/BaseProviderNormalization.ts:8:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/BaseProviderNormalization.ts:22:  settings?: SettingsService | null;
packages/providers/src/BaseProviderNormalization.ts:37:  defaultSettingsService: SettingsService;
packages/providers/src/BaseProviderNormalization.ts:45:    settings: SettingsService,
packages/providers/src/BaseProviderNormalization.ts:152:  fallbackSettings: SettingsService | undefined,
packages/providers/src/BaseProviderNormalization.ts:154:): SettingsService {
packages/providers/src/BaseProviderNormalization.ts:162:        hint: 'ProviderManager must supply settings via GenerateChatOptions or setRuntimeSettingsService.',
packages/providers/src/BaseProviderNormalization.ts:204:  const settings = deps.defaultSettingsService;
packages/cli/src/integration-tests/model-params-isolation.integration.test.ts:17:  type SettingsService,
packages/cli/src/integration-tests/model-params-isolation.integration.test.ts:70:      // Intentionally blank; runtime helpers now manage state in SettingsService.
packages/cli/src/integration-tests/model-params-isolation.integration.test.ts:79:  let settingsService: SettingsService;
packages/cli/src/integration-tests/model-params-isolation.integration.test.ts:92:    settingsService = config.getSettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:6:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:206:      settingsService: new SettingsService(),
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:245:    const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:293:    const settingsPrimary = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:344:    const settingsOverride = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:413:    const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:503:    const settingsA = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:506:    const settingsB = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:588:    const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.stateless.test.ts:619:    const settings = new SettingsService();
packages/core/src/services/contextManager.ts:64:      this.config.getMcpClientManager()?.getMcpInstructions() || '';
packages/providers/src/anthropic/AnthropicProvider.issue1150.streaming.test.ts:39:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue1150.streaming.test.ts:76:  let settingsService: SettingsService;
packages/cli/src/integration-tests/tools-governance.integration.test.ts:11:import { ProfileManager, SettingsService } from '@vybestack/llxprt-code-core';
packages/cli/src/integration-tests/tools-governance.integration.test.ts:62:    const settings = new SettingsService();
packages/cli/src/integration-tests/tools-governance.integration.test.ts:95:      getSettingsService: () => settings,
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:7:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:189:      settingsService: new SettingsService(),
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:213:    const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:262:    const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:327:      const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:378:    const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:428:    const settings = new SettingsService();
packages/providers/src/gemini/__tests__/gemini.thinkingLevel.test.ts:478:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:5:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:19:let settingsServiceRef: { current: SettingsService } = {
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:20:  current: new SettingsService(),
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:39:    getSettingsService: () => settingsServiceRef.current,
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:53:    settingsServiceRef = { current: new SettingsService() };
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:94:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:174:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:212:    settingsServiceRef.current = new SettingsService();
packages/providers/src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts:266:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/ProviderManager.ts:38:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/ProviderManager.ts:87:  settingsService?: SettingsService;
packages/providers/src/ProviderManager.ts:108:  private settingsService: SettingsService;
packages/providers/src/ProviderManager.ts:152:    settingsService: SettingsService;
packages/providers/src/ProviderManager.ts:296:      setRuntimeSettingsService?: (settingsService: SettingsService) => void;
packages/providers/src/ProviderManager.ts:308:    runtimeAware.setRuntimeSettingsService?.(this.settingsService);
packages/providers/src/ProviderManager.ts:350:      baseRuntime as { settingsService?: SettingsService | null }
packages/providers/src/ProviderManager.ts:359:          hint: 'ProviderManager requires a SettingsService to construct runtime contexts.',
packages/providers/src/ProviderManager.ts:449:  ): { settingsService: SettingsService; config: Config } {
packages/providers/src/ProviderManager.ts:463:          hint: 'SettingsService must be provided in options.settings or runtime.settingsService',
packages/providers/src/ProviderManager.ts:491:    settingsService: SettingsService,
packages/providers/src/ProviderManager.ts:610:    settingsService: SettingsService,
packages/providers/src/ProviderManager.ts:614:    const configSettingsService =
packages/providers/src/ProviderManager.ts:615:      typeof (config as unknown as { getSettingsService?: () => unknown })
packages/providers/src/ProviderManager.ts:616:        .getSettingsService === 'function'
packages/providers/src/ProviderManager.ts:618:            config as unknown as { getSettingsService: () => unknown }
packages/providers/src/ProviderManager.ts:619:          ).getSettingsService()
packages/providers/src/ProviderManager.ts:621:    const configMatchesSettingsService =
packages/providers/src/ProviderManager.ts:622:      configSettingsService === undefined ||
packages/providers/src/ProviderManager.ts:623:      configSettingsService === null ||
packages/providers/src/ProviderManager.ts:624:      configSettingsService === settingsService;
packages/providers/src/ProviderManager.ts:629:      configMatchesSettingsService &&
packages/providers/src/ProviderManager.ts:702:    _settingsService: SettingsService,
packages/providers/src/ProviderManager.ts:823:    settingsService: SettingsService,
packages/providers/src/ProviderManager.ts:884:    settingsService: SettingsService,
packages/providers/src/ProviderManager.ts:1018:    // Update SettingsService as the single source of truth
packages/providers/src/ProviderManager.ts:1615:    const invocationSettingsService = (
packages/providers/src/ProviderManager.ts:1616:      runtimeContext as { settingsService?: SettingsService | null }
packages/providers/src/ProviderManager.ts:1619:      invocationSettingsService === null ||
packages/providers/src/ProviderManager.ts:1620:      invocationSettingsService === undefined
packages/providers/src/ProviderManager.ts:1629:          hint: 'ProviderManager requires a SettingsService for stateless invocation.',
packages/providers/src/ProviderManager.ts:1661:      settingsService: invocationSettingsService,
packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts:21:  SecureStore,
packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts:133:    const secureStore = new SecureStore('llxprt-code-oauth', {
packages/providers/src/openai/openai-oauth.spec.ts:23:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/openai-oauth.spec.ts:99:    // Clear global SettingsService instance to ensure isolation
packages/providers/src/openai/openai-oauth.spec.ts:107:    const { getSettingsService } = await import(
packages/providers/src/openai/openai-oauth.spec.ts:111:      settingsService: new SettingsService(),
packages/providers/src/openai/openai-oauth.spec.ts:115:    const globalSettingsService = getSettingsService();
packages/providers/src/openai/openai-oauth.spec.ts:116:    globalSettingsService.clear();
packages/cli/src/zed-integration/zedIntegration.ts:109:   * current Config/SettingsService pair before spawning session handlers.
packages/cli/src/zed-integration/zedIntegration.ts:112:  setCliRuntimeContext(config.getSettingsService(), config, {
packages/cli/src/zed-integration/zedIntegration.ts:378:         * SettingsService aligned with stateless semantics.
packages/providers/src/anthropic/AnthropicProvider.issue1494.test.ts:17:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue1494.test.ts:51:  let settingsService: SettingsService;
packages/providers/src/openai/getOpenAIProviderInfo.context.test.ts:2:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/getOpenAIProviderInfo.context.test.ts:37:  it('derives model and responses mode from SettingsService', () => {
packages/providers/src/openai/getOpenAIProviderInfo.context.test.ts:38:    const settingsService = new SettingsService();
packages/providers/src/openai/getOpenAIProviderInfo.context.test.ts:72:  it('falls back to runtime config when SettingsService lacks model', () => {
packages/providers/src/openai/getOpenAIProviderInfo.context.test.ts:73:    const settingsService = new SettingsService();
packages/providers/src/openai/getOpenAIProviderInfo.context.test.ts:97:    const settingsService = new SettingsService();
packages/cli/src/integration-tests/compression-settings-apply.integration.test.ts:12:  SettingsService,
packages/cli/src/integration-tests/compression-settings-apply.integration.test.ts:45:      settingsService: new SettingsService(),
packages/cli/src/integration-tests/compression-settings-apply.integration.test.ts:193:        settingsService: new SettingsService(),
packages/cli/src/integration-tests/compression-settings-apply.integration.test.ts:245:        settingsService: new SettingsService(),
packages/cli/src/integration-tests/todo-continuation.integration.test.ts:16:  SettingsService,
packages/cli/src/integration-tests/todo-continuation.integration.test.ts:66:      settingsService: new SettingsService(),
packages/cli/src/integration-tests/todo-continuation.integration.test.ts:124:        settingsService: new SettingsService(),
packages/cli/src/integration-tests/todo-continuation.integration.test.ts:301:        settingsService: new SettingsService(),
packages/cli/src/integration-tests/todo-continuation.integration.test.ts:588:        settingsService: new SettingsService(),
packages/providers/src/openai/OpenAIProvider.emptyResponseRetry.test.ts:9:import { resetSettingsService } from '@vybestack/llxprt-code-core/settings/settingsServiceInstance.js';
packages/providers/src/openai/OpenAIProvider.emptyResponseRetry.test.ts:11:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIProvider.emptyResponseRetry.test.ts:20:  let settingsService: SettingsService;
packages/providers/src/openai/OpenAIProvider.emptyResponseRetry.test.ts:24:    resetSettingsService();
packages/providers/src/openai/OpenAIProvider.emptyResponseRetry.test.ts:40:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/anthropic/AnthropicProvider.issue1150.shape.test.ts:40:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue1150.shape.test.ts:77:  let settingsService: SettingsService;
packages/providers/src/gemini/__tests__/gemini.userMemory.test.ts:16:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/gemini/__tests__/gemini.userMemory.test.ts:96:  let settingsService: SettingsService;
packages/providers/src/gemini/__tests__/gemini.userMemory.test.ts:109:    settingsService = new SettingsService();
packages/cli/src/integration-tests/oauth-timing.integration.test.ts:25:  SettingsService,
packages/cli/src/integration-tests/oauth-timing.integration.test.ts:28:  SecureStore,
packages/cli/src/integration-tests/oauth-timing.integration.test.ts:87:  let settingsService: SettingsService;
packages/cli/src/integration-tests/oauth-timing.integration.test.ts:100:    settingsService = new SettingsService();
packages/cli/src/integration-tests/oauth-timing.integration.test.ts:104:    const secureStore = new SecureStore('llxprt-code-oauth', {
packages/providers/src/openai/OpenAIProvider.toolFormatDetection.test.ts:4:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/openai/OpenAIProvider.toolFormatDetection.test.ts:21:    getSettingsService: () => mockSettingsService,
packages/providers/src/openai/OpenAIProvider.toolFormatDetection.test.ts:30:    mockSettingsService.settings = { providers: { openai: {} } };
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:14:import type { Profile, SettingsService } from '@vybestack/llxprt-code-core';
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:49:  let settingsService: SettingsService;
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:63:    settingsService = config.getSettingsService();
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:104:      config.getSettingsService().getProviderSettings('openai')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:116:      config.getSettingsService().getProviderSettings('openai')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:122:      config.getSettingsService().getProviderSettings('openai')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:129:      config.getSettingsService().getProviderSettings('openai')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:142:      config.getSettingsService().getProviderSettings('gemini')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:155:      config.getSettingsService().getProviderSettings('openai')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:160:      config.getSettingsService().getProviderSettings('openai')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:163:      config.getSettingsService().getProviderSettings('anthropic')['base-url'],
packages/cli/src/integration-tests/base-url-behavior.integration.test.ts:193:      config.getSettingsService().getProviderSettings('openai')['base-url'],
packages/cli/src/integration-tests/modelParams.integration.test.ts:16:  type SettingsService,
packages/cli/src/integration-tests/modelParams.integration.test.ts:72:  let settingsService: SettingsService;
packages/cli/src/integration-tests/modelParams.integration.test.ts:94:    settingsService = config.getSettingsService();
packages/cli/src/integration-tests/provider-switching.integration.test.ts:19:import type { SettingsService } from '@vybestack/llxprt-code-core';
packages/cli/src/integration-tests/provider-switching.integration.test.ts:54:  let settingsService: SettingsService;
packages/cli/src/integration-tests/provider-switching.integration.test.ts:68:    settingsService = config.getSettingsService();
packages/cli/src/integration-tests/provider-switching.integration.test.ts:107:      config.getSettingsService().getProviderSettings('providerA').apiKey,
packages/cli/src/integration-tests/provider-switching.integration.test.ts:113:      config.getSettingsService().getProviderSettings('providerA').apiKey,
packages/cli/src/integration-tests/provider-switching.integration.test.ts:120:      config.getSettingsService().getProviderSettings('providerB').apiKey,
packages/cli/src/integration-tests/provider-switching.integration.test.ts:125:      config.getSettingsService().getProviderSettings('providerB').apiKey,
packages/cli/src/integration-tests/provider-switching.integration.test.ts:145:      config.getSettingsService().getProviderSettings('providerA').temperature,
packages/cli/src/integration-tests/provider-switching.integration.test.ts:154:      config.getSettingsService().getProviderSettings('providerB').temperature,
packages/cli/src/integration-tests/provider-switching.integration.test.ts:172:      .getSettingsService()
packages/cli/src/integration-tests/provider-switching.integration.test.ts:177:      config.getSettingsService().getProviderSettings('gemini')['base-url'],
packages/cli/src/integration-tests/provider-switching.integration.test.ts:182:      config.getSettingsService().getProviderSettings('gemini')['base-url'],
packages/providers/src/gemini/GeminiProvider.ts:378:    //    - SettingsService auth-key
packages/providers/src/gemini/GeminiProvider.ts:379:    //    - SettingsService auth-keyfile
packages/providers/src/gemini/GeminiProvider.ts:383:      settingsService: this.resolveSettingsService(),
packages/providers/src/gemini/GeminiProvider.ts:634:   * Gets the current model ID from SettingsService per call
packages/providers/src/gemini/GeminiProvider.ts:637:    // Try to get from SettingsService first (source of truth)
packages/providers/src/gemini/GeminiProvider.ts:639:      const settingsService = this.resolveSettingsService();
packages/providers/src/gemini/GeminiProvider.ts:650:        () => `Failed to get model from SettingsService: ${error}`,
packages/providers/src/gemini/GeminiProvider.ts:667:   * Gets model parameters from SettingsService per call
packages/providers/src/gemini/GeminiProvider.ts:671:      const settingsService = this.resolveSettingsService();
packages/providers/src/gemini/GeminiProvider.ts:702:          `Failed to get Gemini provider settings from SettingsService: ${error}`,
packages/providers/src/gemini/GeminiProvider.ts:715:    // Note: This doesn't check SettingsService to maintain synchronous behavior
packages/providers/src/gemini/GeminiProvider.ts:734:    // Call base implementation to clear SettingsService
packages/providers/src/gemini/GeminiProvider.ts:1418:      ?.getMcpClientManager?.()
packages/providers/src/openai/OpenAIProvider.mediaBlock.test.ts:46:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/openai/OpenAIProvider.mediaBlock.test.ts:57:    getSettingsService: vi.fn(() => mockSettingsService),
packages/cli/src/utils/apiErrorFormatting.ts:68:      .getSettingsService()
packages/providers/src/gemini/GeminiProvider.test.ts:36:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/gemini/GeminiProvider.test.ts:47:    getSettingsService: vi.fn(() => mockSettingsService),
packages/providers/src/gemini/GeminiProvider.test.ts:482:    it('should respect auth precedence (SettingsService over env var)', async () => {
packages/providers/src/gemini/GeminiProvider.test.ts:486:      // Mock authResolver to return 'settings-key' (from SettingsService/keyfile)
packages/cli/src/runtime/runtimeLifecycle.spec.ts:27:  SettingsService,
packages/cli/src/runtime/runtimeLifecycle.spec.ts:43:  let mockSettingsService: SettingsService;
packages/cli/src/runtime/runtimeLifecycle.spec.ts:67:    mockSettingsService = {
packages/cli/src/runtime/runtimeLifecycle.spec.ts:75:    } as unknown as SettingsService;
packages/cli/src/runtime/runtimeLifecycle.spec.ts:117:      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:121:      expect(entry?.settingsService).toBe(mockSettingsService);
packages/cli/src/runtime/runtimeLifecycle.spec.ts:126:      setCliRuntimeContext(mockSettingsService, mockConfig);
packages/cli/src/runtime/runtimeLifecycle.spec.ts:138:      setCliRuntimeContext(mockSettingsService, mockConfig, {
packages/cli/src/runtime/runtimeLifecycle.spec.ts:149:      setCliRuntimeContext(mockSettingsService, mockConfig, {
packages/cli/src/runtime/runtimeLifecycle.spec.ts:152:      setCliRuntimeContext(mockSettingsService, mockConfig, {
packages/cli/src/runtime/runtimeLifecycle.spec.ts:167:      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:168:      setCliRuntimeContext(mockSettingsService, newConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:179:      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:196:      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:212:      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:234:      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:258:      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeLifecycle.spec.ts:283:      settingsService: mockSettingsService,
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:14:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:31:  const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:58:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:81:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:103:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:125:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:148:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:171:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:193:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:214:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:236:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:257:    const settings = new SettingsService();
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts:278:    const settings = new SettingsService();
packages/providers/src/anthropic/AnthropicProvider.issue1150.test.ts:17:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue1150.test.ts:52:  let settingsService: SettingsService;
packages/providers/src/providerInterface.contract.test.ts:110:    provider.setRuntimeSettingsService(customSettings);
packages/providers/src/anthropic/AnthropicProvider.issue1150.redacted.test.ts:32:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue1150.redacted.test.ts:65:  let settingsService: SettingsService;
packages/cli/src/runtime/provider-alias-defaults.test.ts:17:  StubSettingsService: StubSettingsServiceClass,
packages/cli/src/runtime/provider-alias-defaults.test.ts:21:  class StubSettingsService {
packages/cli/src/runtime/provider-alias-defaults.test.ts:75:    private settingsService: InstanceType<typeof StubSettingsService>;
packages/cli/src/runtime/provider-alias-defaults.test.ts:78:    constructor(settingsService: InstanceType<typeof StubSettingsService>) {
packages/cli/src/runtime/provider-alias-defaults.test.ts:82:    getSettingsService(): unknown {
packages/cli/src/runtime/provider-alias-defaults.test.ts:141:  return { StubSettingsService, StubConfig, StubProvider };
packages/cli/src/runtime/provider-alias-defaults.test.ts:144:type StubSettingsServiceInstance = InstanceType<
packages/cli/src/runtime/provider-alias-defaults.test.ts:145:  typeof StubSettingsServiceClass
packages/cli/src/runtime/provider-alias-defaults.test.ts:150:const StubSettingsService = StubSettingsServiceClass;
packages/cli/src/runtime/provider-alias-defaults.test.ts:177:let stubSettingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/provider-alias-defaults.test.ts:189:    settingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/provider-alias-defaults.test.ts:197:    SettingsService: StubSettingsServiceClass,
packages/cli/src/runtime/provider-alias-defaults.test.ts:200:      settingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/provider-alias-defaults.test.ts:217:      settingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/provider-alias-defaults.test.ts:294:    stubSettingsService = new StubSettingsService();
packages/cli/src/runtime/provider-alias-defaults.test.ts:295:    stubConfig = new StubConfig(stubSettingsService);
packages/cli/src/runtime/provider-alias-defaults.test.ts:299:    setCliRuntimeContext(stubSettingsService as never, stubConfig as never, {
packages/cli/src/runtime/provider-alias-defaults.test.ts:352:    expect(stubSettingsService.getProviderSettings('qwenvercel').model).toBe(
packages/cli/src/runtime/provider-alias-defaults.test.ts:413:    expect(stubSettingsService.getProviderSettings('gemini').model).toBe(
packages/cli/src/runtime/provider-alias-defaults.test.ts:825:      stubSettingsService.setProviderSetting('anthropic', 'model', undefined);
packages/cli/src/runtime/provider-alias-defaults.test.ts:958:      stubSettingsService.setProviderSetting('anthropic', 'model', 'gpt-4o');
packages/cli/src/runtime/provider-alias-defaults.test.ts:1068:        stubSettingsService.getProviderSettings('openrouter')[
packages/cli/src/runtime/provider-alias-defaults.test.ts:1089:        stubSettingsService.getProviderSettings('openrouter')['requires-auth'],
packages/cli/src/runtime/provider-alias-defaults.test.ts:1108:      const settings = stubSettingsService.getProviderSettings('openrouter');
packages/cli/src/runtime/provider-alias-defaults.test.ts:1129:        stubSettingsService.getProviderSettings('openrouter')[
packages/cli/src/runtime/provider-alias-defaults.test.ts:1149:        stubSettingsService.getProviderSettings('openrouter')['requires-auth'],
packages/providers/src/anthropic/AnthropicProvider.issue1150-repro.test.ts:17:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue1150-repro.test.ts:49:  let settingsService: SettingsService;
packages/cli/src/runtime/providerMutations.issue1943.test.ts:5: * SettingsService AND Config ephemeral settings, so the tool-format value
packages/cli/src/runtime/providerMutations.issue1943.test.ts:20:const mockSettingsService = {
packages/cli/src/runtime/providerMutations.issue1943.test.ts:33:    settingsService: mockSettingsService,
packages/cli/src/runtime/providerMutations.issue1943.test.ts:47:    mockSettingsService.getProviderSettings.mockReturnValue({});
packages/cli/src/runtime/providerMutations.issue1943.test.ts:53:    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
packages/cli/src/runtime/providerMutations.issue1943.test.ts:65:    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
packages/cli/src/runtime/providerMutations.issue1943.test.ts:77:    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
packages/cli/src/runtime/providerMutations.issue1943.test.ts:89:    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
packages/cli/src/runtime/providerMutations.issue1943.test.ts:102:    expect(mockSettingsService.updateSettings).toHaveBeenCalledTimes(1);
packages/cli/src/runtime/profileSnapshot.ts:36:type CliSettingsService = ReturnType<
packages/cli/src/runtime/profileSnapshot.ts:42:  settingsService: CliSettingsService,
packages/cli/src/runtime/profileSnapshot.ts:268:  settingsService: CliSettingsService,
packages/cli/src/runtime/runtimeLifecycle.ts:28:  type SettingsService,
packages/cli/src/runtime/runtimeLifecycle.ts:145:  settingsService: SettingsService,
packages/providers/src/anthropic/AnthropicProvider.issue1150.toolresult.test.ts:48:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue1150.toolresult.test.ts:84:  let settingsService: SettingsService;
packages/cli/src/runtime/providerMutations.ts:403: * SettingsService in sync.
packages/cli/src/runtime/providerMutations.ts:438:        `[cli-runtime] Failed to persist model change via SettingsService: ${error}`,
packages/providers/src/openai/__tests__/OpenAIProvider.e2e.test.ts:17:import { resetSettingsService } from '@vybestack/llxprt-code-core/settings/settingsServiceInstance.js';
packages/providers/src/openai/__tests__/OpenAIProvider.e2e.test.ts:18:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/__tests__/OpenAIProvider.e2e.test.ts:37:  let settingsService: SettingsService;
packages/providers/src/openai/__tests__/OpenAIProvider.e2e.test.ts:43:    resetSettingsService();
packages/providers/src/openai/__tests__/OpenAIProvider.e2e.test.ts:58:    provider.setRuntimeSettingsService?.(settingsService);
packages/providers/src/LoggingProviderWrapper.ts:46:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/LoggingProviderWrapper.ts:1660:  setRuntimeSettingsService?(settingsService: SettingsService): void {
packages/providers/src/LoggingProviderWrapper.ts:1667:      setRuntimeSettingsService?: (settings: SettingsService) => void;
packages/providers/src/LoggingProviderWrapper.ts:1669:    runtimeAware.setRuntimeSettingsService?.(settingsService);
packages/cli/src/runtime/agentRuntimeAdapter.spec.ts:106:    getSettingsService: vi.fn(() => ({})),
packages/cli/src/runtime/__tests__/profileApplication.test.ts:555: * Apply auth to SettingsService BEFORE provider switch, so auth is available
packages/cli/src/runtime/__tests__/profileApplication.test.ts:561:  it('should apply auth-key to SettingsService BEFORE switching provider', async () => {
packages/cli/src/runtime/__tests__/profileApplication.test.ts:565:    // Track when auth-key is set in SettingsService
packages/cli/src/runtime/__tests__/profileApplication.test.ts:627:  it('should apply keyfile auth to SettingsService BEFORE switching provider', async () => {
packages/cli/src/runtime/__tests__/profileApplication.test.ts:640:    // Track when auth-key is set in SettingsService
packages/cli/src/runtime/__tests__/profileApplication.test.ts:699:  it('should apply base-url to SettingsService BEFORE switching provider', async () => {
packages/cli/src/runtime/__tests__/profileApplication.test.ts:754:  it('should verify SettingsService has auth available when switchActiveProvider is called', async () => {
packages/cli/src/runtime/__tests__/profileApplication.test.ts:761:        // It calls getModels() which checks for auth via SettingsService
packages/cli/src/runtime/runtimeAccessors.spec.ts:22:  SettingsService,
packages/cli/src/runtime/runtimeAccessors.spec.ts:57:  let mockSettingsService: SettingsService;
packages/cli/src/runtime/runtimeAccessors.spec.ts:79:    mockSettingsService = {
packages/cli/src/runtime/runtimeAccessors.spec.ts:87:    } as unknown as SettingsService;
packages/cli/src/runtime/runtimeAccessors.spec.ts:125:    setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
packages/cli/src/runtime/runtimeAccessors.spec.ts:202:      expect(mockSettingsService.setProviderSetting).toHaveBeenCalled();
packages/cli/src/runtime/runtimeAccessors.spec.ts:206:      expect(mockSettingsService.setProviderSetting).toHaveBeenCalledWith(
packages/providers/src/openai/__tests__/openai.localEndpoint.test.ts:11:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/__tests__/openai.localEndpoint.test.ts:110:  const svc = new SettingsService();
packages/providers/src/openai/__tests__/openai.localEndpoint.test.ts:141:      settingsService: new SettingsService(),
packages/cli/src/runtime/providerSwitch.spec.ts:25:  const mockSettingsService = {
packages/cli/src/runtime/providerSwitch.spec.ts:45:      settingsService: mockSettingsService,
packages/providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts:4:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts:37:    getSettingsService: () => mockSettingsService,
packages/providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts:46:    mockSettingsService.settings = { providers: { anthropic: {} } };
packages/providers/src/openai/__tests__/openai.stateless.test.ts:6:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/__tests__/openai.stateless.test.ts:93:  const svc = new SettingsService();
packages/providers/src/openai/__tests__/openai.stateless.test.ts:120:      settingsService: new SettingsService(),
packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts:377:  it('enforces explicit SettingsService when stateless hardening enabled @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', async () => {
packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts:387:      // This simulates missing SettingsService scenario
packages/cli/src/utils/terminalTheme.test.ts:10:  SettingsService,
packages/cli/src/utils/terminalTheme.test.ts:53:  let settingsService: SettingsService;
packages/cli/src/utils/terminalTheme.test.ts:59:    settingsService = new SettingsService();
packages/providers/src/openai/__tests__/openai.requiresAuth.test.ts:2:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/__tests__/openai.requiresAuth.test.ts:77:): SettingsService {
packages/providers/src/openai/__tests__/openai.requiresAuth.test.ts:78:  const svc = new SettingsService();
packages/providers/src/openai/__tests__/openai.requiresAuth.test.ts:108:      settingsService: new SettingsService(),
packages/cli/src/runtime/settingsResolver.ts:17:import type { Config, SettingsService } from '@vybestack/llxprt-code-core';
packages/cli/src/runtime/settingsResolver.ts:87:  settingsService: SettingsService,
packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:14:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:30:  const settingsService = new SettingsService();
packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:88:        settingsService: new SettingsService(),
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:17:  StubSettingsService: StubSettingsServiceClass,
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:21:  class StubSettingsService {
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:72:    private settingsService: InstanceType<typeof StubSettingsService>;
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:74:    constructor(settingsService: InstanceType<typeof StubSettingsService>) {
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:78:    getSettingsService(): unknown {
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:142:  return { StubSettingsService, StubConfig, StubProvider };
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:145:type StubSettingsServiceInstance = InstanceType<
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:146:  typeof StubSettingsServiceClass
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:151:const StubSettingsService = StubSettingsServiceClass;
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:175:let stubSettingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:183:    settingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:191:    SettingsService: StubSettingsServiceClass,
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:194:      settingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:211:      settingsService: StubSettingsServiceInstance;
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:252:    stubSettingsService = new StubSettingsService();
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:253:    stubConfig = new StubConfig(stubSettingsService);
packages/cli/src/runtime/anthropic-oauth-defaults.test.ts:258:    setCliRuntimeContext(stubSettingsService as never, stubConfig as never, {
packages/cli/src/runtime/__tests__/authKeyName.test.ts:30:  SecureStore,
packages/cli/src/runtime/__tests__/authKeyName.test.ts:68:  const secureStore = new SecureStore('llxprt-code-provider-keys', {
packages/providers/src/anthropic/AnthropicRequestPreparation.ts:591:  const mcpInstructions = config?.getMcpClientManager?.()?.getMcpInstructions();
packages/cli/src/runtime/profileApplication.ts:267:      () => `[profile] applied auth to SettingsService before switch (keyfile)`,
packages/cli/src/runtime/profileApplication.ts:280:        `[profile] applied auth to SettingsService before switch (direct key)`,
packages/cli/src/runtime/profileApplication.ts:289:      () => `[profile] applied base-url to SettingsService before switch`,
packages/providers/src/openai/OpenAIProvider.issue1943.test.ts:5: * toolFormat overrides from SettingsService before falling back to model-name
packages/providers/src/openai/OpenAIProvider.issue1943.test.ts:16:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIProvider.issue1943.test.ts:25:function createTestConfig(settingsService: SettingsService): Config {
packages/providers/src/openai/OpenAIProvider.issue1943.test.ts:28:    getSettingsService: () => settingsService,
packages/providers/src/openai/OpenAIProvider.issue1943.test.ts:78:  let settingsService: SettingsService;
packages/providers/src/openai/OpenAIProvider.issue1943.test.ts:82:    settingsService = new SettingsService();
packages/core/src/auth/keyring-token-store.ts:12: * Delegates credential CRUD to SecureStore (OS keychain with encrypted
packages/core/src/auth/keyring-token-store.ts:29:import { SecureStore, SecureStoreError } from '../storage/secure-store.js';
packages/core/src/auth/keyring-token-store.ts:36:// SecureStore.validateKey() handles path separators and null bytes separately.
packages/core/src/auth/keyring-token-store.ts:74:  private readonly secureStore: SecureStore;
packages/core/src/auth/keyring-token-store.ts:78:  constructor(options?: { secureStore?: SecureStore; lockDir?: string }) {
packages/core/src/auth/keyring-token-store.ts:81:      new SecureStore(SERVICE_NAME, {
packages/core/src/auth/keyring-token-store.ts:315:   * Validates and persists an OAuth token to SecureStore.
packages/core/src/auth/keyring-token-store.ts:334:   * Retrieves and validates an OAuth token from SecureStore.
packages/core/src/auth/keyring-token-store.ts:349:      if (error instanceof SecureStoreError && error.code === 'CORRUPT') {
packages/core/src/auth/keyring-token-store.ts:388:   * Removes a token from SecureStore. Best-effort — errors are swallowed.
packages/core/src/auth/keyring-token-store.ts:406:   * Lists all unique provider names from SecureStore keys.
packages/core/src/auth/token-store.spec.ts:16:import { SecureStore } from '../storage/secure-store.js';
packages/core/src/auth/token-store.spec.ts:69:    const secureStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:9:import type { OAuthManager, SettingsService } from '../index.js';
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:21:  let mockSettingsService: SettingsService;
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:30:    mockSettingsService = {
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:41:    } as unknown as SettingsService;
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:61:      mockSettingsService,
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:80:      settingsService: mockSettingsService,
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:93:      settingsService: mockSettingsService,
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:114:      settingsService: mockSettingsService,
packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts:130:      settingsService: mockSettingsService,
packages/providers/src/anthropic/AnthropicProvider.stateless.test.ts:7:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.stateless.test.ts:174:const createSettings = (runtimeId: string): SettingsService => {
packages/providers/src/anthropic/AnthropicProvider.stateless.test.ts:175:  const svc = new SettingsService();
packages/providers/src/anthropic/AnthropicProvider.stateless.test.ts:198:      settingsService: new SettingsService(),
packages/providers/src/anthropic/AnthropicProvider.stateless.test.ts:301:  it('gets model params from SettingsService without caching @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003', async () => {
packages/providers/src/anthropic/AnthropicProvider.stateless.test.ts:303:    // Should return params from SettingsService or undefined, but not throw
packages/core/src/auth/precedence.adapter.test.ts:5:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/auth/precedence.adapter.test.ts:6:import { SettingsService as SettingsServiceImpl } from '../settings/SettingsService.js';
packages/core/src/auth/precedence.adapter.test.ts:23:    settingsService?: SettingsService,
packages/core/src/auth/precedence.adapter.test.ts:74:  it('updates AuthPrecedenceResolver when runtime SettingsService overrides apply', async () => {
packages/core/src/auth/precedence.adapter.test.ts:75:    const baseService = new SettingsServiceImpl();
packages/core/src/auth/precedence.adapter.test.ts:91:    const overrideService = new SettingsServiceImpl();
packages/core/src/auth/precedence.adapter.test.ts:93:    provider.setRuntimeSettingsService(overrideService);
packages/cli/src/nonInteractiveCli.test.ts:112:      getSettingsService: vi
packages/core/src/auth/token-store.refresh-race.spec.ts:18:import { SecureStore } from '../storage/secure-store.js';
packages/core/src/auth/token-store.refresh-race.spec.ts:67:    const secureStore = new SecureStore('llxprt-code-oauth', {
packages/providers/src/anthropic/AnthropicProvider.ts:24:import { getSettingsService } from '@vybestack/llxprt-code-core/settings/settingsServiceInstance.js';
packages/providers/src/anthropic/AnthropicProvider.ts:389:   * Get current model parameters from SettingsService per call
packages/providers/src/anthropic/AnthropicProvider.ts:394:   * Gets model parameters from SettingsService per call (stateless)
packages/providers/src/anthropic/AnthropicProvider.ts:417:      const settingsService = getSettingsService();
packages/providers/src/anthropic/AnthropicProvider.ts:419:      // First check SettingsService for toolFormat override in provider settings
packages/providers/src/anthropic/AnthropicProvider.ts:452:        () => `Failed to detect tool format from SettingsService: ${error}`,
packages/providers/src/anthropic/AnthropicProvider.ts:455:      // Fallback detection without SettingsService
packages/providers/src/ProviderManager.gemini-switch.test.ts:16:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/ProviderManager.gemini-switch.test.ts:26:        settingsService: new SettingsService(),
packages/core/src/auth/__tests__/authRuntimeScope.test.ts:7:import { SettingsService } from '../../settings/SettingsService.js';
packages/core/src/auth/__tests__/authRuntimeScope.test.ts:38:      settingsService: new SettingsService(),
packages/core/src/auth/__tests__/authRuntimeScope.test.ts:80:      settingsService: new SettingsService(),
packages/core/src/auth/__tests__/authRuntimeScope.test.ts:111:      settingsService: new SettingsService(),
packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts:2:import { SettingsService } from '@vybestack/llxprt-code-core';
packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts:9:  let settingsService: SettingsService;
packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts:12:    settingsService = new SettingsService();
packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts:22:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts:28:   * Providers return model parameters from SettingsService without caching
packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts:31:    it('returns model parameters from SettingsService without caching', () => {
packages/providers/src/anthropic/AnthropicProvider.modelParams.test.ts:32:      // Test that it doesn't throw and returns params from SettingsService
packages/cli/src/runtime/runtimeRegistry.ts:19: * Runtime registry that scopes Config/SettingsService/RuntimeProviderManager instances per runtimeId.
packages/cli/src/runtime/runtimeRegistry.ts:25:  type SettingsService,
packages/cli/src/runtime/runtimeRegistry.ts:41:  settingsService: SettingsService | null;
packages/core/src/auth/__tests__/keyring-token-store.test.ts:27:  SecureStore,
packages/core/src/auth/__tests__/keyring-token-store.test.ts:28:  SecureStoreError,
packages/core/src/auth/__tests__/keyring-token-store.test.ts:44: * This is injected via SecureStoreOptions.keyringLoader — no mock theater.
packages/core/src/auth/__tests__/keyring-token-store.test.ts:99: * Creates a temp directory for use as SecureStore fallbackDir in tests.
packages/core/src/auth/__tests__/keyring-token-store.test.ts:106: * Creates a test-ready KeyringTokenStore with injected SecureStore.
packages/core/src/auth/__tests__/keyring-token-store.test.ts:107: * Returns the store, the underlying SecureStore (for direct data manipulation
packages/core/src/auth/__tests__/keyring-token-store.test.ts:112:  secureStore: SecureStore;
packages/core/src/auth/__tests__/keyring-token-store.test.ts:118:  const secureStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:199:  let secureStore: SecureStore;
packages/core/src/auth/__tests__/keyring-token-store.test.ts:239:   * @given A KeyringTokenStore with injected SecureStore
packages/core/src/auth/__tests__/keyring-token-store.test.ts:241:   * @then Data appears in the underlying SecureStore
packages/core/src/auth/__tests__/keyring-token-store.test.ts:243:  it('delegates storage to SecureStore: saved data retrievable via SecureStore.get', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:255:   * @given A pre-configured SecureStore injected via constructor options
packages/core/src/auth/__tests__/keyring-token-store.test.ts:259:  it('uses injected SecureStore: data visible in same SecureStore instance', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:273:   * @then Token stored under key 'anthropic:work' in SecureStore
packages/core/src/auth/__tests__/keyring-token-store.test.ts:275:  it('maps provider+bucket to SecureStore key format provider:bucket', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:356:   * @then Error thrown before any SecureStore write occurs
packages/core/src/auth/__tests__/keyring-token-store.test.ts:360:    // Pre-verify SecureStore is empty
packages/core/src/auth/__tests__/keyring-token-store.test.ts:433:   * @given SecureStore contains non-JSON data for 'corrupt-provider:default'
packages/core/src/auth/__tests__/keyring-token-store.test.ts:437:  it('returns null for corrupt JSON in SecureStore', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:446:   * @given SecureStore contains valid JSON that fails schema validation
packages/core/src/auth/__tests__/keyring-token-store.test.ts:462:   * @given SecureStore contains corrupt data for 'keep-corrupt:default'
packages/core/src/auth/__tests__/keyring-token-store.test.ts:464:   * @then Corrupt data is still present in SecureStore
packages/core/src/auth/__tests__/keyring-token-store.test.ts:466:  it('does NOT delete corrupt data from SecureStore', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:517:  it('removeToken deletes the token from SecureStore', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:574:   * @given SecureStore.list() would throw an error
packages/core/src/auth/__tests__/keyring-token-store.test.ts:578:  it('listProviders returns empty array on SecureStore error', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:583:      throw new SecureStoreError(
packages/core/src/auth/__tests__/keyring-token-store.test.ts:589:    const failStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:605:   * @given SecureStore errors on list
packages/core/src/auth/__tests__/keyring-token-store.test.ts:609:  it('listBuckets returns empty array on SecureStore error', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:613:      throw new SecureStoreError(
packages/core/src/auth/__tests__/keyring-token-store.test.ts:619:    const failStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:874:   * @given SecureStore throws SecureStoreError(UNAVAILABLE)
packages/core/src/auth/__tests__/keyring-token-store.test.ts:876:   * @then SecureStoreError(UNAVAILABLE) is thrown to caller
packages/core/src/auth/__tests__/keyring-token-store.test.ts:878:  it('saveToken propagates SecureStoreError(UNAVAILABLE)', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:882:      throw new SecureStoreError(
packages/core/src/auth/__tests__/keyring-token-store.test.ts:888:    const failStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:898:    ).rejects.toThrow(SecureStoreError);
packages/core/src/auth/__tests__/keyring-token-store.test.ts:905:   * @given SecureStore throws SecureStoreError(DENIED)
packages/core/src/auth/__tests__/keyring-token-store.test.ts:907:   * @then SecureStoreError(DENIED) is thrown to caller
packages/core/src/auth/__tests__/keyring-token-store.test.ts:909:  it('saveToken propagates SecureStoreError(DENIED)', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:913:      throw new SecureStoreError(
packages/core/src/auth/__tests__/keyring-token-store.test.ts:919:    const failStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:929:    ).rejects.toThrow(SecureStoreError);
packages/core/src/auth/__tests__/keyring-token-store.test.ts:942:  it('getToken returns null when SecureStore has no entry', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:950:   * @given secureStore.get() throws SecureStoreError(LOCKED)
packages/core/src/auth/__tests__/keyring-token-store.test.ts:952:   * @then SecureStoreError(LOCKED) is thrown
packages/core/src/auth/__tests__/keyring-token-store.test.ts:954:  it('getToken propagates SecureStoreError(LOCKED)', async () => {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:958:      throw new SecureStoreError(
packages/core/src/auth/__tests__/keyring-token-store.test.ts:964:    const failStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.test.ts:973:      SecureStoreError,
packages/core/src/auth/__tests__/keyring-token-store.test.ts:981:   * @given SecureStore returns data that fails JSON parse (CORRUPT scenario)
packages/core/src/auth/__tests__/keyring-token-store.test.ts:1526:   * @given Corrupt (non-JSON) data set directly in SecureStore for a generated provider
packages/core/src/auth/__tests__/keyring-token-store.test.ts:1552:   * @given Invalid-schema JSON set directly in SecureStore for a generated provider
packages/providers/src/openai/OpenAIProvider.deepseekReasoning.test.ts:17:import { resetSettingsService } from '@vybestack/llxprt-code-core/settings/settingsServiceInstance.js';
packages/providers/src/openai/OpenAIProvider.deepseekReasoning.test.ts:19:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIProvider.deepseekReasoning.test.ts:31:  let settingsService: SettingsService;
packages/providers/src/openai/OpenAIProvider.deepseekReasoning.test.ts:35:    resetSettingsService();
packages/providers/src/openai/OpenAIProvider.deepseekReasoning.test.ts:51:    provider.setRuntimeSettingsService(settingsService);
packages/cli/src/runtime/messages.ts:54:    'Run registerCliProviderInfrastructure() within the activation scope so Config, SettingsService, and ProviderManager are stored.',
packages/cli/src/runtime/messages.ts:91:    'Re-run profile bootstrap (e.g., llx profile apply <name>) to refresh the runtime Config + SettingsService pair.',
packages/cli/src/config/config.test.ts:94:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/config.test.ts:130:        settingsService: ServerConfig.SettingsService,
packages/cli/src/config/config.test.ts:165:        new ServerConfig.SettingsService(),
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:25:  SecureStore,
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:26:  SecureStoreError,
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:88: * Creates a shared SecureStore and two KeyringTokenStore instances that
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:94:  secureStore: SecureStore;
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:99:  const secureStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:112:  secureStore: SecureStore;
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:118:  const secureStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:150:  let secureStore: SecureStore;
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:381:   * @given SecureStore contains non-JSON corrupt data
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:394:   * @given SecureStore contains valid JSON that fails OAuthToken schema
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:410:   * @given A KeyringTokenStore backed by a SecureStore with a failing adapter
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:414:  it('removeToken with failing SecureStore returns normally', async () => {
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:420:    const failStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:437:   * @given A KeyringTokenStore backed by a SecureStore with a failing list
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:441:  it('listProviders with failing SecureStore returns []', async () => {
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:445:      throw new SecureStoreError(
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:451:    const failStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:469:   * @given Two KeyringTokenStore instances sharing the same SecureStore
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:493:   * @given Two KeyringTokenStore instances sharing the same SecureStore
packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts:517:   * @given Two KeyringTokenStore instances sharing the same SecureStore with a saved token
packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts:11:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts:43:      settings: new SettingsService(),
packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts:96:      settings: new SettingsService(),
packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts:157:      settings: new SettingsService(),
packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts:210:      settings: new SettingsService(),
packages/providers/src/anthropic/AnthropicProvider.dumpContext.test.ts:270:      settings: new SettingsService(),
packages/cli/src/providers/logging/git-stats.test.ts:15:  SettingsService,
packages/cli/src/providers/logging/git-stats.test.ts:29:    const settingsService = new SettingsService();
packages/cli/src/utils/apiErrorFormatting.test.ts:33:    getSettingsService: vi.fn(() => {
packages/cli/src/runtime/runtimeContextFactory.ts:26:  SettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:107:    settingsService: SettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:150: * Options for constructing an isolated CLI runtime with dedicated SettingsService/Config instances.
packages/cli/src/runtime/runtimeContextFactory.ts:155:  settingsService?: SettingsService;
packages/cli/src/runtime/runtimeContextFactory.ts:163:    settingsService: SettingsService;
packages/cli/src/runtime/runtimeContextFactory.ts:171:    settingsService: SettingsService;
packages/cli/src/runtime/runtimeContextFactory.ts:187:  settingsService: SettingsService;
packages/cli/src/runtime/runtimeContextFactory.ts:213:  settingsService: SettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:273:  resolvedSettingsService: SettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:306:        settingsService: resolvedSettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:317:        bindings.setRuntimeContext(resolvedSettingsService, config, {
packages/cli/src/runtime/runtimeContextFactory.ts:326:          settingsService: resolvedSettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:356:  resolvedSettingsService: SettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:385:          settingsService: resolvedSettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:427:    options.config?.getSettingsService() ??
packages/cli/src/runtime/runtimeContextFactory.ts:429:    new SettingsService();
packages/cli/src/runtime/runtimeContextFactory.ts:432:  const resolvedSettingsService = config.getSettingsService();
packages/cli/src/runtime/runtimeContextFactory.ts:443:    settingsService: resolvedSettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:456:    settingsService: resolvedSettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:464:    resolvedSettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:474:    resolvedSettingsService,
packages/cli/src/runtime/runtimeContextFactory.ts:483:    settingsService: resolvedSettingsService,
packages/cli/src/config/config.ts:13:  type SettingsService,
packages/cli/src/config/config.ts:79:  runtimeOverrides: { settingsService?: SettingsService },
packages/cli/src/config/config.ts:109:/** Steps 7-8: Resolve approval mode and provider/model, sync to SettingsService */
packages/cli/src/config/config.ts:251:  runtimeOverrides: { settingsService?: SettingsService } = {},
packages/core/src/auth/auth-precedence-resolver.ts:10:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/auth/auth-precedence-resolver.ts:43:  settingsService?: SettingsService | null;
packages/core/src/auth/auth-precedence-resolver.ts:48:  settingsService: SettingsService;
packages/core/src/auth/auth-precedence-resolver.ts:74:  private settingsService?: SettingsService;
packages/core/src/auth/auth-precedence-resolver.ts:79:    settingsService?: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:91:  setSettingsService(
packages/core/src/auth/auth-precedence-resolver.ts:92:    settingsService: SettingsService | null | undefined,
packages/core/src/auth/auth-precedence-resolver.ts:102:  private resolveSettingsService(
packages/core/src/auth/auth-precedence-resolver.ts:103:    override?: SettingsService | null,
packages/core/src/auth/auth-precedence-resolver.ts:104:  ): SettingsService {
packages/core/src/auth/auth-precedence-resolver.ts:109:      context as { settingsService?: SettingsService | null }
packages/core/src/auth/auth-precedence-resolver.ts:129:    const settingsService = this.resolveSettingsService(
packages/core/src/auth/auth-precedence-resolver.ts:145:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:158:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:172:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:191:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:237:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:251:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:269:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:466:    const settingsService = this.resolveSettingsService(
packages/core/src/auth/auth-precedence-resolver.ts:477:    settingsService: SettingsService,
packages/core/src/auth/auth-precedence-resolver.ts:564:    settingsService: SettingsService,
packages/core/src/storage/secure-store.ts:30:export type SecureStoreErrorCode =
packages/core/src/storage/secure-store.ts:38:export class SecureStoreError extends Error {
packages/core/src/storage/secure-store.ts:39:  readonly code: SecureStoreErrorCode;
packages/core/src/storage/secure-store.ts:44:    code: SecureStoreErrorCode,
packages/core/src/storage/secure-store.ts:48:    this.name = 'SecureStoreError';
packages/core/src/storage/secure-store.ts:71:export interface SecureStoreOptions {
packages/core/src/storage/secure-store.ts:87:function classifyError(error: unknown): SecureStoreErrorCode {
packages/core/src/storage/secure-store.ts:102:function getRemediation(code: SecureStoreErrorCode): string {
packages/core/src/storage/secure-store.ts:230:        `[SecureStore] Unexpected error loading @napi-rs/keyring: ${err?.message}`,
packages/core/src/storage/secure-store.ts:251:// ─── SecureStore Class ───────────────────────────────────────────────────────
packages/core/src/storage/secure-store.ts:259:export class SecureStore {
packages/core/src/storage/secure-store.ts:273:  constructor(serviceName: string, options?: SecureStoreOptions) {
packages/core/src/storage/secure-store.ts:310:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:317:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:324:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:336:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:478:        throw new SecureStoreError(msg, classified, getRemediation(classified));
packages/core/src/storage/secure-store.ts:484:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:545:          throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:670:          throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:763:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:772:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:782:      throw new SecureStoreError(
packages/core/src/storage/secure-store.ts:815:      throw new SecureStoreError(
packages/core/src/services/contextManager.test.ts:45:      getMcpClientManager: vi.fn().mockReturnValue({
packages/core/src/agents/executor.ts:492:      settingsService: this.runtimeContext.getSettingsService(),
packages/core/src/config/configTypes.ts:31:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/config/configTypes.ts:420:  settingsService?: SettingsService;
packages/providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts:14:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts:104:  let settingsService: SettingsService;
packages/core/src/auth/precedence.test.ts:14:  getSettingsService,
packages/core/src/auth/precedence.test.ts:15:  registerSettingsService,
packages/core/src/auth/precedence.test.ts:16:  resetSettingsService,
packages/core/src/auth/precedence.test.ts:18:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/auth/precedence.test.ts:70:    resetSettingsService();
packages/core/src/auth/precedence.test.ts:71:    registerSettingsService(new SettingsService());
packages/core/src/auth/precedence.test.ts:81:    it('should prioritize SettingsService auth-key over all other methods', async () => {
packages/core/src/auth/precedence.test.ts:83:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:101:      // Then: Should use SettingsService auth-key (highest priority)
packages/core/src/auth/precedence.test.ts:106:    it('should fall back to SettingsService auth-keyfile when no auth-key', async () => {
packages/core/src/auth/precedence.test.ts:107:      // Given: SettingsService keyfile and other methods available
packages/core/src/auth/precedence.test.ts:111:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:129:      // Then: Should use SettingsService auth-keyfile (second priority)
packages/core/src/auth/precedence.test.ts:139:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:165:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:188:    it('should fall back to environment variables when no SettingsService methods', async () => {
packages/core/src/auth/precedence.test.ts:261:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:286:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:336:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:373:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:480:      // Given: SettingsService auth-key available
packages/core/src/auth/precedence.test.ts:481:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:518:    it('should get correct auth method name for SettingsService auth-key', async () => {
packages/core/src/auth/precedence.test.ts:519:      // Given: SettingsService auth-key configured
packages/core/src/auth/precedence.test.ts:520:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:532:      // Then: Should return command-key (SettingsService auth-key represents command-level auth)
packages/core/src/auth/precedence.test.ts:553:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:570:      // Given: SettingsService keyfile that cannot be read
packages/core/src/auth/precedence.test.ts:573:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:591:      // Given: Empty SettingsService keyfile
packages/core/src/auth/precedence.test.ts:594:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:612:      // Given: SettingsService keyfile with valid content
packages/core/src/auth/precedence.test.ts:615:      const settingsService = getSettingsService();
packages/core/src/auth/precedence.test.ts:681:  describe('Injected SettingsService', () => {
packages/core/src/auth/precedence.test.ts:686:    const createStubSettingsService = (
packages/core/src/auth/precedence.test.ts:688:    ): SettingsService => {
packages/core/src/auth/precedence.test.ts:689:      const service = new SettingsService();
packages/core/src/auth/precedence.test.ts:694:        SettingsService.prototype.get.call(service, key),
packages/core/src/auth/precedence.test.ts:697:        SettingsService.prototype.set.call(service, key, value),
packages/core/src/auth/precedence.test.ts:716:    it('uses the SettingsService injected via constructor', async () => {
packages/core/src/auth/precedence.test.ts:717:      const injected = createStubSettingsService({
packages/core/src/auth/precedence.test.ts:732:      const runtimeService = createStubSettingsService({
packages/cli/src/runtime/runtimeAccessors.ts:29:  type SettingsService,
packages/cli/src/runtime/runtimeAccessors.ts:54:  settingsService: SettingsService;
packages/cli/src/runtime/runtimeAccessors.ts:101:          missingFields: ['SettingsService'],
packages/cli/src/runtime/runtimeAccessors.ts:102:          hint: 'Stateless hardening disables SettingsService fallbacks.',
packages/cli/src/runtime/runtimeAccessors.ts:109:      settingsService ?? entry.config.getSettingsService();
packages/cli/src/runtime/runtimeAccessors.ts:253:    missingFields.push('SettingsService');
packages/cli/src/runtime/runtimeAccessors.ts:304:  settingsService: SettingsService,
packages/cli/src/runtime/runtimeAccessors.ts:321:  settingsService: SettingsService,
packages/cli/src/providers/provider-gemini-switching.test.ts:12:  SettingsService,
packages/cli/src/providers/provider-gemini-switching.test.ts:17:  const settingsService = new SettingsService();
packages/providers/src/__tests__/LoadBalancingProvider.test.ts:22:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoadBalancingProvider.test.ts:33:  let settingsService: SettingsService;
packages/providers/src/__tests__/LoadBalancingProvider.test.ts:38:    settingsService = new SettingsService();
packages/providers/src/__tests__/LoadBalancingProvider.test.ts:1876:        const customSettings = new SettingsService();
packages/core/src/auth/invalidateProviderCache.test.ts:20:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/auth/invalidateProviderCache.test.ts:26:import { resetSettingsService } from '../settings/settingsServiceInstance.js';
packages/core/src/auth/invalidateProviderCache.test.ts:39:    resetSettingsService();
packages/core/src/auth/invalidateProviderCache.test.ts:54:      settingsService: new SettingsService(),
packages/core/src/auth/invalidateProviderCache.test.ts:111:      settingsService: new SettingsService(),
packages/core/src/auth/invalidateProviderCache.test.ts:173:      settingsService: new SettingsService(),
packages/core/src/auth/invalidateProviderCache.test.ts:265:      settingsService: new SettingsService(),
packages/core/src/storage/provider-key-storage.ts:8: * Named API key management backed by SecureStore.
packages/core/src/storage/provider-key-storage.ts:11: * trimming, and singleton access. All storage is delegated to SecureStore.
packages/core/src/storage/provider-key-storage.ts:19:import { SecureStore } from './secure-store.js';
packages/core/src/storage/provider-key-storage.ts:65:  private readonly secureStore: SecureStore;
packages/core/src/storage/provider-key-storage.ts:68:  constructor(options?: { secureStore?: SecureStore }) {
packages/core/src/storage/provider-key-storage.ts:71:      new SecureStore(SERVICE_NAME, {
packages/providers/src/anthropic/AnthropicProvider.thinking.test.ts:26:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.thinking.test.ts:66:  let settingsService: SettingsService;
packages/providers/src/__tests__/BaseProvider.guard.test.ts:8:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/BaseProvider.guard.test.ts:64:          setSettingsService: (settings: SettingsService | undefined) => void;
packages/providers/src/__tests__/BaseProvider.guard.test.ts:69:      setSettingsService: vi.fn(),
packages/providers/src/__tests__/BaseProvider.guard.test.ts:74:        defaultSettingsService?: SettingsService;
packages/providers/src/__tests__/BaseProvider.guard.test.ts:76:    ).defaultSettingsService = undefined;
packages/providers/src/__tests__/BaseProvider.guard.test.ts:103:          setSettingsService: (settings: SettingsService | undefined) => void;
packages/providers/src/__tests__/BaseProvider.guard.test.ts:108:      setSettingsService: vi.fn(),
packages/providers/src/__tests__/BaseProvider.guard.test.ts:111:    const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:17:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:191:  settings: SettingsService,
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:210:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:249:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:282:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:316:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:353:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:382:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:412:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:450:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:482:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:514:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:577:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:638:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:705:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:739:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:772:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:804:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:841:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:911:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:975:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1178:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1210:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1243:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1277:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1309:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1341:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1377:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1449:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1481:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1562:      const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts:1600:      const settings = new SettingsService();
packages/providers/src/anthropic/AnthropicProvider.issue276.test.ts:24:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/anthropic/AnthropicProvider.issue276.test.ts:123:  let settingsService: SettingsService;
packages/core/src/storage/secure-store.spec.ts:9:  SecureStore,
packages/core/src/storage/secure-store.spec.ts:10:  SecureStoreError,
packages/core/src/storage/secure-store.spec.ts:17:describe('SecureStore - Linux Keyring Fallback Reliability', () => {
packages/core/src/storage/secure-store.spec.ts:19:  let store: SecureStore;
packages/core/src/storage/secure-store.spec.ts:49:        store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:85:        store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:126:        store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:166:        store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:204:      store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:211:      expect(error).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.spec.ts:234:      store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:241:      expect(error).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.spec.ts:269:        store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:309:        store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:339:      store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:360:      store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.spec.ts:368:      expect(error).toBeInstanceOf(SecureStoreError);
packages/providers/src/__tests__/LoadBalancingProvider.failover.test.ts:17:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoadBalancingProvider.failover.test.ts:29:  let settingsService: SettingsService;
packages/providers/src/__tests__/LoadBalancingProvider.failover.test.ts:34:    settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:5:  registerSettingsService,
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:6:  resetSettingsService,
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:8:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:27:  settingsService: SettingsService,
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:32:    getSettingsService: vi.fn().mockReturnValue(settingsService),
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:51:  let settingsService: SettingsService;
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:56:    resetSettingsService();
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:58:    settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts:59:    registerSettingsService(settingsService);
packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts:15:import { SettingsService } from '@vybestack/llxprt-code-core';
packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts:27:  let mockSettingsService: SettingsService;
packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts:37:    mockSettingsService = new SettingsService();
packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts:180:      getSettingsService() {
packages/cli/src/providers/providerManagerInstance.oauthRegistration.test.ts:181:        return mockSettingsService;
packages/core/src/config/config.test.ts:32:import { getSettingsService } from '../settings/settingsServiceInstance.js';
packages/core/src/config/config.test.ts:33:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/config/config.test.ts:144:  const mockSettingsService = {
packages/core/src/config/config.test.ts:155:    getSettingsService: vi.fn(() => mockSettingsService),
packages/core/src/config/config.test.ts:156:    resetSettingsService: vi.fn(),
packages/core/src/config/config.test.ts:157:    registerSettingsService: vi.fn(),
packages/core/src/config/config.test.ts:223:  const sharedSettingsService =
packages/core/src/config/config.test.ts:224:    getSettingsService() as unknown as SettingsService;
packages/core/src/config/config.test.ts:237:    settingsService: sharedSettingsService,
packages/core/src/config/config.test.ts:910:  describe('Ephemeral Settings with SettingsService Integration', () => {
packages/core/src/config/config.test.ts:911:    let mockSettingsService: ReturnType<typeof vi.fn>;
packages/core/src/config/config.test.ts:914:      mockSettingsService = getSettingsService() as ReturnType<typeof vi.fn>;
packages/core/src/config/config.test.ts:921:     * @given SettingsService has 'model' = 'gpt-4'
packages/core/src/config/config.test.ts:923:     * @then Returns 'gpt-4' from SettingsService
packages/core/src/config/config.test.ts:926:    it('should delegate getEphemeralSetting to SettingsService', () => {
packages/core/src/config/config.test.ts:931:      mockSettingsService.get.mockReturnValue('gpt-4');
packages/core/src/config/config.test.ts:935:      expect(mockSettingsService.get).toHaveBeenCalledWith('model');
packages/core/src/config/config.test.ts:937:      expect(mockSettingsService.get).toHaveBeenCalledTimes(1);
packages/core/src/config/config.test.ts:943:     * @given SettingsService is available
packages/core/src/config/config.test.ts:945:     * @then SettingsService.set called with 'temperature', 0.8
packages/core/src/config/config.test.ts:948:    it('should delegate setEphemeralSetting to SettingsService', () => {
packages/core/src/config/config.test.ts:953:      expect(mockSettingsService.set).toHaveBeenCalledWith('temperature', 0.8);
packages/core/src/config/config.test.ts:954:      expect(mockSettingsService.set).toHaveBeenCalledTimes(1);
packages/core/src/config/config.test.ts:985:      mockSettingsService.get.mockReturnValue(true);
packages/core/src/config/config.test.ts:992:      expect(mockSettingsService.set).toHaveBeenCalledWith('instant', true);
packages/core/src/config/config.test.ts:993:      expect(mockSettingsService.get).toHaveBeenCalledWith('instant');
packages/core/src/config/config.test.ts:1008:      mockSettingsService.get
packages/core/src/config/config.test.ts:1026:      expect(mockSettingsService.set).toHaveBeenCalledTimes(3);
packages/core/src/config/config.test.ts:1027:      expect(mockSettingsService.get).toHaveBeenCalledTimes(3);
packages/core/src/config/config.test.ts:1033:     * @given SettingsService returns different types
packages/core/src/config/config.test.ts:1042:      mockSettingsService.get.mockImplementation((key: string) => {
packages/core/src/config/config.test.ts:1070:      expect(mockSettingsService.get).toHaveBeenCalledTimes(6);
packages/core/src/config/config.test.ts:1077:      mockSettingsService.get.mockImplementation((key: string) => {
packages/core/src/config/config.test.ts:1085:      expect(mockSettingsService.get).toHaveBeenCalledWith('context-limit');
packages/core/src/config/config.test.ts:1086:      expect(mockSettingsService.set).toHaveBeenCalledWith(
packages/core/src/config/config.test.ts:1097:     * @then All values properly delegated to SettingsService
packages/core/src/config/config.test.ts:1113:        expect(mockSettingsService.set).toHaveBeenCalledWith(key, value);
packages/core/src/config/config.test.ts:1116:      expect(mockSettingsService.set).toHaveBeenCalledTimes(6);
packages/core/src/config/config.test.ts:1125:      expect(mockSettingsService.set).toHaveBeenCalledWith(
packages/core/src/config/config.test.ts:1133:     * @scenario Return to SettingsService clear functionality
packages/core/src/config/config.test.ts:1136:     * @then SettingsService clear is called
packages/core/src/config/config.test.ts:1138:    it('should use SettingsService for clearing operations', () => {
packages/core/src/config/config.test.ts:1140:      const settingsService = config.getSettingsService();
packages/core/src/config/config.test.ts:1145:      expect(mockSettingsService.clear).toHaveBeenCalledTimes(1);
packages/core/src/config/config.test.ts:1150:     * @scenario Config accesses SettingsService correctly
packages/core/src/config/config.test.ts:1152:     * @when getSettingsService is called
packages/core/src/config/config.test.ts:1155:    it('should provide access to SettingsService instance', () => {
packages/core/src/config/config.test.ts:1158:      const settingsService1 = config.getSettingsService();
packages/core/src/config/config.test.ts:1159:      const settingsService2 = config.getSettingsService();
packages/core/src/config/config.test.ts:1162:      expect(settingsService1).toBe(mockSettingsService);
packages/core/src/config/config.test.ts:1521:    const mockSettingsService = {
packages/core/src/config/config.test.ts:1526:    } as unknown as SettingsService;
packages/core/src/config/config.test.ts:1530:      settingsService: mockSettingsService,
packages/core/src/config/config.test.ts:1534:    expect(mockSettingsService.get).toHaveBeenCalledWith('jitContextEnabled');
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:6:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:11:  let settingsService: SettingsService;
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:14:    settingsService = new SettingsService();
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:28:      defaultSettingsService?: SettingsService;
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:30:    expect(internal.defaultSettingsService).toStrictEqual(settingsService);
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:33:  it('uses SettingsService global model override when present', () => {
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:37:        resolveSettingsService: () => SettingsService;
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:39:    ).resolveSettingsService();
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:58:        resolveSettingsService: () => SettingsService;
packages/providers/src/openai/OpenAIProvider.setModel.test.ts:60:    ).resolveSettingsService();
packages/core/src/storage/secure-store-integration.test.ts:8: * Forward-looking integration tests for SecureStore in wrapper-like usage patterns.
packages/core/src/storage/secure-store-integration.test.ts:10: * These tests verify SecureStore can serve as the backend for:
packages/core/src/storage/secure-store-integration.test.ts:15: * All tests should PASS against the fully-implemented SecureStore (Phase 06).
packages/core/src/storage/secure-store-integration.test.ts:26:  SecureStore,
packages/core/src/storage/secure-store-integration.test.ts:27:  SecureStoreError,
packages/core/src/storage/secure-store-integration.test.ts:36: * This is injected via SecureStoreOptions.keyringLoader — no mock theater.
packages/core/src/storage/secure-store-integration.test.ts:76:describe('SecureStore — ToolKeyStorage Pattern', () => {
packages/core/src/storage/secure-store-integration.test.ts:91:   * SecureStore must round-trip them exactly.
packages/core/src/storage/secure-store-integration.test.ts:97:    const store = new SecureStore('llxprt-code-tool-keys', {
packages/core/src/storage/secure-store-integration.test.ts:114:    const store = new SecureStore('llxprt-code-tool-keys', {
packages/core/src/storage/secure-store-integration.test.ts:134:    const store = new SecureStore('llxprt-code-tool-keys', {
packages/core/src/storage/secure-store-integration.test.ts:155:    const toolStore = new SecureStore('llxprt-code-tool-keys', {
packages/core/src/storage/secure-store-integration.test.ts:159:    const otherStore = new SecureStore('other-service', {
packages/core/src/storage/secure-store-integration.test.ts:174:   * maskKeyForDisplay should work on values retrieved from SecureStore,
packages/core/src/storage/secure-store-integration.test.ts:181:    const store = new SecureStore('llxprt-code-tool-keys', {
packages/core/src/storage/secure-store-integration.test.ts:200:describe('SecureStore — KeychainTokenStorage Pattern', () => {
packages/core/src/storage/secure-store-integration.test.ts:215:   * SecureStore must handle JSON values as opaque strings.
packages/core/src/storage/secure-store-integration.test.ts:221:    const store = new SecureStore('llxprt-code-mcp-tokens', {
packages/core/src/storage/secure-store-integration.test.ts:247:   * SecureStore must handle special chars in key names.
packages/core/src/storage/secure-store-integration.test.ts:253:    const store = new SecureStore('llxprt-code-mcp-tokens', {
packages/core/src/storage/secure-store-integration.test.ts:268:   * SecureStore.list() provides equivalent functionality.
packages/core/src/storage/secure-store-integration.test.ts:274:    const store = new SecureStore('llxprt-code-mcp-tokens', {
packages/core/src/storage/secure-store-integration.test.ts:297:    const store = new SecureStore('llxprt-code-mcp-tokens', {
packages/core/src/storage/secure-store-integration.test.ts:313:describe('SecureStore — ExtensionSettingsStorage Pattern', () => {
packages/core/src/storage/secure-store-integration.test.ts:328:   * "LLxprt Code Extension {name}". SecureStore must work with these.
packages/core/src/storage/secure-store-integration.test.ts:335:    const store = new SecureStore(extensionServiceName, {
packages/core/src/storage/secure-store-integration.test.ts:353:    const store = new SecureStore('LLxprt Code Extension secure-ext', {
packages/core/src/storage/secure-store-integration.test.ts:366:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store-integration.test.ts:367:    expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
packages/core/src/storage/secure-store-integration.test.ts:368:    expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
packages/core/src/storage/secure-store-integration.test.ts:374:describe('SecureStore — Cross-Wrapper Isolation', () => {
packages/core/src/storage/secure-store-integration.test.ts:395:    const toolStore = new SecureStore('llxprt-code-tool-keys', {
packages/core/src/storage/secure-store-integration.test.ts:399:    const mcpStore = new SecureStore('llxprt-code-mcp-tokens', {
packages/core/src/storage/secure-store-integration.test.ts:403:    const extStore = new SecureStore('LLxprt Code Extension my-ext', {
packages/core/src/storage/secure-store-integration.test.ts:425:    const storeA = new SecureStore('service-a', {
packages/core/src/storage/secure-store-integration.test.ts:429:    const storeB = new SecureStore('service-b', {
packages/core/src/storage/secure-store-integration.test.ts:448:describe('SecureStore — Legacy Format Detection', () => {
packages/core/src/storage/secure-store-integration.test.ts:467:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store-integration.test.ts:486:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store-integration.test.ts:487:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store-integration.test.ts:488:    expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
packages/core/src/storage/secure-store-integration.test.ts:499:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store-integration.test.ts:519:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store-integration.test.ts:520:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store-integration.test.ts:521:    expect((err as SecureStoreError).remediation).toContain('upgrade');
packages/core/src/storage/secure-store-integration.test.ts:532:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store-integration.test.ts:551:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store-integration.test.ts:552:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store-integration.test.ts:553:    expect((err as SecureStoreError).remediation.toLowerCase()).toContain(
packages/core/src/storage/secure-store-integration.test.ts:566:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store-integration.test.ts:594:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store-integration.test.ts:595:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/providers/src/__tests__/LoadBalancingProvider.metrics.test.ts:18:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoadBalancingProvider.metrics.test.ts:43:      const settingsService = new SettingsService();
packages/core/src/config/config.scheduler.test.ts:17:import type { ISettingsService } from '../settings/types.js';
packages/core/src/config/config.scheduler.test.ts:37:    const mockSettingsService: ISettingsService = {
packages/core/src/config/config.scheduler.test.ts:74:      settingsService: mockSettingsService,
packages/providers/src/openai/OpenAIProvider.integration.test.ts:12:import { resetSettingsService } from '@vybestack/llxprt-code-core/settings/settingsServiceInstance.js';
packages/providers/src/openai/OpenAIProvider.integration.test.ts:13:import type { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIProvider.integration.test.ts:33:  let settingsService: SettingsService;
packages/providers/src/openai/OpenAIProvider.integration.test.ts:41:    resetSettingsService();
packages/providers/src/openai/OpenAIProvider.integration.test.ts:62:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/openai/OpenAIRequestPreparation.ts:108:  const mcpInstructions = config?.getMcpClientManager?.()?.getMcpInstructions();
packages/providers/src/__tests__/ProviderManager.settingsSeparation.test.ts:14:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/ProviderManager.settingsSeparation.test.ts:19:  let settingsService: SettingsService;
packages/providers/src/__tests__/ProviderManager.settingsSeparation.test.ts:23:    settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.settingsSeparation.test.ts:35:          settings: SettingsService,
packages/providers/src/__tests__/LoadBalancingProvider.timeout.test.ts:17:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoadBalancingProvider.timeout.test.ts:23:  let settingsService: SettingsService;
packages/providers/src/__tests__/LoadBalancingProvider.timeout.test.ts:46:    settingsService = new SettingsService();
packages/core/src/storage/secure-store.test.ts:10: * Behavioral tests for SecureStore.
packages/core/src/storage/secure-store.test.ts:23:  SecureStore,
packages/core/src/storage/secure-store.test.ts:24:  SecureStoreError,
packages/core/src/storage/secure-store.test.ts:32: * This is injected via SecureStoreOptions.keyringLoader — no mock theater.
packages/core/src/storage/secure-store.test.ts:70:describe('SecureStore — Keyring Access', () => {
packages/core/src/storage/secure-store.test.ts:87:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:103:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:118:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:133:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:147:describe('SecureStore — Availability Probe', () => {
packages/core/src/storage/secure-store.test.ts:164:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:178:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:206:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:242:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:272:describe('SecureStore — CRUD Operations', () => {
packages/core/src/storage/secure-store.test.ts:289:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:304:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:321:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:337:    const fallbackStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:345:    const readStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:360:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:377:    const fallbackStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:385:    const keyringStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:404:    const fallbackStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:412:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:427:    const fallbackRead = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:444:    const keyringStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:452:    const fallbackStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:471:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:487:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:500:  it('has() throws SecureStoreError on non-NOT_FOUND keyring errors', async () => {
packages/core/src/storage/secure-store.test.ts:512:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:524:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:525:    expect((err as SecureStoreError).code).toBe('LOCKED');
packages/core/src/storage/secure-store.test.ts:531:describe('SecureStore — Encrypted File Fallback', () => {
packages/core/src/storage/secure-store.test.ts:547:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:569:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:597:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:614:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:615:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:616:    expect((err as SecureStoreError).remediation).toContain('upgrade');
packages/core/src/storage/secure-store.test.ts:624:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:645:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:668:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:688:describe('SecureStore — No Backward Compatibility', () => {
packages/core/src/storage/secure-store.test.ts:704:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:722:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:723:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:731:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:747:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:748:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:749:    expect((err as SecureStoreError).remediation.toLowerCase()).toContain(
packages/core/src/storage/secure-store.test.ts:757:describe('SecureStore — Error Taxonomy', () => {
packages/core/src/storage/secure-store.test.ts:773:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:786:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:787:    expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
packages/core/src/storage/secure-store.test.ts:788:    expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
packages/core/src/storage/secure-store.test.ts:796:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:815:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:816:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:825:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:838:describe('SecureStore — Resilience', () => {
packages/core/src/storage/secure-store.test.ts:871:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:897:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:921:describe('SecureStore — Key Validation', () => {
packages/core/src/storage/secure-store.test.ts:937:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:950:    expect(err1).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:951:    expect((err1 as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:960:    expect(err2).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:961:    expect((err2 as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:969:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:982:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:983:    expect((err as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:991:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1004:    expect(err1).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:1005:    expect((err1 as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:1014:    expect(err2).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:1015:    expect((err2 as SecureStoreError).code).toBe('CORRUPT');
packages/core/src/storage/secure-store.test.ts:1023:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1046:describe('SecureStore — Probe Cache Invalidation', () => {
packages/core/src/storage/secure-store.test.ts:1075:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1124:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1192:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1226:describe('SecureStore — Fault Injection', () => {
packages/core/src/storage/secure-store.test.ts:1242:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1252:    // that would exist mid-write, then verify SecureStore's next write
packages/core/src/storage/secure-store.test.ts:1287:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1311:    const store1 = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1316:    const store2 = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1329:    const readStore = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1344:describe('SecureStore — Fallback Policy', () => {
packages/core/src/storage/secure-store.test.ts:1360:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1373:    expect(err).toBeInstanceOf(SecureStoreError);
packages/core/src/storage/secure-store.test.ts:1374:    expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
packages/core/src/storage/secure-store.test.ts:1375:    expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
packages/core/src/storage/secure-store.test.ts:1383:    const store = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1397:describe('SecureStore — Cross-Instance Consistency', () => {
packages/core/src/storage/secure-store.test.ts:1412:  it('different SecureStore instances with same config read each other fallback files', async () => {
packages/core/src/storage/secure-store.test.ts:1413:    const store1 = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1419:    const store2 = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1436:    const store1 = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1440:    const store2 = new SecureStore('test-service', {
packages/core/src/storage/secure-store.test.ts:1453:describe('SecureStore — Default Path Uses Platform Standards', () => {
packages/core/src/storage/secure-store.test.ts:1455:   * @given SecureStore created without explicit fallbackDir
packages/core/src/storage/secure-store.test.ts:1467:    const store = new SecureStore('test-service', {
packages/cli/src/providers/providerManagerInstance.ts:15:  type SettingsService,
packages/cli/src/providers/providerManagerInstance.ts:16:  getSettingsService,
packages/cli/src/providers/providerManagerInstance.ts:79:  settingsService: SettingsService;
packages/cli/src/providers/providerManagerInstance.ts:368:  const settingsServiceAuthOnly = tryGetSettingsServiceAuthOnly();
packages/cli/src/providers/providerManagerInstance.ts:377: * Attempts to get authOnly from SettingsService, returning undefined on failure.
packages/cli/src/providers/providerManagerInstance.ts:379:function tryGetSettingsServiceAuthOnly(): boolean | undefined {
packages/cli/src/providers/providerManagerInstance.ts:380:  if (typeof getSettingsService !== 'function') {
packages/cli/src/providers/providerManagerInstance.ts:384:    const settingsService = getSettingsService();
packages/cli/src/providers/providerManagerInstance.ts:392:    // Ignore SettingsService lookup failures and fall back to default
packages/providers/src/__tests__/LoadBalancingProvider.tpm.test.ts:18:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoadBalancingProvider.tpm.test.ts:72:      const settingsService = new SettingsService();
packages/providers/src/openai/OpenAIProvider.ts:315:        settingsService: this.resolveSettingsService(),
packages/providers/src/openai/OpenAIProvider.ts:334:          settingsService: this.resolveSettingsService(),
packages/providers/src/openai/OpenAIProvider.ts:437:      const settingsService = this.resolveSettingsService();
packages/providers/src/openai/OpenAIProvider.ts:471:          `Failed to get OpenAI provider settings from SettingsService: ${error}`,
packages/providers/src/openai/OpenAIProvider.ts:659:   * honoring explicit provider toolFormat overrides from SettingsService.
packages/providers/src/openai/OpenAIProvider.ts:663:    const settings = this.resolveSettingsService();
packages/providers/src/openai/OpenAIProvider.shouldRetry.test.ts:10:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/openai/OpenAIProvider.shouldRetry.test.ts:23:    getSettingsService: () => mockSettingsService,
packages/providers/src/openai/OpenAIProvider.shouldRetry.test.ts:32:    mockSettingsService.getSettings.mockResolvedValue({});
packages/core/src/config/profileManager.ts:11:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/config/profileManager.ts:260:   * Save current settings to a profile through SettingsService
packages/core/src/config/profileManager.ts:266:   * Persist profile data through the injected SettingsService instead of the
packages/core/src/config/profileManager.ts:272:    settingsService: SettingsService,
packages/core/src/config/profileManager.ts:274:    // Use SettingsService to export current settings
packages/core/src/config/profileManager.ts:277:      throw new Error('SettingsService does not support profile export');
packages/core/src/config/profileManager.ts:281:    // Convert SettingsService format to Profile format
packages/core/src/config/profileManager.ts:325:    // Update current profile name in SettingsService
packages/core/src/config/profileManager.ts:336:   * Load a profile and apply through SettingsService
packages/core/src/config/profileManager.ts:342:   * Apply profiles via the injected SettingsService rather than the singleton.
packages/core/src/config/profileManager.ts:384:    settingsService: SettingsService,
packages/core/src/config/profileManager.ts:399:    settingsService: SettingsService,
packages/core/src/config/profileManager.ts:425:    settingsService: SettingsService,
packages/core/src/config/profileManager.ts:436:      throw new Error('SettingsService does not support profile import');
packages/providers/src/__tests__/ProviderManager.guard.test.ts:3:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/ProviderManager.guard.test.ts:17:  constructor(config: Config, settingsService: SettingsService) {
packages/providers/src/__tests__/ProviderManager.guard.test.ts:42:  constructor(name: string, config: Config, settingsService: SettingsService) {
packages/providers/src/__tests__/ProviderManager.guard.test.ts:83:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:129:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:174:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:205:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:214:          settingsService: undefined as unknown as SettingsService,
packages/providers/src/__tests__/ProviderManager.guard.test.ts:228:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:251:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:282:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:319:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:350:    const foregroundSettings = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:351:    const subagentSettings = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:356:      getSettingsService: () => foregroundSettings,
packages/providers/src/__tests__/ProviderManager.guard.test.ts:390:    const foregroundSettings = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:391:    const subagentSettings = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:396:      getSettingsService: () => foregroundSettings,
packages/providers/src/__tests__/ProviderManager.guard.test.ts:428:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:460:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:492:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:523:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:563:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:602:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:638:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:674:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:706:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:738:    const settingsService = new SettingsService();
packages/providers/src/__tests__/ProviderManager.guard.test.ts:747:      constructor(cfg: Config, ss: SettingsService) {
packages/providers/src/__tests__/ProviderManager.guard.test.ts:802:    const settingsService = new SettingsService();
packages/core/src/storage/provider-key-storage.test.ts:21:import { SecureStore, type KeyringAdapter } from './secure-store.js';
packages/core/src/storage/provider-key-storage.test.ts:34: * Injected via SecureStoreOptions.keyringLoader — no mock theater.
packages/core/src/storage/provider-key-storage.test.ts:70: * Creates a ProviderKeyStorage backed by a real SecureStore with
packages/core/src/storage/provider-key-storage.test.ts:77:  const secureStore = new SecureStore('llxprt-code-provider-keys', {
packages/core/src/storage/provider-key-storage.test.ts:383:    const secureStore = new SecureStore('llxprt-code-provider-keys', {
packages/core/src/storage/provider-key-storage.test.ts:402:    // Create a SecureStore where keyring will fail after initial set
packages/core/src/storage/provider-key-storage.test.ts:423:    const secureStore = new SecureStore('llxprt-code-provider-keys', {
packages/core/src/config/config.ts:11:import { PromptRegistry } from '../prompts/prompt-registry.js';
packages/core/src/config/config.ts:97:import { McpClientManager } from '../tools/mcp-client-manager.js';
packages/core/src/config/config.ts:129:    this.promptRegistry = new PromptRegistry();
packages/core/src/config/config.ts:132:    this.mcpClientManager = new McpClientManager(
packages/core/src/config/config.ts:363:    // Delegate to SettingsService as source of truth
packages/core/src/config/config.ts:364:    const settingsService = this.getSettingsService();
packages/core/src/config/config.ts:389:    // Update SettingsService as source of truth
packages/core/src/config/config.ts:390:    const settingsService = this.getSettingsService();
packages/core/src/config/config.ts:425:   * Preserved from gmerge branch for compatibility with McpClientManager.
packages/core/src/config/config.ts:687:      const settingsService = this.getSettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.stateless.test.ts:9:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoggingProviderWrapper.stateless.test.ts:76:  settings: SettingsService,
packages/providers/src/__tests__/LoggingProviderWrapper.stateless.test.ts:94:    const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.stateless.test.ts:116:      settingsService: undefined as unknown as SettingsService,
packages/providers/src/__tests__/LoggingProviderWrapper.stateless.test.ts:137:    const settings = new SettingsService();
packages/providers/src/__tests__/LoggingProviderWrapper.stateless.test.ts:165:    const settings = new SettingsService();
packages/providers/src/__tests__/baseProvider.stateless.test.ts:12:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/baseProvider.stateless.test.ts:40:  settings: SettingsService;
packages/providers/src/__tests__/baseProvider.stateless.test.ts:69:const createSettingsService = (
packages/providers/src/__tests__/baseProvider.stateless.test.ts:71:): SettingsService => {
packages/providers/src/__tests__/baseProvider.stateless.test.ts:72:  const service = new SettingsService();
packages/providers/src/__tests__/baseProvider.stateless.test.ts:96:  const settings = createSettingsService({
packages/providers/src/__tests__/baseProvider.stateless.test.ts:138:  constructor(baseSettings: SettingsService) {
packages/providers/src/__tests__/baseProvider.stateless.test.ts:223:    createSettingsService({
packages/providers/src/__tests__/baseProvider.stateless.test.ts:368:    const settings = createSettingsService({
packages/providers/src/__tests__/baseProvider.stateless.test.ts:379:    const settings = createSettingsService({
packages/providers/src/openai/OpenAIProvider.caching.test.ts:5:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai/OpenAIProvider.caching.test.ts:23:let settingsServiceRef: { current: SettingsService } = {
packages/providers/src/openai/OpenAIProvider.caching.test.ts:24:  current: new SettingsService(),
packages/providers/src/openai/OpenAIProvider.caching.test.ts:43:    getSettingsService: () => settingsServiceRef.current,
packages/providers/src/openai/OpenAIProvider.caching.test.ts:50:    settingsServiceRef = { current: new SettingsService() };
packages/providers/src/openai/OpenAIProvider.caching.test.ts:107:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/openai/OpenAIProvider.caching.test.ts:171:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/openai/OpenAIProvider.caching.test.ts:247:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/openai/OpenAIProvider.caching.test.ts:324:    provider.setRuntimeSettingsService(settingsService);
packages/providers/src/__tests__/LoadBalancingProvider.circuitbreaker.test.ts:17:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/__tests__/LoadBalancingProvider.circuitbreaker.test.ts:23:  let settingsService: SettingsService;
packages/providers/src/__tests__/LoadBalancingProvider.circuitbreaker.test.ts:45:    settingsService = new SettingsService();
packages/core/src/config/configBaseCore.ts:20:import type { PromptRegistry } from '../prompts/prompt-registry.js';
packages/core/src/config/configBaseCore.ts:23:import type { McpClientManager } from '../tools/mcp-client-manager.js';
packages/core/src/config/configBaseCore.ts:50:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/config/configBaseCore.ts:79:  protected mcpClientManager?: McpClientManager;
packages/core/src/config/configBaseCore.ts:82:  protected promptRegistry!: PromptRegistry;
packages/core/src/config/configBaseCore.ts:86:  protected readonly settingsService!: SettingsService;
packages/core/src/config/configBaseCore.ts:374:  getPromptRegistry(): PromptRegistry {
packages/core/src/config/configBaseCore.ts:410:  getMcpClientManager(): McpClientManager | undefined {
packages/core/src/config/configBaseCore.ts:681:  getSettingsService(): SettingsService {
packages/core/src/config/profileManager.test.ts:9:import type { ISettingsService } from '../settings/types.js';
packages/core/src/config/profileManager.test.ts:11:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/config/profileManager.test.ts:25:// Mock SettingsService
packages/core/src/config/profileManager.test.ts:26:const createMockSettingsService = (): vi.Mocked<ISettingsService> => ({
packages/core/src/config/profileManager.test.ts:42:  let mockSettingsService: vi.Mocked<ISettingsService>;
packages/core/src/config/profileManager.test.ts:66:    mockSettingsService = createMockSettingsService();
packages/core/src/config/profileManager.test.ts:70:    // No feature flags needed - SettingsService is always used
packages/core/src/config/profileManager.test.ts:145:  describe('save method with SettingsService', () => {
packages/core/src/config/profileManager.test.ts:146:    it('should export from SettingsService and save profile', async () => {
packages/core/src/config/profileManager.test.ts:161:      mockSettingsService.exportForProfile.mockResolvedValue(settingsData);
packages/core/src/config/profileManager.test.ts:167:        mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:170:      expect(mockSettingsService.exportForProfile).toHaveBeenCalled();
packages/core/src/config/profileManager.test.ts:171:      expect(mockSettingsService.setCurrentProfileName).toHaveBeenCalledWith(
packages/core/src/config/profileManager.test.ts:177:    it('should work when SettingsService is always available', async () => {
packages/core/src/config/profileManager.test.ts:178:      mockSettingsService.exportForProfile.mockResolvedValue({
packages/core/src/config/profileManager.test.ts:197:          mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:205:      mockSettingsService.exportForProfile.mockResolvedValue({
packages/core/src/config/profileManager.test.ts:225:        mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:242:      mockSettingsService.exportForProfile.mockResolvedValue({
packages/core/src/config/profileManager.test.ts:259:        mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:271:  describe('load method with SettingsService', () => {
packages/core/src/config/profileManager.test.ts:275:      mockSettingsService.importFromProfile.mockResolvedValue();
packages/core/src/config/profileManager.test.ts:279:        mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:283:      expect(mockSettingsService.importFromProfile).toHaveBeenCalled();
packages/core/src/config/profileManager.test.ts:284:      expect(mockSettingsService.setCurrentProfileName).toHaveBeenCalledWith(
packages/core/src/config/profileManager.test.ts:289:    it('should pass provider and model from profile to SettingsService', async () => {
packages/core/src/config/profileManager.test.ts:293:      mockSettingsService.importFromProfile.mockImplementation((data) => {
packages/core/src/config/profileManager.test.ts:300:        mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:316:      mockSettingsService.importFromProfile.mockImplementation((data) => {
packages/core/src/config/profileManager.test.ts:323:        mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:335:    it('should pass toolFormat from profile to SettingsService', async () => {
packages/core/src/config/profileManager.test.ts:350:      mockSettingsService.importFromProfile.mockImplementation((data) => {
packages/core/src/config/profileManager.test.ts:357:        mockSettingsService as unknown as SettingsService,
packages/core/src/config/profileManager.test.ts:381:      mockSettingsService.importFromProfile.mockImplementation((data) => {
packages/core/src/config/profileManager.test.ts:388:        mockSettingsService as unknown as SettingsService,
packages/cli/src/config/__tests__/approvalModeParity.test.ts:101:  const { SettingsService: RealSettingsService } = await vi.importActual<
packages/cli/src/config/__tests__/approvalModeParity.test.ts:108:        settingsService: new RealSettingsService(),
packages/cli/src/config/__tests__/approvalModeParity.test.ts:128:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/__tests__/approvalModeParity.test.ts:159:        settingsService: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/approvalModeParity.test.ts:194:        new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/approvalModeParity.test.ts:282:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/approvalModeParity.test.ts:290:    { settingsService: runtimeSettingsService },
packages/core/src/settings/SettingsService.ts:11:  type ISettingsService,
packages/core/src/settings/SettingsService.ts:40:export class SettingsService extends EventEmitter implements ISettingsService {
packages/core/src/settings/settingsServiceInstance.ts:8: * Centralized SettingsService singleton instance
packages/core/src/settings/settingsServiceInstance.ts:11:import type { SettingsService } from './SettingsService.js';
packages/core/src/settings/settingsServiceInstance.ts:19:let settingsServiceInstance: SettingsService | null = null;
packages/core/src/settings/settingsServiceInstance.ts:22: * Get or create the global SettingsService singleton instance.
packages/core/src/settings/settingsServiceInstance.ts:25:export function getSettingsService(): SettingsService {
packages/core/src/settings/settingsServiceInstance.ts:33:    '[settings] No SettingsService registered in the active provider runtime context. Call activateIsolatedRuntimeContext() and registerSettingsService() before accessing settings (@plan:PLAN-20251023-STATELESS-HARDENING.P08, @requirement:REQ-SP4-004).',
packages/core/src/settings/settingsServiceInstance.ts:38: * Register an externally created SettingsService with the active runtime context.
packages/core/src/settings/settingsServiceInstance.ts:40:export function registerSettingsService(
packages/core/src/settings/settingsServiceInstance.ts:41:  settingsService: SettingsService,
packages/core/src/settings/settingsServiceInstance.ts:58:      metadata: { source: 'registerSettingsService' },
packages/core/src/settings/settingsServiceInstance.ts:66:export function resetSettingsService(): void {
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:97:  const { SettingsService: RealSettingsService } = await vi.importActual<
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:104:        settingsService: new RealSettingsService(),
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:130:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:170:      svc: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:195:      new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:238:        svc: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:273:        new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:357:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/e2eOrderingParity.test.ts:365:    { settingsService: runtimeSettingsService },
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:6: * SettingsService before falling back to model-name auto-detection.
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:15:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:25:function createTestConfig(settingsService: SettingsService): Config {
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:28:    getSettingsService: () => settingsService,
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:78:  let settingsService: SettingsService;
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:82:    settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:162:    const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:172:    const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:182:    const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:193:    const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:204:    const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts:216:    const settingsService = new SettingsService();
packages/core/src/integration-tests/settings-remediation.test.ts:10:  resetSettingsService,
packages/core/src/integration-tests/settings-remediation.test.ts:11:  registerSettingsService,
packages/core/src/integration-tests/settings-remediation.test.ts:13:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/integration-tests/settings-remediation.test.ts:34:  let settingsService: SettingsService;
packages/core/src/integration-tests/settings-remediation.test.ts:38:    resetSettingsService();
packages/core/src/integration-tests/settings-remediation.test.ts:40:    settingsService = new SettingsService();
packages/core/src/integration-tests/settings-remediation.test.ts:49:    registerSettingsService(settingsService);
packages/core/src/integration-tests/settings-remediation.test.ts:70:    resetSettingsService();
packages/core/src/integration-tests/settings-remediation.test.ts:74:  describe('Config to SettingsService Integration', () => {
packages/core/src/integration-tests/settings-remediation.test.ts:78:     * @given Fresh SettingsService instance
packages/core/src/integration-tests/settings-remediation.test.ts:80:     * @then SettingsService has value in memory
packages/core/src/integration-tests/settings-remediation.test.ts:84:    it('should update settings through Config to SettingsService synchronously', () => {
packages/core/src/integration-tests/settings-remediation.test.ts:93:     * @given Fresh SettingsService instance
packages/core/src/integration-tests/settings-remediation.test.ts:95:     * @then SettingsService provider settings are updated
packages/core/src/integration-tests/settings-remediation.test.ts:110:     * @given SettingsService supports nested keys
packages/core/src/integration-tests/settings-remediation.test.ts:128:     * @scenario Events propagate from SettingsService to listeners
packages/core/src/integration-tests/settings-remediation.test.ts:129:     * @given SettingsService with event listener
packages/core/src/integration-tests/settings-remediation.test.ts:134:    it('should propagate events from SettingsService to listeners', () => {
packages/core/src/integration-tests/settings-remediation.test.ts:170:     * @given SettingsService with provider change listener
packages/core/src/integration-tests/settings-remediation.test.ts:214:     * @given SettingsService with clear listener
packages/core/src/integration-tests/settings-remediation.test.ts:239:     * @given SettingsService with data
packages/core/src/integration-tests/settings-remediation.test.ts:254:      resetSettingsService();
packages/core/src/integration-tests/settings-remediation.test.ts:256:      const newSettingsService = new SettingsService();
packages/core/src/integration-tests/settings-remediation.test.ts:258:        settingsService: newSettingsService,
packages/core/src/integration-tests/settings-remediation.test.ts:263:      registerSettingsService(newSettingsService);
packages/core/src/integration-tests/settings-remediation.test.ts:275:        newSettingsService.getProviderSettings('test-provider').key,
packages/core/src/integration-tests/settings-remediation.test.ts:309:     * @given SettingsService instance
packages/core/src/integration-tests/settings-remediation.test.ts:363:     * @given SettingsService instance
packages/core/src/integration-tests/settings-remediation.test.ts:398:     * @given Config, SettingsService, and event listeners
packages/core/src/integration-tests/settings-remediation.test.ts:458:     * @given SettingsService with legacy methods
packages/core/src/integration-tests/settings-remediation.test.ts:483:     * @given SettingsService with data
packages/providers/src/openai-vercel/OpenAIVercelProvider.test.ts:27:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-vercel/OpenAIVercelProvider.test.ts:157:        const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.test.ts:205:        const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.test.ts:341:      const settingsService = new SettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.test.ts:437:  let settingsService: SettingsService;
packages/providers/src/openai-vercel/OpenAIVercelProvider.test.ts:579:      provider.setRuntimeSettingsService(settingsService);
packages/core/src/config/__tests__/config-terminal-background.test.ts:9:import { SettingsService } from '../../settings/SettingsService.js';
packages/core/src/config/__tests__/config-terminal-background.test.ts:15:    const settingsService = new SettingsService();
packages/core/src/integration-tests/profile-integration.test.ts:9:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/integration-tests/profile-integration.test.ts:11:import { getSettingsService } from '../settings/settingsServiceInstance.js';
packages/core/src/integration-tests/profile-integration.test.ts:25:const mockGetSettingsService = getSettingsService as vi.MockedFunction<
packages/core/src/integration-tests/profile-integration.test.ts:26:  typeof getSettingsService
packages/core/src/integration-tests/profile-integration.test.ts:57:class MockSettingsService {
packages/core/src/integration-tests/profile-integration.test.ts:135:  let settingsService: MockSettingsService;
packages/core/src/integration-tests/profile-integration.test.ts:165:    // SettingsService is always enabled in the new architecture
packages/core/src/integration-tests/profile-integration.test.ts:167:    // Create SettingsService with mock repository
packages/core/src/integration-tests/profile-integration.test.ts:169:    settingsService = new MockSettingsService(
packages/core/src/integration-tests/profile-integration.test.ts:171:    ) as unknown as MockSettingsService;
packages/core/src/integration-tests/profile-integration.test.ts:173:    // Mock the getSettingsService to return our mock
packages/core/src/integration-tests/profile-integration.test.ts:174:    mockGetSettingsService.mockReturnValue(
packages/core/src/integration-tests/profile-integration.test.ts:175:      settingsService as unknown as SettingsService,
packages/core/src/integration-tests/profile-integration.test.ts:190:  it('should save and load profile through SettingsService', async () => {
packages/core/src/integration-tests/profile-integration.test.ts:191:    // First set some settings in SettingsService
packages/core/src/integration-tests/profile-integration.test.ts:236:  it('should track profile changes in SettingsService', async () => {
packages/core/src/integration-tests/profile-integration.test.ts:255:  it('should work with SettingsService always enabled', async () => {
packages/core/src/integration-tests/profile-integration.test.ts:256:    // SettingsService is always available in the new architecture
packages/core/src/integration-tests/profile-integration.test.ts:288:    // Create profile manager - SettingsService is always available
packages/providers/src/openai-vercel/providerRegistry.test.ts:23:  resetSettingsService,
packages/providers/src/openai-vercel/providerRegistry.test.ts:24:  registerSettingsService,
packages/providers/src/openai-vercel/providerRegistry.test.ts:26:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-vercel/providerRegistry.test.ts:48:  let settingsService: SettingsService;
packages/providers/src/openai-vercel/providerRegistry.test.ts:52:    resetSettingsService();
packages/providers/src/openai-vercel/providerRegistry.test.ts:54:    settingsService = new SettingsService();
packages/providers/src/openai-vercel/providerRegistry.test.ts:55:    registerSettingsService(settingsService);
packages/core/src/settings/types.ts:118: * Comprehensive diagnostics information from SettingsService
packages/core/src/settings/types.ts:133:export interface ISettingsService {
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:91:  const { SettingsService: RealSettingsService } = await vi.importActual<
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:98:        settingsService: new RealSettingsService(),
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:162:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:174:      svc: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:198:      new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:241:        svc: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:273:        new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:369:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts:377:    { settingsService: runtimeSettingsService },
packages/core/src/auth/precedence.ts:18:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/auth/precedence.ts:116:  settingsService?: SettingsService;
packages/core/src/auth/precedence.ts:145:  settingsService: SettingsService,
packages/core/src/auth/precedence.ts:291:  settingsService: SettingsService,
packages/cli/src/providers/provider-switching.integration.test.ts:12:  SettingsService,
packages/cli/src/providers/provider-switching.integration.test.ts:16:  const settingsService = new SettingsService();
packages/core/src/integration-tests/geminiChat-isolation.integration.test.ts:40:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/integration-tests/geminiChat-isolation.integration.test.ts:54:    settingsService: new SettingsService(),
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:89:  const { SettingsService: RealSettingsService } = await vi.importActual<
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:96:        settingsService: new RealSettingsService(),
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:116:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:145:        svc: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:177:        new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:273:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:281:    { settingsService: runtimeSettingsService },
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:292:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/mcpFilteringParity.test.ts:300:    { settingsService: runtimeSettingsService },
packages/core/src/mcp/token-storage/keychain-token-storage.ts:10: * Delegates keytar adapter loading to SecureStore's shared
packages/cli/src/providers/providerManagerInstance.messagebus.test.ts:58:          settingsService: runtimeHandle.config.getSettingsService(),
packages/core/src/integration-tests/provider-settings-integration.spec.ts:6:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/integration-tests/provider-settings-integration.spec.ts:8:import { getSettingsService } from '../settings/settingsServiceInstance.js';
packages/core/src/integration-tests/provider-settings-integration.spec.ts:14:const mockGetSettingsService = getSettingsService as vi.MockedFunction<
packages/core/src/integration-tests/provider-settings-integration.spec.ts:15:  typeof getSettingsService
packages/core/src/integration-tests/provider-settings-integration.spec.ts:41:  let settingsService: SettingsService;
packages/core/src/integration-tests/provider-settings-integration.spec.ts:47:    settingsService = new SettingsService();
packages/core/src/integration-tests/provider-settings-integration.spec.ts:49:    // Mock getSettingsService to return our test instance
packages/core/src/integration-tests/provider-settings-integration.spec.ts:50:    mockGetSettingsService.mockReturnValue(settingsService);
packages/core/src/integration-tests/provider-settings-integration.spec.ts:76:  it('should integrate provider with SettingsService always enabled', async () => {
packages/core/src/integration-tests/provider-settings-integration.spec.ts:77:    // SettingsService is always enabled in new architecture
packages/core/src/integration-tests/provider-settings-integration.spec.ts:116:  it('should work with global SettingsService', async () => {
packages/core/src/integration-tests/provider-settings-integration.spec.ts:120:    // These should work with global SettingsService
packages/core/src/integration-tests/provider-settings-integration.spec.ts:135:  it('should use SettingsService for provider switching', async () => {
packages/core/src/integration-tests/provider-settings-integration.spec.ts:136:    // SettingsService is always enabled
packages/core/src/integration-tests/provider-settings-integration.spec.ts:137:    // Test provider switching through SettingsService with a known provider
packages/core/src/integration-tests/provider-settings-integration.spec.ts:149:  it('should maintain backward compatibility with SettingsService always enabled', async () => {
packages/core/src/integration-tests/provider-settings-integration.spec.ts:150:    // SettingsService is always enabled in the new architecture
packages/core/src/integration-tests/provider-settings-integration.spec.ts:151:    // Provider methods should work properly with SettingsService
packages/core/src/integration-tests/provider-settings-integration.spec.ts:154:    // These should work with SettingsService integration
packages/cli/src/config/__tests__/folderTrustOriginalSettingsParity.test.ts:92:  const { SettingsService: RealSettingsService } = await vi.importActual<
packages/cli/src/config/__tests__/folderTrustOriginalSettingsParity.test.ts:99:        settingsService: new RealSettingsService(),
packages/cli/src/config/__tests__/folderTrustOriginalSettingsParity.test.ts:122:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/__tests__/folderTrustOriginalSettingsParity.test.ts:153:        svc: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/folderTrustOriginalSettingsParity.test.ts:185:        new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/folderTrustOriginalSettingsParity.test.ts:268:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/folderTrustOriginalSettingsParity.test.ts:276:    { settingsService: runtimeSettingsService },
packages/providers/src/openai-vercel/OpenAIVercelProvider.reasoning.test.ts:89:        mockSettings as unknown as import('@vybestack/llxprt-code-core/settings/SettingsService.js').SettingsService,
packages/cli/src/providers/providerManagerInstance.test.ts:18:  SettingsService,
packages/cli/src/providers/providerManagerInstance.test.ts:162:    const settingsService = new SettingsService();
packages/cli/src/providers/providerManagerInstance.test.ts:163:    provider.setRuntimeSettingsService(settingsService);
packages/core/src/runtime/providerRuntimeContext.test.ts:13:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/runtime/providerRuntimeContext.test.ts:22:  getSettingsService,
packages/core/src/runtime/providerRuntimeContext.test.ts:23:  resetSettingsService,
packages/core/src/runtime/providerRuntimeContext.test.ts:29:    resetSettingsService();
packages/core/src/runtime/providerRuntimeContext.test.ts:41:    const injectedSettings = new SettingsService();
packages/core/src/runtime/providerRuntimeContext.test.ts:59:    expect(getSettingsService()).toBe(injectedSettings);
packages/core/src/runtime/providerRuntimeContext.test.ts:63:    const injectedSettings = new SettingsService();
packages/core/src/runtime/providerRuntimeContext.test.ts:72:    expect(getSettingsService()).toBe(injectedSettings);
packages/core/src/runtime/providerRuntimeContext.test.ts:74:    resetSettingsService();
packages/core/src/config/config.ephemeral.test.ts:10:  registerSettingsService,
packages/core/src/config/config.ephemeral.test.ts:11:  resetSettingsService,
packages/core/src/config/config.ephemeral.test.ts:13:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/config/config.ephemeral.test.ts:20:    // Reset SettingsService singleton to ensure clean state between tests
packages/core/src/config/config.ephemeral.test.ts:21:    resetSettingsService();
packages/core/src/config/config.ephemeral.test.ts:22:    registerSettingsService(new SettingsService());
packages/core/src/config/config.ephemeral.test.ts:157:      const settingsService = config.getSettingsService();
packages/cli/src/config/__tests__/toolGovernanceParity.test.ts:95:  const { SettingsService: RealSettingsService } = await vi.importActual<
packages/cli/src/config/__tests__/toolGovernanceParity.test.ts:102:        settingsService: new RealSettingsService(),
packages/cli/src/config/__tests__/toolGovernanceParity.test.ts:122:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/__tests__/toolGovernanceParity.test.ts:152:        svc: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/toolGovernanceParity.test.ts:184:        new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/toolGovernanceParity.test.ts:272:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/toolGovernanceParity.test.ts:280:    { settingsService: runtimeSettingsService },
packages/core/src/index.ts:267:  SecureStore,
packages/core/src/index.ts:268:  SecureStoreError,
packages/core/src/index.ts:271:  type SecureStoreErrorCode,
packages/core/src/index.ts:272:  type SecureStoreOptions,
packages/core/src/index.ts:322:export { SettingsService } from './settings/SettingsService.js';
packages/core/src/index.ts:324:  getSettingsService,
packages/core/src/index.ts:325:  resetSettingsService,
packages/core/src/index.ts:326:  registerSettingsService,
packages/core/src/index.ts:329:  ISettingsService,
packages/core/src/index.ts:438:export { McpClientManager } from './tools/mcp-client-manager.js';
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:506:    const settings = this.resolveSettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:699:      ?.getMcpClientManager?.()
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:1919:    const settings = this.resolveSettingsService();
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:1950:   * Gets model parameters from SettingsService per call (stateless).
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:1952:   * Now uses invocation.modelParams instead of filtering SettingsService
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:1955:    // Model params should come from invocation context, not SettingsService
packages/core/src/test-utils/__tests__/providerCallOptions.test.ts:8:import { SettingsService } from '../../settings/SettingsService.js';
packages/core/src/test-utils/__tests__/providerCallOptions.test.ts:13:    const settings = new SettingsService();
packages/providers/src/openai-vercel/errorHandling.test.ts:32:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-vercel/errorHandling.test.ts:66:  let settingsService: SettingsService;
packages/providers/src/openai-vercel/errorHandling.test.ts:71:    settingsService = new SettingsService();
packages/core/src/test-utils/providerCallOptions.ts:7:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/test-utils/providerCallOptions.ts:45:  settings?: SettingsService;
packages/core/src/test-utils/providerCallOptions.ts:58:  settings: SettingsService,
packages/core/src/test-utils/providerCallOptions.ts:80:  settings: SettingsService,
packages/core/src/test-utils/providerCallOptions.ts:105:  settings: SettingsService,
packages/core/src/test-utils/providerCallOptions.ts:127:    getSettingsService: () => settings,
packages/core/src/test-utils/providerCallOptions.ts:138:  settings: SettingsService,
packages/core/src/test-utils/providerCallOptions.ts:174:  settings: SettingsService,
packages/core/src/test-utils/providerCallOptions.ts:217:  settings: SettingsService;
packages/core/src/test-utils/providerCallOptions.ts:228:  const settings = init.settings ?? new SettingsService();
packages/core/src/test-utils/runtime.ts:16:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/test-utils/runtime.ts:19:  settingsService?: SettingsService;
packages/core/src/test-utils/runtime.ts:74:  settingsService: SettingsService;
packages/core/src/test-utils/runtime.ts:85:    settingsService: SettingsService;
packages/core/src/test-utils/runtime.ts:90:  const settingsService = options.settingsService ?? new SettingsService();
packages/core/src/test-utils/runtime.ts:114:  settingsService: SettingsService,
packages/core/src/test-utils/runtime.ts:134:    getSettingsService: () => settingsService,
packages/core/src/test-utils/runtime.ts:184:  settingsService: SettingsService;
packages/core/src/test-utils/runtime.ts:188:  const settingsService = new SettingsService();
packages/core/src/test-utils/runtime.ts:243:  getSettingsService: ReturnType<ReturnType<typeof requireVi>['fn']>;
packages/core/src/test-utils/runtime.ts:249:  settingsService?: SettingsService;
packages/core/src/test-utils/runtime.ts:259:  settingsService: SettingsService;
packages/core/src/test-utils/runtime.ts:281: * guaranteeing that runtime-aware helpers (e.g. getSettingsService) exist.
packages/core/src/test-utils/runtime.ts:287:  const settingsService = options.settingsService ?? new SettingsService();
packages/core/src/test-utils/runtime.ts:330:    getSettingsService: vi.fn().mockReturnValue(settingsService),
packages/providers/src/openai-vercel/nonStreaming.test.ts:29:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-vercel/nonStreaming.test.ts:48:  let settingsService: SettingsService;
packages/providers/src/openai-vercel/nonStreaming.test.ts:53:    settingsService = new SettingsService();
packages/core/src/config/configConstructor.ts:65:import { registerSettingsService } from '../settings/settingsServiceInstance.js';
packages/core/src/config/configConstructor.ts:66:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/config/configConstructor.ts:86:  settingsService: SettingsService;
packages/core/src/config/configConstructor.ts:211:function applySettingsService(
packages/core/src/config/configConstructor.ts:215:  const providedSettingsService = params.settingsService;
packages/core/src/config/configConstructor.ts:216:  if (providedSettingsService) {
packages/core/src/config/configConstructor.ts:217:    registerSettingsService(providedSettingsService);
packages/core/src/config/configConstructor.ts:221:  if (providedSettingsService) {
packages/core/src/config/configConstructor.ts:222:    config.settingsService = providedSettingsService;
packages/core/src/config/configConstructor.ts:226:    config.settingsService = new SettingsService();
packages/core/src/config/configConstructor.ts:453:  applySettingsService(config, params);
packages/cli/src/config/__tests__/profileBootstrap.test.ts:33:type MockSettingsService = {
packages/cli/src/config/__tests__/profileBootstrap.test.ts:45:  settingsService?: MockSettingsService;
packages/cli/src/config/__tests__/profileBootstrap.test.ts:877:  let mockSettingsService: {
packages/cli/src/config/__tests__/profileBootstrap.test.ts:890:    mockSettingsService = {
packages/cli/src/config/__tests__/profileBootstrap.test.ts:930:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:968:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1006:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1043:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1082:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1119:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1156:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1193:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1233:        settingsService: mockSettingsService,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1263:        settingsService: mockSettingsService,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1289:    mockSettingsService.getProfile.mockReturnValue(mockProfile);
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1304:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1316:    expect(mockSettingsService.getProfile).toHaveBeenCalledWith('test-profile');
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1341:      settingsService: mockSettingsService as any,
packages/cli/src/config/__tests__/profileBootstrap.test.ts:1362:  let mockSettings: MockSettingsService;
packages/providers/src/openai-vercel/OpenAIVercelProvider.shouldRetry.test.ts:10:const mockSettingsService = vi.hoisted(() => ({
packages/providers/src/openai-vercel/OpenAIVercelProvider.shouldRetry.test.ts:23:    getSettingsService: () => mockSettingsService,
packages/providers/src/openai-vercel/OpenAIVercelProvider.shouldRetry.test.ts:32:    mockSettingsService.getSettings.mockResolvedValue({});
packages/core/src/runtime/RuntimeInvocationContext.ts:17:import type { SettingsService } from '../settings/SettingsService.js';
packages/core/src/runtime/RuntimeInvocationContext.ts:42:  readonly settings: SettingsService;
packages/core/src/runtime/RuntimeInvocationContext.ts:75:  settings: SettingsService;
packages/core/src/mcp/oauth-token-storage.ts:45: * delegates to a KeychainTokenStorage that uses SecureStore internally
packages/cli/src/config/__tests__/providerModelPrecedenceParity.test.ts:95:  const { SettingsService: RealSettingsService } = await vi.importActual<
packages/cli/src/config/__tests__/providerModelPrecedenceParity.test.ts:102:        settingsService: new RealSettingsService(),
packages/cli/src/config/__tests__/providerModelPrecedenceParity.test.ts:122:    settingsService: ServerConfig.SettingsService;
packages/cli/src/config/__tests__/providerModelPrecedenceParity.test.ts:153:        settingsService: ServerConfig.SettingsService,
packages/cli/src/config/__tests__/providerModelPrecedenceParity.test.ts:188:        new ServerConfig.SettingsService(),
packages/cli/src/config/__tests__/providerModelPrecedenceParity.test.ts:274:  const runtimeSettingsService = new ServerConfig.SettingsService();
packages/cli/src/config/__tests__/providerModelPrecedenceParity.test.ts:282:    { settingsService: runtimeSettingsService },
packages/core/src/config/config-lsp-integration.test.ts:136:  McpClientManager: vi.fn().mockImplementation(() => ({
packages/core/src/config/config-lsp-integration.test.ts:168:  getSettingsService: vi.fn().mockReturnValue({
packages/core/src/config/config-lsp-integration.test.ts:176:  registerSettingsService: vi.fn(),
packages/providers/src/openai-vercel/streaming.test.ts:28:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-vercel/streaming.test.ts:45:  let settingsService: SettingsService;
packages/providers/src/openai-vercel/streaming.test.ts:50:    settingsService = new SettingsService();
packages/cli/src/auth/oauth-manager.refresh-race.spec.ts:20:  SecureStore,
packages/cli/src/auth/oauth-manager.refresh-race.spec.ts:68:    const secureStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/runtime/AgentRuntimeContext.stateless.test.ts:7:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/runtime/AgentRuntimeContext.stateless.test.ts:32:          settingsService: new SettingsService(),
packages/core/src/runtime/AgentRuntimeContext.stateless.test.ts:64:        settingsService: new SettingsService(),
packages/cli/src/config/postConfigRuntime.ts:12:  type SettingsService,
packages/cli/src/config/postConfigRuntime.ts:48:  readonly runtimeOverrides: { settingsService?: SettingsService };
packages/cli/src/config/postConfigRuntime.ts:79:function getSettingsService(
packages/cli/src/config/postConfigRuntime.ts:81:): SettingsService {
packages/cli/src/config/postConfigRuntime.ts:98:  const settingsService = getSettingsService(input);
packages/cli/src/config/postConfigRuntime.ts:220:  const settingsService = getSettingsService(input);
packages/cli/src/config/postConfigRuntime.ts:348:  const settingsService = getSettingsService(input);
packages/cli/src/config/postConfigRuntime.ts:351:      '[cli-runtime] loadCliConfig called without runtime SettingsService override; using bootstrap-scoped instance (temporary compatibility path).',
packages/providers/src/openai-vercel/OpenAIVercelProvider.caching.test.ts:23:import { SettingsService } from '@vybestack/llxprt-code-core/settings/SettingsService.js';
packages/providers/src/openai-vercel/OpenAIVercelProvider.caching.test.ts:38:  let settingsService: SettingsService;
packages/providers/src/openai-vercel/OpenAIVercelProvider.caching.test.ts:43:    settingsService = new SettingsService();
packages/core/src/runtime/contracts/RuntimeProviderChat.ts:21:import type { SettingsService } from '../../settings/SettingsService.js';
packages/core/src/runtime/contracts/RuntimeProviderChat.ts:52:  settings?: SettingsService;
packages/core/src/runtime/providerRuntimeContext.ts:21:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/runtime/providerRuntimeContext.ts:32:  settingsService: SettingsService;
packages/core/src/runtime/providerRuntimeContext.ts:47:  settingsService?: SettingsService;
packages/core/src/runtime/providerRuntimeContext.ts:63:    settingsService: init.settingsService ?? new SettingsService(),
packages/core/src/runtime/providerRuntimeContext.ts:98:      'MissingProviderRuntimeError(provider-runtime): active provider runtime context is missing SettingsService (REQ-SP4-004).',
packages/core/src/runtime/__tests__/RuntimeInvocationContext.separation.test.ts:20:import type { SettingsService } from '../../settings/SettingsService.js';
packages/core/src/runtime/__tests__/RuntimeInvocationContext.separation.test.ts:23:  function createMockSettings(): SettingsService {
packages/core/src/runtime/__tests__/RuntimeInvocationContext.separation.test.ts:29:    } as unknown as SettingsService;
packages/core/src/runtime/RuntimeInvocationContext.failfast.test.ts:10:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/runtime/RuntimeInvocationContext.failfast.test.ts:14:    const settings = new SettingsService();
packages/core/src/runtime/RuntimeInvocationContext.failfast.test.ts:29:    const settings = new SettingsService();
packages/core/src/core/ChatSessionFactory.ts:124:  const mcpInstructions = config.getMcpClientManager()?.getMcpInstructions();
packages/core/src/core/ChatSessionFactory.ts:252:    settingsService: config.getSettingsService(),
packages/core/src/core/turn.ts:365:            getSettingsService(): { get(key: string): unknown } | undefined;
packages/core/src/core/turn.ts:369:      const settingsService = config?.getSettingsService();
packages/core/src/lsp/__tests__/system-integration.test.ts:121:  McpClientManager: vi.fn().mockImplementation(() => ({
packages/core/src/lsp/__tests__/system-integration.test.ts:158:  getSettingsService: vi.fn().mockReturnValue({
packages/core/src/lsp/__tests__/system-integration.test.ts:171:  registerSettingsService: vi.fn(),
packages/core/src/core/geminiChat.thinking-toolcalls.test.ts:53:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/core/geminiChat.thinking-toolcalls.test.ts:70:  settingsService: SettingsService,
packages/core/src/core/geminiChat.thinking-toolcalls.test.ts:87:  let settingsService: SettingsService;
packages/core/src/core/geminiChat.thinking-toolcalls.test.ts:93:    settingsService = new SettingsService();
packages/core/src/lsp/__tests__/e2e-lsp.test.ts:122:  McpClientManager: vi.fn().mockImplementation(() => ({
packages/core/src/lsp/__tests__/e2e-lsp.test.ts:159:  getSettingsService: vi.fn().mockReturnValue({
packages/core/src/lsp/__tests__/e2e-lsp.test.ts:172:  registerSettingsService: vi.fn(),
packages/cli/src/config/extensions/settingsStorage.test.ts:18:// In-memory store used by the mock SecureStore instances
packages/cli/src/config/extensions/settingsStorage.test.ts:22:  SecureStore: vi.fn().mockImplementation(() => ({
packages/cli/src/config/extensions/settingsStorage.test.ts:140:    it('should save sensitive settings to SecureStore', async () => {
packages/cli/src/config/extensions/settingsStorage.test.ts:218:    it('should load sensitive settings from SecureStore', async () => {
packages/cli/src/config/extensions/settingsStorage.test.ts:259:      // API_KEY would come from SecureStore (mocked)
packages/cli/src/config/extensions/settingsStorage.test.ts:274:    it('should delete SecureStore entries', async () => {
packages/cli/src/config/extensions/settingsStorage.test.ts:295:    it('should return true if SecureStore has entries', async () => {
packages/core/src/runtime/AgentRuntimeLoader.test.ts:25:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/runtime/AgentRuntimeLoader.test.ts:37:  const settingsService = new SettingsService();
packages/core/src/runtime/AgentRuntimeLoader.test.ts:118:      settingsService: new SettingsService(),
packages/core/src/runtime/AgentRuntimeLoader.test.ts:319:      settingsService: new SettingsService(),
packages/core/src/runtime/AgentRuntimeLoader.test.ts:399:      settingsService: new SettingsService(),
packages/cli/src/nonInteractiveCli.slashCommandsAndThinking.test.ts:108:      getSettingsService: vi
packages/cli/src/config/extensions/settingsStorage.ts:11: * in the OS keychain via SecureStore. All keyring access is delegated
packages/cli/src/config/extensions/settingsStorage.ts:12: * to SecureStore, eliminating direct @napi-rs/keyring imports.
packages/cli/src/config/extensions/settingsStorage.ts:22:import { SecureStore, debugLogger } from '@vybestack/llxprt-code-core';
packages/cli/src/config/extensions/settingsStorage.ts:132: * via SecureStore (keychain + encrypted file fallback).
packages/cli/src/config/extensions/settingsStorage.ts:137:  private readonly store: SecureStore;
packages/cli/src/config/extensions/settingsStorage.ts:142:    this.store = new SecureStore(
packages/cli/src/config/extensions/settingsStorage.ts:148:   * Saves settings to appropriate storage (env file for non-sensitive, SecureStore for sensitive).
packages/cli/src/config/extensions/settingsStorage.ts:179:    // Write sensitive settings to SecureStore (delete removed ones)
packages/cli/src/config/extensions/settingsStorage.ts:238:    // Load sensitive settings from SecureStore
packages/cli/src/config/extensions/settingsStorage.ts:247:    // Populate sensitive values from SecureStore
packages/cli/src/config/extensions/settingsStorage.ts:278:    // Delete all SecureStore entries for this service
packages/cli/src/config/extensions/settingsStorage.ts:303:    // Check for SecureStore entries
packages/cli/src/config/profileBootstrap.ts:14:  SettingsService,
packages/cli/src/config/profileBootstrap.ts:43:  settingsService?: SettingsService;
packages/cli/src/config/profileBootstrap.ts:377:    providedService instanceof SettingsService
packages/cli/src/config/profileBootstrap.ts:379:      : new SettingsService();
packages/cli/src/config/config.loadMemory.test.ts:13:  resetSettingsService,
packages/cli/src/config/config.loadMemory.test.ts:15:  type SettingsService,
packages/cli/src/config/config.loadMemory.test.ts:32:        new (actual.SettingsService as new () => SettingsService)();
packages/cli/src/config/config.loadMemory.test.ts:55:        getSettingsService: vi.fn(() => settingsServiceInstance),
packages/cli/src/config/config.loadMemory.test.ts:81:const createMockSettingsService = () => {
packages/cli/src/config/config.loadMemory.test.ts:122:    settingsService: createMockSettingsService(),
packages/cli/src/config/config.loadMemory.test.ts:304:    resetSettingsService();
packages/core/src/core/subagentRuntimeSetup.ts:567:  const mcpInstructions = config.getMcpClientManager()?.getMcpInstructions();
packages/core/src/core/client.test.ts:436:      getMcpClientManager: vi.fn().mockReturnValue(undefined),
packages/core/src/core/client.test.ts:2924:        getMcpClientManager: () => unknown;
packages/core/src/core/client.test.ts:2929:      vi.spyOn(config, 'getMcpClientManager').mockReturnValue(undefined);
packages/core/src/core/client.test.ts:2970:        getMcpClientManager: () => unknown;
packages/core/src/core/client.test.ts:2975:      vi.spyOn(config, 'getMcpClientManager').mockReturnValue(undefined);
packages/cli/src/auth/oauth-manager.token-reuse.spec.ts:26:  resetSettingsService,
packages/cli/src/auth/oauth-manager.token-reuse.spec.ts:27:  registerSettingsService,
packages/cli/src/auth/oauth-manager.token-reuse.spec.ts:28:  SettingsService,
packages/cli/src/auth/oauth-manager.token-reuse.spec.ts:203:    // Register a real SettingsService instance for the test
packages/cli/src/auth/oauth-manager.token-reuse.spec.ts:204:    const mockSettingsService = new SettingsService();
packages/cli/src/auth/oauth-manager.token-reuse.spec.ts:205:    registerSettingsService(mockSettingsService);
packages/cli/src/auth/oauth-manager.token-reuse.spec.ts:212:      resetSettingsService();
packages/cli/src/auth/oauth-manager.issue1317.spec.ts:24:  resetSettingsService,
packages/cli/src/auth/oauth-manager.issue1317.spec.ts:25:  registerSettingsService,
packages/cli/src/auth/oauth-manager.issue1317.spec.ts:26:  SettingsService,
packages/cli/src/auth/oauth-manager.issue1317.spec.ts:220:    const mockSettingsService = new SettingsService();
packages/cli/src/auth/oauth-manager.issue1317.spec.ts:221:    registerSettingsService(mockSettingsService);
packages/cli/src/auth/oauth-manager.issue1317.spec.ts:228:      resetSettingsService();
packages/cli/src/auth/provider-usage-info.ts:21:  getSettingsService,
packages/cli/src/auth/provider-usage-info.ts:243:    const settingsService = getSettingsService();
packages/cli/src/auth/provider-usage-info.ts:249:    // SettingsService not registered (subagent/test context) — skip authOnly check
packages/core/src/core/ChatSessionFactory.test.ts:93:    getMcpClientManager: vi.fn().mockReturnValue(undefined),
packages/core/src/core/ChatSessionFactory.test.ts:96:    getSettingsService: vi.fn().mockReturnValue({}),
packages/core/src/core/ChatSessionFactory.test.ts:248:      getMcpClientManager: vi.fn().mockReturnValue({
packages/cli/src/auth/oauth-manager.spec.ts:13:  resetSettingsService,
packages/cli/src/auth/oauth-manager.spec.ts:14:  registerSettingsService,
packages/cli/src/auth/oauth-manager.spec.ts:15:  SettingsService,
packages/cli/src/auth/oauth-manager.spec.ts:821:    resetSettingsService();
packages/cli/src/auth/oauth-manager.spec.ts:826:    resetSettingsService();
packages/cli/src/auth/oauth-manager.spec.ts:833:    // Register SettingsService in runtime context before creating manager
packages/cli/src/auth/oauth-manager.spec.ts:834:    const settingsService = new SettingsService();
packages/cli/src/auth/oauth-manager.spec.ts:835:    registerSettingsService(settingsService);
packages/cli/src/auth/oauth-manager.spec.ts:848:    // Register SettingsService in runtime context before creating manager
packages/cli/src/auth/oauth-manager.spec.ts:849:    const settingsService = new SettingsService();
packages/cli/src/auth/oauth-manager.spec.ts:850:    registerSettingsService(settingsService);
packages/core/src/core/prompts.coreMemory.test.ts:40:const mockSettingsService = {
packages/core/src/core/prompts.coreMemory.test.ts:45:  getSettingsService: () => mockSettingsService,
packages/core/src/core/prompts.coreMemory.test.ts:70:    mockSettingsService.get.mockReturnValue(undefined);
packages/core/src/core/prompts.coreMemory.test.ts:183:      mockSettingsService.get.mockImplementation((key: string) => {
packages/core/src/core/subagent.test.ts:32:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/core/subagent.test.ts:123:  const settingsService = new SettingsService();
packages/core/src/core/subagent.test.ts:3030:          settingsService: config.getSettingsService(),
packages/core/src/core/subagent.test.ts:3061:      const settingsService = new SettingsService();
packages/core/src/core/subagent.test.ts:3156:      const settingsService = new SettingsService();
packages/core/src/core/subagent.test.ts:3262:      const settingsService = new SettingsService();
packages/core/src/utils/extensionLoader.test.ts:10:import { type McpClientManager } from '../tools/mcp-client-manager.js';
packages/core/src/utils/extensionLoader.test.ts:15:  let mockMcpClientManager: McpClientManager;
packages/core/src/utils/extensionLoader.test.ts:34:    mockMcpClientManager = {
packages/core/src/utils/extensionLoader.test.ts:37:    } as unknown as McpClientManager;
packages/core/src/utils/extensionLoader.test.ts:40:      getMcpClientManager: () => mockMcpClientManager,
packages/core/src/utils/extensionLoader.test.ts:60:    expect(mockMcpClientManager.startExtension).toHaveBeenCalledExactlyOnceWith(
packages/core/src/utils/extensionLoader.test.ts:68:    expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
packages/core/src/utils/extensionLoader.test.ts:75:      expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
packages/core/src/utils/extensionLoader.test.ts:77:      expect(mockMcpClientManager.stopExtension).not.toHaveBeenCalled();
packages/core/src/utils/extensionLoader.test.ts:83:      expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
packages/core/src/utils/extensionLoader.test.ts:86:        mockMcpClientManager.startExtension,
packages/core/src/utils/extensionLoader.test.ts:96:        expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
packages/core/src/utils/extensionLoader.test.ts:103:        expect(mockMcpClientManager.startExtension).toHaveBeenCalledTimes(
packages/core/src/utils/extensionLoader.test.ts:106:        expect(mockMcpClientManager.stopExtension).toHaveBeenCalledTimes(
packages/core/src/utils/extensionLoader.test.ts:110:        const actualStartCalls = mockMcpClientManager.startExtension.mock.calls;
packages/core/src/utils/extensionLoader.test.ts:111:        const actualStopCalls = mockMcpClientManager.stopExtension.mock.calls;
packages/core/src/utils/extensionLoader.test.ts:132:        getMcpClientManager: () => ({
packages/core/src/utils/extensionLoader.test.ts:170:        getMcpClientManager: () => ({
packages/core/src/core/subagentRuntimeSetup.test.ts:424:          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
packages/core/src/core/subagentRuntimeSetup.test.ts:455:          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
packages/core/src/core/subagentRuntimeSetup.test.ts:486:          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
packages/core/src/core/subagentRuntimeSetup.test.ts:517:          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
packages/core/src/core/geminiChat.issue1729.test.ts:7:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/core/geminiChat.issue1729.test.ts:23:    const settingsService = new SettingsService();
packages/core/src/tools/tool-registry.test.ts:148:    vi.spyOn(config, 'getPromptRegistry').mockReturnValue({
packages/core/src/tools/tool-registry.test.ts:662:        const mockSettingsService = {
packages/core/src/tools/tool-registry.test.ts:668:        vi.spyOn(config, 'getSettingsService').mockReturnValue(
packages/core/src/tools/tool-registry.test.ts:669:          mockSettingsService as unknown as ReturnType<
packages/core/src/tools/tool-registry.test.ts:670:            typeof config.getSettingsService
packages/core/src/tools/tool-registry.test.ts:706:        const mockSettingsService = {
packages/core/src/tools/tool-registry.test.ts:712:        vi.spyOn(config, 'getSettingsService').mockReturnValue(
packages/core/src/tools/tool-registry.test.ts:713:          mockSettingsService as unknown as ReturnType<
packages/core/src/tools/tool-registry.test.ts:714:            typeof config.getSettingsService
packages/core/src/tools/tool-registry.test.ts:742:        const mockSettingsService = {
packages/core/src/tools/tool-registry.test.ts:748:        vi.spyOn(config, 'getSettingsService').mockReturnValue(
packages/core/src/tools/tool-registry.test.ts:749:          mockSettingsService as unknown as ReturnType<
packages/core/src/tools/tool-registry.test.ts:750:            typeof config.getSettingsService
packages/core/src/tools/tool-registry.test.ts:778:        const mockSettingsService = {
packages/core/src/tools/tool-registry.test.ts:782:        vi.spyOn(config, 'getSettingsService').mockReturnValue(
packages/core/src/tools/tool-registry.test.ts:783:          mockSettingsService as unknown as ReturnType<
packages/core/src/tools/tool-registry.test.ts:784:            typeof config.getSettingsService
packages/core/src/tools/tool-registry.test.ts:814:        const mockSettingsService = {
packages/core/src/tools/tool-registry.test.ts:818:        vi.spyOn(config, 'getSettingsService').mockReturnValue(
packages/core/src/tools/tool-registry.test.ts:819:          mockSettingsService as unknown as ReturnType<
packages/core/src/tools/tool-registry.test.ts:820:            typeof config.getSettingsService
packages/core/src/core/compression/__tests__/high-density-settings.test.ts:36:import { SettingsService } from '../../../settings/SettingsService.js';
packages/core/src/core/compression/__tests__/high-density-settings.test.ts:63:  const settingsService = new SettingsService();
packages/core/src/core/subagentOrchestrator.ts:40:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/core/subagentOrchestrator.ts:401:    service: SettingsService,
packages/core/src/core/subagentOrchestrator.ts:426:    service: SettingsService,
packages/core/src/core/subagentOrchestrator.ts:469:    service: SettingsService,
packages/core/src/core/subagentOrchestrator.ts:489:    service: SettingsService,
packages/core/src/core/subagentOrchestrator.ts:516:    service: SettingsService,
packages/core/src/core/subagentOrchestrator.ts:553:  private populateSettingsService(
packages/core/src/core/subagentOrchestrator.ts:554:    service: SettingsService,
packages/core/src/core/subagentOrchestrator.ts:705:    const settingsService = new SettingsService();
packages/core/src/core/subagentOrchestrator.ts:706:    this.populateSettingsService(settingsService, profile, subagent.profile);
packages/core/src/tools/task.ts:1073:    const settingsService = this.config.getSettingsService?.();
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:16:  mockGetSettingsService,
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:17:  mockSettingsServiceRef,
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:24:    mockGetSettingsService: vi.fn(() => settingsServiceRef.current),
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:25:    mockSettingsServiceRef: settingsServiceRef,
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:47:    getSettingsService: mockGetSettingsService,
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:653:    mockSettingsServiceRef.current = { get: vi.fn(() => false) };
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:654:    mockGetSettingsService.mockReturnValue(mockSettingsServiceRef.current);
packages/cli/src/auth/__tests__/provider-usage-info.spec.ts:670:    mockSettingsServiceRef.current.get = vi.fn(() => true);
packages/core/src/core/subagentOrchestrator.test.ts:701:  it('forwards user-agent ephemeral setting to subagent SettingsService', async () => {
packages/core/src/core/clientLlmUtilities.ts:30:  const mcpInstructions = config.getMcpClientManager()?.getMcpInstructions();
packages/core/src/core/clientLlmUtilities.test.ts:46:    getMcpClientManager: vi.fn().mockReturnValue(undefined),
packages/core/src/core/geminiChat.runtime.test.ts:22:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/core/geminiChat.runtime.test.ts:42:  settingsService: SettingsService,
packages/core/src/core/geminiChat.runtime.test.ts:60:  let settingsService: SettingsService;
packages/core/src/core/geminiChat.runtime.test.ts:66:    settingsService = new SettingsService();
packages/core/src/core/geminiChat.runtime.test.ts:849:  let localSettingsService: SettingsService;
packages/core/src/core/geminiChat.runtime.test.ts:868:      localSettingsService = new SettingsService();
packages/core/src/core/geminiChat.runtime.test.ts:869:      localConfig = new Config(createConfigParams(localSettingsService));
packages/core/src/core/geminiChat.runtime.test.ts:877:        settingsService: localSettingsService,
packages/core/src/core/geminiChat.runtime.test.ts:925:      localSettingsService = new SettingsService();
packages/core/src/core/geminiChat.runtime.test.ts:926:      localConfig = new Config(createConfigParams(localSettingsService));
packages/core/src/core/geminiChat.runtime.test.ts:930:        settingsService: localSettingsService,
packages/core/src/core/geminiChat.runtime.test.ts:979:      localSettingsService = new SettingsService();
packages/core/src/core/geminiChat.runtime.test.ts:980:      localConfig = new Config(createConfigParams(localSettingsService));
packages/core/src/core/geminiChat.runtime.test.ts:996:      localSettingsService = new SettingsService();
packages/core/src/core/geminiChat.runtime.test.ts:997:      localConfig = new Config(createConfigParams(localSettingsService));
packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts:12:  SecureStore,
packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts:65:    const secureStore = new SecureStore('llxprt-code-oauth', {
packages/core/src/core/prompts.ts:15:import { getSettingsService } from '../settings/settingsServiceInstance.js';
packages/core/src/core/prompts.ts:243:    const settingsService = getSettingsService();
packages/core/src/core/prompts.ts:350:      const settingsService = getSettingsService();
packages/core/src/core/prompts.ts:368:      const settingsService = getSettingsService();
packages/core/src/core/prompts.ts:513:    const settingsService = getSettingsService();
packages/core/src/core/__tests__/geminiChat.runtimeState.test.ts:40:import { SettingsService } from '../../settings/SettingsService.js';
packages/core/src/core/__tests__/geminiChat.runtimeState.test.ts:89:    settingsService: config?.getSettingsService() ?? new SettingsService(),
packages/core/src/core/__tests__/subagent.stateless.test.ts:27:import { SettingsService } from '../../settings/SettingsService.js';
packages/core/src/core/__tests__/subagent.stateless.test.ts:60:  const settingsService = new SettingsService();
packages/core/src/core/__tests__/subagent.stateless.test.ts:820:      const settingsService = new SettingsService();
packages/core/src/utils/extensionLoader.ts:37:   * McpClientManager, PromptRegistry, and GeminiChat set up.
packages/core/src/utils/extensionLoader.ts:76:      await this.config.getMcpClientManager()!.startExtension(extension);
packages/core/src/utils/extensionLoader.ts:179:      await this.config.getMcpClientManager()!.stopExtension(extension);
packages/core/src/utils/shell-utils.shellReplacement.test.ts:13:import { SettingsService } from '../settings/SettingsService.js';
packages/core/src/utils/shell-utils.shellReplacement.test.ts:18:  let settingsService: SettingsService;
packages/core/src/utils/shell-utils.shellReplacement.test.ts:22:    settingsService = new SettingsService();
packages/core/src/utils/shell-utils.shellReplacement.test.ts:112:        settingsService: new SettingsService(),
packages/core/src/utils/shell-utils.shellReplacement.test.ts:134:        settingsService: new SettingsService(),
packages/core/src/utils/shell-utils.shellReplacement.test.ts:188:        settingsService: new SettingsService(),
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:10:interface RuntimeSettingsServiceBoundary {
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:17:  getSettingsService?: () => RuntimeSettingsServiceBoundary | null | undefined;
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:20:function getRuntimeSettingsService(
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:22:): RuntimeSettingsServiceBoundary | null {
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:23:  return (config as RuntimeConfigBoundary).getSettingsService?.() ?? null;
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:61:      const settingsService = getRuntimeSettingsService(config);
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:63:      // Try to get from SettingsService first (same as diagnostics does)
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:94:    // Also listen for any changes if SettingsService is available
packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts:95:    const settingsService = getRuntimeSettingsService(config);
packages/core/src/tools/tool-registry.ts:430:      this.config.getPromptRegistry().clear();
packages/core/src/tools/tool-registry.ts:596:    const settingsService = this.config.getSettingsService?.();
packages/core/src/tools/mcp-client-manager.ts:31:export class McpClientManager {
packages/core/src/tools/mcp-client-manager.ts:211:        this.cliConfig.getPromptRegistry(),
packages/cli/src/ui/commands/keyCommand.ts:27:  SecureStoreError,
packages/cli/src/ui/commands/keyCommand.ts:47:  if (error instanceof SecureStoreError) {
packages/core/src/tools/memoryTool.ts:30:import { getSettingsService } from '../settings/settingsServiceInstance.js';
packages/core/src/tools/memoryTool.ts:384:        const settingsService = getSettingsService();
packages/core/src/tools/codesearch.ts:224:      .getSettingsService()
packages/core/src/tools/mcp-client.test.ts:18:import type { PromptRegistry } from '../prompts/prompt-registry.js';
packages/core/src/tools/mcp-client.test.ts:123:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:195:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:238:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:282:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:333:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:398:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:473:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:557:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:631:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:671:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:730:      const mockedPromptRegistry = {
packages/core/src/tools/mcp-client.test.ts:734:      } as unknown as PromptRegistry;
packages/core/src/tools/mcp-client.test.ts:745:        mockedPromptRegistry,
packages/core/src/tools/mcp-client.test.ts:756:      expect(mockedPromptRegistry.registerPrompt).toHaveBeenCalledOnce();
packages/core/src/tools/mcp-client.test.ts:763:      expect(mockedPromptRegistry.removePromptsByServer).toHaveBeenCalledOnce();
packages/core/src/tools/mcp-client.test.ts:808:      const mockedPromptRegistry = {
packages/core/src/tools/mcp-client.test.ts:811:      } as unknown as PromptRegistry;
packages/core/src/tools/mcp-client.test.ts:822:        mockedPromptRegistry,
packages/core/src/tools/mcp-client.test.ts:844:      expect(mockedPromptRegistry.removePromptsByServer).toHaveBeenCalledWith(
packages/core/src/tools/mcp-client.test.ts:882:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:919:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:956:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:1015:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:1086:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:1157:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:1170:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:1254:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:1319:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:2259:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.test.ts:2294:        {} as PromptRegistry,
packages/core/src/tools/mcp-client.ts:50:import type { PromptRegistry } from '../prompts/prompt-registry.js';
packages/core/src/tools/mcp-client.ts:121:    private readonly promptRegistry: PromptRegistry,
packages/core/src/tools/mcp-client.ts:966:  promptRegistry: PromptRegistry,
packages/core/src/tools/mcp-client.ts:1063:  promptRegistry: PromptRegistry,
packages/core/src/tools/mcp-client.ts:1336:  promptRegistry: PromptRegistry,
packages/core/src/tools/tool-key-storage.ts:12: * Delegates keychain operations to SecureStore; retains encrypted-file
packages/core/src/tools/tool-key-storage.ts:24:  SecureStore,
packages/core/src/tools/tool-key-storage.ts:25:  SecureStoreError,
packages/core/src/tools/tool-key-storage.ts:143: * Delegates keychain operations to SecureStore (fallbackPolicy: 'deny').
packages/core/src/tools/tool-key-storage.ts:147: * Resolution order: keychain (via SecureStore) → encrypted file → keyfile → null
packages/core/src/tools/tool-key-storage.ts:155:  private readonly secureStore: SecureStore;
packages/core/src/tools/tool-key-storage.ts:161:    this.secureStore = new SecureStore(KEYCHAIN_SERVICE, {
packages/core/src/tools/tool-key-storage.ts:334:      if (error instanceof SecureStoreError && error.code === 'UNAVAILABLE') {
packages/core/src/tools/tool-key-storage.ts:348:      if (error instanceof SecureStoreError && error.code === 'UNAVAILABLE') {
packages/core/src/tools/tool-key-storage.ts:362:      if (error instanceof SecureStoreError && error.code === 'UNAVAILABLE') {
packages/core/src/tools/tool-key-storage.ts:379:    // Step 1: Try stored key (keychain via SecureStore or encrypted file)
packages/core/src/tools/memoryTool.test.ts:38:const mockSettingsService = {
packages/core/src/tools/memoryTool.test.ts:43:  getSettingsService: () => mockSettingsService,
packages/core/src/tools/memoryTool.test.ts:661:      mockSettingsService.get.mockReturnValue(undefined);
packages/core/src/tools/memoryTool.test.ts:671:      mockSettingsService.get.mockReturnValue(true);
packages/core/src/tools/memoryTool.test.ts:685:      mockSettingsService.get.mockReturnValue(true);
packages/cli/src/ui/commands/mcpCommand.test.ts:90:    getPromptRegistry: ReturnType<typeof vi.fn>;
packages/cli/src/ui/commands/mcpCommand.test.ts:114:      getPromptRegistry: vi.fn().mockReturnValue({
packages/cli/src/ui/commands/mcpCommand.test.ts:1145:      const mockMcpClientManager = {
packages/cli/src/ui/commands/mcpCommand.test.ts:1162:            getMcpClientManager: vi.fn().mockReturnValue(mockMcpClientManager),
packages/cli/src/ui/commands/mcpCommand.test.ts:1164:            getPromptRegistry: vi.fn().mockReturnValue({
packages/cli/src/ui/commands/mcpCommand.test.ts:1186:      expect(mockMcpClientManager.restartServer).toHaveBeenCalledWith(
packages/cli/src/ui/commands/mcpCommand.test.ts:1275:            getPromptRegistry: vi.fn().mockReturnValue({
packages/cli/src/ui/commands/mcpCommand.ts:48:  | 'getMcpClientManager'
packages/cli/src/ui/commands/mcpCommand.ts:53:  getMcpClientManager?: () =>
packages/cli/src/ui/commands/mcpCommand.ts:54:    | ReturnType<Config['getMcpClientManager']>
packages/cli/src/ui/commands/mcpCommand.ts:539:  const promptRegistry = config.getPromptRegistry();
packages/cli/src/ui/commands/mcpCommand.ts:699:    const mcpClientManager = runtimeConfig.getMcpClientManager?.();
packages/cli/src/ui/commands/keyCommand.subcommands.test.ts:10: * Uses real ProviderKeyStorage backed by SecureStore with an in-memory
packages/cli/src/ui/commands/keyCommand.subcommands.test.ts:26:  SecureStore,
packages/cli/src/ui/commands/keyCommand.subcommands.test.ts:67:  const secureStore = new SecureStore('llxprt-code-provider-keys', {
packages/cli/src/ui/commands/keyCommand.subcommands.test.ts:535:    // Create a storage that always fails — use saveKey to trigger SecureStoreError
packages/cli/src/ui/commands/keyCommand.subcommands.test.ts:551:    const failStore = new SecureStore('llxprt-code-provider-keys', {
packages/cli/src/ui/commands/keyCommand.subcommands.test.ts:558:    // save triggers set() which throws SecureStoreError(UNAVAILABLE)
packages/cli/src/ui/commands/keyCommand.subcommands.test.ts:642:    const failStore = new SecureStore('llxprt-code-provider-keys', {
packages/core/src/tools/task.test.ts:1589:        getSettingsService: () => ({
packages/core/src/tools/task.test.ts:1623:        getSettingsService: () => ({
packages/core/src/tools/task.test.ts:1674:        getSettingsService: () => ({
packages/core/src/tools/task.test.ts:1725:      // Config without getSettingsService and getEphemeralSettings
packages/core/src/tools/task.test.ts:1728:        // No getSettingsService or getEphemeralSettings
packages/cli/src/ui/commands/toolsCommand.ts:17:  SettingsService,
packages/cli/src/ui/commands/toolsCommand.ts:49:function getSettingsService(context: CommandContext): SettingsService | null {
packages/cli/src/ui/commands/toolsCommand.ts:51:  if (config && typeof config.getSettingsService === 'function') {
packages/cli/src/ui/commands/toolsCommand.ts:52:    return config.getSettingsService();
packages/cli/src/ui/commands/toolsCommand.ts:61:  const settings = getSettingsService(context);
packages/cli/src/ui/commands/toolsCommand.ts:100:  const settings = getSettingsService(context);
packages/cli/src/ui/commands/toolformatCommand.test.ts:78:  it('persists valid overrides through SettingsService', async () => {
packages/cli/src/ui/commands/toolformatCommand.test.ts:101:      getSettingsService: vi.fn().mockReturnValue(null),
packages/core/src/tools/codesearch.test.ts:20:  let mockSettingsService: { get: ReturnType<typeof vi.fn> };
packages/core/src/tools/codesearch.test.ts:23:    mockSettingsService = {
packages/core/src/tools/codesearch.test.ts:28:      getSettingsService: () => mockSettingsService,
packages/core/src/tools/codesearch.test.ts:106:    mockSettingsService.get.mockReturnValue(3000);
packages/core/src/tools/codesearch.test.ts:122:    mockSettingsService.get.mockReturnValue(2000);
packages/core/src/tools/codesearch.test.ts:138:    mockSettingsService.get.mockReturnValue(4000);
packages/core/src/tools/codesearch.test.ts:157:    mockSettingsService.get.mockReturnValue(100);
packages/core/src/tools/codesearch.test.ts:173:    mockSettingsService.get.mockReturnValue(60000);
packages/core/src/tools/codesearch.test.ts:188:    mockSettingsService.get.mockReturnValue(100);
packages/core/src/tools/codesearch.test.ts:204:    mockSettingsService.get.mockReturnValue(100000);
packages/core/src/tools/codesearch.test.ts:276:        getSettingsService: () => mockSettingsService,
packages/core/src/tools/mcp-client-manager.test.ts:8:import { McpClientManager } from './mcp-client-manager.js';
packages/core/src/tools/mcp-client-manager.test.ts:13:import type { PromptRegistry } from '../prompts/prompt-registry.js';
packages/core/src/tools/mcp-client-manager.test.ts:29:describe('McpClientManager', () => {
packages/core/src/tools/mcp-client-manager.test.ts:47:      getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:60:    const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:91:      getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:104:    const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:136:      getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:148:    const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:178:      getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:189:    const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:235:        getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:249:      const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:289:        getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:303:      const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:348:        getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:362:      const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:400:        getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:413:      const manager = new McpClientManager(
packages/core/src/tools/mcp-client-manager.test.ts:491:        getPromptRegistry: () => ({}) as PromptRegistry,
packages/core/src/tools/mcp-client-manager.test.ts:504:      const manager = new McpClientManager(
packages/cli/src/ui/commands/setCommand.ts:565:  // Note: SettingsService doesn't currently support ephemeral settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:12:import { SettingsService } from '@vybestack/llxprt-code-core';
packages/cli/src/ui/commands/toolsCommand.test.ts:35:          getSettingsService: vi.fn(),
packages/cli/src/ui/commands/toolsCommand.test.ts:55:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:62:          getSettingsService: () => settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:80:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:85:          getSettingsService: () => settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:102:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:109:          getSettingsService: () => settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:125:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:132:          getSettingsService: () => settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:149:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:154:          getSettingsService: () => settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:171:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:178:          getSettingsService: () => settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:194:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:202:          getSettingsService: () => settings,
packages/cli/src/ui/commands/toolsCommand.test.ts:223:    const settings = new SettingsService();
packages/cli/src/ui/commands/toolsCommand.test.ts:230:          getSettingsService: () => settings,
packages/cli/src/ui/hooks/useMcpStatus.ts:18:      config.getMcpClientManager()?.getDiscoveryState() ??
packages/cli/src/ui/hooks/useMcpStatus.ts:23:    () => config.getMcpClientManager()?.getMcpServerCount() ?? 0,
packages/cli/src/ui/hooks/useMcpStatus.ts:28:      const manager = config.getMcpClientManager();
packages/cli/src/ui/hooks/atCommandProcessor.test.ts:111:      getMcpClientManager: () => undefined,
packages/cli/src/ui/hooks/atCommandProcessor.test.ts:112:      getPromptRegistry: () => ({
packages/cli/src/ui/hooks/atCommandProcessor.test.ts:180:      getMcpClientManager: () => ({ getClient }),
packages/cli/src/ui/hooks/atCommandProcessorHelpers.ts:101:  mcpClientManager: ReturnType<Config['getMcpClientManager']>;
packages/cli/src/ui/hooks/atCommandProcessorHelpers.ts:529:  mcpClientManager: ReturnType<Config['getMcpClientManager']>,
packages/cli/src/ui/hooks/atCommandProcessorHelpers.ts:558:  mcpClientManager: ReturnType<Config['getMcpClientManager']>,
packages/cli/src/ui/hooks/slashCommandHandlers.ts:615:    deps.config?.getMcpClientManager()?.getDiscoveryState() ===
packages/cli/src/ui/hooks/atCommandProcessor.ts:195:    mcpClientManager: config.getMcpClientManager(),
packages/cli/src/ui/hooks/geminiStream/useSubmitQuery.ts:379:  const mcpManager = config.getMcpClientManager();
packages/cli/src/ui/hooks/geminiStream/streamUtils.ts:451:    const enabled = config.getSettingsService().get('ui.showCitations');
packages/cli/src/ui/hooks/geminiStream/streamUtils.ts:475:    return config.getSettingsService().getCurrentProfileName() ?? null;
packages/cli/src/ui/hooks/geminiStream/__tests__/useStreamEventHandlers.watchdog.test.ts:77:      getSettingsService: vi.fn(() => ({
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:516:      getSettingsService: vi.fn(() => ({
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:554:      getSettingsService: vi.fn(() => ({
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:685:    getSettingsService: vi.fn(() => null),
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:704:    const mockSettingsService = { get: vi.fn(() => true) };
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:706:      getSettingsService: vi.fn(() => mockSettingsService),
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:712:    const mockSettingsService = { get: vi.fn(() => false) };
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:714:      getSettingsService: vi.fn(() => mockSettingsService),
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:720:    const mockSettingsService = { get: vi.fn(() => undefined) };
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:722:      getSettingsService: vi.fn(() => mockSettingsService),
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:729:      getSettingsService: vi.fn(() => {
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:737:    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:742:    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:749:    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:755:    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:767:    const mockSettingsService = {
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:771:      getSettingsService: vi.fn(() => mockSettingsService),
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:777:    const mockSettingsService = { getCurrentProfileName: vi.fn(() => null) };
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:779:      getSettingsService: vi.fn(() => mockSettingsService),
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:785:    const config = makeConfig({ getSettingsService: vi.fn(() => null) });
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:789:  it('returns null when getSettingsService throws', () => {
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:791:      getSettingsService: vi.fn(() => {
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:799:    const mockSettingsService = {}; // No getCurrentProfileName
packages/cli/src/ui/hooks/geminiStream/__tests__/streamUtils.test.ts:801:      getSettingsService: vi.fn(() => mockSettingsService),
```

## Workspace baseline

### node -e workspaces

```text
packages/core
packages/providers
packages/cli
packages/a2a-server
packages/test-utils
packages/vscode-ide-companion
packages/lsp
```

## Providers package metadata pattern

### cat packages/providers/package.json

```json
{
  "name": "@vybestack/llxprt-code-providers",
  "version": "0.10.0",
  "description": "LLxprt Code Providers — LLM provider implementations and management",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/vybestack/llxprt-code.git"
  },
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./BaseProvider.js": "./dist/src/BaseProvider.js",
    "./IModel.js": "./dist/src/IModel.js",
    "./IProvider.js": "./dist/src/IProvider.js",
    "./IProviderManager.js": "./dist/src/IProviderManager.js",
    "./ITool.js": "./dist/src/ITool.js",
    "./LoggingProviderWrapper.js": "./dist/src/LoggingProviderWrapper.js",
    "./ProviderContentGenerator.js": "./dist/src/ProviderContentGenerator.js",
    "./ProviderManager.js": "./dist/src/ProviderManager.js",
    "./logging/ProviderPerformanceTracker.js": "./dist/src/logging/ProviderPerformanceTracker.js",
    "./providerConfigKeys.js": "./dist/src/providerConfigKeys.js",
    "./reasoning/reasoningUtils.js": "./dist/src/reasoning/reasoningUtils.js",
    "./tokenizers/AnthropicTokenizer.js": "./dist/src/tokenizers/AnthropicTokenizer.js",
    "./tokenizers/ITokenizer.js": "./dist/src/tokenizers/ITokenizer.js",
    "./tokenizers/OpenAITokenizer.js": "./dist/src/tokenizers/OpenAITokenizer.js",
    "./types.js": "./dist/src/types.js",
    "./types/IProviderConfig.js": "./dist/src/types/IProviderConfig.js",
    "./types/providerRuntime.js": "./dist/src/types/providerRuntime.js",
    "./utils/mediaUtils.js": "./dist/src/utils/mediaUtils.js"
  },
  "scripts": {
    "build": "node ../../scripts/build_package.js",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:ci": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "files": [
    "dist"
  ],
  "dependencies": {
    "@ai-sdk/openai": "^2.0.74",
    "@ai-sdk/provider-utils": "^2.0.6",
    "@anthropic-ai/sdk": "^0.55.1",
    "@dqbd/tiktoken": "^1.0.21",
    "@google/genai": "1.30.0",
    "@vybestack/llxprt-code-core": "file:../core",
    "ai": "^5.0.104",
    "openai": "^5.10.1",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^24.2.1",
    "@vybestack/llxprt-code-test-utils": "file:../test-utils",
    "typescript": "^5.3.3",
    "vitest": "^3.2.4"
  },
  "engines": {
    "node": ">=20"
  }
}

```

## Core package tool exports baseline

### node -e core exports tools filter

```text
./tools/doubleEscapeUtils.js
./tools/IToolFormatter.js
./tools/ToolFormatter.js
./tools/ToolIdStrategy.js
./tools/toolNameUtils.js
./tools/toolIdNormalization.js
```

## Core import graph

### rg -n core relative tools imports

```text
packages/core/src/policy/policy-helpers.test.ts:19:import type { AnyToolInvocation } from '../tools/tools.js';
packages/core/src/policy/policy-helpers.ts:9:import type { AnyToolInvocation } from '../tools/tools.js';
packages/core/src/policy/policy-helpers.ts:10:import { BaseToolInvocation } from '../tools/tools.js';
packages/core/src/policy/policy-updater.test.ts:15:import { ShellToolInvocation } from '../tools/shell.js';
packages/core/src/policy/policy-updater.test.ts:20:} from '../tools/tools.js';
packages/core/src/services/tool-call-tracker-service.ts:8:import { type TodoToolCall } from '../tools/todo-schemas.js';
packages/core/src/telemetry/metrics.ts:26:import { type DiffStat } from '../tools/tools.js';
packages/core/src/services/todo-reminder-service.ts:7:import { type Todo } from '../tools/todo-schemas.js';
packages/core/src/todo/todoFormatter.ts:7:import { type Todo, type TodoToolCall } from '../tools/todo-schemas.js';
packages/core/src/storage/SessionPersistenceService.ts:16:} from '../tools/tools.js';
packages/core/src/telemetry/tool-call-decision.test.ts:12:import { ToolConfirmationOutcome } from '../tools/tools.js';
packages/core/src/runtime/runtimeAdapters.ts:11:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/storage/secure-store-integration.test.ts:30:import { maskKeyForDisplay } from '../tools/tool-key-storage.js';
packages/core/src/telemetry/loggers.test.ts:81:import { DiscoveredMCPTool } from '../tools/mcp-tool.js';
packages/core/src/telemetry/loggers.test.ts:82:import type { CallableTool } from '../tools/tool.js';
packages/core/src/telemetry/types.ts:12:import { ToolConfirmationOutcome } from '../tools/tools.js';
packages/core/src/telemetry/types.ts:13:import { DiscoveredMCPTool } from '../tools/mcp-tool.js';
packages/core/src/lsp/__tests__/system-integration.test.ts:20:import { setLlxprtMdFilename as mockSetLlxprtMdFilename } from '../../tools/memoryTool.js';
packages/core/src/confirmation-bus/message-bus.test.ts:7:import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
packages/core/src/confirmation-bus/types.ts:5:} from '../tools/tool-confirmation-types.js';
packages/core/src/confirmation-bus/integration.test.ts:23:import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
packages/core/src/confirmation-bus/message-bus.ts:15:} from '../tools/tool-confirmation-types.js';
packages/core/src/hooks/notification-hook.test.ts:24:import type { ToolCallConfirmationDetails } from '../tools/tools.js';
packages/core/src/telemetry/tool-call-decision.ts:7:import { ToolConfirmationOutcome } from '../tools/tools.js';
packages/core/src/runtime/AgentRuntimeLoader.test.ts:27:import { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/telemetry/uiTelemetry.test.ts:22:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/telemetry/uiTelemetry.test.ts:23:import { ToolConfirmationOutcome } from '../tools/tools.js';
packages/core/src/runtime/AgentRuntimeLoader.ts:9:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/runtime/AgentRuntimeLoader.ts:31:import { normalizeToolName } from '../tools/toolNameUtils.js';
packages/core/src/runtime/contracts/toolIdNormalization-contract.test.ts:29:} from '../../tools/toolIdNormalization.js';
packages/core/src/agents/invocation.test.ts:17:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/agents/executor-validation.ts:7:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/agents/executor-validation.ts:8:import { GlobTool } from '../tools/glob.js';
packages/core/src/agents/executor-validation.ts:9:import { GrepTool } from '../tools/grep.js';
packages/core/src/agents/executor-validation.ts:10:import { RipGrepTool } from '../tools/ripGrep.js';
packages/core/src/agents/executor-validation.ts:11:import { LSTool } from '../tools/ls.js';
packages/core/src/agents/executor-validation.ts:12:import { MemoryTool } from '../tools/memoryTool.js';
packages/core/src/agents/executor-validation.ts:13:import { ReadFileTool } from '../tools/read-file.js';
packages/core/src/agents/executor-validation.ts:14:import { ReadManyFilesTool } from '../tools/read-many-files.js';
packages/core/src/agents/executor-validation.ts:15:import { GoogleWebSearchTool } from '../tools/google-web-search.js';
packages/core/src/utils/extensionLoader.test.ts:10:import { type McpClientManager } from '../tools/mcp-client-manager.js';
packages/core/src/utils/fileDiffUtils.ts:7:import type { FileDiff } from '../tools/tools.js';
packages/core/src/utils/memoryDiscovery.ts:16:} from '../tools/memoryTool.js';
packages/core/src/core/MessageStreamOrchestrator.ts:25:import type { Todo } from '../tools/todo-schemas.js';
packages/core/src/agents/types.ts:12:import type { AnyDeclarativeTool } from '../tools/tools.js';
packages/core/src/agents/executor.ts:29:import { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/agents/executor.test.ts:20:import { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/agents/executor.test.ts:21:import { LSTool } from '../tools/ls.js';
packages/core/src/agents/executor.test.ts:22:import { ReadFileTool } from '../tools/read-file.js';
packages/core/src/core/turn.ts:24:} from '../tools/tools.js';
packages/core/src/core/turn.ts:25:import type { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/core/turn.ts:38:import { normalizeToolName } from '../tools/toolNameUtils.js';
packages/core/src/scheduler/tool-executor.ts:19:import type { ToolResult } from '../tools/tools.js';
packages/core/src/agents/invocation.ts:9:import { BaseToolInvocation, type ToolResult } from '../tools/tools.js';
packages/core/src/agents/invocation.ts:10:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/scheduler/result-aggregator.ts:20:import type { ToolResult } from '../tools/tools.js';
packages/core/src/scheduler/result-aggregator.ts:21:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/utils/memoryDiscovery.subfunctions.test.ts:21:} from '../tools/memoryTool.js';
packages/core/src/utils/summarizer.ts:7:import { type ToolResult } from '../tools/tools.js';
packages/core/src/scheduler/types.ts:19:} from '../tools/tools.js';
packages/core/src/scheduler/types.ts:24:import type { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
packages/core/src/core/StreamProcessor.ts:56:import { hasCycleInSchema } from '../tools/tools.js';
packages/core/src/scheduler/confirmation-coordinator.ts:27:import { ToolConfirmationOutcome } from '../tools/tools.js';
packages/core/src/scheduler/confirmation-coordinator.ts:28:import type { ToolCallConfirmationDetails } from '../tools/tools.js';
packages/core/src/scheduler/confirmation-coordinator.ts:29:import type { ToolConfirmationPayload } from '../tools/tool-confirmation-types.js';
packages/core/src/scheduler/confirmation-coordinator.ts:42:} from '../tools/modifiable-tool.js';
packages/core/src/scheduler/tool-dispatcher.ts:15:import type { AnyDeclarativeTool, AnyToolInvocation } from '../tools/tools.js';
packages/core/src/scheduler/tool-dispatcher.ts:18:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/scheduler/tool-dispatcher.ts:22:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/scheduler/utils.ts:7:import type { AnyDeclarativeTool } from '../tools/tools.js';
packages/core/src/scheduler/utils.ts:8:import type { ContextAwareTool } from '../tools/tool-context.js';
packages/core/src/utils/fileDiffUtils.test.ts:12:import type { FileDiff, ToolResultDisplay } from '../tools/tools.js';
packages/core/src/scheduler/result-aggregator.test.ts:11:import type { ToolResult } from '../tools/tools.js';
packages/core/src/scheduler/result-aggregator.test.ts:12:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/scheduler/tool-dispatcher.test.ts:18:} from '../tools/tools.js';
packages/core/src/scheduler/tool-dispatcher.test.ts:22:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/scheduler/tool-dispatcher.test.ts:23:import type { ContextAwareTool } from '../tools/tool-context.js';
packages/core/src/scheduler/confirmation-coordinator.test.ts:16:import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
packages/core/src/scheduler/confirmation-coordinator.test.ts:17:import type { ToolCallConfirmationDetails } from '../tools/tools.js';
packages/core/src/utils/events.ts:8:import type { McpClient } from '../tools/mcp-client.js';
packages/core/src/utils/summarizer.test.ts:18:import type { ToolResult } from '../tools/tools.js';
packages/core/src/utils/tool-utils.test.ts:10:import { ReadFileTool } from '../tools/read-file.js';
packages/core/src/core/toolGovernance.ts:7:import { normalizeToolName, toSnakeCase } from '../tools/toolNameUtils.js';
packages/core/src/utils/ignorePatterns.ts:9:import { getCurrentLlxprtMdFilename } from '../tools/memoryTool.js';
packages/core/src/utils/fileUtils.ts:13:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/core/clientToolGovernance.ts:9:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/utils/memoryDiscovery.test.ts:16:} from '../tools/memoryTool.js';
packages/core/src/core/TodoContinuationService.ts:15:import { TodoStore } from '../tools/todo-store.js';
packages/core/src/core/TodoContinuationService.ts:16:import type { Todo } from '../tools/todo-schemas.js';
packages/core/src/core/subagentToolProcessing.test.ts:8:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/core/TurnProcessor.ts:54:import { hasCycleInSchema } from '../tools/tools.js';
packages/core/src/core/coreToolHookTriggers.ts:23:} from '../tools/tools.js';
packages/core/src/core/prompts.ts:21:} from '../tools/memoryTool.js';
packages/core/src/core/subagentOrchestrator.ts:41:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/core/subagentRuntimeSetup.ts:38:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/core/toolExecutorUnification.integration.test.ts:34:import type { ContextAwareTool, ToolContext } from '../tools/tool-context.js';
packages/core/src/core/clientToolGovernance.test.ts:16:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/core/coreToolScheduler.test.ts:40:import type { ContextAwareTool, ToolContext } from '../tools/tool-context.js';
packages/core/src/core/coreToolScheduler.test.ts:46:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/core/subagentToolProcessing.ts:28:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/core/subagentToolProcessing.ts:29:import { type ToolResultDisplay } from '../tools/tools.js';
packages/core/src/core/subagentToolProcessing.ts:31:import { TodoStore } from '../tools/todo-store.js';
packages/core/src/core/coreToolScheduler.interactiveMode.test.ts:29:import type { ContextAwareTool, ToolContext } from '../tools/tool-context.js';
packages/core/src/core/TodoContinuationService.test.ts:16:import type { Todo } from '../tools/todo-schemas.js';
packages/core/src/core/ChatSessionFactory.ts:26:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/core/subagent.test.ts:49:import { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/core/subagent.test.ts:60:import { ToolErrorType } from '../tools/tool-error.js';
packages/core/src/core/messageBus.core-integration.tdd.test.ts:27:} from '../tools/tools.js';
packages/core/src/core/messageBus.core-integration.tdd.test.ts:34:import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
packages/core/src/core/__tests__/subagent.stateless.test.ts:47:import type { ToolRegistry } from '../../tools/tool-registry.js';
packages/core/src/core/subagentTypes.ts:21:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/core/compression/utils.ts:42:import { classifyMediaBlock } from '../../tools/mediaUtils.js';
packages/core/src/config/configTypes.ts:34:import type { AnyToolInvocation } from '../tools/tools.js';
packages/core/src/test-utils/mock-tool.ts:11:} from '../tools/tools.js';
packages/core/src/test-utils/mock-tool.ts:16:} from '../tools/tools.js';
packages/core/src/test-utils/tools.ts:15:} from '../tools/tools.js';
packages/core/src/test-utils/tools.ts:22:} from '../tools/modifiable-tool.js';
packages/core/src/config/configBase.ts:12:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/config/config.test.ts:22:import { setLlxprtMdFilename as mockSetLlxprtMdFilename } from '../tools/memoryTool.js';
packages/core/src/config/config.test.ts:36:import { ShellTool } from '../tools/shell.js';
packages/core/src/config/config.test.ts:37:import { ReadFileTool } from '../tools/read-file.js';
packages/core/src/config/config.ts:13:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/config/config.ts:14:import { ActivateSkillTool } from '../tools/activate-skill.js';
packages/core/src/config/config.ts:97:import { McpClientManager } from '../tools/mcp-client-manager.js';
packages/core/src/config/configConstructor.ts:52:import { setLlxprtMdFilename } from '../tools/memoryTool.js';
packages/core/src/config/configBaseCore.ts:22:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/config/configBaseCore.ts:23:import type { McpClientManager } from '../tools/mcp-client-manager.js';
packages/core/src/config/configBaseCore.ts:24:import { LLXPRT_CONFIG_DIR as LLXPRT_DIR } from '../tools/memoryTool.js';
packages/core/src/config/lspIntegration.ts:8:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/config/schedulerSingleton.ts:19:import type { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/config/toolRegistryFactory.ts:11:import { ToolRegistry } from '../tools/tool-registry.js';
packages/core/src/config/toolRegistryFactory.ts:12:import { LSTool } from '../tools/ls.js';
packages/core/src/config/toolRegistryFactory.ts:13:import { ReadFileTool } from '../tools/read-file.js';
packages/core/src/config/toolRegistryFactory.ts:14:import { GrepTool } from '../tools/grep.js';
packages/core/src/config/toolRegistryFactory.ts:15:import { RipGrepTool } from '../tools/ripGrep.js';
packages/core/src/config/toolRegistryFactory.ts:16:import { GlobTool } from '../tools/glob.js';
packages/core/src/config/toolRegistryFactory.ts:17:import { EditTool } from '../tools/edit.js';
packages/core/src/config/toolRegistryFactory.ts:18:import { ShellTool } from '../tools/shell.js';
packages/core/src/config/toolRegistryFactory.ts:19:import { ASTEditTool } from '../tools/ast-edit.js';
packages/core/src/config/toolRegistryFactory.ts:20:import { ASTReadFileTool } from '../tools/ast-edit.js';
packages/core/src/config/toolRegistryFactory.ts:21:import { AstGrepTool } from '../tools/ast-grep.js';
packages/core/src/config/toolRegistryFactory.ts:22:import { StructuralAnalysisTool } from '../tools/structural-analysis.js';
packages/core/src/config/toolRegistryFactory.ts:23:import { WriteFileTool } from '../tools/write-file.js';
packages/core/src/config/toolRegistryFactory.ts:24:import { GoogleWebFetchTool } from '../tools/google-web-fetch.js';
packages/core/src/config/toolRegistryFactory.ts:25:import { ReadManyFilesTool } from '../tools/read-many-files.js';
packages/core/src/config/toolRegistryFactory.ts:26:import { ReadLineRangeTool } from '../tools/read_line_range.js';
packages/core/src/config/toolRegistryFactory.ts:27:import { DeleteLineRangeTool } from '../tools/delete_line_range.js';
packages/core/src/config/toolRegistryFactory.ts:28:import { InsertAtLineTool } from '../tools/insert_at_line.js';
packages/core/src/config/toolRegistryFactory.ts:29:import { ApplyPatchTool } from '../tools/apply-patch.js';
packages/core/src/config/toolRegistryFactory.ts:30:import { MemoryTool } from '../tools/memoryTool.js';
packages/core/src/config/toolRegistryFactory.ts:31:import { GoogleWebSearchTool } from '../tools/google-web-search.js';
packages/core/src/config/toolRegistryFactory.ts:32:import { ExaWebSearchTool } from '../tools/exa-web-search.js';
packages/core/src/config/toolRegistryFactory.ts:33:import { TodoWrite } from '../tools/todo-write.js';
packages/core/src/config/toolRegistryFactory.ts:34:import { TodoRead } from '../tools/todo-read.js';
packages/core/src/config/toolRegistryFactory.ts:35:import { TodoPause } from '../tools/todo-pause.js';
packages/core/src/config/toolRegistryFactory.ts:36:import { CodeSearchTool } from '../tools/codesearch.js';
packages/core/src/config/toolRegistryFactory.ts:37:import { DirectWebFetchTool } from '../tools/direct-web-fetch.js';
packages/core/src/config/toolRegistryFactory.ts:38:import { TaskTool } from '../tools/task.js';
packages/core/src/config/toolRegistryFactory.ts:39:import { ListSubagentsTool } from '../tools/list-subagents.js';
packages/core/src/config/toolRegistryFactory.ts:40:import { CheckAsyncTasksTool } from '../tools/check-async-tasks.js';
packages/core/src/config/config-lsp-integration.test.ts:21:import { setLlxprtMdFilename as _mockSetLlxprtMdFilename } from '../tools/memoryTool.js';
```

## Provider deep imports

### rg -n core tools deep imports in providers

```text
packages/providers/src/openai-responses/OpenAIResponsesInputBuilder.ts:26:import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts:32:import type { ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/openai-responses/buildResponsesInputFromContent.ts:26:import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts:23:import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/OpenAIProvider.toolNameErrors.test.ts:19:import { ToolFormatter } from '@vybestack/llxprt-code-core/tools/ToolFormatter.js';
packages/providers/src/openai/OpenAIStreamProcessor.ts:33:} from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/OpenAIStreamProcessor.ts:34:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/openai/OpenAIStreamProcessor.ts:43:import { type ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/openai/ToolCallNormalizer.ts:25:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/openai/buildResponsesRequest.ts:15:import { type ResponsesTool } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/openai/buildResponsesRequest.ts:20:import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/utils/toolFormatDetection.ts:17:import type { ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/utils/toolFormatDetection.ts:22:} from '@vybestack/llxprt-code-core/tools/ToolIdStrategy.js';
packages/providers/src/openai/OpenAIProvider.ts:28:import { type ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/openai/OpenAIProvider.ts:36:import { ToolFormatter } from '@vybestack/llxprt-code-core/tools/ToolFormatter.js';
packages/providers/src/reasoning/reasoningUtils.ts:13:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/reasoning/reasoningUtils.ts:14:import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/ToolCallNormalizer.test.ts:22:vi.mock('@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js', () => ({
packages/providers/src/openai/ToolCallNormalizer.test.ts:26:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/openai/OpenAIRequestBuilder.ts:19:import type { ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/openai/OpenAIRequestBuilder.ts:32:} from '@vybestack/llxprt-code-core/tools/ToolIdStrategy.js';
packages/providers/src/openai/OpenAIRequestBuilder.ts:39:import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/OpenAINonStreamHandler.ts:34:import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/OpenAINonStreamHandler.ts:35:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/openai-vercel/messageConversion.ts:46:} from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai-vercel/messageConversion.ts:51:import type { ToolIdMapper } from '@vybestack/llxprt-code-core/tools/ToolIdStrategy.js';
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:57:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:64:import { getToolIdStrategy } from '@vybestack/llxprt-code-core/tools/ToolIdStrategy.js';
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:83:} from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/syntheticToolResponses.ts:14:import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/OpenAIResponseParser.ts:27:import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/openai/OpenAIResponseParser.ts:28:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/openai/__tests__/ToolNameValidator.test.ts:19:import type { ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/openai/ToolNameValidator.ts:25:import type { ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/openai/ToolNameValidator.ts:29:} from '@vybestack/llxprt-code-core/tools/toolNameUtils.js';
packages/providers/src/anthropic/AnthropicProvider.test.ts:50:vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js', () => ({
packages/providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts:18:vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js', () => ({
packages/providers/src/anthropic/AnthropicMessageNormalizer.ts:24:import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/anthropic/AnthropicStreamProcessor.ts:19:import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/anthropic/AnthropicStreamProcessor.ts:23:} from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/anthropic/AnthropicResponseParser.ts:17:import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-core/tools/toolIdNormalization.js';
packages/providers/src/anthropic/AnthropicResponseParser.ts:18:import { processToolParameters } from '@vybestack/llxprt-code-core/tools/doubleEscapeUtils.js';
packages/providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts:56:vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js', () => ({
packages/providers/src/anthropic/AnthropicProvider.ts:13:import type { ToolFormat } from '@vybestack/llxprt-code-core/tools/IToolFormatter.js';
packages/providers/src/anthropic/AnthropicProvider.issue276.test.ts:31:vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js', () => ({
```

## Tools-to-core cycle candidates

### rg -n non-tools relative imports from core tools

```text
packages/core/src/tools/ToolIdStrategy.ts:22:} from '../services/history/IContent.js';
packages/core/src/tools/google-web-search.ts:8:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/google-web-search.ts:9:import type { Config } from '../config/config.js';
packages/core/src/tools/read-many-files.test.ts:10:import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/read-many-files.test.ts:15:import type { Config } from '../config/config.js';
packages/core/src/tools/read-many-files.test.ts:16:import { WorkspaceContext } from '../utils/workspaceContext.js';
packages/core/src/tools/read-many-files.test.ts:17:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/read-many-files.test.ts:21:} from '../utils/ignorePatterns.js';
packages/core/src/tools/tool-registry.test.ts:9:import type { ConfigParameters } from '../config/config.js';
packages/core/src/tools/tool-registry.test.ts:10:import { Config, ApprovalMode } from '../config/config.js';
packages/core/src/tools/tool-registry.test.ts:15:import { IdeClient } from '../ide/ide-client.js';
packages/core/src/tools/tool-registry.test.ts:19:import { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/read-file.test.ts:14:import type { Config } from '../config/config.js';
packages/core/src/tools/read-file.test.ts:15:import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/read-file.test.ts:16:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/task.ts:15:import type { Config } from '../config/config.js';
packages/core/src/tools/task.ts:19:} from '../core/subagentOrchestrator.js';
packages/core/src/tools/task.ts:20:import type { SubAgentScope } from '../core/subagent.js';
packages/core/src/tools/task.ts:25:} from '../core/subagentTypes.js';
packages/core/src/tools/task.ts:26:import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
packages/core/src/tools/task.ts:27:import type { SubagentManager } from '../config/subagentManager.js';
packages/core/src/tools/task.ts:28:import type { ProfileManager } from '../config/profileManager.js';
packages/core/src/tools/task.ts:30:import { DEFAULT_AGENT_ID } from '../core/turn.js';
packages/core/src/tools/task.ts:32:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/task.ts:33:import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
packages/core/src/tools/task.ts:34:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/task.ts:39:} from '../core/toolGovernance.js';
packages/core/src/tools/todo-store.ts:11:import { DEFAULT_AGENT_ID } from '../core/turn.js';
packages/core/src/tools/tool-registry.ts:18:import type { Config } from '../config/config.js';
packages/core/src/tools/tool-registry.ts:24:import { safeJsonStringify } from '../utils/safeJsonStringify.js';
packages/core/src/tools/tool-registry.ts:25:import { DebugLogger } from '../debug/index.js';
packages/core/src/tools/tool-registry.ts:27:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/edit-tabs-issue473.test.ts:17:import type { Config } from '../config/config.js';
packages/core/src/tools/edit-tabs-issue473.test.ts:18:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/edit-tabs-issue473.test.ts:20:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/shell.multibyte.test.ts:30:import type { Config } from '../config/config.js';
packages/core/src/tools/codesearch.test.ts:10:import type { Config } from '../config/config.js';
packages/core/src/tools/activate-skill.ts:10:import { getFolderStructure } from '../utils/getFolderStructure.js';
packages/core/src/tools/activate-skill.ts:11:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/activate-skill.ts:19:import type { Config } from '../config/config.js';
packages/core/src/tools/base-tool-invocation.test.ts:9:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/base-tool-invocation.test.ts:15:} from '../confirmation-bus/types.js';
packages/core/src/tools/tool-key-storage.ts:27:} from '../storage/secure-store.js';
packages/core/src/tools/tool-key-storage.ts:28:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/ripGrep.ts:22:import { SchemaValidator } from '../utils/schemaValidator.js';
packages/core/src/tools/ripGrep.ts:23:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/ripGrep.ts:24:import { getErrorMessage } from '../utils/errors.js';
packages/core/src/tools/ripGrep.ts:25:import type { Config } from '../config/config.js';
packages/core/src/tools/ripGrep.ts:26:import { getRipgrepPath } from '../utils/ripgrepPathResolver.js';
packages/core/src/tools/ripGrep.ts:27:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/ripGrep.ts:31:} from '../utils/resolveTextSearchTarget.js';
packages/core/src/tools/ripGrep.ts:32:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/ripGrep.ts:33:import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/modifiable-tool.ts:7:import { type EditorType, openDiff } from '../utils/editor.js';
packages/core/src/tools/modifiable-tool.ts:13:import { isNodeError } from '../utils/errors.js';
packages/core/src/tools/modifiable-tool.ts:16:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/direct-web-fetch.ts:11:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/direct-web-fetch.ts:19:import type { Config } from '../config/config.js';
packages/core/src/tools/direct-web-fetch.ts:25:import { retryWithBackoff } from '../utils/retry.js';
packages/core/src/tools/direct-web-fetch.ts:26:import { ensureJsonSafe } from '../utils/unicodeUtils.js';
packages/core/src/tools/mcp-tool.test.ts:12:import { safeJsonStringify } from '../utils/safeJsonStringify.js';
packages/core/src/tools/todo-pause.ts:9:import { SchemaValidator } from '../utils/schemaValidator.js';
packages/core/src/tools/mediaUtils.ts:18:import type { MediaBlock } from '../services/history/IContent.js';
packages/core/src/tools/IToolFormatter.ts:24:import { type ToolCallBlock } from '../services/history/IContent.js';
packages/core/src/tools/lsp-diagnostics-helper.ts:8:import type { Config } from '../config/config.js';
packages/core/src/tools/mcp-client-manager.test.ts:11:import type { Config } from '../config/config.js';
packages/core/src/tools/mcp-client-manager.test.ts:15:import type { WorkspaceContext } from '../utils/workspaceContext.js';
packages/core/src/tools/mcp-client-manager.test.ts:17:import { CoreEvent } from '../utils/events.js';
packages/core/src/tools/edit-utils.ts:7:import type { Config } from '../config/config.js';
packages/core/src/tools/insert_at_line.ts:11:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/insert_at_line.ts:23:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/insert_at_line.ts:27:import type { Config } from '../config/config.js';
packages/core/src/tools/insert_at_line.ts:28:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/insert_at_line.ts:33:import { getSpecificMimeType } from '../utils/fileUtils.js';
packages/core/src/tools/insert_at_line.ts:34:import { isNodeError } from '../utils/errors.js';
packages/core/src/tools/insert_at_line.ts:36:import { IDEConnectionStatus } from '../ide/ide-client.js';
packages/core/src/tools/direct-web-fetch.test.ts:10:import type { Config } from '../config/config.js';
packages/core/src/tools/delete_line_range.test.ts:10:import type { Config } from '../config/config.js';
packages/core/src/tools/delete_line_range.test.ts:11:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/delete_line_range.test.ts:16:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/ToolFormatter.ts:32:import { type ToolCallBlock } from '../services/history/IContent.js';
packages/core/src/tools/ToolFormatter.ts:33:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/memoryTool.ts:15:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/memoryTool.ts:20:import { Storage } from '../config/storage.js';
packages/core/src/tools/memoryTool.ts:23:import { tildeifyPath } from '../utils/paths.js';
packages/core/src/tools/memoryTool.ts:29:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/modifiable-tool.test.ts:16:import { DEFAULT_GUI_EDITOR } from '../utils/editor.js';
packages/core/src/tools/modifiable-tool.test.ts:17:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/grep.test.ts:13:import type { Config } from '../config/config.js';
packages/core/src/tools/shell.ts:14:import type { Config } from '../config/config.js';
packages/core/src/tools/shell.ts:16:import { initializeParser } from '../utils/shell-parser.js';
packages/core/src/tools/shell.ts:35:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/shell.ts:36:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/shell.ts:37:import { getErrorMessage } from '../utils/errors.js';
packages/core/src/tools/shell.ts:44:} from '../utils/toolOutputLimiter.js';
packages/core/src/tools/shell.ts:45:import { summarizeToolOutput } from '../utils/summarizer.js';
packages/core/src/tools/shell.ts:50:} from '../services/shellExecutionService.js';
packages/core/src/tools/shell.ts:51:import type { AnsiOutput } from '../utils/terminalSerializer.js';
packages/core/src/tools/shell.ts:52:import { formatMemoryUsage } from '../utils/formatters.js';
packages/core/src/tools/shell.ts:57:} from '../utils/shell-utils.js';
packages/core/src/tools/shell.ts:58:import { isShellInvocationAllowlisted } from '../utils/tool-utils.js';
packages/core/src/tools/shell.ts:59:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/shell.ts:60:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/write-file.ts:10:import type { Config } from '../config/config.js';
packages/core/src/tools/write-file.ts:11:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/write-file.ts:24:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/write-file.ts:26:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/write-file.ts:27:import { getErrorMessage, isNodeError } from '../utils/errors.js';
packages/core/src/tools/write-file.ts:33:import { getSpecificMimeType } from '../utils/fileUtils.js';
packages/core/src/tools/write-file.ts:38:import { IDEConnectionStatus } from '../ide/ide-client.js';
packages/core/src/tools/write-file.ts:39:import { getGitStatsService } from '../services/git-stats-service.js';
packages/core/src/tools/write-file.ts:41:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/google-web-fetch.test.ts:9:import type { Config } from '../config/config.js';
packages/core/src/tools/google-web-fetch.test.ts:10:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/google-web-fetch.test.ts:13:import * as fetchUtils from '../utils/fetch.js';
packages/core/src/tools/ripGrep.test.ts:15:import type { Config } from '../config/config.js';
packages/core/src/tools/toolIdNormalization.ts:29:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/read-many-files.batch.test.ts:10:import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/read-many-files.batch.test.ts:15:import type { Config } from '../config/config.js';
packages/core/src/tools/read-many-files.batch.test.ts:16:import { WorkspaceContext } from '../utils/workspaceContext.js';
packages/core/src/tools/read-many-files.batch.test.ts:17:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/read-many-files.batch.test.ts:21:} from '../utils/ignorePatterns.js';
packages/core/src/tools/messageBus.registry-invocation.tdd.test.ts:12:} from '../config/config.js';
packages/core/src/tools/messageBus.registry-invocation.tdd.test.ts:14:import { IdeClient } from '../ide/ide-client.js';
packages/core/src/tools/messageBus.registry-invocation.tdd.test.ts:22:import { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/messageBus.registry-invocation.tdd.test.ts:26:} from '../confirmation-bus/types.js';
packages/core/src/tools/delete_line_range.ts:9:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/delete_line_range.ts:21:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/delete_line_range.ts:25:import type { Config } from '../config/config.js';
packages/core/src/tools/delete_line_range.ts:26:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/delete_line_range.ts:31:import { getSpecificMimeType } from '../utils/fileUtils.js';
packages/core/src/tools/delete_line_range.ts:33:import { IDEConnectionStatus } from '../ide/ide-client.js';
packages/core/src/tools/google-web-fetch.integration.test.ts:9:import type { Config } from '../config/config.js';
packages/core/src/tools/google-web-fetch.integration.test.ts:12:import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
packages/core/src/tools/google-web-fetch.integration.test.ts:13:import * as fetchUtils from '../utils/fetch.js';
packages/core/src/tools/mcp-client.ts:37:import type { Config, MCPServerConfig } from '../config/config.js';
packages/core/src/tools/mcp-client.ts:38:import { AuthProviderType } from '../config/config.js';
packages/core/src/tools/mcp-client.ts:39:import { GoogleCredentialProvider } from '../mcp/google-auth-provider.js';
packages/core/src/tools/mcp-client.ts:40:import { ServiceAccountImpersonationProvider } from '../mcp/sa-impersonation-provider.js';
packages/core/src/tools/mcp-client.ts:46:import type { McpAuthProvider } from '../mcp/auth-provider.js';
packages/core/src/tools/mcp-client.ts:47:import { MCPOAuthProvider } from '../mcp/oauth-provider.js';
packages/core/src/tools/mcp-client.ts:48:import { MCPOAuthTokenStorage } from '../mcp/oauth-token-storage.js';
packages/core/src/tools/mcp-client.ts:49:import { OAuthUtils } from '../mcp/oauth-utils.js';
packages/core/src/tools/mcp-client.ts:57:} from '../utils/errors.js';
packages/core/src/tools/mcp-client.ts:61:} from '../utils/workspaceContext.js';
packages/core/src/tools/mcp-client.ts:63:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/mcp-client.ts:64:import { DebugLogger } from '../debug/index.js';
packages/core/src/tools/mcp-client.ts:65:import { coreEvents } from '../utils/events.js';
packages/core/src/tools/todo-read.ts:11:import { TodoReminderService } from '../services/todo-reminder-service.js';
packages/core/src/tools/todo-read.ts:13:import { ToolCallTrackerService } from '../services/tool-call-tracker-service.js';
packages/core/src/tools/structural-analysis.ts:23:import { makeRelative } from '../utils/paths.js';
packages/core/src/tools/structural-analysis.ts:25:import type { Lang } from '../utils/ast-grep-utils.js';
packages/core/src/tools/structural-analysis.ts:30:} from '../utils/ast-grep-utils.js';
packages/core/src/tools/structural-analysis.ts:31:import type { Config } from '../config/config.js';
packages/core/src/tools/structural-analysis.ts:32:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/read-file.ts:11:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/read-file.ts:27:} from '../utils/fileUtils.js';
packages/core/src/tools/read-file.ts:28:import type { Config } from '../config/config.js';
packages/core/src/tools/read-file.ts:33:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/read-file.ts:34:import type { GitLineChangeMarker } from '../utils/gitLineChanges.js';
packages/core/src/tools/read-file.ts:35:import { getGitLineChanges } from '../utils/gitLineChanges.js';
packages/core/src/tools/mcp-client-manager.ts:11:} from '../config/config.js';
packages/core/src/tools/mcp-client-manager.ts:18:import { getErrorMessage, isAuthenticationError } from '../utils/errors.js';
packages/core/src/tools/mcp-client-manager.ts:20:import { coreEvents, CoreEvent } from '../utils/events.js';
packages/core/src/tools/mcp-client-manager.ts:21:import { DebugLogger } from '../debug/index.js';
packages/core/src/tools/mcp-client-manager.ts:22:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/tools.test.ts:11:import type { AnsiOutput } from '../utils/terminalSerializer.js';
packages/core/src/tools/read-many-files.ts:14:import { getErrorMessage } from '../utils/errors.js';
packages/core/src/tools/read-many-files.ts:25:} from '../utils/fileUtils.js';
packages/core/src/tools/read-many-files.ts:27:import type { Config } from '../config/config.js';
packages/core/src/tools/read-many-files.ts:35:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/todo-write.test.ts:10:import { TodoReminderService } from '../services/todo-reminder-service.js';
packages/core/src/tools/ast-grep.test.ts:5:import type { Config } from '../config/config.js';
packages/core/src/tools/list-subagents.ts:13:import type { Config } from '../config/config.js';
packages/core/src/tools/list-subagents.ts:14:import type { SubagentManager } from '../config/subagentManager.js';
packages/core/src/tools/list-subagents.ts:15:import type { SubagentConfig } from '../config/types.js';
packages/core/src/tools/list-subagents.ts:16:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/edit-fuzzy.test.ts:19:import type { Config } from '../config/config.js';
packages/core/src/tools/edit-fuzzy.test.ts:20:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/edit-fuzzy.test.ts:22:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/confirmation-policy.test.ts:15:import { MessageBusType } from '../confirmation-bus/types.js';
packages/core/src/tools/confirmation-policy.test.ts:16:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/confirmation-policy.test.ts:17:import type { Config } from '../config/config.js';
packages/core/src/tools/read-line-range.test.ts:15:import type { Config } from '../config/config.js';
packages/core/src/tools/read-line-range.test.ts:16:import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/read-line-range.test.ts:17:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/write-file.test.ts:19:import type { Config } from '../config/config.js';
packages/core/src/tools/write-file.test.ts:20:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/write-file.test.ts:25:import { GeminiClient } from '../core/client.js';
packages/core/src/tools/write-file.test.ts:27:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/codesearch.ts:17:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/codesearch.ts:19:import type { Config } from '../config/config.js';
packages/core/src/tools/codesearch.ts:22:import { ensureJsonSafe } from '../utils/unicodeUtils.js';
packages/core/src/tools/mcp-tool.ts:7:import { safeJsonStringify } from '../utils/safeJsonStringify.js';
packages/core/src/tools/mcp-tool.ts:21:import type { Config } from '../config/config.js';
packages/core/src/tools/mcp-tool.ts:22:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/todo-write.ts:11:import { TodoReminderService } from '../services/todo-reminder-service.js';
packages/core/src/tools/todo-write.ts:13:import { TodoContextTracker } from '../services/todo-context-tracker.js';
packages/core/src/tools/todo-write.ts:15:import { DEFAULT_AGENT_ID } from '../core/turn.js';
packages/core/src/tools/structural-analysis.test.ts:5:import type { Config } from '../config/config.js';
packages/core/src/tools/ls.test.ts:11:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/ls.test.ts:24:import type { Config } from '../config/config.js';
packages/core/src/tools/ls.test.ts:25:import type { WorkspaceContext } from '../utils/workspaceContext.js';
packages/core/src/tools/ls.test.ts:26:import type { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/read_line_range.ts:10:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/read_line_range.ts:19:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/read_line_range.ts:26:} from '../utils/fileUtils.js';
packages/core/src/tools/read_line_range.ts:27:import type { Config } from '../config/config.js';
packages/core/src/tools/read_line_range.ts:33:import type { GitLineChangeMarker } from '../utils/gitLineChanges.js';
packages/core/src/tools/read_line_range.ts:34:import { getGitLineChanges } from '../utils/gitLineChanges.js';
packages/core/src/tools/ast-grep.ts:20:import { makeRelative } from '../utils/paths.js';
packages/core/src/tools/ast-grep.ts:22:import type { Lang } from '../utils/ast-grep-utils.js';
packages/core/src/tools/ast-grep.ts:28:} from '../utils/ast-grep-utils.js';
packages/core/src/tools/ast-grep.ts:29:import type { Config } from '../config/config.js';
packages/core/src/tools/ast-grep.ts:30:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/ast-edit.ts:20:import { isNodeError } from '../utils/errors.js';
packages/core/src/tools/ast-edit.ts:21:import type { Config } from '../config/config.js';
packages/core/src/tools/apply-patch.ts:26:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/apply-patch.ts:28:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/apply-patch.ts:29:import type { Config } from '../config/config.js';
packages/core/src/tools/apply-patch.ts:30:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/apply-patch.ts:32:import { IDEConnectionStatus } from '../ide/ide-client.js';
packages/core/src/tools/apply-patch.ts:33:import { getGitStatsService } from '../services/git-stats-service.js';
packages/core/src/tools/apply-patch.ts:36:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/exa-web-search.test.ts:9:import type { Config } from '../config/config.js';
packages/core/src/tools/todo-store.test.ts:13:import { DEFAULT_AGENT_ID } from '../core/turn.js';
packages/core/src/tools/google-web-search-invocation.ts:12:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/google-web-search-invocation.ts:13:import { getErrorMessage } from '../utils/errors.js';
packages/core/src/tools/google-web-search-invocation.ts:14:import type { Config } from '../config/config.js';
packages/core/src/tools/google-web-search-invocation.ts:16:import { getResponseText } from '../utils/generateContentResponseUtilities.js';
packages/core/src/tools/google-web-search-invocation.ts:18:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/google-web-fetch.ts:17:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/google-web-fetch.ts:19:import { getErrorMessage } from '../utils/errors.js';
packages/core/src/tools/google-web-fetch.ts:20:import type { Config } from '../config/config.js';
packages/core/src/tools/google-web-fetch.ts:21:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/google-web-fetch.ts:22:import { getResponseText } from '../utils/generateContentResponseUtilities.js';
packages/core/src/tools/google-web-fetch.ts:23:import { fetchWithTimeout, isPrivateIp } from '../utils/fetch.js';
packages/core/src/tools/google-web-fetch.ts:27:import { DebugLogger } from '../debug/DebugLogger.js';
packages/core/src/tools/ast-edit.test.ts:13:import type { Config } from '../config/config.js';
packages/core/src/tools/mcp-client.test.ts:14:import { AuthProviderType, type Config } from '../config/config.js';
packages/core/src/tools/mcp-client.test.ts:15:import { GoogleCredentialProvider } from '../mcp/google-auth-provider.js';
packages/core/src/tools/mcp-client.test.ts:16:import { MCPOAuthProvider } from '../mcp/oauth-provider.js';
packages/core/src/tools/mcp-client.test.ts:17:import { MCPOAuthTokenStorage } from '../mcp/oauth-token-storage.js';
packages/core/src/tools/mcp-client.test.ts:26:import { WorkspaceContext } from '../utils/workspaceContext.js';
packages/core/src/tools/mcp-client.test.ts:40:import { coreEvents } from '../utils/events.js';
packages/core/src/tools/insert_at_line.test.ts:10:import type { Config } from '../config/config.js';
packages/core/src/tools/insert_at_line.test.ts:11:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/insert_at_line.test.ts:16:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/tools.ts:14:import { type DiffUpdateResult } from '../ide/ideContext.js';
packages/core/src/tools/tools.ts:15:import { SchemaValidator } from '../utils/schemaValidator.js';
packages/core/src/tools/tools.ts:16:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/tools.ts:20:} from '../confirmation-bus/types.js';
packages/core/src/tools/tools.ts:26:import type { AnsiOutput } from '../utils/terminalSerializer.js';
packages/core/src/tools/exa-web-search.ts:19:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/exa-web-search.ts:21:import type { Config } from '../config/config.js';
packages/core/src/tools/exa-web-search.ts:24:import { ensureJsonSafe } from '../utils/unicodeUtils.js';
packages/core/src/tools/list-subagents.test.ts:9:import type { Config } from '../config/config.js';
packages/core/src/tools/list-subagents.test.ts:10:import type { SubagentManager } from '../config/subagentManager.js';
packages/core/src/tools/task.test.ts:11:import type { Config } from '../config/config.js';
packages/core/src/tools/task.test.ts:12:import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
packages/core/src/tools/task.test.ts:13:import { ContextState, SubagentTerminateMode } from '../core/subagentTypes.js';
packages/core/src/tools/task.test.ts:15:import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
packages/core/src/tools/ToolIdStrategy.test.ts:27:} from '../services/history/IContent.js';
packages/core/src/tools/check-async-tasks.ts:19:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/check-async-tasks.ts:24:} from '../services/asyncTaskManager.js';
packages/core/src/tools/glob.ts:14:import { shortenPath, makeRelative } from '../utils/paths.js';
packages/core/src/tools/glob.ts:15:import { type Config } from '../config/config.js';
packages/core/src/tools/glob.ts:17:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/glob.ts:18:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/glob.ts:20:import type { WorkspaceContext } from '../utils/workspaceContext.js';
packages/core/src/tools/google-web-search.test.ts:9:import type { Config } from '../config/config.js';
packages/core/src/tools/check-async-tasks.test.ts:13:import { AsyncTaskManager } from '../services/asyncTaskManager.js';
packages/core/src/tools/edit.test.ts:15:import { IDEConnectionStatus } from '../ide/ide-client.js';
packages/core/src/tools/edit.test.ts:52:import type { Config } from '../config/config.js';
packages/core/src/tools/edit.test.ts:53:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/edit.test.ts:56:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/grep.timeout.test.ts:13:import type { Config } from '../config/config.js';
packages/core/src/tools/grep.ts:21:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/grep.ts:22:import { getErrorMessage, isNodeError } from '../utils/errors.js';
packages/core/src/tools/grep.ts:23:import { isGitRepository } from '../utils/gitUtils.js';
packages/core/src/tools/grep.ts:27:} from '../utils/resolveTextSearchTarget.js';
packages/core/src/tools/grep.ts:28:import type { Config } from '../config/config.js';
packages/core/src/tools/grep.ts:29:import type { FileExclusions } from '../utils/ignorePatterns.js';
packages/core/src/tools/grep.ts:34:} from '../utils/toolOutputLimiter.js';
packages/core/src/tools/grep.ts:35:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/grep.ts:36:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/ls.ts:18:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/ls.ts:19:import type { Config } from '../config/config.js';
packages/core/src/tools/ls.ts:21:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/ls.ts:22:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/edit.ts:24:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/edit.ts:26:import { makeRelative, shortenPath } from '../utils/paths.js';
packages/core/src/tools/edit.ts:27:import { isNodeError } from '../utils/errors.js';
packages/core/src/tools/edit.ts:28:import type { Config } from '../config/config.js';
packages/core/src/tools/edit.ts:29:import { ApprovalMode } from '../config/config.js';
packages/core/src/tools/edit.ts:36:import { IDEConnectionStatus } from '../ide/ide-client.js';
packages/core/src/tools/edit.ts:37:import { getGitStatsService } from '../services/git-stats-service.js';
packages/core/src/tools/edit.ts:41:import { debugLogger } from '../utils/debugLogger.js';
packages/core/src/tools/glob.test.ts:9:import { partListUnionToString } from '../core/geminiRequest.js';
packages/core/src/tools/glob.test.ts:14:import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/glob.test.ts:15:import type { Config } from '../config/config.js';
packages/core/src/tools/activate-skill.test.ts:9:import type { Config } from '../config/config.js';
packages/core/src/tools/activate-skill.test.ts:10:import type { MessageBus } from '../confirmation-bus/message-bus.js';
packages/core/src/tools/doubleEscapeUtils.ts:29:import { DebugLogger } from '../debug/index.js';
packages/core/src/tools/read-many-files.token-overflow.test.ts:10:import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
packages/core/src/tools/read-many-files.token-overflow.test.ts:15:import type { Config } from '../config/config.js';
packages/core/src/tools/read-many-files.token-overflow.test.ts:16:import { WorkspaceContext } from '../utils/workspaceContext.js';
packages/core/src/tools/read-many-files.token-overflow.test.ts:17:import { StandardFileSystemService } from '../services/fileSystemService.js';
packages/core/src/tools/read-many-files.token-overflow.test.ts:18:import { COMMON_IGNORE_PATTERNS } from '../utils/ignorePatterns.js';
packages/core/src/tools/shell.test.ts:49:import { isCommandAllowed } from '../utils/shell-utils.js';
packages/core/src/tools/shell.test.ts:51:import { type Config } from '../config/config.js';
packages/core/src/tools/shell.test.ts:55:} from '../services/shellExecutionService.js';
packages/core/src/tools/shell.test.ts:70:import * as summarizer from '../utils/summarizer.js';
```

## A2A server tool consumer verification

### rg -n "getToolRegistry|ToolRegistry" packages/a2a-server/src -g "*.ts"

```text
packages/a2a-server/src/http/app.test.ts:80:const getToolRegistrySpy = vi.fn().mockReturnValue(ApprovalMode.DEFAULT);
packages/a2a-server/src/http/app.test.ts:90:        getToolRegistry: getToolRegistrySpy,
packages/a2a-server/src/http/app.test.ts:203:    getToolRegistrySpy.mockReturnValue({
packages/a2a-server/src/http/app.test.ts:301:    getToolRegistrySpy.mockReturnValue({
packages/a2a-server/src/http/app.test.ts:415:    getToolRegistrySpy.mockReturnValue({
packages/a2a-server/src/http/app.test.ts:532:    getToolRegistrySpy.mockReturnValue({
packages/a2a-server/src/agent/task.ts:178:    const toolRegistry = this.config.getToolRegistry();
packages/a2a-server/src/utils/testing_utils.ts:42:  getToolRegistry: () => unknown;
packages/a2a-server/src/utils/testing_utils.ts:114:  const registry = mockConfig.getToolRegistry() as
packages/a2a-server/src/utils/testing_utils.ts:228:          toolRegistry: mockConfig.getToolRegistry(),
packages/a2a-server/src/utils/testing_utils.ts:239:    getToolRegistry: vi.fn().mockReturnValue({
```

## Release baseline commands

### rg -n "npm publish --workspace=@vybestack/llxprt-code" .github/workflows/release.yml

```text
322:        run: npm publish --workspace=@vybestack/llxprt-code-core --provenance --tag=${{ steps.version.outputs.NPM_TAG }} ${{ steps.vars.outputs.is_dry_run == 'true' && '--dry-run' || '' }}
326:        run: npm publish --workspace=@vybestack/llxprt-code-lsp --access public --provenance --tag=${{ steps.version.outputs.NPM_TAG }} ${{ steps.vars.outputs.is_dry_run == 'true' && '--dry-run' || '' }}
330:        run: npm publish --workspace=@vybestack/llxprt-code-providers --access public --provenance --tag=${{ steps.version.outputs.NPM_TAG }} ${{ steps.vars.outputs.is_dry_run == 'true' && '--dry-run' || '' }}
334:        run: npm publish --workspace=@vybestack/llxprt-code --provenance --tag=${{ steps.version.outputs.NPM_TAG }} ${{ steps.vars.outputs.is_dry_run == 'true' && '--dry-run' || '' }}
```

### rg -n "providers|tools" scripts/tests/release-process.test.js

```text
66:      '@vybestack/llxprt-code-providers',
105:  it('publishes providers after core but before CLI', () => {
109:    const providersIndex = releaseYml.indexOf(
110:      'npm publish --workspace=@vybestack/llxprt-code-providers',
117:    expect(providersIndex).toBeGreaterThan(coreIndex);
118:    expect(cliIndex).toBeGreaterThan(providersIndex);
146:  it('prepares providers tarballs for sandbox images', () => {
147:    expect(releaseYml).toContain('packages/providers/dist');
149:      'npm pack -w @vybestack/llxprt-code-providers',
157:  it('packs providers alongside core and CLI', () => {
161:      'npm pack -w @vybestack/llxprt-code-providers',
174:  it('copies providers tarball after core and before CLI', () => {
178:    const providersCopy = dockerfile.indexOf(
179:      'COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz',
186:    expect(providersCopy).toBeGreaterThan(coreCopy);
187:    expect(cliCopy).toBeGreaterThan(providersCopy);
197:    expect(installCommand).toContain('vybestack-llxprt-code-providers-*.tgz');
221:      ['@vybestack/llxprt-code-providers', { version: '1.2.3' }],
225:      '@vybestack/llxprt-code-providers',
229:      '@vybestack/llxprt-code-providers': 'file:../providers',
239:      '@vybestack/llxprt-code-providers': '1.2.3',
255:            '@vybestack/llxprt-code-providers': 'file:../providers',
264:        new Set(['@vybestack/llxprt-code', '@vybestack/llxprt-code-providers']),
```

### rg -n "npm pack -w @vybestack/llxprt-code" scripts/build_sandbox.js

```text
102:    `npm pack -w @vybestack/llxprt-code --pack-destination ./packages/cli/dist`,
113:    `npm pack -w @vybestack/llxprt-code-core --pack-destination ./packages/core/dist`,
123:    `npm pack -w @vybestack/llxprt-code-providers --pack-destination ./packages/providers/dist`,
```

### rg -n "vybestack-llxprt-code.*\.tgz" Dockerfile

```text
53:COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz /tmp/
54:COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz /tmp/
55:COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz /tmp/
61:      /tmp/vybestack-llxprt-code-core-*.tgz \
62:      /tmp/vybestack-llxprt-code-providers-*.tgz \
63:      /tmp/vybestack-llxprt-code-*.tgz && \
```


## Approved Missing-Packages Decision

Evidence above shows packages/settings, packages/storage, and packages/mcp do not exist. The empty output from `find packages -maxdepth 1 -type d \( -name settings -o -name storage -o -name mcp \)` confirms there are no same-named package directories.

The plan approves a temporary tools-owned interface/core-adapter path:
- tools-owned interfaces in packages/tools/src/interfaces/**
- core adapters in packages/core/src/tools-adapters/**
- packages/tools MUST NOT import packages/core, packages/cli, or packages/providers
- when packages/settings, packages/storage, or packages/mcp are created, replace corresponding temporary interfaces/adapters with direct imports from those packages
- behavior preservation is mandatory: adapters preserve return types, error behavior, optionality, ordering, and existing storage/settings/MCP semantics
- MCP client/manager remain core infrastructure; mcp-tool.ts may move if it depends solely on IMcpToolService

Status: APPROVED FOR IMPLEMENTATION PHASES AFTER P00a. Missing packages are not a blocker because this temporary interface-adapter path is explicitly approved by the plan.

## MCP Ownership Decision

- mcp-client.ts: STAYS in core as STAY_CORE_INFRASTRUCTURE because it is core MCP infrastructure with OAuth/auth/token-storage coupling.
- mcp-client-manager.ts: STAYS in core as STAY_CORE_INFRASTRUCTURE because it manages MCP client lifecycle and depends on Config/events/core infrastructure.
- mcp-tool.ts: CONDITIONAL MOVE. It moves to packages/tools only if its constructor/dependencies can be expressed through IMcpToolService or equivalent tools-owned interfaces instead of direct Config+MessageBus coupling. The final classification requires analysis/mcp-tool-decision.md before P03/P10/P11 per the plan.

## Inventory Artifacts Generated

- project-plans/issue1585/analysis/current-tools-files.txt generated with all-file scan: `find packages/core/src/tools -type f | sort`.
- project-plans/issue1585/analysis/all-tool-consumers.txt generated with import/deep-import scan: `rg -n "\.\./tools/|\.\./\.\./tools/|@vybestack/llxprt-code-core/tools/" packages -g "*.ts"`.

Counts from generation:
- current-tools-files.txt: 152 lines/files.
- all-tool-consumers.txt: 276 lines/matches.

## A2A Server Tool Consumer Usage Evidence

The A2A evidence command output above confirms packages/a2a-server consumes tool registry access through Config.getToolRegistry()/ToolRegistry-shaped values, including task execution and test utilities. This matches the plan decision that a2a-server should receive ToolRegistry through core re-exports/config paths and does not need a direct packages/tools dependency.

## Type And Interface Verification Summary

- ToolContext exists in packages/core/src/tools/tool-context.ts and is planned to remain narrow.
- ToolRegistry exists in packages/core/src/tools/tool-registry.ts and currently participates in core/config wiring; P02/P02b/P11 replace concrete Config dependencies with tools-owned interfaces and core adapters.
- Base tool abstractions exist in packages/core/src/tools/tools.ts and currently import core services/types; P02/P03/P05/P11 define and apply tools-owned contracts before migration.
- Config tool registry factory exists in packages/core/src/config/toolRegistryFactory.ts and imports concrete built-in tools from core/tools today; P11/P12 migrate it to adapter-based registration.
- MessageBus confirmation API exists under packages/core/src/confirmation-bus and is planned to be adapted through IToolMessageBus.

## Semantic Assessment

- Actual package existence was verified, not assumed.
- Missing settings/storage/mcp packages are reconciled by the approved temporary interface-adapter path.
- MCP ownership decision is recorded with final mcp-tool.ts classification deferred to the required decision artifact.
- Complete current core tools file inventory and current consumer import inventory were generated.
- GitHub issue body/comments were captured separately and traceability was appended there.
- A2A server usage evidence was captured.
- No production source files under packages/** were modified by P00a.

Gate result: PASS for P00a preflight evidence collection.
Verification timestamp: 2026-06-08T20:18:16Z
preflight-results.md exists
Approved Missing-Packages Decision count: 2
MCP Ownership Decision count: 2
current-tools-files.txt exists
all-tool-consumers.txt exists
issue-body-and-comments.md exists
traceability count: 2
current-tools-files count:      152
all-tool-consumers count:      276
packages/** modified by this phase (should be none from P00a):
