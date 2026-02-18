import React from 'react';
import type { ModelMessageProps } from './types';

export function ModelMessage(
  props: Readonly<ModelMessageProps>,
): React.ReactNode {
  return (
    <box key={props.id}>
      {props.profileName !== undefined && props.profileName !== '' && (
        <text fg={props.theme.colors.text.muted}>[{props.profileName}]</text>
      )}
      <text fg={props.theme.colors.text.responder}>{props.text}</text>
    </box>
  );
}

ModelMessage.displayName = 'ModelMessage';
