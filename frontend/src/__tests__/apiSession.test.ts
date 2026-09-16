// @vitest-environment jsdom
//
// The SESSION mechanics of the API client (accounts-spec §3): the cookie goes
// with every request, every mutating one carries Django's CSRF header, and a
// 401 that is not an answer to a sign-in attempt is reported to whoever
// installed the handler.
//
// jsdom, because the CSRF token is read off `document.cookie` and there is no
// other way to have one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnalysis,
  csrfToken,
  fetchCsrf,
  firstPass,
  getMe,
  listAnalyses,
  login,
  logout,
  setUnauthorizedHandler,
  updateMe,
} from '../api';
import type { DocumentV2 } from '../types';

interface Call {
  url: string;
  init: RequestInit;
}

/** Stub fetch; returns the recorded calls. `status` may vary per call. */
function stubFetch(body: unknown, status: number | number[] = 200): Call[] {
  const calls: Call[] = [];
  const codes = Array.isArray(status) ? status : [status];
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const code = codes[Math.min(calls.length, codes.length - 1)] ?? 200;
    calls.push({ url, init });
    return Promise.resolve(
      // 204 carries no body at all — the Response constructor refuses one.
      new Response(code === 204 ? null : JSON.stringify(body), {
        status: code,
        statusText: code === 200 ? 'OK' : 'Error',
      }),
    );
  });
  return calls;
}

/** Put a csrftoken cookie in place, as `GET /api/auth/csrf` would. */
function setCookie(value: string) {
  document.cookie = `csrftoken=${value}`;
}

function clearCookies() {
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (name !== undefined && name !== '') {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

const DOC: DocumentV2 = { schemaVersion: 2, propositions: [], forest: [] };

beforeEach(clearCookies);

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  clearCookies();
});

describe('credentials', () => {
  it('sends the session cookie on a READ', async () => {
    const calls = stubFetch([]);
    await listAnalyses();
    expect(calls[0]?.init.credentials).toBe('same-origin');
  });

  it('sends the session cookie on a WRITE', async () => {
    setCookie('tok');
    const calls = stubFetch({});
    await createAnalysis({ document: DOC });
    expect(calls[0]?.init.credentials).toBe('same-origin');
  });
});

describe('CSRF', () => {
  it('reads the token off the cookie', () => {
    expect(csrfToken()).toBeNull();
    setCookie('abc123');
    expect(csrfToken()).toBe('abc123');
  });

  it('puts the token on a mutating request', async () => {
    setCookie('abc123');
    const calls = stubFetch({});
    await createAnalysis({ document: DOC });
    expect((calls[0]?.init.headers as Record<string, string>)['X-CSRFToken']).toBe('abc123');
  });

  it('sends NO token on a read — Django checks none there', async () => {
    setCookie('abc123');
    const calls = stubFetch([]);
    await listAnalyses();
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers['X-CSRFToken']).toBeUndefined();
  });

  it('bootstraps the cookie before the first write of a page load', async () => {
    // No cookie yet: the client fetches /api/auth/csrf first, and the write
    // that follows carries the token that call set.
    const calls: Call[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url === '/api/auth/csrf') setCookie('fresh');
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    await login({ email: 'ada@example.com', password: 'x' });
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/csrf', '/api/auth/login']);
    expect((calls[1]?.init.headers as Record<string, string>)['X-CSRFToken']).toBe('fresh');
  });

  it('does not bootstrap the bootstrap', async () => {
    const calls = stubFetch({ ok: true });
    await fetchCsrf();
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/csrf']);
  });
});

describe('the 401 handler', () => {
  it('fires when a request loses its session', async () => {
    const seen: string[] = [];
    setUnauthorizedHandler((path) => seen.push(path));
    stubFetch({ errors: ['auth required'] }, 401);
    await expect(listAnalyses()).rejects.toMatchObject({ status: 401 });
    expect(seen).toEqual(['/api/analyses']);
  });

  it('does NOT fire for a refused sign-in: that 401 is an answer', async () => {
    setCookie('tok');
    const seen: string[] = [];
    setUnauthorizedHandler((path) => seen.push(path));
    stubFetch({ errors: ['wrong password'] }, 401);
    await expect(login({ email: 'ada@example.com', password: 'no' })).rejects.toMatchObject({ status: 401 });
    expect(seen).toEqual([]);
  });

  it('does NOT fire for "who is signed in?": that 401 is an answer too', async () => {
    // SessionProvider asks this on EVERY page load, the public ones included.
    // Bouncing on it would send a signed-out visitor away from /register, from
    // /forgot-password, and out of the /reset-password/<uid>/<token> link in
    // their invitation mail — with the token gone.
    const seen: string[] = [];
    setUnauthorizedHandler((path) => seen.push(path));
    stubFetch({ errors: ['auth required'] }, 401);
    await expect(getMe()).rejects.toMatchObject({ status: 401 });
    expect(seen).toEqual([]);
  });

  it('DOES fire when a WRITE to /auth/me is refused', async () => {
    // Renaming yourself on /account is a different matter: a 401 there really
    // is a session that expired under the reader's hands.
    setCookie('tok');
    const seen: string[] = [];
    setUnauthorizedHandler((path) => seen.push(path));
    stubFetch({ errors: ['auth required'] }, 401);
    await expect(updateMe({ name: 'Ada' })).rejects.toMatchObject({ status: 401 });
    expect(seen).toEqual(['/api/auth/me']);
  });

  it('is uninstalled by the disposer it returns', async () => {
    const seen: string[] = [];
    const off = setUnauthorizedHandler((path) => seen.push(path));
    off();
    stubFetch({}, 401);
    await expect(listAnalyses()).rejects.toMatchObject({ status: 401 });
    expect(seen).toEqual([]);
  });
});

describe('the endpoints the pages call', () => {
  it('posts the tier, not the retired boolean', async () => {
    setCookie('tok');
    const calls = stubFetch({ document: DOC, alignment: null });
    await firstPass('Eph 1:3', 'none');
    expect(calls[0]?.url).toBe('/api/first-pass');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ text: 'Eph 1:3', tier: 'none' });
  });

  it('records the tier on the analysis it creates', async () => {
    setCookie('tok');
    const calls = stubFetch({});
    await createAnalysis({ title: 'T', document: DOC, firstPassTier: 'minimal' });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ firstPassTier: 'minimal' });
  });

  it('signs out with a POST and takes 204 for an answer', async () => {
    setCookie('tok');
    const calls = stubFetch(null, 204);
    await expect(logout()).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe('/api/auth/logout');
    expect(calls[0]?.init.method).toBe('POST');
  });
});
