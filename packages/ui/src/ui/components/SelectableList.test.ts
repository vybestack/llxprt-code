import { describe, expect, it } from 'vitest';
import type { SelectableListItemProps } from './SelectableList';
import type { ThemeDefinition } from '../../features/theme';

describe('SelectableListItem', () => {
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

  it('accepts required props without optional fields', () => {
    const props: SelectableListItemProps = {
      label: 'Test Item',
      isSelected: true,
      theme: mockTheme,
    };
    expect(props.label).toBe('Test Item');
    expect(props.isSelected).toBe(true);
  });

  it('accepts optional isActive prop', () => {
    const props: SelectableListItemProps = {
      label: 'Test Item',
      isSelected: false,
      isActive: true,
      theme: mockTheme,
    };
    expect(props.isActive).toBe(true);
  });

  it('accepts optional activeTag prop', () => {
    const props: SelectableListItemProps = {
      label: 'Test Item',
      isSelected: false,
      activeTag: ' (active)',
      theme: mockTheme,
    };
    expect(props.activeTag).toBe(' (active)');
  });
});
