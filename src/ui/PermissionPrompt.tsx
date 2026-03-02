import React from 'react';
import { Box, Text, useInput } from 'ink';

interface PermissionPromptProps {
  toolName: string;
  input: any;
  onResponse: (approved: boolean) => void;
}

export function PermissionPrompt({ toolName, input, onResponse }: PermissionPromptProps) {
  useInput((char) => {
    if (char === 'y' || char === 'Y') {
      onResponse(true);
    } else if (char === 'n' || char === 'N') {
      onResponse(false);
    }
  });

  const inputPreview = typeof input === 'string'
    ? input.slice(0, 200)
    : JSON.stringify(input, null, 2).slice(0, 200);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>Allow {toolName}?</Text>
      <Box marginLeft={1}>
        <Text dimColor>{inputPreview}</Text>
      </Box>
      <Text>
        <Text color="green" bold>[Y]</Text>
        <Text>es  </Text>
        <Text color="red" bold>[N]</Text>
        <Text>o</Text>
      </Text>
    </Box>
  );
}
