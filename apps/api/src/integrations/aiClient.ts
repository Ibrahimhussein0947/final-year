import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Client for the Python AI service (multilingual sentence embeddings).
 * Every call can fail or be unavailable: callers must treat `null` as "no semantic information" and fall back to
 * the rule-based score. After a failure the client stays quiet for a short while instead of slowing every request.
 */
export interface EmbedResult {
  model: string;
  vectors: number[][];
}

export interface AiClient {
  enabled(): boolean;
  embed(texts: string[], opts?: { timeoutMs?: number }): Promise<EmbedResult | null>;
}

const COOL_DOWN_MS = 30_000;

export function createHttpAiClient(baseUrl: string | undefined, token: string | undefined, fetchImpl: typeof fetch = fetch): AiClient {
  let downUntil = 0;
  const configured = !!baseUrl && !!token;
  return {
    enabled: () => configured,
    async embed(texts, opts = {}) {
      if (!configured || texts.length === 0 || Date.now() < downUntil) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
      try {
        const res = await fetchImpl(`${baseUrl!.replace(/\/$/, '')}/v1/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Service-Token': token! },
          body: JSON.stringify({ texts }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`AI service answered ${res.status}`);
        const body = (await res.json()) as { model?: string; embeddings?: number[][] };
        if (!body.model || !Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) throw new Error('unexpected AI service response');
        return { model: body.model, vectors: body.embeddings };
      } catch (err) {
        downUntil = Date.now() + COOL_DOWN_MS;
        logger.warn({ err: String(err) }, 'AI service unavailable, using rule-based matching for the next 30 seconds');
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

let current: AiClient = createHttpAiClient(env.AI_SERVICE_URL, env.AI_SERVICE_TOKEN);
export const aiClient = (): AiClient => current;
/** For tests: swap in a fake client. */
export function setAiClient(c: AiClient) {
  current = c;
}
