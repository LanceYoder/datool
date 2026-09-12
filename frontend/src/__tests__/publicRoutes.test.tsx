// @vitest-environment jsdom
//
// The public routes and the session probe, with the REAL api.ts underneath
// (only `fetch` is stubbed) — because the bug this guards against lived in the
// seam between the two, and every test that mocks the api module away misses
// it.
//
// SessionProvider asks `GET /api/auth/me` on every page load, the public ones
// included, and a signed-out visitor gets a 401 for an answer. If that 401 is
// treated as "your session ran out", the provider redirects to /login — and
// the invitation link from a professor's mail, /reset-password/<uid>/<token>,
// takes its token with it. Provisioning by email would be unusable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { SessionProvider, RequireAuth } = await import('../session');

/** Prints the URL, so a redirect can be read off the page. */
function Here() {
  const location = useLocation();
  return <span data-testid="here">{`${location.pathname}${location.search}`}</span>;
}

function stubFetch(answer: (path: string) => Response) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
    Promise.resolve(answer(String(input))),
  );
}

/** Signed out: the CSRF bootstrap works, everything else is a 401. */
function signedOut() {
  stubFetch((path) =>
    path === '/api/auth/csrf'
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ errors: ['Authentication credentials were not provided.'] }), {
          status: 401,
        }),
  );
}

function mount(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <SessionProvider>
        <Here />
        <Routes>
          <Route path="/login" element={<p>Sign in</p>} />
          <Route path="/register" element={<p>Register</p>} />
          <Route path="/forgot-password" element={<p>Forgot</p>} />
          <Route path="/reset-password/:uid/:token" element={<p>Set your password</p>} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <p>The work</p>
              </RequireAuth>
            }
          />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signedOut();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('a signed-out visitor on a public page', () => {
  it('stays on the invitation link, token and all', async () => {
    mount('/reset-password/Mg/set-me-1a2b3c');
    await screen.findByText('Set your password');
    // Long enough for the session probe to have answered and, if it were going
    // to, redirected.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('here').textContent).toBe('/reset-password/Mg/set-me-1a2b3c');
    expect(screen.queryByText('Sign in')).toBeNull();
  });

  it('stays on /register', async () => {
    mount('/register');
    await screen.findByText('Register');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('here').textContent).toBe('/register');
  });

  it('stays on /forgot-password', async () => {
    mount('/forgot-password');
    await screen.findByText('Forgot');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('here').textContent).toBe('/forgot-password');
  });

  it('IS sent to sign in from a page that is somebody’s own work', async () => {
    // The guard, not the 401, is what decides this — and it carries `next`.
    mount('/');
    await waitFor(() => {
      expect(screen.getByTestId('here').textContent).toBe('/login?next=%2F');
    });
  });
});
