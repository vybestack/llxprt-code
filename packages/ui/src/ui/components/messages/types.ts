import type React from 'react';
import type { ThemeDefinition } from '../../../features/theme';

export type MessageRole = 'user' | 'model' | 'system' | 'thinking';

export interface MessageProps {
  readonly id: string;
  readonly text: string;
  readonly theme: ThemeDefinition;
}

export type UserMessageProps = MessageProps;

export type SystemMessageProps = MessageProps;

export interface ModelMessageProps extends MessageProps {
  readonly profileName?: string;
}

export type ThinkingMessageProps = MessageProps;

export type MessageComponent = ((props: MessageProps) => React.ReactNode) & {
  displayName?: string;
};

export const EmptyBorder = {
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: ' ',
  bottomRight: ' ',
  horizontal: ' ',
  vertical: ' ',
  topT: ' ',
  bottomT: ' ',
  leftT: ' ',
  rightT: ' ',
  cross: ' ',
};
