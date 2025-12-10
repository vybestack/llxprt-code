import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { useCommand } from '../uicontext';
import { ThemeModal } from '../ui/modals';
import type { ThemeDefinition } from '../features/theme';

interface ThemeCommandProps {
  readonly themes: ThemeDefinition[];
  readonly currentTheme: ThemeDefinition;
  readonly onThemeSelect: (theme: ThemeDefinition) => void;
  readonly appendMessage: (
    role: 'user' | 'model' | 'system',
    text: string,
  ) => string;
  readonly focusInput: () => void;
}

export function ThemeCommand({
  themes,
  currentTheme,
  onThemeSelect,
  appendMessage,
  focusInput,
}: ThemeCommandProps): JSX.Element | null {
  const { register } = useCommand();
  const dialogClearRef = useRef<(() => void) | null>(null);

  const handleClose = useCallback((): void => {
    if (dialogClearRef.current !== null) {
      dialogClearRef.current();
    }
    focusInput();
  }, [focusInput]);

  const handleSelect = useCallback(
    (theme: ThemeDefinition): void => {
      onThemeSelect(theme);
      appendMessage('system', `Theme set to ${theme.name}`);
    },
    [onThemeSelect, appendMessage],
  );

  const modal = useMemo(
    () => (
      <ThemeModal
        themes={themes}
        current={currentTheme}
        onClose={handleClose}
        onSelect={handleSelect}
      />
    ),
    [themes, currentTheme, handleClose, handleSelect],
  );

  useEffect(() => {
    const cleanup = register([
      {
        name: '/theme',
        title: 'Select Theme',
        category: 'appearance',
        onExecute: (dialog) => {
          dialogClearRef.current = dialog.clear;
          dialog.replace(modal);
        },
      },
    ]);

    return cleanup;
  }, [register, modal]);

  return null;
}
