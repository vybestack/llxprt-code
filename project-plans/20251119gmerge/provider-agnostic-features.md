# Provider-Agnostic Features Analysis

## Executive Summary

This document analyzes Gemini-specific features that were skipped during the 20251119gmerge cherry-pick process and proposes provider-agnostic alternatives that would benefit llxprt's multi-provider architecture. The analysis identifies 8 major feature areas where provider-agnostic implementations would add value.

## Skipped Gemini-Specific Features

### 1. Zed Auto-Model Selection (Commit #176: `d39cd045`)

**What it does:** In upstream Gemini CLI, the Zed integration supports an 'auto' model selection that automatically switches between `gemini-2.5-pro` and `gemini-2.5-flash` based on context.

**Why it was skipped:** The implementation is hardcoded to specific Gemini models and doesn't accommodate other providers.

**Current llxprt state:**
- Zed integration exists (`packages/cli/src/zed-integration/zedIntegration.ts`)
- Already supports multi-provider authentication and model selection
- Uses runtime settings to switch providers and models

**Status:** ⏳ Not started — requires a provider-agnostic routing heuristic before we can re-enable an `auto` mode.

### 2. Extension Auto-Update Infrastructure (Commit #44: `22b7d865`)

**What it does:** Automatically updates git-based extensions when newer versions are available.

**Why it was skipped:** Complex conflicts with llxprt's extension architecture; would require significant restructuring of the extension installation flow.

**Current llxprt state:**
- Manual extension updates via `llxprt extension update` command
- Extension installation metadata tracking exists
- No automatic update checking mechanism

**Status:** ✅ Completed — `ExtensionAutoUpdater` (packages/cli/src/extensions/extensionAutoUpdater.ts) plus the `useExtensionAutoUpdate` UI hook now implement background checks, notifications, and install modes per the updated plan (`project-plans/20251119gmerge/extension-auto-update.md`).

### 3. /model Command Interactive Selection (Commit #155: `5151bedf`)

**What it does:** Upstream provides an interactive model selector specifically for Gemini models.

**Why it was skipped:** llxprt already has a multi-provider `/model` command that works across all providers.

**Current llxprt state:**
- `/model` command exists and works with provider model dialog
- Supports switching models within the active provider
- No automatic model selection based on task context

**Status:** ✅ Completed — multi-provider `/model` slash command shipped prior to gmerge.

### 4. Permissions Command UI (Commit #133: `6c559e23`)

**What it does:** Adds a `/permissions` command with an interactive dialog to modify trust settings.

**Why it was marked for reimplementation:** While the command shell exists in llxprt, the full interactive dialog with trust modification capabilities needs to be implemented.

**Current llxprt state:**
- Basic `/permissions` command exists but only opens a dialog placeholder
- Trust system is fully functional but lacks interactive modification UI

**Status:** ✅ Completed — `/permissions` now opens the `PermissionsModifyTrustDialog`, commits trust levels, and surfaces restart instructions.

### 5. Policy Engine Configuration (Commit #42: `afba59a9`)

**What it does:** Configures a policy engine for tool execution governance from existing settings.

**Why it was skipped:** Relies on Gemini-only governance paths and message bus infrastructure.

**Current llxprt state:**
- No policy engine for tool execution
- Trust-based permission system exists
- Tool confirmation happens at execution time

**Status:** ✅ Completed — policy engine and message bus integration landed; all confirmations now flow through the policy stack.

### 6. Model Router (Commit #175: `fd2bc71e`)

**What it does:** Enables automatic model routing based on request characteristics.

**Why it was skipped:** Gemini-specific router that wouldn't work with multiple providers.

**Current llxprt state:**
- Manual provider and model selection
- No automatic routing based on task type

**Status:** ⏳ Not started — awaiting the intelligent model selection work outlined below.

### 7. Todo Tool (Commit #113: `44691a4c`)

**What it does:** Upstream added a simpler todo tracking tool.

**Why it was skipped:** llxprt already has a comprehensive Todo system with subtasks, priorities, tool call tracking, TodoStore, TodoReminderService, and TodoContextTracker.

**Current llxprt state:**
- Full-featured todo system already exists
- More advanced than upstream implementation

**Status:** ✅ Not needed — llxprt's Todo implementation already surpasses the skipped upstream feature.

### 8. Terminal Reconnect (Commit #117: `375b8522`)

