interface SlashNode {
  name: string;
  description: string;
  children?: SlashNode[];
}

let themeNodes: SlashNode[] = [];
let profileNodes: SlashNode[] = [];

export function setThemeSuggestions(
  themes: { slug: string; name: string }[],
): void {
  themeNodes = themes.map((theme) => ({
    name: theme.slug,
    description: theme.name,
  }));
}

export function setProfileSuggestions(profileNames: string[]): void {
  profileNodes = profileNames.map((name) => ({
    name,
    description: `Profile: ${name}`,
  }));
}

const SLASH_COMMANDS: SlashNode[] = [
  { name: 'about', description: 'show version info' },
  {
    name: 'auth',
    description:
      'Open auth dialog or toggle OAuth enablement for providers (gemini, qwen, anthropic)',
  },
  { name: 'bug', description: 'submit a bug report' },
  { name: 'chat', description: 'Manage conversation checkpoints' },
  { name: 'clear', description: 'clear the screen and conversation history' },
  {
    name: 'compress',
    description: 'Compresses the context by replacing it with a summary.',
  },
  {
    name: 'copy',
    description: 'Copy the last result or code snippet to clipboard',
  },
  {
    name: 'docs',
    description: 'open full LLxprt Code documentation in your browser',
  },
  { name: 'directory', description: 'Manage workspace directories' },
  { name: 'editor', description: 'set external editor preference' },
  { name: 'extensions', description: 'Manage extensions' },
  { name: 'help', description: 'for help on LLxprt Code' },
  { name: 'ide', description: 'manage IDE integration' },
  {
    name: 'init',
    description: 'Analyzes the project and creates a tailored LLXPRT.md file.',
  },
  { name: 'model', description: 'Set the model id for the current provider' },
  {
    name: 'mcp',
    description:
      'list configured MCP servers and tools, or authenticate with OAuth-enabled servers',
  },
  { name: 'memory', description: 'Commands for interacting with memory.' },
  {
    name: 'privacy',
    description: 'view Gemini API privacy disclosure and terms',
  },
  { name: 'logging', description: 'manage conversation logging settings' },
  {
    name: 'provider',
    description: 'Set the provider (openai | gemini | anthropic)',
  },
  { name: 'baseurl', description: 'Set the provider base URL' },
  { name: 'key', description: 'Set the API key' },
  { name: 'keyfile', description: 'Set the API keyfile path' },
  {
    name: 'profile',
    description: 'Load a profile',
    children: [
      {
        name: 'load',
        description: 'Load a profile by name',
        children: profileNodes,
      },
    ],
  },
  { name: 'quit', description: 'exit the cli' },
  {
    name: 'stats',
    description: 'check session stats. Usage: /stats [model|tools|cache]',
    children: [
      { name: 'model', description: 'Show model-specific usage statistics.' },
      { name: 'tools', description: 'Show tool-specific usage statistics.' },
      {
        name: 'cache',
        description: 'Show cache usage statistics (Anthropic only).',
      },
    ],
  },
  { name: 'theme', description: 'change the theme' },
  { name: 'tools', description: 'List, enable, or disable Gemini CLI tools' },
  { name: 'settings', description: 'View and edit LLxprt Code settings' },
  { name: 'vim', description: 'toggle vim mode on/off' },
  {
    name: 'set',
    description: 'Set an option',
    children: [
      { name: 'unset', description: 'Unset option' },
      { name: 'modelparam', description: 'Model parameter option' },
      {
        name: 'emojifilter',
        description: 'Emoji filter option',
        children: [
          { name: 'allowed', description: 'Allow all emojis' },
          {
            name: 'auto',
            description: 'Automatically filter inappropriate emojis',
          },
          { name: 'warn', description: 'Warn about filtered emojis' },
          { name: 'error', description: 'Error on filtered emojis' },
        ],
      },
      { name: 'context-limit', description: 'Context Limit option' },
      {
        name: 'compression-threshold',
        description: 'Compression Threshold option',
      },
      { name: 'base-url', description: 'Base Url option' },
      { name: 'api-version', description: 'Api Version option' },
      { name: 'streaming', description: 'Streaming option' },
    ],
  },
];

export interface SlashSuggestion {
  value: string;
  description: string;
  fullPath: string;
  hasChildren: boolean;
}

export function getSlashSuggestions(
  parts: string[],
  limit: number,
): SlashSuggestion[] {
  const prefixParts = parts.slice(0, Math.max(parts.length - 1, 0));
  const query = parts[parts.length - 1] ?? '';
  const nodeList = resolvePath(prefixParts);

  if (nodeList.length === 0) {
    return [];
  }

  const normalized = query.toLowerCase();

  const suggestions = nodeList
    .filter((node) => node.name.toLowerCase().startsWith(normalized))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(normalized);
      const bStarts = b.name.toLowerCase().startsWith(normalized);
      if (aStarts !== bStarts) {
        return aStarts ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((node) => ({
      value: node.name,
      description: node.description,
      fullPath: buildFullPath(parts, node.name),
      hasChildren: Boolean(node.children?.length),
    }));

  return suggestions;
}

export function extractSlashContext(
  input: string,
  cursorOffset: number,
): { parts: string[]; start: number; end: number } | null {
  const safeOffset = Math.min(Math.max(cursorOffset, 0), input.length);
  const upToCursor = input.slice(0, safeOffset);
  const slashIndex = upToCursor.lastIndexOf('/');

  if (slashIndex === -1) {
    return null;
  }

  if (slashIndex > 0 && /\S/.test(upToCursor[slashIndex - 1] ?? '')) {
    return null;
  }

  let end = safeOffset;
  while (end < input.length) {
    const char = input[end] ?? '';
    if (char === '\n') {
      break;
    }
    if (char.trim() === '') {
      break;
    }
    end += 1;
  }

  const token = input.slice(slashIndex + 1, end);
  const parts = token.length === 0 ? [] : token.split(/\s+/);

  return { parts, start: slashIndex, end };
}

function resolvePath(parts: string[]): SlashNode[] {
  if (parts.length === 0) {
    return SLASH_COMMANDS;
  }
  if (parts.length >= 1 && parts[0] === 'theme') {
    return parts.length === 1 ? themeNodes : [];
  }
  if (parts.length === 1 && parts[0] === 'profile') {
    return [
      {
        name: 'load',
        description: 'Load a profile by name',
        children: profileNodes,
      },
    ];
  }
  if (parts.length === 2 && parts[0] === 'profile' && parts[1] === 'load') {
    return profileNodes;
  }
  let current: SlashNode[] = SLASH_COMMANDS;
  for (const part of parts) {
    const node = current.find((n) => n.name === part);
    if (!node?.children) {
      return [];
    }
    current = node.children;
  }
  return current;
}

function buildFullPath(parts: string[], next: string): string {
  const existing = [...parts];
  if (existing.length === 0) {
    return `/${next}`;
  }
  const pathParts = [...existing.slice(0, -1), next];
  return `/${pathParts.join(' ')}`;
}
