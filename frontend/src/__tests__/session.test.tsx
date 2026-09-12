// @vitest-environment jsdom
//
// The session around the app (accounts-spec §8): the guard on everything that
// is somebody's own work, the 401 that means the session ran out, and the
// header links each role gets.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Me } from '../types';

class FakeApiError extends Error {
  readonly status: number;
  readonly errors: string[];
  constructor(status: number, errors: string[] = []) {
    super(errors.join('; '));
    this.status = status;
    this.errors = errors;
  }
}

const api = {
  getMe: vi.fn(),
  logout: vi.fn(),
};

/** Whatever `setUnauthorizedHandler` last installed. */
let unauthorized: ((path: string) => void) | null = null;

vi.mock('../api', () => ({
  ApiError: FakeApiError,
  errorMessages: (err: unknown) => [String(err)],
  fetchCsrf: () => Promise.resolve({ ok: true }),
  getMe: () => api.getMe(),
  logout: () => api.logout(),
  setUnauthorizedHandler: (handler: ((path: string) => void) | null) => {
    unauthorized = handler;
    return () => {
      unauthorized = null;
    };
  },
  // Everything the pages behind the guard would reach for.
  listAnalyses: () => Promise.resolve([]),
  listDeletedAnalyses: () => Promise.resolve([]),
  changePassword: () => Promise.resolve(),
}));

const { RequireAuth, SessionProvider, useSession } = await import('../session');

const STUDENT: Me = {
  id: 2,
  email: null,
  handle: 'greek101-smith',
  name: 'Sam Smith',
  memberships: [
    {
      membershipId: 12,
      org: { id: 5, name: 'Greek 101', slug: 'greek-101' },
      role: 'student',
      active: true,
    },
  ],
  invitations: [],
  policy: null,
  isStaff: false,
};

const PROFESSOR: Me = {
  ...STUDENT,
  id: 3,
  email: 'prof@example.edu',
  handle: null,
  name: 'Prof Ada',
  memberships: [
    {
      membershipId: 11,
      org: { id: 5, name: 'Greek 101', slug: 'greek-101' },
      role: 'professor',
      active: true,
    },
    {
      membershipId: 10,
      org: { id: 6, name: 'Seminary', slug: 'sem' },
      role: 'admin',
      active: true,
    },
  ],
};

/** Prints the URL, so a redirect can be read off the page. */
function Where() {
  const location = useLocation();
  return <p>at:{location.pathname}{location.search}</p>;
}

function Guarded() {
  return (
    <RequireAuth>
      <p>the work</p>
    </RequireAuth>
  );
}

function mount(at: string, children: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <SessionProvider>
        <Where />
        {children}
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getMe.mockReset();
  api.logout.mockReset();
  api.logout.mockResolvedValue(undefined);
  unauthorized = null;
});

afterEach(cleanup);

describe('RequireAuth', () => {
  it('lets a signed-in reader through', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    mount('/analysis/7', <Guarded />);
    expect(await screen.findByText('the work')).toBeTruthy();
  });

  it('sends a signed-out one to /login, carrying where they were headed', async () => {
    api.getMe.mockRejectedValue(new FakeApiError(401));
    mount('/analysis/7?x=1', <Guarded />);
    expect(await screen.findByText('at:/login?next=%2Fanalysis%2F7%3Fx%3D1')).toBeTruthy();
    expect(screen.queryByText('the work')).toBeNull();
  });

  it('decides nothing while the session is still loading', () => {
    api.getMe.mockReturnValue(new Promise(() => {}));
    mount('/analysis/7', <Guarded />);
    // Neither through nor bounced: the page waits.
    expect(screen.queryByText('the work')).toBeNull();
    expect(screen.getByText('at:/analysis/7')).toBeTruthy();
  });
});

