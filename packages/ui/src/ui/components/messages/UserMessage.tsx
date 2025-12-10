import type { JSX } from 'react';
import type { UserMessageProps } from './types';
import { EmptyBorder } from './types';

export function UserMessage(props: Readonly<UserMessageProps>): JSX.Element {
  return (
    <box
      key={props.id}
      border={['left']}
      borderColor={props.theme.colors.message.userBorder}
      customBorderChars={{
        ...EmptyBorder,
        vertical: '┃',
        bottomLeft: '╹',
        topLeft: '╻',
      }}
      style={{ paddingLeft: 1, marginBottom: 1 }}
    >
      <text fg={props.theme.colors.text.user}>{props.text}</text>
    </box>
  );
}

UserMessage.displayName = 'UserMessage';
