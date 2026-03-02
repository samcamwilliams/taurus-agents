import React from 'react';
import { Box, Text } from 'ink';

interface ToolCallViewProps {
  name: string;
  output: string;
  isError?: boolean;
}

export function ToolCallView({ name, output, isError }: ToolCallViewProps) {
  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text>
        <Text color={isError ? 'red' : 'yellow'} bold>
          {isError ? '✗' : '✓'} {name}
        </Text>
      </Text>
      {output && (
        <Box marginLeft={2}>
          <Text dimColor>{output}</Text>
        </Box>
      )}
    </Box>
  );
}
