import type { ChatMessage, ContentBlock, ToolUseBlock, ImageData, TextBlock, ImageBlock, ToolDef } from './types.js';

/**
 * ChatML — the fundamental conversation primitive.
 *
 * Any agent builds one of these and sends it to inference.
 * Handles message accumulation, context management, serialization.
 */
export class ChatML {
  private systemPrompt: string = '';
  private messages: ChatMessage[] = [];
  private tools: ToolDef[] = [];

  // ─── Building ───

  setSystem(prompt: string): this {
    this.systemPrompt = prompt;
    return this;
  }

  setTools(tools: ToolDef[]): this {
    this.tools = tools;
    return this;
  }

  addUser(content: string | ContentBlock[]): this {
    this.messages.push({ role: 'user', content });
    return this;
  }

  /**
   * Append user content, merging with the last message if it's already a user message.
   * Handles string + string, blocks + blocks, and string-to-blocks conversion for images.
   */
  appendUser(content: string | ContentBlock[]): this {
    const last = this.messages[this.messages.length - 1];

    if (last?.role === 'user' && Array.isArray(last.content)) {
      const blocks = typeof content === 'string'
        ? [{ type: 'text' as const, text: content }]
        : content;
      (last.content as ContentBlock[]).push(...blocks);
    } else if (last?.role === 'user' && typeof last.content === 'string') {
      if (typeof content === 'string') {
        last.content += `\n\n${content}`;
      } else {
        // Convert existing string to text block so we can mix with new content blocks
        last.content = [{ type: 'text' as const, text: last.content }, ...content];
      }
    } else {
      this.messages.push({ role: 'user', content });
    }
    return this;
  }

  addAssistant(content: string | ContentBlock[]): this {
    this.messages.push({ role: 'assistant', content });
    return this;
  }

  addToolResult(toolUseId: string, output: string, isError: boolean = false, images?: ImageData[]): this {
    // Tool results are user messages containing tool_result blocks.
    // If the last message is already a user message with tool results, append to it.
    const last = this.messages[this.messages.length - 1];

    // Build content: plain string if no images, rich array if images present
    let content: string | (TextBlock | ImageBlock)[];
    if (images && images.length > 0) {
      content = [
        { type: 'text' as const, text: output },
        ...images.map(img => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
        })),
      ];
    } else {
      content = output;
    }

    const resultBlock: ContentBlock = {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content,
      is_error: isError || undefined,
    };

    if (last && last.role === 'user' && Array.isArray(last.content)) {
      const hasToolResults = last.content.some(b => b.type === 'tool_result');
      if (hasToolResults) {
        (last.content as ContentBlock[]).push(resultBlock);
        return this;
      }
    }

    this.messages.push({ role: 'user', content: [resultBlock] });
    return this;
  }

  // ─── Accessors ───

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  clearMessages(): this {
    this.messages = [];
    return this;
  }

  getTools(): ToolDef[] {
    return this.tools;
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getLastAssistantMessage(): ChatMessage | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        return this.messages[i];
      }
    }
    return null;
  }

  /**
   * Extract tool_use blocks from the last assistant message.
   * Used by the agent loop to know which tools to execute.
   */
  getToolUseBlocks(): ToolUseBlock[] {
    const last = this.getLastAssistantMessage();
    if (!last || typeof last.content === 'string') return [];
    return last.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  }

  // ─── Context Management ───

  /**
   * Rough token estimate: ~4 chars per token.
   * Good enough for context budget checks. Use the inference service for accurate counts.
   */
  getTokenEstimate(): number {
    // Image tokens are NOT proportional to base64 length — providers tokenize
    // based on pixel dimensions (Anthropic: w*h/750, OpenAI: tile system).
    // We use a fixed ~1,000 tokens per image as a reasonable cross-provider estimate.
    const IMAGE_TOKENS = 1000;

    let tokens = Math.ceil(this.systemPrompt.length / 4);
    for (const msg of this.messages) {
      if (typeof msg.content === 'string') {
        tokens += Math.ceil(msg.content.length / 4);
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') tokens += Math.ceil(block.text.length / 4);
          else if (block.type === 'image') tokens += IMAGE_TOKENS;
          else if (block.type === 'image_gen') tokens += IMAGE_TOKENS;
          else if (block.type === 'compaction') tokens += Math.ceil((block.content?.length ?? 0) / 4);
          else if (block.type === 'tool_use') tokens += Math.ceil(JSON.stringify(block.input).length / 4);
          else if (block.type === 'tool_result') {
            if (typeof block.content === 'string') {
              tokens += Math.ceil(block.content.length / 4);
            } else {
              for (const sub of block.content) {
                if (sub.type === 'text') tokens += Math.ceil(sub.text.length / 4);
                else if (sub.type === 'image') tokens += IMAGE_TOKENS;
              }
            }
          }
        }
      }
    }
    return tokens;
  }

  /**
   * Drop oldest messages (keeping system prompt) to fit within token budget.
   */
  truncateToFit(maxTokens: number): this {
    while (this.messages.length > 2 && this.getTokenEstimate() > maxTokens) {
      this.messages.shift();
    }
    // Ensure first message is from user (API requirement)
    while (this.messages.length > 0 && this.messages[0].role !== 'user') {
      this.messages.shift();
    }
    return this;
  }

  // ─── Compaction ───

  static readonly COMPACTION_ACK = 'Understood. I have the context from the previous conversation and will continue where it left off.';

  static wrapCompactionSummary(summary: string): string {
    return `[This conversation ran out of context. The summary below covers the earlier portion of the conversation]\n\n<compaction_summary>\n${summary}\n</compaction_summary>`;
  }

  // ─── Serialization ───

  toJSON(): { systemPrompt: string; messages: ChatMessage[]; tools: ToolDef[] } {
    return {
      systemPrompt: this.systemPrompt,
      messages: this.messages,
      tools: this.tools,
    };
  }

  static fromJSON(data: { systemPrompt: string; messages: ChatMessage[]; tools?: ToolDef[] }): ChatML {
    const chatml = new ChatML();
    chatml.systemPrompt = data.systemPrompt;
    chatml.messages = data.messages;
    chatml.tools = data.tools ?? [];
    return chatml;
  }

  // ─── Utility ───

  clone(): ChatML {
    return ChatML.fromJSON(JSON.parse(JSON.stringify(this.toJSON())));
  }
}