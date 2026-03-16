import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';
import type { PersistentShell } from '../../daemon/persistent-shell.js';
import type { FileTracker } from './file-tracker.js';

export class ShellEditTool extends Tool {
  readonly name = 'Edit';
  readonly group = 'File';
  readonly description = 'Edit a file by replacing an exact string match. The old_string must appear exactly once in the file (unless replace_all is true). You must Read the file first.';
  readonly requiresApproval = true;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', description: 'The path to the file to edit' },
      old_string: { type: 'string', description: 'The exact string to find and replace. Must be unique unless replace_all is true.' },
      new_string: { type: 'string', description: 'The string to replace it with.' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences instead of requiring uniqueness. Default false.' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  };

  constructor(private shell: PersistentShell, private tracker?: FileTracker) { super(); }

  async execute(input: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }, context: ToolContext): Promise<ToolResult> {
    const fp = input.file_path.startsWith('/') ? input.file_path : `${context.cwd}/${input.file_path}`;

    if (input.old_string === input.new_string) {
      return { output: 'old_string and new_string are identical. No changes made.', isError: true, durationMs: 0 };
    }

    // Freshness + size check: get mtime and size in one call
    const statResult = await this.shell.exec(
      `stat -c '%Y %s' ${JSON.stringify(fp)} 2>/dev/null || stat -f '%m %z' ${JSON.stringify(fp)} 2>/dev/null`,
    );
    if (statResult.exitCode !== 0) {
      return { output: `File not found: ${fp}`, isError: true, durationMs: statResult.durationMs };
    }
    const [mtimeStr, sizeStr] = statResult.stdout.trim().split(/\s+/);
    const currentMtime = parseInt(mtimeStr, 10) || 0;
    const fileSize = parseInt(sizeStr, 10) || 0;

    if (this.tracker) {
      const err = this.tracker.checkFreshness(fp, currentMtime);
      if (err) return { output: err, isError: true, durationMs: statResult.durationMs };
    }

    // 5MB — base64 expands ~33%, so 5MB file → ~6.7MB base64 output, well within
    // the 10MB outputLimit below. If changing this, update outputLimit to ~2x.
    const MAX_EDIT_SIZE = 5 * 1024 * 1024;
    if (fileSize > MAX_EDIT_SIZE) {
      return {
        output: `File too large for Edit (${(fileSize / 1024 / 1024).toFixed(1)}MB, limit ${MAX_EDIT_SIZE / 1024 / 1024}MB). Use Bash with sed or a script instead.`,
        isError: true,
        durationMs: statResult.durationMs,
      };
    }

    // Read the file via base64 to preserve exact bytes (including trailing newline).
    // PersistentShell strips trailing \n from stdout, which would lose the file's
    // final newline if we used `cat` directly.
    // 10MB outputLimit — sized for MAX_EDIT_SIZE (5MB) after base64 expansion (~6.7MB).
    const readResult = await this.shell.exec(`base64 ${JSON.stringify(fp)}`, { outputLimit: 10_000_000 });
    if (readResult.exitCode !== 0) {
      return { output: `File not found: ${fp}`, isError: true, durationMs: readResult.durationMs };
    }

    const content = Buffer.from(readResult.stdout.replace(/\s/g, ''), 'base64').toString('utf-8');
    const occurrences = content.split(input.old_string).length - 1;

    if (occurrences === 0) {
      return { output: `old_string not found in ${fp}. Make sure it matches exactly (including whitespace and indentation).`, isError: true, durationMs: 0 };
    }

    if (!input.replace_all && occurrences > 1) {
      return { output: `old_string appears ${occurrences} times in ${fp}. It must be unique. Provide more context or use replace_all.`, isError: true, durationMs: 0 };
    }

    // Replace and write back via base64
    const newContent = input.replace_all
      ? content.split(input.old_string).join(input.new_string)
      : content.replace(input.old_string, input.new_string);

    const b64 = Buffer.from(newContent).toString('base64');
    const writeResult = await this.shell.exec(`echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(fp)}`);

    if (writeResult.exitCode !== 0) {
      return { output: `Error writing file: ${writeResult.stdout}`, isError: true, durationMs: writeResult.durationMs };
    }

    // Update tracked mtime after successful edit
    const stat = await this.shell.exec(`stat -c %Y ${JSON.stringify(fp)} 2>/dev/null || stat -f %m ${JSON.stringify(fp)} 2>/dev/null`);
    const newMtime = stat.exitCode === 0 ? parseInt(stat.stdout.trim(), 10) : 0;
    if (this.tracker) {
      this.tracker.updateMtime(fp, newMtime);
    }

    const replacedCount = input.replace_all ? occurrences : 1;
    const startLine = input.replace_all ? 1 : content.slice(0, content.indexOf(input.old_string)).split('\n').length;
    const oldLines = input.old_string.split('\n').length;
    const newLines = input.new_string.split('\n').length;
    const endLine = startLine + newLines - 1;
    const lineInfo = input.replace_all ? '' : ` (lines ${startLine}–${endLine})`;
    return {
      output: `Edited ${fp}${lineInfo}: replaced ${replacedCount} occurrence(s), ${oldLines} → ${newLines} lines`,
      isError: false,
      durationMs: readResult.durationMs + writeResult.durationMs,
      metadata: { file_path: fp, mtime: newMtime, start_line: startLine },
    };
  }
}