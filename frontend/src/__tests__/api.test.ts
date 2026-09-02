// The API client's own behaviour, with fetch stubbed: the request it sends and
// the shape it hands back. (The server's side of the same contract is pinned in
// da/tests/test_text_flow.py.)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getTextFlow } from '../api';
import type { TextFlow } from '../types';

const FLOW: TextFlow = {
  lines: [
    { start: 10, end: 14, indent: 0 },
    { start: 15, end: 18, indent: 1 },
  ],
};

/** Stub fetch with one response; returns the recorded calls. */
function stubFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        statusText: status === 200 ? 'OK' : 'Bad Request',
      }),
    );
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getTextFlow', () => {
  it('asks for the range and unwraps the flow', async () => {
    const calls = stubFetch({ textFlow: FLOW });
    await expect(getTextFlow(10, 18)).resolves.toEqual(FLOW);
    expect(calls).toEqual(['/api/text-flow?start=10&end=18']);
  });

  it('sends ONE request — the flow is derived per sentence, never chunked', async () => {
    const calls = stubFetch({ textFlow: FLOW });
    await getTextFlow(0, 5000);
    expect(calls).toHaveLength(1);
  });

  it('surfaces the server errors', async () => {
    stubFetch({ errors: ['range exceeds the 2000-word cap'] }, { status: 400 });
    await expect(getTextFlow(0, 9999)).rejects.toMatchObject({
      status: 400,
      errors: ['range exceeds the 2000-word cap'],
    });
    await expect(getTextFlow(0, 9999)).rejects.toBeInstanceOf(ApiError);
  });
});
