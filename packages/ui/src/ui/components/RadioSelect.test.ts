import { describe, expect, it } from 'vitest';
import type { RadioSelectOption, RadioSelectProps } from './RadioSelect';
import type { ThemeDefinition } from '../../features/theme';

describe('RadioSelect', () => {
  const mockTheme: ThemeDefinition = {
    slug: 'test',
    name: 'Test Theme',
    kind: 'dark',
    colors: {
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
      accent: {
        primary: '#00ffff',
      },
      diff: {
        addedBg: '#003300',
        addedFg: '#00ff00',
        removedBg: '#330000',
        removedFg: '#ff0000',
      },
    },
  };

  describe('RadioSelectOption type', () => {
    it('accepts required properties', () => {
      const option: RadioSelectOption<string> = {
        label: 'Option 1',
        value: 'opt1',
        key: 'opt1',
      };
      expect(option.label).toBe('Option 1');
      expect(option.value).toBe('opt1');
      expect(option.key).toBe('opt1');
    });

    it('works with different value types', () => {
      const stringOption: RadioSelectOption<string> = {
        label: 'String Option',
        value: 'string_value',
        key: 'str',
      };
      expect(stringOption.value).toBe('string_value');

      const numberOption: RadioSelectOption<number> = {
        label: 'Number Option',
        value: 42,
        key: 'num',
      };
      expect(numberOption.value).toBe(42);

      type CustomType = 'allow_once' | 'allow_always' | 'cancel';
      const unionOption: RadioSelectOption<CustomType> = {
        label: 'Union Option',
        value: 'allow_once',
        key: 'union',
      };
      expect(unionOption.value).toBe('allow_once');
    });
  });

  describe('RadioSelectProps type', () => {
    it('accepts required props', () => {
      const options: RadioSelectOption<string>[] = [
        { label: 'Option 1', value: 'opt1', key: 'opt1' },
        { label: 'Option 2', value: 'opt2', key: 'opt2' },
      ];

      const props: RadioSelectProps<string> = {
        options,
        onSelect: () => {},
      };

      expect(props.options).toHaveLength(2);
      expect(typeof props.onSelect).toBe('function');
    });

    it('accepts optional theme prop', () => {
      const props: RadioSelectProps<string> = {
        options: [{ label: 'Test', value: 'test', key: 'test' }],
        onSelect: () => {},
        theme: mockTheme,
      };

      expect(props.theme).toBe(mockTheme);
    });

    it('accepts optional isFocused prop', () => {
      const props: RadioSelectProps<string> = {
        options: [{ label: 'Test', value: 'test', key: 'test' }],
        onSelect: () => {},
        isFocused: false,
      };

      expect(props.isFocused).toBe(false);
    });

    it('accepts optional initialIndex prop', () => {
      const props: RadioSelectProps<string> = {
        options: [
          { label: 'Option 1', value: 'opt1', key: 'opt1' },
          { label: 'Option 2', value: 'opt2', key: 'opt2' },
        ],
        onSelect: () => {},
        initialIndex: 1,
      };

      expect(props.initialIndex).toBe(1);
    });
  });
});
