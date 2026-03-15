import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';
import type { PersistentShell } from '../../daemon/persistent-shell.js';
import type { FileTracker } from './file-tracker.js';

export class ShellWriteTool extends Tool {
  readonly name = 'Write';
  readonly group = 'File';
  readonly description = 'Write content to a file. Creates parent directories if needed. WARNING: this OVERWRITES the entire file. To modify or append to an existing file, use the Edit tool instead. Only use Write for new files or complete rewrites.';
  readonly requiresApproval = true;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', description: 'The path to the file to write' },
      content: { type: 'string', description: 'The content to write' },
    },
    required: ['file_path', 'content'],
  };

  constructor(private shell: PersistentShell, private tracker?: FileTracker) { super(); }

  async execute(input: { file_path: string; content: string }, context: ToolContext): Promise<ToolResult> {
    const fp = input.file_path.startsWith('/') ? input.file_path : `${context.cwd}/${input.file_path}`;

    // Check if file already exists (for warning, not blocking)
    let existed = false;
    if (this.tracker) {
      const stat = await this.shell.exec(`stat -c %Y ${JSON.stringify(fp)} 2>/dev/null || stat -f %m ${JSON.stringify(fp)} 2>/dev/null`);
      existed = stat.exitCode === 0;
    }

    // Ensure parent directory exists, then write via base64 to avoid escaping issues
    const b64 = Buffer.from(input.content).toString('base64');
    const cmd = `mkdir -p $(dirname ${JSON.stringify(fp)}) && echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(fp)}`;
    const result = await this.shell.exec(cmd);

    if (result.exitCode !== 0) {
      return { output: `Error writing file: ${result.stdout}`, isError: true, durationMs: result.durationMs };
    }

    // Update tracked mtime
    const stat = await this.shell.exec(`stat -c %Y ${JSON.stringify(fp)} 2>/dev/null || stat -f %m ${JSON.stringify(fp)} 2>/dev/null`);
    const newMtime = stat.exitCode === 0 ? parseInt(stat.stdout.trim(), 10) : 0;
    if (this.tracker) {
      this.tracker.updateMtime(fp, newMtime);
    }

    let output = `File written: ${fp} (${input.content.length} bytes)`;
    if (existed && this.tracker && !this.tracker.hasRead(fp)) {
      output += `\nNote: this file already existed and was overwritten without being read first.`;
    }

    return {
      output,
      isError: false,
      durationMs: result.durationMs,
      metadata: { file_path: fp, mtime: newMtime },
    };
  }
}