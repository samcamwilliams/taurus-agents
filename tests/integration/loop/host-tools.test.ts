/**
 * ⚠️  WARNING: These tests execute real commands on the developer's machine.
 * All file operations are confined to a temporary directory created in beforeAll.
 * The Bash tool runs commands with cwd set to this tmpdir.
 * Do NOT use absolute paths outside the tmpdir or commands that could affect the
 * host system beyond the tmpdir.
 * The tmpdir is cleaned up in afterAll.
 *
 * Tests verify real tool execution via the agent loop with PersistentShell in
 * host mode — no Docker required. The mock inference provider scripts tool calls
 * and the real tools execute them against the filesystem.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentLoop } from '../../../src/agents/agent-loop.js';
import { ChatML } from '../../../src/core/chatml.js';
import { InferenceService } from '../../../src/inference/service.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { PersistentShell } from '../../../src/daemon/persistent-shell.js';
import { ShellReadTool } from '../../../src/tools/shell/read.js';
import { ShellWriteTool } from '../../../src/tools/shell/write.js';
import { ShellEditTool } from '../../../src/tools/shell/edit.js';
import { ShellGlobTool } from '../../../src/tools/shell/glob.js';
import { ShellGrepTool } from '../../../src/tools/shell/grep.js';
import { PersistentBashTool } from '../../../src/tools/shell/bash.js';
import { FileTracker } from '../../../src/tools/shell/file-tracker.js';
import { MockInferenceProvider } from '../../helpers/mock-provider.js';
import type { AgentEvent } from '../../../src/core/types.js';

let tmpDir: string;
let shell: PersistentShell;
let tools: ToolRegistry;
const toolNames = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taurus-host-tools-'));

  shell = new PersistentShell({ mode: 'host', cwd: tmpDir });
  await shell.spawn();

  const tracker = new FileTracker();
  tools = new ToolRegistry();
  tools.register(new ShellReadTool(shell, tracker));
  tools.register(new ShellWriteTool(shell, tracker));
  tools.register(new ShellEditTool(shell, tracker));
  tools.register(new ShellGlobTool(shell));
  tools.register(new ShellGrepTool(shell));
  tools.register(new PersistentBashTool(shell));
});

afterAll(async () => {
  if (shell) await shell.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('host-mode real tools', () => {
  it('Write creates a file on disk', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Write',
          input: { file_path: filePath, content: 'Hello from Taurus!' },
        }],
      },
      { text: 'File created.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Create a file.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    // Verify file was actually created on disk
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello from Taurus!');

    // Verify agent completed
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(provider.callCount).toBe(2);
  });

  it('Read returns file content from disk', async () => {
    const filePath = path.join(tmpDir, 'read-me.txt');
    fs.writeFileSync(filePath, 'Line one\nLine two\nLine three');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Read',
          input: { file_path: filePath },
        }],
      },
      { text: 'I read the file.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Read the file.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd).toBeDefined();
    expect(toolEnd.result.isError).toBe(false);
    expect(toolEnd.result.output).toContain('Line one');
    expect(toolEnd.result.output).toContain('Line three');
  });

  it('Glob finds files by pattern', async () => {
    // Create a few files
    fs.writeFileSync(path.join(tmpDir, 'alpha.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(tmpDir, 'beta.ts'), 'export const b = 2;');
    fs.writeFileSync(path.join(tmpDir, 'gamma.js'), 'module.exports = 3;');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Glob',
          input: { pattern: '*.ts', path: tmpDir },
        }],
      },
      { text: 'Found TypeScript files.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Find TypeScript files.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd).toBeDefined();
    expect(toolEnd.result.isError).toBe(false);
    expect(toolEnd.result.output).toContain('alpha.ts');
    expect(toolEnd.result.output).toContain('beta.ts');
    expect(toolEnd.result.output).not.toContain('gamma.js');
  });

  it('Glob finds files recursively with ** pattern', async () => {
    // Create nested structure
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'deep.ts'), 'export const deep = true;');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Glob',
          input: { pattern: '**/*.ts', path: tmpDir },
        }],
      },
      { text: 'Found recursive files.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Find all TypeScript files recursively.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd).toBeDefined();
    expect(toolEnd.result.isError).toBe(false);
    // Should find both top-level and nested .ts files
    expect(toolEnd.result.output).toContain('alpha.ts');
    expect(toolEnd.result.output).toContain('deep.ts');
  });

  it('Grep searches file content', async () => {
    fs.writeFileSync(path.join(tmpDir, 'search-me.txt'), 'foo bar\nbaz NEEDLE qux\nhello world');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Grep',
          input: { pattern: 'NEEDLE', path: tmpDir },
        }],
      },
      { text: 'Found the needle.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Search for NEEDLE.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd).toBeDefined();
    expect(toolEnd.result.isError).toBe(false);
    expect(toolEnd.result.output).toContain('NEEDLE');
  });

  it('Bash runs a command and returns output', async () => {
    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Bash',
          input: { command: 'echo "host-mode-works"' },
        }],
      },
      { text: 'Command ran.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Run echo.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd).toBeDefined();
    expect(toolEnd.result.isError).toBe(false);
    expect(toolEnd.result.output).toContain('host-mode-works');
  });

  it('Edit modifies file content on disk', async () => {
    const filePath = path.join(tmpDir, 'edit-me.txt');
    fs.writeFileSync(filePath, 'old content here');

    // Read first (Edit tool requires a prior read for freshness tracking)
    const readProvider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Read',
          input: { file_path: filePath },
        }],
      },
      {
        toolCalls: [{
          name: 'Edit',
          input: {
            file_path: filePath,
            old_string: 'old content',
            new_string: 'new content',
          },
        }],
      },
      { text: 'File edited.' },
    ]);
    const inference = new InferenceService(readProvider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Edit the file.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnds = events.filter((e) => e.type === 'tool_end') as any[];
    const editResult = toolEnds.find((e) => e.name === 'Edit');
    expect(editResult).toBeDefined();
    expect(editResult!.result.isError).toBe(false);

    // Verify the file was actually edited on disk
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('new content here');
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('multi-step: Write then Read the same file', async () => {
    const filePath = path.join(tmpDir, 'round-trip.txt');
    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Write',
          input: { file_path: filePath, content: 'round trip data' },
        }],
      },
      {
        toolCalls: [{
          name: 'Read',
          input: { file_path: filePath },
        }],
      },
      { text: 'Round trip complete.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Write then read.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnds = events.filter((e) => e.type === 'tool_end') as any[];
    expect(toolEnds.length).toBe(2);

    // Read result should contain the written content
    const readResult = toolEnds[1].result;
    expect(readResult.isError).toBe(false);
    expect(readResult.output).toContain('round trip data');
  });
});

