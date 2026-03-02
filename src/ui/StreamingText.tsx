import React from 'react';
import { Text } from 'ink';

interface StreamingTextProps {
  text: string;
}

export function StreamingText({ text }: StreamingTextProps) {
  return (
    <Text color="green">{text}{'▌'}</Text>
  );
}