**What it does:** Allows users to re-enter disconnected terminal sessions.

**Why it was skipped:** Architecture incompatibility with llxprt's AppWrapper (vs upstream's AppContainer).

**Current llxprt state:**
- Terminal sessions exist but no reconnection capability
- Would need porting to llxprt's UI architecture

**Status:** ⏳ Not started — will require follow-up after AppContainer migration stabilizes.

## Provider-Agnostic Design Proposals

### 1. Intelligent Model Selection System

**Concept:** A provider-agnostic "auto" model selection that chooses the appropriate model based on:
- Task complexity (simple queries vs complex code generation)
- Token limits and context window requirements
- Cost optimization preferences
- Response time requirements
- Provider capabilities

**Design:**
```typescript
interface ModelSelector {
  selectModel(context: TaskContext): Promise<ModelSelection>;
}

interface TaskContext {
  estimatedTokens: number;
  taskType: 'chat' | 'code' | 'analysis' | 'creative';
  requiresFunctionCalling: boolean;
  latencySensitive: boolean;
  costSensitive: boolean;
}

interface ModelSelection {
  provider: string;
  model: string;
  reason: string;
}
```

**Implementation approach:**
- Add model capability metadata to each provider
- Create scoring algorithm based on task requirements
- Allow user configuration of preferences (cost vs speed vs capability)
- Integrate with existing runtime settings system

### 2. Universal Extension Auto-Update System

**Concept:** Provider-agnostic extension update system that works for all extension types.

**Design:**
```typescript
interface ExtensionUpdateManager {
  checkForUpdates(): Promise<UpdateInfo[]>;
  applyUpdates(extensions: string[], strategy: UpdateStrategy): Promise<void>;
  configureAutoUpdate(settings: AutoUpdateSettings): void;
}

interface UpdateStrategy {
  type: 'immediate' | 'scheduled' | 'manual';
  confirmMajorVersions: boolean;
  backupBeforeUpdate: boolean;
}
```

**Implementation approach:**
- Leverage existing GitHub release detection
- Add version comparison logic
- Create update scheduling system
- Implement rollback capability
- Add update notifications to UI

### 3. Enhanced Permissions Management UI

**Concept:** Full-featured permissions dialog for managing trust settings across all contexts.

**Design:**
```typescript
interface PermissionsDialog {
  showTrustSettings(): void;
  modifyFolderTrust(path: string, level: TrustLevel): void;
  configureToolPermissions(tool: string, permission: Permission): void;
  exportTrustConfiguration(): TrustConfig;
  importTrustConfiguration(config: TrustConfig): void;
}
```

**Implementation approach:**
- Build on existing trust system
- Create interactive React component
- Add bulk operations (trust all in workspace)
- Implement trust inheritance rules
- Add visual trust indicators

### 4. Provider-Agnostic Policy Engine

**Concept:** Rule-based system for tool execution governance that works across all providers.

**Design:**
```typescript
interface PolicyEngine {
  evaluateToolCall(tool: ToolCall, context: ExecutionContext): PolicyDecision;
  loadPolicies(source: PolicySource): void;
  auditLog(): PolicyAuditLog[];
}

interface PolicyRule {
  pattern: string; // Tool name pattern
  conditions: Condition[];
  action: 'allow' | 'deny' | 'confirm';
  providers?: string[]; // Optional provider-specific rules
}
```

**Implementation approach:**
- Create TOML/YAML policy definition format
- Implement rule evaluation engine
- Add context-aware conditions (time, location, user)
- Integrate with existing tool confirmation flow
- Add policy testing/validation tools

### 5. Smart Model Router

**Concept:** Intelligent routing of requests to optimal provider/model combinations.

**Design:**
```typescript
interface ModelRouter {
  route(request: Request): Promise<RouteDecision>;
  addRoutingRule(rule: RoutingRule): void;
  getRoutingMetrics(): RoutingMetrics;
}

interface RoutingRule {
  condition: (request: Request) => boolean;
  targetProvider?: string;
  targetModel?: string;
  fallbackChain?: ModelSpec[];
}
```

**Implementation approach:**
- Pattern matching on request content
- Load balancing across providers
- Fallback chains for reliability
- Cost-aware routing
- Performance tracking and optimization

### 6. Session Persistence and Recovery

**Concept:** Provider-agnostic session management with reconnection capability.

