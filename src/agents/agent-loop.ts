import type { AgentEvent, StreamEvent, ContentBlock } from '../core/types.js';
import type { ChatML } from '../core/chatml.js';
import type { InferenceService } from '../inference/service.js';
import type { ToolRegistry } from '../tools/registry.js';
import { maybeCompact, shouldCompact } from './compaction.js';

export interface AgentLoopParams {
  chatml: ChatML;
  inference: InferenceService;
  tools: ToolRegistry;
  allowedTools: string[];
  cwd: string;

  /** Called for every tool invocation. Defaults to allowing all. */
  requestApproval?: (toolName: string, input: any) => Promise<boolean>;

  /** Maximum inference round-trips before stopping. */
  maxTurns?: number;

  /** Optional signal for graceful cancellation. */
  signal?: AbortSignal;

  /** Model override (passed to inference provider per-request). */
  model?: string;

  /** Output token limit per inference call. Also used for compaction threshold.
   *  Resolved from model registry by the caller (run-worker). */
  limitOutputTokens?: number;

  /** Returns queued injected messages (drains the queue). Used for mid-run user messages. */
  getInjectedMessages?: () => { text: string; images?: { base64: string; mediaType: string }[] }[];

  /** Called before each inference call. Throw to abort the run (e.g. budget exceeded). */
  beforeInference?: () => Promise<void>;
}

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET']);
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

function isTransientError(err: any): boolean {
  if (TRANSIENT_CODES.has(err?.code)) return true;
  if (TRANSIENT_STATUSES.has(err?.status)) return true;
  const msg = err?.message ?? '';
  return TRANSIENT_CODES.has(msg) || /ECONNRESET|ETIMEDOUT|overloaded/i.test(msg);
}

/**
 * The core TAOR loop: Think → Act → Observe → Repeat.
 *
 * Reusable by any agent.
 * Yields AgentEvents that the UI (or any consumer) can render.
 */
export async function* agentLoop(params: AgentLoopParams): AsyncGenerator<AgentEvent> {
  const { chatml, inference, tools, allowedTools, cwd, requestApproval = async () => true, maxTurns = 0, signal, model, limitOutputTokens, getInjectedMessages, beforeInference } = params;
  let turns = 0;
  chatml.setTools(tools.getToolDefinitions(allowedTools));

  while (true) {
    if (signal?.aborted) {
      yield { type: 'done' };
      return;
    }

    if (maxTurns > 0 && turns >= maxTurns) {
      yield { type: 'max_turns_reached' };
      break;
    }

    // ── Check for injected user messages ──
    const injected = getInjectedMessages?.() ?? [];
    if (injected.length > 0) {
      const combinedText = injected.map(m => m.text).filter(Boolean).join('\n\n');
      const allImages = injected.flatMap(m => m.images ?? []);

      // Build content blocks for the injected message
      const blocks: ContentBlock[] = [];
      if (combinedText) blocks.push({ type: 'text', text: `[User message mid-turn]: ${combinedText}` });
      for (const img of allImages) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
      }

      chatml.appendUser(blocks);
    }

    // ── Pre-inference compaction: compact before a call that would overflow ──
    if (model && limitOutputTokens) {
      const currentTokens = await inference.countTokens(chatml);
      if (shouldCompact(model, currentTokens, limitOutputTokens)) {
        yield { type: 'context_compacting' };
        const compactResult = await maybeCompact({
          chatml, inference, model, limitOutputTokens, signal, currentTokens,
        });
        if (compactResult.compacted) {
          yield { type: 'context_compacted', tokensBefore: compactResult.tokensBefore!, summary: compactResult.summary!, messagesCompacted: compactResult.messagesCompacted!, usage: compactResult.usage };
        } else {
          yield { type: 'context_compaction_failed', reason: compactResult.reason ?? 'unknown' };
        }
      }
    }

    // ── Pre-inference check (budget etc.) ──
    if (beforeInference) await beforeInference();

    // ── Think: stream inference (with retry for transient errors) ──
    let stopReason = '';

    for (let attempt = 0; ; attempt++) {
      try {
        for await (const event of inference.complete(chatml, { model, limitOutputTokens })) {
          yield { type: 'stream', event };

          if (event.type === 'message_complete') {
            stopReason = event.stopReason;
            chatml.addAssistant(event.message.content);
          }
        }
        break; // success
      } catch (err: any) {
        // Extract the most useful error message across providers:
        // - Anthropic: err.message directly
        // - OpenAI SDK: err.error.message
        // - Google/Gemini: err.error is [{ error: { message: "..." } }] (array)
        const rawError = err?.error;
        const errMsg =
          rawError?.message
          || (Array.isArray(rawError) && rawError[0]?.error?.message)
          || err?.message
          || String(err);
        const errDetail = err?.status ? `[${err.status}] ${errMsg}` : errMsg;

        if (attempt < MAX_RETRIES && isTransientError(err) && !signal?.aborted) {
          const delay = BASE_DELAY_MS * 2 ** attempt;
          yield { type: 'retry', attempt: attempt + 1, maxRetries: MAX_RETRIES, error: errDetail, delayMs: delay };
          await new Promise(r => {
            const timer = setTimeout(r, delay);
            signal?.addEventListener('abort', () => { clearTimeout(timer); r(undefined); }, { once: true });
          });
          if (signal?.aborted) throw err;
          continue;
        }
        throw new Error(errDetail);
      }
    }

    // If model finished without requesting tools → done
    if (stopReason !== 'tool_use') {
      yield { type: 'done' };
      return;
    }

    // ── Act: execute tool calls ──
    const toolUseBlocks = chatml.getToolUseBlocks();
    const toolMeta: Record<string, any> = {};

    for (const toolUse of toolUseBlocks) {
      if (signal?.aborted) {
        yield { type: 'done' };
        return;
      }

      // Always run through approval — enforces agent-type policy on every tool
      const approved = await requestApproval(toolUse.name, toolUse.input);
      if (!approved) {
        chatml.addToolResult(toolUse.id, 'Tool denied by policy.', true);
        yield { type: 'tool_denied', name: toolUse.name };
        continue;
      }

      yield { type: 'tool_start', name: toolUse.name, input: toolUse.input };

      // ── Observe: execute and feed result back ──
      const result = await tools.execute(toolUse.name, toolUse.input, { cwd });
      chatml.addToolResult(toolUse.id, result.output, result.isError, result.images);

      // Collect internal metadata (e.g. file tracker state) — stored on Message.meta, not sent to LLM
      if (result.metadata) {
        toolMeta[toolUse.id] = result.metadata;
      }

      yield { type: 'tool_end', name: toolUse.name, result };
    }

    // Yield the user message (tool results) that was just built so it can be persisted
    const allMessages = chatml.getMessages();
    const lastMsg = allMessages[allMessages.length - 1];
    if (lastMsg?.role === 'user') {
      const meta = Object.keys(toolMeta).length > 0 ? toolMeta : undefined;
      yield { type: 'user_message', message: lastMsg, meta };
    }

    turns++;
    // Loop back → Think again with tool results in context
  }
}