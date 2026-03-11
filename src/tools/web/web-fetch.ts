import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';
import { isUrlSafe } from './url-safety.js';
import { DEFAULT_FETCH_HEADERS } from '../../core/defaults.js';

const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_OUTPUT_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 15_000;
const JINA_BASE = 'https://r.jina.ai/';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

type Format = 'auto' | 'markdown' | 'raw';
type Backend = 'local' | 'jina';

export class WebFetchTool extends Tool {
  readonly name = 'WebFetch';
  readonly group = 'Web';
  readonly description =
    'Fetch a web page or file and return its content.\n\n' +
    '`format` controls the output:\n' +
    '- "auto" (default): HTML → readable markdown, JSON → pretty-print, everything else (JS, CSS, plain text) → raw text.\n' +
    '- "markdown": always extract readable content as markdown.\n' +
    '- "raw": return the unprocessed response body as-is (local backend only — Jina always extracts content).\n\n' +
    '`backend` controls how the URL is fetched:\n' +
    '- "local" (default): direct HTTP fetch from the agent\'s host.\n' +
    '- "jina": fetch via r.jina.ai reader service. Useful when direct fetch returns 403. ' +
    'Supports format "auto" and "markdown" only (not "raw" — Jina always extracts content). ' +
    'Note: routes the request through a third-party service.';
  readonly requiresApproval = false;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (http or https only).',
      },
      format: {
        type: 'string',
        enum: ['auto', 'markdown', 'raw'],
        description: 'Output format. Default: auto.',
      },
      backend: {
        type: 'string',
        enum: ['local', 'jina'],
        description: 'Fetch backend. Default: local.',
      },
    },
    required: ['url'],
  };

  async execute(input: { url: string; format?: Format; backend?: Backend }, _context: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const format = input.format ?? 'auto';
    const backend = input.backend ?? 'local';

    const check = isUrlSafe(input.url);
    if (!check.safe) {
      return { output: `Error: ${check.reason}`, isError: true, durationMs: Date.now() - start };
    }

    if (backend === 'jina') {
      if (format === 'raw') {
        return { output: 'Error: Jina backend does not support format "raw". Use "auto" or "markdown", or switch to the local backend.', isError: true, durationMs: Date.now() - start };
      }
      return this.fetchViaJina(input.url, format, start);
    }

    const { result } = await this.directFetch(input.url, format, start);
    return result;
  }

  private async directFetch(url: string, format: Format, start: number): Promise<{ result: ToolResult; httpStatus?: number }> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { ...DEFAULT_FETCH_HEADERS },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          result: {
            output: `Error: HTTP ${response.status} ${response.statusText}`,
            isError: true,
            durationMs: Date.now() - start,
          },
          httpStatus: response.status,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const body = await this.readBody(response);

      let output: string;
      if (format === 'raw') {
        output = `URL: ${url}\nContent-Type: ${contentType}\n\n${body}`;
      } else if (format === 'markdown') {
        output = this.toMarkdown(url, body);
      } else {
        output = this.autoFormat(url, contentType, body);
      }

      return {
        result: { output: truncate(output), isError: false, durationMs: Date.now() - start },
      };

    } catch (err: any) {
      const message = err.name === 'TimeoutError'
        ? `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : err.cause ? `${err.message}: ${err.cause.message ?? err.cause}` : err.message || String(err);
      return {
        result: { output: `Error: ${message}`, isError: true, durationMs: Date.now() - start },
      };
    }
  }

  private async fetchViaJina(url: string, format: Format, start: number): Promise<ToolResult> {
    try {
      const jinaUrl = `${JINA_BASE}${url}`;
      const headers: Record<string, string> = {
        // raw/auto → plain text extraction; markdown → markdown
        'X-Return-Format': format === 'markdown' ? 'markdown' : 'text',
      };
      const apiKey = process.env.JINA_API_KEY;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(jinaUrl, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          output: `Error: Jina returned HTTP ${response.status} ${response.statusText}`,
          isError: true,
          durationMs: Date.now() - start,
        };
      }

      const body = await this.readBody(response);
      return {
        output: truncate(`URL: ${url}\n[Fetched via Jina Reader]\n\n${body}`),
        isError: false,
        durationMs: Date.now() - start,
      };

    } catch (err: any) {
      const message = err.name === 'TimeoutError'
        ? `Jina fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : err.message || String(err);
      return { output: `Error: ${message}`, isError: true, durationMs: Date.now() - start };
    }
  }

  private autoFormat(url: string, contentType: string, body: string): string {
    // JSON — pretty-print
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      try {
        const json = JSON.parse(body);
        const pretty = JSON.stringify(json, null, 2);
        return `URL: ${url}\nContent-Type: ${contentType}\n\n${pretty}`;
      } catch { /* fall through */ }
    }

    // HTML — extract with Readability → markdown
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      return this.toMarkdown(url, body);
    }

    // Everything else (text/plain, application/javascript, text/css, etc.) — raw
    return `URL: ${url}\nContent-Type: ${contentType}\n\n${body}`;
  }

  private toMarkdown(url: string, body: string): string {
    const { document } = parseHTML(body);
    const reader = new Readability(document);
    const article = reader.parse();

    if (article?.content) {
      const markdown = turndown.turndown(article.content);
      return `Title: ${article.title || '(untitled)'}\nURL: ${url}\n\n${markdown}`;
    }

    // Readability failed — extract text content
    const { document: fallbackDoc } = parseHTML(body);
    const textContent = fallbackDoc.body?.textContent?.trim() || body;
    return `URL: ${url}\n\n${textContent}`;
  }

  private async readBody(response: Response): Promise<string> {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const streamReader = response.body?.getReader();
    if (!streamReader) return '';

    while (true) {
      const { done, value } = await streamReader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        streamReader.cancel();
        break;
      }
      chunks.push(value);
    }

    const buffer = new Uint8Array(Math.min(totalBytes, MAX_RESPONSE_BYTES));
    let offset = 0;
    for (const chunk of chunks) {
      const len = Math.min(chunk.byteLength, buffer.byteLength - offset);
      buffer.set(chunk.subarray(0, len), offset);
      offset += len;
      if (offset >= buffer.byteLength) break;
    }
    return new TextDecoder().decode(buffer);
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + `\n\n[Truncated — showing ${MAX_OUTPUT_CHARS} of ${text.length} characters]`;
}

