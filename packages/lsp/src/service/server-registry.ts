/* @plan PLAN-20250212-LSP.P15 */
/* @pseudocode project-plans/issue438/pseudocode.md#phase-p15-server-registry-implementation */

export interface ServerRegistryEntry {
  id: string;
  displayName: string;
  extensions: readonly string[];
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  workspaceRootMarkers?: readonly string[];
  initializationOptions?: Readonly<Record<string, unknown>>;
  detectCommand?: string;
}

export interface ServerRegistry {
  readonly builtins: readonly ServerRegistryEntry[];
  getServersForExtension(ext: string): readonly ServerRegistryEntry[];
  mergeUserConfig(
    userConfig?: readonly ServerRegistryEntry[],
  ): readonly ServerRegistryEntry[];
}

const BUILTIN_SERVERS: readonly ServerRegistryEntry[] = [
  {
    id: 'eslint',
    displayName: 'ESLint',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    command: 'vscode-eslint-language-server',
    args: ['--stdio'],
  },
  {
    id: 'gopls',
    displayName: 'Go Language Server',
    extensions: ['.go'],
    command: 'gopls',
  },
  {
    id: 'python',
    displayName: 'Python Language Server',
    extensions: ['.py'],
    command: 'pylsp',
  },
  {
    id: 'rust',
    displayName: 'Rust Analyzer',
    extensions: ['.rs'],
    command: 'rust-analyzer',
  },
  {
    id: 'ts',
    displayName: 'TypeScript Language Server',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
];

const cloneEntry = (entry: ServerRegistryEntry): ServerRegistryEntry => ({
  ...entry,
  extensions: [...entry.extensions],
  args: entry.args ? [...entry.args] : undefined,
  env: entry.env ? { ...entry.env } : undefined,
  workspaceRootMarkers: entry.workspaceRootMarkers
    ? [...entry.workspaceRootMarkers]
    : undefined,
  initializationOptions: entry.initializationOptions
    ? { ...entry.initializationOptions }
    : undefined,
});

const normalizeExtension = (ext: string): string => {
  if (ext.length === 0) {
    return ext;
  }

  return ext.startsWith('.') ? ext : `.${ext}`;
};

export const mergeUserConfig = (
  builtins: readonly ServerRegistryEntry[],
  userConfig?: readonly ServerRegistryEntry[],
): ServerRegistryEntry[] => {
  if (!userConfig || userConfig.length === 0) {
    return builtins.map(cloneEntry);
  }

  const merged = new Map<string, ServerRegistryEntry>();
  for (const builtin of builtins) {
    merged.set(builtin.id, cloneEntry(builtin));
  }

  for (const userEntry of userConfig) {
    if (userEntry.command === '') {
      merged.delete(userEntry.id);
      continue;
    }

    merged.set(userEntry.id, cloneEntry(userEntry));
  }

  return [...merged.values()];
};

export const getBuiltinServers = (): readonly ServerRegistryEntry[] =>
  BUILTIN_SERVERS.map(cloneEntry);

export const getServersForExtension = (
  ext: string,
  userConfig?: readonly ServerRegistryEntry[],
): ServerRegistryEntry[] => {
  const normalized = normalizeExtension(ext);
  const servers = mergeUserConfig(getBuiltinServers(), userConfig);

  return servers.filter((server) => server.extensions.includes(normalized));
};

export const createServerRegistry = (
  builtins: readonly ServerRegistryEntry[] = getBuiltinServers(),
): ServerRegistry => ({
  builtins,
  getServersForExtension: (ext: string) =>
    getServersForExtension(ext, builtins),
  mergeUserConfig: (userConfig?: readonly ServerRegistryEntry[]) =>
    mergeUserConfig(builtins, userConfig),
});
