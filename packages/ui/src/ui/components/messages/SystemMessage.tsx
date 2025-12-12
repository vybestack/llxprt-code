import React from 'react';
import type { SystemMessageProps } from './types';
import { EmptyBorder } from './types';

export function SystemMessage(
  props: Readonly<SystemMessageProps>,
): React.ReactNode {
  const bgColor = props.theme.colors.message.systemBg;
  return (
    <box
      key={props.id}
      border={['left']}
      borderColor={props.theme.colors.message.systemBorder}
      customBorderChars={{
        ...EmptyBorder,
        vertical: '│',
        bottomLeft: '╵',
        topLeft: '╷',
      }}
      style={{ paddingLeft: 1, marginBottom: 1, backgroundColor: bgColor }}
    >
      <text fg={props.theme.colors.message.systemText} bg={bgColor}>
        {props.text}
      </text>
    </box>
  );
}

SystemMessage.displayName = 'SystemMessage';
