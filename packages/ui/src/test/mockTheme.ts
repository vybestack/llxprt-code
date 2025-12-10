import type { ThemeDefinition } from '../features/theme';

export function createMockTheme(): ThemeDefinition {
  return {
    slug: 'test',
    name: 'Test Theme',
    kind: 'dark',
    colors: {
      background: '#000000',
      panel: {
        bg: '#111111',
        border: '#333333',
      },
      text: {
        primary: '#ffffff',
        muted: '#888888',
        user: '#00ff00',
        responder: '#0088ff',
        thinking: '#ff8800',
        tool: '#ff00ff',
      },
      input: {
        fg: '#ffffff',
        bg: '#000000',
        border: '#333333',
        placeholder: '#666666',
      },
      status: {
        fg: '#ffffff',
      },
      accent: {
        primary: '#00ffff',
      },
      diff: {
        addedBg: '#003300',
        addedFg: '#00ff00',
        removedBg: '#330000',
        removedFg: '#ff0000',
      },
      selection: {
        fg: '#000000',
        bg: '#ffffff',
      },
      message: {
        userBorder: '#00ff00',
        systemBorder: '#ffff00',
        systemText: '#ffff00',
      },
    },
  };
}
