/**
 * Multi-LLM failover. Tries Google Gemini, then Groq, and finally a
 * deterministic writer that needs no network, so a caller always gets text
 * back and the demo never crashes on a bad key, a rate limit or a timeout.
 *
 * Fetch-only, so it runs on the Vercel Edge runtime.
 */

export type ProviderName = 'gemini' | 'groq' | 'deterministic';

export type AiAttempt = {
  provider: ProviderName;
  ok: boolean;
  ms: number;
  error?: string;
};

export type AiResult = {
  text: string;
  provider: ProviderName;
  attempts: AiAttempt[];
};

export type AiPrompt = { system: string; user: string };

type Options = {
  /** Providers to treat as down. Used by the admin panel to demo the failover live. */
  simulateOutage?: ProviderName[];
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 7000;

class ProviderError extends Error {}

async function callGemini(prompt: AiPrompt, timeoutMs: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new ProviderError('Empty response');
  return text;
}

/** Groq (groq.com) serves open models through an OpenAI-compatible chat completions API. */
async function callGroq(prompt: AiPrompt, timeoutMs: number): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new ProviderError('GROQ_API_KEY is not set');
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_completion_tokens: 400,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new ProviderError('Empty response');
  return text;
}

const PROVIDERS: { name: Exclude<ProviderName, 'deterministic'>; call: typeof callGemini }[] = [
  { name: 'gemini', call: callGemini },
  { name: 'groq', call: callGroq },
];

function clean(text: string): string {
  return text
    .replace(/[*_#`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function describe(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  if (err instanceof Error) return err.name === 'TimeoutError' || err.name === 'AbortError' ? 'Timed out' : err.message;
  return 'Unknown error';
}

/**
 * @param prompt   what to ask the LLMs
 * @param fallback deterministic writer used when every provider fails
 */
export async function generateWithFailover(
  prompt: AiPrompt,
  fallback: () => string,
  options: Options = {},
): Promise<AiResult> {
  const attempts: AiAttempt[] = [];
  const down = new Set(options.simulateOutage ?? []);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const provider of PROVIDERS) {
    const started = Date.now();
    try {
      if (down.has(provider.name)) throw new ProviderError('Simulated outage');
      const text = clean(await provider.call(prompt, timeoutMs));
      if (!text) throw new ProviderError('Empty response');
      attempts.push({ provider: provider.name, ok: true, ms: Date.now() - started });
      return { text, provider: provider.name, attempts };
    } catch (err) {
      attempts.push({ provider: provider.name, ok: false, ms: Date.now() - started, error: describe(err) });
    }
  }

  const started = Date.now();
  let text: string;
  try {
    text = fallback();
  } catch {
    text = 'Briefing unavailable. Follow the route on the Job Card and drive safely.';
  }
  attempts.push({ provider: 'deterministic', ok: true, ms: Date.now() - started });
  return { text, provider: 'deterministic', attempts };
}
