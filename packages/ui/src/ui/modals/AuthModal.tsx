import { useKeyboard } from '@opentui/react';
import { useCallback, useState, type JSX } from 'react';
import { useListNavigation } from '../../hooks/useListNavigation';
import { ModalShell } from './ModalShell';
import type { ThemeDefinition } from '../../features/theme';
import { SelectableListItem } from '../components/SelectableList';

export interface AuthOption {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
}

export function AuthModal(props: {
  readonly options: AuthOption[];
  readonly onClose: () => void;
  readonly onSave: (next: AuthOption[]) => void;
  readonly theme?: ThemeDefinition;
}): JSX.Element {
  const [options, setOptions] = useState<AuthOption[]>(props.options);
  const { selectedIndex, moveSelection } = useListNavigation(options.length);

  const closeWithSave = useCallback((): void => {
    props.onSave(options);
    props.onClose();
  }, [options, props]);

  useKeyboard((key) => {
    if (key.eventType !== 'press') {
      return;
    }
    if (key.name === 'escape') {
      closeWithSave();
      return;
    }
    if (key.name === 'up') {
      key.preventDefault();
      moveSelection(-1);
    } else if (key.name === 'down') {
      key.preventDefault();
      moveSelection(1);
    } else if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault();
      const current = options[selectedIndex];
      if (!current) {
        return;
      }
      if (current.id === 'close') {
        closeWithSave();
        return;
      }
      setOptions((prev) =>
        prev.map((opt, optIndex) =>
          optIndex === selectedIndex ? { ...opt, enabled: !opt.enabled } : opt,
        ),
      );
    }
  });

  return (
    <ModalShell
      title="OAuth Authentication"
      onClose={closeWithSave}
      theme={props.theme}
    >
      <text fg={props.theme?.colors.text.primary}>
        Select an OAuth provider to authenticate:
      </text>
      <text fg={props.theme?.colors.text.muted}>
        Note: You can also use API keys via /key, /keyfile, --key, --keyfile, or
        environment variables
      </text>
      <box flexDirection="column" style={{ gap: 0 }}>
        {renderAuthOptions(options, selectedIndex, props.theme)}
      </box>
      <text fg={props.theme?.colors.text.muted}>
        (Use Enter to select, ESC to close)
      </text>
      <text fg={props.theme?.colors.text.primary}>
        Terms of Services and Privacy Notice for Gemini CLI
      </text>
      <text fg={props.theme?.colors.text.muted}>
        https://github.com/acoliver/llxprt-code/blob/main/docs/tos-privacy.md
      </text>
    </ModalShell>
  );
}

function renderAuthOptions(
  options: AuthOption[],
  selectedIndex: number,
  theme?: ThemeDefinition,
): JSX.Element[] {
  return options.map((opt, optIndex): JSX.Element => {
    const isSelected = optIndex === selectedIndex;
    const label = `${optIndex + 1}. ${opt.label} [${opt.enabled ? 'ON' : 'OFF'}]`;
    return (
      <SelectableListItem
        key={opt.id}
        label={label}
        isSelected={isSelected}
        theme={theme}
      />
    );
  });
}
