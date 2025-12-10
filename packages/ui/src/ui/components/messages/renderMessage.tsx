import type { JSX } from 'react';
import type { ThemeDefinition } from '../../../features/theme';
import type { MessageRole, MessageComponent } from './types';
import { UserMessage } from './UserMessage';
import { SystemMessage } from './SystemMessage';
import { ModelMessage } from './ModelMessage';
import { ThinkingMessage } from './ThinkingMessage';

export function getMessageRenderer(role: MessageRole): MessageComponent {
  switch (role) {
    case 'user':
      return UserMessage;
    case 'system':
      return SystemMessage;
    case 'model':
      return ModelMessage;
    case 'thinking':
      return ThinkingMessage;
  }
}

export function roleColor(role: MessageRole, theme: ThemeDefinition): string {
  switch (role) {
    case 'user':
      return theme.colors.text.user;
    case 'model':
      return theme.colors.text.responder;
    case 'system':
      return theme.colors.message.systemText;
    case 'thinking':
      return theme.colors.text.thinking;
  }
}

export function renderMessage(
  role: MessageRole,
  id: string,
  text: string,
  theme: ThemeDefinition,
): JSX.Element {
  const MessageComponent = getMessageRenderer(role);
  return <MessageComponent id={id} text={text} theme={theme} />;
}