describe('host-mode path escaping', () => {
  it('Write + Read handles spaces in path', async () => {
    const dirWithSpaces = path.join(tmpDir, 'dir with spaces');
    fs.mkdirSync(dirWithSpaces, { recursive: true });
    const filePath = path.join(dirWithSpaces, 'my file.txt');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Write',
          input: { file_path: filePath, content: 'spaces work' },
        }],
      },
      {
        toolCalls: [{
          name: 'Read',
          input: { file_path: filePath },
        }],
      },
      { text: 'Done.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Write then read a file with spaces.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('spaces work');

    const toolEnds = events.filter((e) => e.type === 'tool_end') as any[];
    const readResult = toolEnds.find((e) => e.name === 'Read');
    expect(readResult!.result.isError).toBe(false);
    expect(readResult!.result.output).toContain('spaces work');
  });

  it('Edit handles spaces in path', async () => {
    const dirWithSpaces = path.join(tmpDir, 'edit spaces dir');
    fs.mkdirSync(dirWithSpaces, { recursive: true });
    const filePath = path.join(dirWithSpaces, 'spaced file.txt');
    fs.writeFileSync(filePath, 'before edit');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Read',
          input: { file_path: filePath },
        }],
      },
      {
        toolCalls: [{
          name: 'Edit',
          input: { file_path: filePath, old_string: 'before', new_string: 'after' },
        }],
      },
      { text: 'Edited.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Edit the spaced file.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const editResult = (events.filter((e) => e.type === 'tool_end') as any[])
      .find((e) => e.name === 'Edit');
    expect(editResult!.result.isError).toBe(false);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('after edit');
  });

  it('Glob finds files in directory with spaces', async () => {
    const dirWithSpaces = path.join(tmpDir, 'glob spaces');
    fs.mkdirSync(dirWithSpaces, { recursive: true });
    fs.writeFileSync(path.join(dirWithSpaces, 'found.ts'), '');
    fs.writeFileSync(path.join(dirWithSpaces, 'ignored.js'), '');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Glob',
          input: { pattern: '*.ts', path: dirWithSpaces },
        }],
      },
      { text: 'Found.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Glob in spaced dir.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd.result.isError).toBe(false);
    expect(toolEnd.result.output).toContain('found.ts');
    expect(toolEnd.result.output).not.toContain('ignored.js');
  });

  it('Write + Read handles special characters in filename', async () => {
    // Parentheses, ampersand, dollar — chars that break if unescaped in shell
    const filePath = path.join(tmpDir, 'file (copy) & $var.txt');

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Write',
          input: { file_path: filePath, content: 'special chars ok' },
        }],
      },
      {
        toolCalls: [{
          name: 'Read',
          input: { file_path: filePath },
        }],
      },
      { text: 'Done.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Write then read file with special chars.');

    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: tmpDir }),
    );

    expect(fs.existsSync(filePath)).toBe(true);
    const toolEnds = events.filter((e) => e.type === 'tool_end') as any[];
    const readResult = toolEnds.find((e) => e.name === 'Read');
    expect(readResult!.result.isError).toBe(false);
    expect(readResult!.result.output).toContain('special chars ok');
  });

  it('Bash handles spaces in cwd', async () => {
    const dirWithSpaces = path.join(tmpDir, 'bash spaces');
    fs.mkdirSync(dirWithSpaces, { recursive: true });

    const provider = new MockInferenceProvider([
      {
        toolCalls: [{
          name: 'Bash',
          input: { command: `pwd && echo "ok"` },
        }],
      },
      { text: 'Done.' },
    ]);
    const inference = new InferenceService(provider);

    const chatml = new ChatML();
    chatml.setSystem('You are helpful.');
    chatml.appendUser('Run pwd.');

    // Note: cwd with spaces passed to agentLoop
    const events = await collectEvents(
      agentLoop({ chatml, inference, tools, allowedTools: toolNames, cwd: dirWithSpaces }),
    );

    const toolEnd = events.find((e) => e.type === 'tool_end') as any;
    expect(toolEnd.result.isError).toBe(false);
    expect(toolEnd.result.output).toContain('ok');
  });
});
