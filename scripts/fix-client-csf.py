import pathlib

# ============================================
# 1. Fix client.ts: revert to Config, use getter
# ============================================
f = pathlib.Path('packages/agents/src/core/client.ts')
c = f.read_text()

# Remove the ClientConfigSurface type definition
old_type = """
/** Narrow config surface for the agent client. */
type ClientConfigSurface = ModelSelection &
  SessionIdentity & {
    getToolRegistry(): import('@vybestack/llxprt-code-tools').ToolRegistry;
  };

"""
c = c.replace(old_type, '')

# Revert field type to Config
c = c.replace(
    'private readonly config: ClientConfigSurface,',
    'private readonly config: Config,'
)

# Add getter inside the class (after the config field declaration)
field_line = '  private readonly config: Config,'
# The config is a constructor parameter, so add getter as a separate field
# Find the constructor and add after it
# Actually, let me add the type def and getter before the class
class_marker = '\nexport class '
type_and_getter = """
/** Narrow config surface for agent client member reads. */
type ClientConfigSurface = ModelSelection &
  SessionIdentity & {
    getToolRegistry: Config['getToolRegistry'];
  };

"""
if class_marker in c:
    c = c.replace(class_marker, type_and_getter + class_marker, 1)

# Replace member reads: this.config.MEMBER → (this.config as ClientConfigSurface).MEMBER
# Actually, add a getter-like approach using a local variable pattern
# Since this.config is a constructor parameter, let's use inline casts for member reads
for member in ['getContentGeneratorConfig', 'getModel', 'getSessionId', 'getToolRegistry']:
    c = c.replace(f'this.config.{member}', f'(this.config as ClientConfigSurface).{member}')

f.write_text(c)
print("client: reverted to Config + inline casts")

# ============================================
# 2. Fix ChatSessionFactory.ts: fix helper return types, import
# ============================================
f2 = pathlib.Path('packages/agents/src/core/ChatSessionFactory.ts')
c2 = f2.read_text()

# Fix getSettingsService return type in helper
c2 = c2.replace(
    'getSettingsService(): unknown;',
    'getSettingsService: Config[\'getSettingsService\'];'
)

# Add RuntimeProviderManager import if missing
if 'RuntimeProviderManager' not in c2.split('function asConfigView')[0].count('RuntimeProviderManager'):
    # Check existing imports
    if "import type { RuntimeProviderManager }" not in c2:
        # Add after Config import
        config_imp = "import type { Config } from '@vybestack/llxprt-code-core/config/config.js';"
        if config_imp in c2:
            c2 = c2.replace(
                config_imp,
                config_imp + "\nimport type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';"
            )

f2.write_text(c2)
print("ChatSessionFactory: fixed helper types + import")
