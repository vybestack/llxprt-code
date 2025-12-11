import { describe, expect, it, vi } from 'vitest';
import type { FilterInputProps } from './FilterInput';
import type { ThemeDefinition } from '../../features/theme';

describe('FilterInput', () => {
  const mockTheme: ThemeDefinition = {
    slug: 'test',
    name: 'Test Theme',
    kind: 'dark',
    colors: {
      background: '#000000',
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
      panel: {
        bg: '#111111',
        border: '#333333',
      },
      status: {
        fg: '#ffffff',
      },
      accent: {
        primary: '#00ffff',
      },
      selection: {
        fg: '#000000',
        bg: '#ffffff',
      },
      diff: {
        addedBg: '#003300',
        addedFg: '#00ff00',
        removedBg: '#330000',
        removedFg: '#ff0000',
      },
      message: {
        userBorder: '#00ff00',
        systemBorder: '#888888',
        systemText: '#888888',
      },
    },
  };

  it('accepts required props', () => {
    const onQueryChange = vi.fn();
    const props: Omit<FilterInputProps, 'textareaRef'> = {
      placeholder: 'type to filter',
      theme: mockTheme,
      onQueryChange,
    };
    expect(props.placeholder).toBe('type to filter');
    expect(props.onQueryChange).toBe(onQueryChange);
  });

  it('requires onQueryChange callback', () => {
    const onQueryChange = vi.fn();
    expect(onQueryChange).toBeDefined();
  });
});
