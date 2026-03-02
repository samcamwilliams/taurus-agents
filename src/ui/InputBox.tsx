import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputBoxProps {
  onSubmit: (input: string) => void;
}

export function InputBox({ onSubmit }: InputBoxProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      setValue('');
      return;
    }
    if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
      return;
    }
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }
    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue(prev => prev + input);
    }
  });

  return (
    <Box>
      <Text color="cyan" bold>{'taurus > '}</Text>
      <Text>{value}</Text>
      <Text color="gray">{'█'}</Text>
    </Box>
  );
}
