/**
 * Programmatic test harness — runs the full agent loop without the TUI.
 * Usage: npx tsx src/test-harness.ts "What files are in this directory?"
 */
import 'dotenv/config';

import { AnthropicProvider } from './inference/providers/anthropic.js';
import { InferenceService } from './inference/service.js';
import { ToolRegistry } from './tools/registry.js';
import { ReadTool } from './tools/read.js';
import { WriteTool } from './tools/write.js';
import { EditTool } from './tools/edit.js';
import { BashTool } from './tools/bash.js';
import { GlobTool } from './tools/glob.js';
import { GrepTool } from './tools/grep.js';
import { CodingAgent } from './agents/coding-agent.js';

async function main() {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error('Usage: npx tsx src/test-harness.ts "your prompt here"');
    process.exit(1);
  }

  // Boot services (no DB, no TUI)
  const provider = new AnthropicProvider();
  const inference = new InferenceService(provider);

  const tools = new ToolRegistry();
  tools.register(new ReadTool());
  tools.register(new WriteTool());
  tools.register(new EditTool());
  tools.register(new BashTool());
  tools.register(new GlobTool());
  tools.register(new GrepTool());

  const agent = new CodingAgent({
    inference,
    tools,
    cwd: process.cwd(),
    requestApproval: async () => true, // auto-approve for testing
  });

  console.log(`\n--- Prompt: "${prompt}" ---\n`);

  let fullText = '';
  for await (const event of agent.run(prompt)) {
    switch (event.type) {
      case 'stream':
        if (event.event.type === 'text_delta') {
          process.stdout.write(event.event.text);
          fullText += event.event.text;
        }
        break;
      case 'tool_start':
        console.log(`\n[tool:${event.name}] input: ${JSON.stringify(event.input).slice(0, 200)}`);
        break;
      case 'tool_end':
        console.log(`[tool:${event.name}] ${event.result.isError ? 'ERROR' : 'ok'} (${event.result.durationMs}ms) output: ${event.result.output.slice(0, 200)}`);
        break;
      case 'done':
        console.log('\n\n--- Done ---');
        break;
    }
  }

  const usage = inference.getUsage();
  console.log(`Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
