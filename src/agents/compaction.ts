import type { ChatML } from '../core/chatml.js';
import type { InferenceService } from '../inference/service.js';
import type { TokenUsage } from '../core/types.js';
import { getModel, getLimitOutputTokens } from '../core/models.js';

/** Default compaction threshold if model is not in registry. */
const FALLBACK_THRESHOLD = 150_000;
export const KEEP_RECENT_MESSAGES = 6;

/** Output token limit for the compaction inference call (summary generation). */
const COMPACTION_OUTPUT_TOKENS = 8_000;

/**
 * Safety factor for context capacity (0 < factor ≤ 1.0).
 * 0.95 = trigger compaction at 95% of model capacity, leaving 5% breathing room
 * for estimate inaccuracy and the compaction call itself.
 */
const COMPACTION_SAFETY_FACTOR = 0.95;

const COMPACTION_PROMPT = `Compaction triggered:

You have been working on the task but probably have not yet completed it. Write a continuation summary that will allow you to resume work efficiently. After the summary is written, the **entire** conversation history will be replaced with the new summary at the beginning of the thread. Your summary should be structured, concise, and actionable, but containing everything you might need to remember to resume work without loss of context or repeated mistakes.

First, if this conversation already begins with a summary from a previous compaction, extract its key historical context (goals, decisions and their rationale, outcomes) and carry it forward in your new summary under a "History" section. Do not let prior context degrade across compactions.

Then, structure your summary as:

1. Task. The user's core request, success criteria, and any constraints, preferences or clarifications they specified. Feel free to reproduce key user statements almost verbatim if needed.
2. Progress. What's been done, files created/modified/analyzed (with full paths if relevant), key outputs or artifacts produced. What's currently in progress.
3. Decisions. Choices made and why. Approaches that failed and why they failed. Errors encountered and how they were resolved. Technical constraints or requirements uncovered.
4. State. Current working state. User preferences, domain-specific details, promises made to the user. Open questions or blockers.
5. Next. Specific actions needed to continue, in priority order.

Be concise but complete — err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.

This is only part of a longer conversation so *do not* conclude the summary with language like "Finally, ...". Because the conversation will continue after the summary.

Wrap in <compaction_summary></compaction_summary> tags.`;

/**
 * Should compaction trigger for the current context size?
 *
 * Checks: will the next inference call fit in the model's context window?
 *   wouldNeed = currentTokens + maxOutputTokens
 *   capacity  = contextTokens * safetyFactor
 *   compact if wouldNeed > capacity
 *
 * The safety factor (0.95) gives 5% breathing room for estimate inaccuracy
 * and the compaction call itself.
 *
 * Examples (at 0.95 safety factor):
 *   200K context, 16K output → capacity 190K → compact when input > 174K
 *   64K context, 16K output  → capacity 60.8K → compact when input > 44.8K
 *   200K context, 8K output  → capacity 190K → compact when input > 182K
 */
export function shouldCompact(model: string, currentTokens: number, limitOutputTokens: number): boolean {
  const def = getModel(model);
  if (!def) return currentTokens > FALLBACK_THRESHOLD;
  const capacity = Math.round(def.contextTokens * COMPACTION_SAFETY_FACTOR);
  return currentTokens + limitOutputTokens > capacity;
}

export interface CompactionResult {
  compacted: boolean;
  summary?: string;
  tokensBefore?: number;
  messagesCompacted?: number;
  usage?: TokenUsage;
}

/**
 * Check whether compaction is needed and perform it if so.
 *
 * Makes a separate inference call (no tools) to generate a conversation summary.
 * Does NOT modify the chatml — the caller persists the boundary and rebuilds from DB.
 *
 * This is provider-agnostic — works with any LLM backend.
 */
export async function maybeCompact(params: {
  chatml: ChatML;
  inference: InferenceService;
  model: string;
  limitOutputTokens: number;
  signal?: AbortSignal;
  /** Pre-counted tokens — avoids a redundant countTokens call when the caller already checked. */
  currentTokens?: number;
}): Promise<CompactionResult> {
  const { chatml, inference, model, limitOutputTokens, signal } = params;

  const currentTokens = params.currentTokens ?? await inference.countTokens(chatml);
  if (!shouldCompact(model, currentTokens, limitOutputTokens)) {
    return { compacted: false };
  }

  // Clone chatml and append the compaction prompt as a user message
  // (user message avoids cache eviction on the system prompt prefix)
  const compactionChatml = chatml.clone();
  compactionChatml.setTools([]);
  compactionChatml.addUser(COMPACTION_PROMPT);

  let summaryText = '';
  let compactionUsage: TokenUsage | undefined;
  try {
    const compactionLimit = Math.min(COMPACTION_OUTPUT_TOKENS, getLimitOutputTokens(model));
    for await (const event of inference.complete(compactionChatml, { model, limitOutputTokens: compactionLimit })) {
      if (signal?.aborted) return { compacted: false };
      if (event.type === 'message_complete') {
        compactionUsage = event.usage;
        const msg = event.message;
        if (typeof msg.content === 'string') {
          summaryText = msg.content;
        } else {
          const textBlock = msg.content.find(b => b.type === 'text');
          if (textBlock && textBlock.type === 'text') {
            summaryText = textBlock.text;
          }
        }
      }
    }
  } catch {
    return { compacted: false };
  }

  // Extract content between tags — prefer <compaction_summary>, fall back to <summary> (models may default to it)
  const match = summaryText.match(/<compaction_summary>([\s\S]*?)<\/compaction_summary>/)
    || summaryText.match(/<summary>([\s\S]*?)<\/summary>/);
  let summary = match ? match[1].trim() : summaryText.trim();
  // Strip any residual tags the model may have nested inside
  summary = summary.replace(/<\/?compaction_summary>/g, '').replace(/<\/?summary>/g, '').trim();

  if (!summary) {
    return { compacted: false };
  }

  // Don't modify chatml here — the caller (run-worker) will persist the boundary
  // and rebuild chatml from DB, ensuring live and resume paths are identical.
  return {
    compacted: true,
    summary,
    tokensBefore: currentTokens,
    messagesCompacted: chatml.getMessageCount() - KEEP_RECENT_MESSAGES,
    usage: compactionUsage,
  };
}
