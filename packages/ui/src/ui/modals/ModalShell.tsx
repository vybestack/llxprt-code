import { useKeyboard } from '@opentui/react';
import type { JSX } from 'react';
import type { ThemeDefinition } from '../../features/theme';

export interface ModalShellProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly width?: number | string;
  readonly onClose: () => void;
  readonly children: JSX.Element | JSX.Element[];
  readonly footer?: JSX.Element;
  readonly theme?: ThemeDefinition;
}

export function ModalShell(props: ModalShellProps): JSX.Element {
  useKeyboard((key) => {
    if (key.name === 'escape') {
      key.preventDefault();
      props.onClose();
    }
  });

  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        padding: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: undefined,
      }}
    >
      <box
        border
        style={{
          width: props.width ?? '95%',
          maxWidth: props.width ?? '95%',
          padding: 1,
          borderColor: props.theme?.colors.panel.border,
          backgroundColor: props.theme?.colors.panel.bg,
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <text fg={props.theme?.colors.text.primary}>{props.title}</text>
        {props.subtitle ? (
          <text fg={props.theme?.colors.text.muted}>{props.subtitle}</text>
        ) : null}
        <box flexDirection="column" style={{ gap: 1, flexGrow: 1 }}>
          {props.children}
        </box>
        {props.footer ?? null}
      </box>
    </box>
  );
}
