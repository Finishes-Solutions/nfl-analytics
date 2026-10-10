/**
 * llm.ts — minimal OpenAI Responses API client (streaming + tool calls).
 *
 * Works with OpenAI directly and with Azure OpenAI's v1 endpoint, which is
 * OpenAI-compatible: set OPENAI_BASE_URL=https://<resource>.openai.azure.com/openai/v1
 * and OPENAI_MODEL=<your deployment name>. Plain fetch, no SDK, so the wire
 * format is visible here and easy to adjust if the API moves.
 *
 * Tool loops chain turns with previous_response_id (the server keeps the
 * conversation state, including any reasoning items), so each follow-up call
 * only sends the new function_call_output items.
 */

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  embedModel?: string;
  reasoningEffort?: string;
}

export function llmConfig(): LlmConfig | null {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return null;
  return {
    apiKey,
    model,
    baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    embedModel: process.env.OPENAI_EMBED_MODEL || undefined,
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || undefined,
  };
}

function headers(cfg: LlmConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
  if (/\.azure\.com/i.test(cfg.baseUrl)) h['api-key'] = cfg.apiKey; // Azure also accepts its own header
  return h;
}

export interface FunctionCall { type: 'function_call'; call_id: string; name: string; arguments: string }
export interface ResponseResult {
  id: string;
  status: string;
  output: Array<{ type: string } & Record<string, unknown>>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export interface CreateArgs {
  instructions: string;
  input: unknown[];
  tools: unknown[];
  previousResponseId?: string;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

/** One model turn, streamed. Resolves with the completed response (including any function calls). */
export async function createResponse(cfg: LlmConfig, a: CreateArgs): Promise<ResponseResult> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    instructions: a.instructions,  // not inherited through previous_response_id — send every turn
    input: a.input,
    stream: true,
  };
  if (a.tools.length) body.tools = a.tools;
  if (a.previousResponseId) body.previous_response_id = a.previousResponseId;
  if (cfg.reasoningEffort) body.reasoning = { effort: cfg.reasoningEffort };

  const res = await fetch(`${cfg.baseUrl}/responses`, { method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal: a.signal });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`model request failed: HTTP ${res.status} ${text.slice(0, 400)}`);
  }

  let final: ResponseResult | undefined;
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      switch (ev.type) {
        case 'response.output_text.delta': a.onText?.(ev.delta ?? ''); break;
        case 'response.completed':
        case 'response.incomplete': final = ev.response; break;
        case 'response.failed': throw new Error(`model error: ${ev.response?.error?.message ?? 'response failed'}`);
        case 'error': throw new Error(`model error: ${ev.message ?? ev.error?.message ?? 'unknown'}`);
      }
    }
  }
  if (!final) throw new Error('model stream ended without a completed response');
  return final;
}

export function functionCalls(r: ResponseResult): FunctionCall[] {
  return r.output.filter((o) => o.type === 'function_call') as unknown as FunctionCall[];
}

/** Embed text for semantic_search — must be the same model that built semantic_documents (1536-dim). */
export async function embed(cfg: LlmConfig, text: string, signal?: AbortSignal): Promise<number[]> {
  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: 'POST', headers: headers(cfg), signal,
    body: JSON.stringify({ model: cfg.embedModel, input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`embedding failed: HTTP ${res.status}`);
  const j = (await res.json()) as { data: { embedding: number[] }[] };
  return j.data[0].embedding;
}
