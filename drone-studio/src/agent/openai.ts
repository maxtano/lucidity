import type { AgentProvider } from './types';

type ProviderOptions = {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  onRetry?: (attempt: number) => void;
};

export class ModelConnectionError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ModelConnectionError';
  }
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error('Cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Server-only adapter. No credential or provider instance is sent to the browser. */
export function createOpenAIProvider({
  apiKey,
  model,
  fetchImpl = fetch,
  onRetry,
}: ProviderOptions): AgentProvider {
  if (!apiKey.trim())
    throw new ModelConnectionError(
      'Add OPENAI_API_KEY to .env.local and restart the studio server.'
    );
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(model))
    throw new ModelConnectionError('Enter a valid model ID.');
  return {
    async complete({ input, tools, signal }) {
      const deadline = AbortSignal.timeout(60_000);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      for (let attempt = 0; attempt < 3; attempt++) {
        requestSignal.throwIfAborted();
        let response: Response;
        try {
          response = await fetchImpl('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              input,
              tools,
              store: false,
              include: ['reasoning.encrypted_content'],
              parallel_tool_calls: false,
              max_output_tokens: 4000,
            }),
            signal: requestSignal,
          });
        } catch (error) {
          if (requestSignal.aborted) throw requestSignal.reason;
          if (attempt === 2)
            throw new ModelConnectionError(
              'The model service could not be reached. Your show has not changed.'
            );
          onRetry?.(attempt + 1);
          await wait(400 * 2 ** attempt, requestSignal);
          continue;
        }
        const body = (await response.json().catch(() => null)) as Record<string, any> | null;
        requestSignal.throwIfAborted();
        if (!response.ok) {
          const code = String(body?.error?.code || '');
          const retryable =
            (response.status === 429 && code !== 'insufficient_quota') || response.status >= 500;
          if (retryable && attempt < 2) {
            onRetry?.(attempt + 1);
            await wait(400 * 2 ** attempt, requestSignal);
            continue;
          }
          const message =
            response.status === 401
              ? 'The API key was rejected. Check the server connection settings.'
              : response.status === 429
                ? 'The provider quota or rate limit was reached. Retry after checking your API account.'
                : String(
                    body?.error?.message || `The model service returned HTTP ${response.status}.`
                  )
                    .split(apiKey)
                    .join('[redacted]')
                    .slice(0, 300);
          throw new ModelConnectionError(message, response.status);
        }
        if (!body || body.error || body.status !== 'completed' || !Array.isArray(body.output))
          throw new ModelConnectionError(
            'The model response was incomplete. Retry with a smaller editing request.'
          );
        const calls: { id: string; name: string; arguments: string }[] = [];
        const text: string[] = [];
        for (const item of body.output) {
          if (item?.type === 'function_call') {
            if (
              typeof item.call_id !== 'string' ||
              typeof item.name !== 'string' ||
              typeof item.arguments !== 'string'
            )
              throw new ModelConnectionError('The provider returned an invalid tool call.');
            calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
          }
          if (item?.type === 'message' && Array.isArray(item.content))
            for (const content of item.content) {
              if (content.type === 'output_text' && typeof content.text === 'string')
                text.push(content.text);
              if (content.type === 'refusal' && typeof content.refusal === 'string')
                text.push(content.refusal);
            }
        }
        const tokens = (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
        return {
          output: body.output,
          calls,
          text: text.join('\n'),
          usage: {
            inputTokens: tokens(body.usage?.input_tokens),
            outputTokens: tokens(body.usage?.output_tokens),
          },
        };
      }
      throw new ModelConnectionError('The model request could not complete.');
    },
  };
}
