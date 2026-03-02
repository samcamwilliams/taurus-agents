import { spawn } from 'node:child_process';
import treeKill from 'tree-kill';
import type { ToolResult, ToolContext } from '../core/types.js';
import { Tool } from './base.js';

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT = 100_000; // 100KB

export class BashTool extends Tool {
  readonly name = 'Bash';
  readonly description = 'Execute a bash command in the working directory. Commands run with a 2-minute timeout by default.';
  readonly requiresApproval = true;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds. Default is 120000 (2 minutes).',
      },
    },
    required: ['command'],
  };

  async execute(input: { command: string; timeout?: number }, context: ToolContext): Promise<ToolResult> {
    const timeout = input.timeout ?? DEFAULT_TIMEOUT;

    return new Promise<ToolResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn('bash', ['-c', input.command], {
        cwd: context.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > MAX_OUTPUT) {
          stdout = stdout.slice(0, MAX_OUTPUT) + '\n[output truncated]';
          killProc();
        }
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > MAX_OUTPUT) {
          stderr = stderr.slice(0, MAX_OUTPUT) + '\n[output truncated]';
          killProc();
        }
      });

      const timer = setTimeout(() => {
        killed = true;
        killProc();
      }, timeout);

      function killProc() {
        if (proc.pid) {
          treeKill(proc.pid, 'SIGTERM');
        }
      }

      proc.on('close', (code) => {
        clearTimeout(timer);

        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n' : '') + stderr;
        if (killed) output += '\n[Process killed: timeout exceeded]';
        if (!output) output = `(exit code ${code})`;

        resolve({
          output,
          isError: code !== 0,
          durationMs: 0, // registry wraps with timing
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          output: `Failed to execute: ${err.message}`,
          isError: true,
          durationMs: 0,
        });
      });
    });
  }
}
