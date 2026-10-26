import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAIProvider, ModelConnectionError } from './openai';
import type { AgentToolDefinition } from './types';

// Synthetic credential only. Every request is intercepted by injected fetch; no network or env reads.
const key = 'synthetic-adapter-test-key';
const model = 'test-model';
const tool: AgentToolDefinition = {
  type: 'function',
  name: 'inspect_show',
  description: 'Read the current show.',
  strict: true,
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};
const request = { input: [{ role: 'user', content: 'Inspect the show.' }], tools: [tool] };
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const completed = (overrides: Record<string, unknown> = {}) => ({
  id: 'response-test',
  status: 'completed',
  output: [],
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe('server-only Responses provider adapter', () => {
  it('preserves raw output, opaque reasoning and message phase while extracting tool calls, text and usage', async () => {
    const output = [
      {
        type: 'reasoning',
        id: 'reasoning-test',
        summary: [],
        encrypted_content: 'opaque-continuation-test',
      },
      {
        type: 'message',
        id: 'message-test',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: 'Inspecting the scene.', annotations: [] }],
      },
      {
        type: 'function_call',
        id: 'item-test',
        call_id: 'call-test',
        name: 'inspect_show',
        arguments: '{}',
      },
      {
        type: 'message',
        id: 'refusal-test',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'refusal', refusal: 'A clear refusal.' }],
      },
    ];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(completed({ output, usage: { input_tokens: 57, output_tokens: 19 } }))
      );
    const result = await createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete(request);
    expect(result.output).toEqual(output);
    expect(result.calls).toEqual([{ id: 'call-test', name: 'inspect_show', arguments: '{}' }]);
    expect(result.text).toBe('Inspecting the scene.\nA clear refusal.');
    expect(result.usage).toEqual({ inputTokens: 57, outputTokens: 19 });
  });

  it('uses only the official endpoint with server authorization and a stateless sequential request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(completed()));
    const original = structuredClone(request);
    await createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete(request);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${key}`);
    expect(headers.get('Content-Type')).toBe('application/json');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model,
      input: request.input,
      tools: [tool],
      store: false,
      include: ['reasoning.encrypted_content'],
      parallel_tool_calls: false,
      max_output_tokens: 4000,
    });
    expect(JSON.stringify(body)).not.toContain(key);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(request).toEqual(original);
  });

  it.each([
    { apiKey: '', model, message: /OPENAI_API_KEY/ },
    { apiKey: '   ', model, message: /OPENAI_API_KEY/ },
    { apiKey: key, model: 'https://untrusted.invalid/model', message: /valid model ID/ },
    { apiKey: key, model: 'model\nInjected: value', message: /valid model ID/ },
  ])(
    'rejects invalid server connection values before requesting ($model)',
    ({ apiKey, model: selectedModel, message }) => {
      const fetchImpl = vi.fn<typeof fetch>();
      expect(() => createOpenAIProvider({ apiKey, model: selectedModel, fetchImpl })).toThrow(
        message
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it.each([
    { status: 401, code: 'invalid_api_key', message: /API key was rejected/ },
    { status: 429, code: 'insufficient_quota', message: /quota or rate limit/ },
  ])(
    'does not retry or expose credentials for HTTP $status / $code',
    async ({ status, code, message }) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response({ error: { code, message: `Provider echoes ${key}` } }, status)
        );
      const onRetry = vi.fn();
      const error = await createOpenAIProvider({ apiKey: key, model, fetchImpl, onRetry })
        .complete(request)
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ModelConnectionError);
      expect(error).toMatchObject({ status });
      expect((error as Error).message).toMatch(message);
      expect(String(error)).not.toContain(key);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    }
  );

  it('redacts repeated credentials and bounds provider error detail', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ error: { message: `${key}: ${key}. ${'x'.repeat(700)}` } }, 400)
      );
    const error = await createOpenAIProvider({ apiKey: key, model, fetchImpl })
      .complete(request)
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ModelConnectionError);
    expect((error as Error).message).toContain('[redacted]: [redacted]');
    expect((error as Error).message.length).toBeLessThanOrEqual(300);
    expect(String(error)).not.toContain(key);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'incomplete status', body: completed({ status: 'incomplete' }) },
    { label: 'failed status', body: completed({ status: 'failed' }) },
    { label: 'cancelled status', body: completed({ status: 'cancelled' }) },
    { label: 'queued status', body: completed({ status: 'queued' }) },
    { label: 'missing status', body: { output: [] } },
    { label: 'body error', body: completed({ error: { message: 'Test failure' } }) },
    { label: 'missing output', body: { status: 'completed' } },
    { label: 'nonarray output', body: completed({ output: {} }) },
    { label: 'null body', body: null },
  ])('rejects an unusable response: $label', async ({ body }) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    await expect(
      createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete(request)
    ).rejects.toBeInstanceOf(ModelConnectionError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid JSON and invalid tool-call fields', async () => {
    for (const result of [
      new Response('{'),
      response(
        completed({ output: [{ type: 'function_call', name: 'inspect_show', arguments: '{}' }] })
      ),
      response(
        completed({
          output: [
            { type: 'function_call', call_id: 'call-test', name: 'inspect_show', arguments: {} },
          ],
        })
      ),
    ]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(result);
      await expect(
        createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete(request)
      ).rejects.toBeInstanceOf(ModelConnectionError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('treats missing or malformed usage counters as unavailable zeros', async () => {
    for (const usage of [
      undefined,
      { input_tokens: -3, output_tokens: '17' },
      { input_tokens: null, output_tokens: null },
    ]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(completed({ usage })));
      const result = await createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete(
        request
      );
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
  });
});

describe('bounded provider retries and cancellation', () => {
  it.each([429, 500, 503])(
    'retries transient HTTP %s only twice with bounded backoff',
    async (status) => {
      vi.useFakeTimers();
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          response(
            { error: { code: 'rate_limit_exceeded', message: 'Temporary service failure.' } },
            status
          )
        );
      const onRetry = vi.fn();
      const pending = createOpenAIProvider({ apiKey: key, model, fetchImpl, onRetry }).complete(
        request
      );
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'ModelConnectionError',
        status,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(399);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(799);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(onRetry.mock.calls).toEqual([[1], [2]]);
    }
  );

  it('recovers from a transient network error and HTTP error without replaying unrelated requests', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError(`Synthetic network failure ${key}`))
      .mockResolvedValueOnce(response({ error: { code: 'server_error' } }, 502))
      .mockResolvedValueOnce(
        response(
          completed({
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'Recovered.' }] }],
          })
        )
      );
    const pending = createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete(request);
    await vi.advanceTimersByTimeAsync(1200);
    expect((await pending).text).toBe('Recovered.');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new Set(fetchImpl.mock.calls.map(([, init]) => init?.body)).size).toBe(1);
  });

  it('bounds network failures and hides their possibly sensitive error text', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError(`Synthetic error includes ${key}`));
    const pending = createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete(request);
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'ModelConnectionError',
      message: 'The model service could not be reached. Your show has not changed.',
    });
    await vi.advanceTimersByTimeAsync(1200);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not request a response for an already-aborted run', async () => {
    const controller = new AbortController(),
      reason = new Error('Synthetic cancellation.');
    controller.abort(reason);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete({
        ...request,
        signal: controller.signal,
      })
    ).rejects.toBe(reason);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes cancellation into an in-flight fetch and returns the original reason without retry', async () => {
    const controller = new AbortController(),
      reason = new Error('Synthetic in-flight cancellation.');
    let suppliedSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      suppliedSignal = init?.signal;
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      );
    });
    const onRetry = vi.fn();
    const pending = createOpenAIProvider({ apiKey: key, model, fetchImpl, onRetry }).complete({
      ...request,
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;
    expect(suppliedSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('cancels backoff immediately and never launches another retry', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      reason = new Error('Synthetic backoff cancellation.');
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Temporary failure.'));
    const pending = createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete({
      ...request,
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    await assertion;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves cancellation when reading a response body rejects after the run is aborted', async () => {
    const controller = new AbortController(),
      reason = new Error('Synthetic body-read cancellation.');
    let rejectBody!: (error: unknown) => void;
    const result = response(completed());
    vi.spyOn(result, 'json').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectBody = reject;
        })
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(result);
    const pending = createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete({
      ...request,
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toBe(reason);
    await Promise.resolve();
    controller.abort(reason);
    rejectBody(reason);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not return a late successful response body after cancellation', async () => {
    const controller = new AbortController(),
      reason = new Error('Synthetic late-body cancellation.');
    let resolveBody!: (body: unknown) => void;
    const result = response(completed());
    vi.spyOn(result, 'json').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBody = resolve;
        })
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(result);
    const pending = createOpenAIProvider({ apiKey: key, model, fetchImpl }).complete({
      ...request,
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toBe(reason);
    await Promise.resolve();
    controller.abort(reason);
    resolveBody(completed());
    await assertion;
  });
});