**Design:**
```typescript
interface SessionManager {
  saveSession(id: string, state: SessionState): void;
  restoreSession(id: string): Promise<SessionState>;
  listSessions(): SessionInfo[];
  cleanupStaleSessions(): void;
}
```

**Implementation approach:**
- Serialize conversation state to disk
- Track terminal sessions and tool executions
- Implement reconnection protocol
- Handle provider switching in restored sessions
- Add session migration between providers

## Priority Assessment

### Tier 1 - High Impact, Low Complexity
1. **Enhanced Permissions Management UI** ⭐⭐⭐⭐⭐
   - High user demand
   - Builds on existing infrastructure
   - Improves security posture
   - Relatively straightforward implementation

2. **Intelligent Model Selection** ⭐⭐⭐⭐⭐
   - Significant UX improvement
   - Cost optimization benefits
   - Leverages existing provider architecture
   - Clear value proposition

### Tier 2 - High Impact, Medium Complexity
3. **Extension Auto-Update System** ⭐⭐⭐⭐
   - Improves maintenance workflow
   - Security benefits (timely updates)
   - Some architecture already exists
   - Moderate implementation effort

4. **Smart Model Router** ⭐⭐⭐⭐
   - Performance optimization
   - Cost savings
   - Reliability improvements
   - Requires metrics collection

### Tier 3 - Medium Impact, Higher Complexity
5. **Policy Engine** ⭐⭐⭐
   - Enterprise feature appeal
   - Complex implementation
   - Requires careful design
   - May have limited initial adoption

6. **Session Persistence** ⭐⭐⭐
   - Nice-to-have feature
   - Complex state management
   - Provider-specific challenges
   - Limited use cases

## Implementation Plans

### Plan 1: Intelligent Model Selection System

**Phase 1: Model Metadata (1 week)**
```typescript
// packages/core/src/providers/types.ts
interface ModelCapabilities {
  contextWindow: number;
  supportsFunctions: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  costPerMillion: { input: number; output: number };
  averageLatencyMs: number;
  strengthAreas: ('code' | 'chat' | 'analysis' | 'creative')[];
}

// Add to each provider implementation
class OpenAIProvider {
  getModelCapabilities(model: string): ModelCapabilities { ... }
}
```

**Phase 2: Selection Algorithm (1 week)**
```typescript
// packages/core/src/model-selection/ModelSelector.ts
export class ModelSelector {
  constructor(
    private providers: ProviderManager,
    private preferences: UserPreferences
  ) {}

  async selectModel(context: TaskContext): Promise<ModelSelection> {
    const candidates = await this.getCandidateModels();
    const scores = candidates.map(c => this.scoreModel(c, context));
    return this.pickBestModel(scores);
  }

  private scoreModel(model: ModelCandidate, context: TaskContext): number {
    let score = 0;

    // Context window fit
    if (model.capabilities.contextWindow >= context.estimatedTokens) {
      score += 20;
    }

    // Task type match
    if (model.capabilities.strengthAreas.includes(context.taskType)) {
      score += 30;
    }

    // Cost consideration
    if (context.costSensitive) {
      score += (100 - model.capabilities.costPerMillion.input) / 10;
    }

    // Latency consideration
    if (context.latencySensitive) {
      score += (1000 - model.capabilities.averageLatencyMs) / 100;
    }

    return score;
  }
}
```

**Phase 3: Integration (3 days)**
- Wire into Zed integration for 'auto' model support
- Add to CLI with `--auto-model` flag
- Create settings for user preferences
- Add telemetry for model selection decisions

**Phase 4: Testing (2 days)**
- Unit tests for selection algorithm
- Integration tests with multiple providers
- Performance benchmarking
- User acceptance testing

### Plan 2: Enhanced Permissions Management UI

**Phase 1: Dialog Component (1 week)**
```typescript
// packages/cli/src/ui/components/PermissionsDialog.tsx
export const PermissionsDialog: React.FC = () => {
  const [trustSettings, setTrustSettings] = useState<TrustSettings>();
  const [selectedPath, setSelectedPath] = useState<string>();

  return (
    <Box flexDirection="column">
      <Text bold>Trust Settings Management</Text>
      <SelectInput
        items={['Folder Trust', 'Tool Permissions', 'Provider Access']}
        onSelect={handleCategorySelect}
      />
      {selectedCategory === 'Folder Trust' && (
        <FolderTrustManager
          settings={trustSettings.folders}
          onUpdate={handleFolderTrustUpdate}
        />
      )}
      {/* Additional UI components */}
    </Box>
  );
};
```

