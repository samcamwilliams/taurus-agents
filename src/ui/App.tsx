import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, Static, useApp } from 'ink';
import { InputBox } from './InputBox.js';
import { StreamingText } from './StreamingText.js';
import { ToolCallView } from './ToolCallView.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import type { CodingAgent } from '../agents/coding-agent.js';
import type { StreamEvent, ToolResult } from '../core/types.js';

type AppState = 'idle' | 'streaming' | 'tool_running' | 'permission';

let _itemId = 0;
function nextId(): string {
  return String(++_itemId);
}

interface CompletedItem {
  id: string;
  type: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  isError?: boolean;
}

interface PendingApproval {
  toolName: string;
  input: any;
  resolve: (approved: boolean) => void;
}

interface AppProps {
  agent: CodingAgent;
}

export function App({ agent }: AppProps) {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>('idle');
  const [completed, setCompleted] = useState<CompletedItem[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const addCompleted = useCallback((item: CompletedItem) => {
    setCompleted(prev => [...prev, item]);
  }, []);

  const handleSubmit = useCallback(async (input: string) => {
    if (input.trim() === '/exit' || input.trim() === '/quit') {
      exit();
      return;
    }

    if (!input.trim()) return;

    // Add user message to completed
    addCompleted({ id: nextId(), type: 'user', text: input });
    setStreamingText('');
    setState('streaming');

    try {
      for await (const event of agent.run(input)) {
        switch (event.type) {
          case 'stream': {
            const streamEvent = event.event as StreamEvent;
            if (streamEvent.type === 'text_delta') {
              setStreamingText(prev => prev + streamEvent.text);
            }
            if (streamEvent.type === 'message_complete') {
              // Finalize streaming text
              setStreamingText(prev => {
                if (prev.trim()) {
                  addCompleted({ id: nextId(), type: 'assistant', text: prev });
                }
                return '';
              });
            }
            break;
          }

          case 'tool_start':
            setState('tool_running');
            setCurrentTool(event.name);
            break;

          case 'tool_end': {
            const result = event.result as ToolResult;
            addCompleted({
              id: nextId(),
              type: 'tool',
              text: result.output.slice(0, 500) + (result.output.length > 500 ? '...' : ''),
              toolName: event.name,
              isError: result.isError,
            });
            setCurrentTool(null);
            setState('streaming');
            setStreamingText('');
            break;
          }

          case 'tool_denied':
            addCompleted({
              id: nextId(),
              type: 'tool',
              text: `Denied: ${event.name}`,
              toolName: event.name,
              isError: true,
            });
            setState('streaming');
            break;

          case 'done':
            setState('idle');
            break;

          case 'max_turns_reached':
            addCompleted({
              id: nextId(),
              type: 'assistant',
              text: '[Max turns reached]',
            });
            setState('idle');
            break;
        }
      }
    } catch (err: any) {
      addCompleted({
        id: nextId(),
        type: 'assistant',
        text: `Error: ${err.message}`,
        isError: true,
      });
    }

    setState('idle');
  }, [agent, addCompleted, exit]);

  return (
    <Box flexDirection="column">
      {/* Past messages — printed permanently via <Static> */}
      <Static items={completed}>
        {(item) => (
          <Box key={item.id} flexDirection="column" marginBottom={0}>
            {item.type === 'user' && (
              <Text>
                <Text color="blue" bold>{'> '}</Text>
                <Text>{item.text}</Text>
              </Text>
            )}
            {item.type === 'assistant' && (
              <Text>
                <Text color="green">{item.text}</Text>
              </Text>
            )}
            {item.type === 'tool' && (
              <ToolCallView
                name={item.toolName || ''}
                output={item.text}
                isError={item.isError}
              />
            )}
          </Box>
        )}
      </Static>

      {/* Live streaming response */}
      {state === 'streaming' && streamingText && (
        <StreamingText text={streamingText} />
      )}

      {/* Tool running indicator */}
      {state === 'tool_running' && currentTool && (
        <Box>
          <Text color="yellow">{'⟳ '}</Text>
          <Text dimColor>Running {currentTool}...</Text>
        </Box>
      )}

      {/* Permission prompt */}
      {state === 'permission' && pendingApproval && (
        <PermissionPrompt
          toolName={pendingApproval.toolName}
          input={pendingApproval.input}
          onResponse={(approved) => {
            pendingApproval.resolve(approved);
            setPendingApproval(null);
            setState('tool_running');
          }}
        />
      )}

      {/* User input */}
      {state === 'idle' && (
        <InputBox onSubmit={handleSubmit} />
      )}
    </Box>
  );
}