describe('the 401 hook the provider installs', () => {
  it('bounces to /login with the page it was on', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    mount('/analysis/7', <Guarded />);
    await screen.findByText('the work');

    expect(unauthorized).not.toBeNull();
    unauthorized!('/api/analyses/7');
    await waitFor(() => {
      expect(screen.getByText('at:/login?next=%2Fanalysis%2F7')).toBeTruthy();
    });
  });

  it('bounces ONCE however many requests fail together', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    mount('/analysis/7', <Guarded />);
    await screen.findByText('the work');
    unauthorized!('/api/analyses/7');
    unauthorized!('/api/taxonomy');
    unauthorized!('/api/corpus/words');
    await waitFor(() => {
      expect(screen.getByText('at:/login?next=%2Fanalysis%2F7')).toBeTruthy();
    });
  });
});

describe('the session value', () => {
  function Readout() {
    const { user, policy, loading } = useSession();
    return (
      <p>
        {loading ? 'loading' : (user?.name ?? 'nobody')}/
        {policy.aids.english ? 'english' : 'no-english'}
      </p>
    );
  }

  it('hands an individual the "everything allowed" policy', async () => {
    api.getMe.mockResolvedValue({ ...STUDENT, policy: null });
    mount('/', <Readout />);
    expect(await screen.findByText('Sam Smith/english')).toBeTruthy();
  });

  it('hands a student the policy their professor set', async () => {
    api.getMe.mockResolvedValue({
      ...STUDENT,
      policy: {
        firstPass: { allowed: ['minimal'] },
        aids: { english: false, verses: true, verbs: true, colorCoding: true },
      },
    });
    mount('/', <Readout />);
    expect(await screen.findByText('Sam Smith/no-english')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The header, which is where a role becomes a link.

const App = (await import('../App')).default;

function app(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <App />
    </MemoryRouter>,
  );
}

describe('the header', () => {
  it('offers Sign in and nothing else to a stranger', async () => {
    api.getMe.mockRejectedValue(new FakeApiError(401));
    app('/login');
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('names the reader, and keeps the New-analysis link', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    app('/account');
    expect(await screen.findByRole('link', { name: 'Sam Smith' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New analysis' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('gives a student no organization or teaching link', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    app('/account');
    await screen.findByRole('link', { name: 'Sam Smith' });
    expect(screen.queryByRole('link', { name: /^Organization/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Teaching/ })).toBeNull();
  });

  it('gives a professor-and-admin both, each pointing at its own org', async () => {
    api.getMe.mockResolvedValue(PROFESSOR);
    app('/account');
    const org = await screen.findByRole('link', { name: 'Organization' });
    expect(org.getAttribute('href')).toBe('/org/6');
    expect(screen.getByRole('link', { name: 'Teaching' }).getAttribute('href')).toBe('/teach/5');
  });

  it('signs out through the API and lands on /login', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    app('/account');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(api.logout).toHaveBeenCalled();
    });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The skin is a signed-in reader's choice: the way in is always the original
// design, and the picker is not offered until somebody is signed in.

describe('the site design', () => {
  const skin = () => document.documentElement.dataset.theme;

  beforeEach(() => {
    window.localStorage.setItem('datool.theme', 'slate');
  });

  it('is the original on the sign-in page, whatever the browser remembers', async () => {
    api.getMe.mockRejectedValue(new FakeApiError(401));
    app('/login');
    await screen.findByRole('link', { name: 'Sign in' });
    expect(skin()).toBe('original');
    expect(screen.queryByRole('group', { name: 'Site design' })).toBeNull();
  });

  it('offers no picker to a stranger anywhere', async () => {
    api.getMe.mockRejectedValue(new FakeApiError(401));
    app('/register');
    await screen.findByRole('link', { name: 'Sign in' });
    expect(skin()).toBe('original');
    expect(screen.queryByRole('group', { name: 'Site design' })).toBeNull();
  });

  it('comes back, with its picker, once the reader is signed in', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    app('/account');
    await screen.findByRole('link', { name: 'Sam Smith' });
    expect(skin()).toBe('slate');
    expect(screen.getByRole('group', { name: 'Site design' })).toBeTruthy();
  });

  it('falls back to the original the moment the reader signs out', async () => {
    api.getMe.mockResolvedValue(STUDENT);
    app('/account');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(skin()).toBe('original');
    expect(screen.queryByRole('group', { name: 'Site design' })).toBeNull();
    // The choice itself is kept for next time.
    expect(window.localStorage.getItem('datool.theme')).toBe('slate');
  });
});