**Phase 2: Trust Management Logic (3 days)**
```typescript
// packages/cli/src/services/TrustManager.ts
export class TrustManager {
  async getFolderTrust(path: string): Promise<TrustLevel> { ... }
  async setFolderTrust(path: string, level: TrustLevel): Promise<void> { ... }
  async getToolPermissions(tool: string): Promise<Permission> { ... }
  async setToolPermission(tool: string, permission: Permission): Promise<void> { ... }
  async exportConfiguration(): Promise<string> { ... }
  async importConfiguration(config: string): Promise<void> { ... }
}
```

**Phase 3: Integration (2 days)**
- Connect to existing `/permissions` command
- Update trust state management
- Add real-time trust updates
- Implement persistence

**Phase 4: Testing (2 days)**
- Component testing with React Testing Library
- Trust rule evaluation tests
- Import/export functionality tests
- Security boundary tests

### Plan 3: Extension Auto-Update System

**Phase 1: Update Detection (1 week)**
```typescript
// packages/cli/src/services/ExtensionUpdateService.ts
export class ExtensionUpdateService {
  async checkForUpdates(): Promise<UpdateInfo[]> {
    const installed = await this.getInstalledExtensions();
    const updates = [];

    for (const ext of installed) {
      const latest = await this.getLatestVersion(ext);
      if (this.isUpdateAvailable(ext.version, latest.version)) {
        updates.push({
          extension: ext,
          currentVersion: ext.version,
          latestVersion: latest.version,
          changeLog: latest.changeLog
        });
      }
    }

    return updates;
  }
}
```

**Phase 2: Update Application (1 week)**
```typescript
// packages/cli/src/services/ExtensionUpdater.ts
export class ExtensionUpdater {
  async applyUpdate(
    extension: Extension,
    newVersion: string,
    options: UpdateOptions
  ): Promise<void> {
    // Backup current version
    if (options.backup) {
      await this.backupExtension(extension);
    }

    // Download new version
    const artifact = await this.downloadVersion(extension.source, newVersion);

    // Install new version
    await this.installExtension(artifact);

    // Verify installation
    await this.verifyUpdate(extension, newVersion);
  }
}
```

**Phase 3: Scheduling & Automation (3 days)**
- Cron-like scheduling system
- Background update checks
- User notification system
- Update strategy configuration

**Phase 4: Testing (3 days)**
- Mock update scenarios
- Rollback testing
- Concurrent update handling
- Network failure recovery

## Success Metrics

### Quantitative Metrics
- **Model Selection**: 30% reduction in average response time, 20% cost savings
- **Permissions UI**: 50% reduction in trust-related support queries
- **Auto-Update**: 80% of extensions updated within 48 hours of release
- **Model Router**: 25% improvement in request success rate

### Qualitative Metrics
- User satisfaction scores
- Developer productivity improvements
- Reduced cognitive load for model selection
- Improved security posture

## Risk Mitigation

### Technical Risks
1. **Provider API Changes**: Abstract provider interfaces, version pinning
2. **State Management Complexity**: Incremental implementation, thorough testing
3. **Performance Impact**: Caching strategies, lazy loading
4. **Breaking Changes**: Feature flags, gradual rollout

### User Experience Risks
1. **Automation Confusion**: Clear opt-in/opt-out, transparency in decisions
2. **Loss of Control**: Manual overrides always available
3. **Update Fatigue**: Batching, scheduling, silent updates for patches

## Conclusion

The provider-agnostic features identified in this analysis would significantly enhance llxprt's value proposition as a multi-provider AI assistant. The top priorities—Intelligent Model Selection and Enhanced Permissions Management—offer immediate user value with reasonable implementation effort.

These features differentiate llxprt from single-provider solutions by leveraging its unique multi-provider architecture to deliver capabilities that aren't possible in isolated ecosystems. The implementation plans provide a clear path forward with manageable phases and testable outcomes.

## Next Steps

1. **Stakeholder Review**: Share this document for feedback on priorities
2. **Prototype Development**: Build proof-of-concept for top 2 features
3. **User Research**: Validate assumptions with user interviews
4. **Technical Spike**: Investigate any architectural blockers
5. **Roadmap Integration**: Add selected features to product roadmap
