// @vitest-environment jsdom
//
// The four pages that stand outside the session (accounts-spec §8): what they
// send, where they go next, and what they say when the server refuses.
//
// The api module is mocked whole (the TextFlowPanel test's pattern), so these
// are about the PAGES — the field that takes an email or a handle, the `next`
// a bounced request left behind, the reset that hands you on to sign in — and
// never about fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '../../types';

const ME: Me = {
  id: 1,
  email: 'ada@example.com',
  handle: null,
  name: 'Ada',
  memberships: [],
  invitations: [],
  policy: null,
  isStaff: false,
};

class FakeApiError extends Error {
  readonly status: number;
  readonly errors: string[];
  constructor(status: number, errors: string[]) {
    super(errors.join('; '));
    this.status = status;
    this.errors = errors;
  }
}

const api = {
  login: vi.fn(),
  register: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  getMe: vi.fn(),
  fetchCsrf: vi.fn(),
  logout: vi.fn(),
};

vi.mock('../../api', () => ({
  ApiError: FakeApiError,
  errorMessages: (err: unknown) =>
    err instanceof FakeApiError ? err.errors : [String((err as Error).message ?? err)],
  setUnauthorizedHandler: () => () => {},
  fetchCsrf: () => api.fetchCsrf(),
  getMe: () => api.getMe(),
  logout: () => api.logout(),
  login: (input: unknown) => api.login(input),
  register: (input: unknown) => api.register(input),
  forgotPassword: (email: string) => api.forgotPassword(email),
  resetPassword: (input: unknown) => api.resetPassword(input),
}));

const LoginPage = (await import('../LoginPage')).default;
const RegisterPage = (await import('../RegisterPage')).default;
const ForgotPasswordPage = (await import('../ForgotPasswordPage')).default;
const ResetPasswordPage = (await import('../ResetPasswordPage')).default;
const { SessionProvider } = await import('../../session');

/** Whatever the route landed on, printed so a redirect can be asserted. */
function Landed({ where }: { where: string }) {
  return <p>landed:{where}</p>;
}

function mount(page: React.ReactNode, at: string, path: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <SessionProvider>
        <Routes>
          <Route path={path} element={page} />
          <Route path="/" element={<Landed where="home" />} />
          <Route path="/login" element={<Landed where="login" />} />
          <Route path="/analysis/:id" element={<Landed where="analysis" />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => {
  fireEvent.change(field(label), { target: { value } });
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  // Nobody is signed in unless a test says so.
  api.getMe.mockRejectedValue(new FakeApiError(401, ['auth required']));
  api.fetchCsrf.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe('/login', () => {
  it('takes an email OR a handle in the one field, and posts it as `login`', async () => {
    api.login.mockResolvedValue(ME);
    mount(<LoginPage />, '/login', '/login');
    await screen.findByRole('button', { name: 'Sign in' });

    type('Email or login handle', 'greek101-smith');
    type('Password', 'hunter2');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith({ login: 'greek101-smith', password: 'hunter2' });
    });
  });

  it('returns to where the bounced request came from', async () => {
    api.login.mockResolvedValue(ME);
    mount(<LoginPage />, '/login?next=%2Fanalysis%2F7', '/login');
    await screen.findByRole('button', { name: 'Sign in' });

    type('Email or login handle', 'ada');
    type('Password', 'x');
    // The session answers with the user once the sign-in has happened.
    api.getMe.mockResolvedValue(ME);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('landed:analysis')).toBeTruthy();
  });

  it('shows the server’s refusal and stays put', async () => {
    api.login.mockRejectedValue(new FakeApiError(400, ['That password is not right.']));
    mount(<LoginPage />, '/login', '/login');
    await screen.findByRole('button', { name: 'Sign in' });

    type('Email or login handle', 'ada');
    type('Password', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That password is not right.')).toBeTruthy();
    // Still on the form, with what was typed.
    expect(field('Email or login handle').value).toBe('ada');
  });

  it('will not submit an empty form', async () => {
    mount(<LoginPage />, '/login', '/login');
    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('/register', () => {
  it('creates an individual account and goes straight to the work', async () => {
    api.register.mockResolvedValue(ME);
    mount(<RegisterPage />, '/register', '/register');
    await screen.findByRole('button', { name: 'Create account' });

    type('Email', 'ada@example.com');
    type('Name', 'Ada');
    type('Password', 'hunter2');
    api.getMe.mockResolvedValue(ME);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(api.register).toHaveBeenCalledWith({
        email: 'ada@example.com',
        name: 'Ada',
        password: 'hunter2',
      });
    });
    expect(await screen.findByText('landed:home')).toBeTruthy();
  });

  it('leaves an empty name out of the body rather than sending ""', async () => {
    api.register.mockResolvedValue(ME);
    mount(<RegisterPage />, '/register', '/register');
    await screen.findByRole('button', { name: 'Create account' });

    type('Email', 'ada@example.com');
    type('Password', 'hunter2');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(api.register).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'hunter2' });
    });
  });
});

describe('/forgot-password', () => {
  it('says the same thing whatever the address was', async () => {
    api.forgotPassword.mockResolvedValue(undefined);
    mount(<ForgotPasswordPage />, '/forgot-password', '/forgot-password');
    await screen.findByRole('button', { name: 'Send reset link' });

    type('Email', 'stranger@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'If that address has an account, a reset link is on its way to it.',
    );
    expect(api.forgotPassword).toHaveBeenCalledWith('stranger@example.com');
  });
});

describe('/reset-password/:uid/:token', () => {
  const at = '/reset-password/MQ/set-token';
  const path = '/reset-password/:uid/:token';

  it('sends the uid and token from the URL', async () => {
    api.resetPassword.mockResolvedValue(undefined);
    mount(<ResetPasswordPage />, at, path);
    await screen.findByRole('button', { name: 'Set password' });

    type('New password', 'hunter2');
    type('New password again', 'hunter2');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => {
      expect(api.resetPassword).toHaveBeenCalledWith({
        uid: 'MQ',
        token: 'set-token',
        password: 'hunter2',
      });
    });
  });

  it('refuses to submit two passwords that differ', async () => {
    mount(<ResetPasswordPage />, at, path);
    await screen.findByRole('button', { name: 'Set password' });

    type('New password', 'hunter2');
    type('New password again', 'hunter3');
    expect(
      (screen.getByRole('button', { name: 'Set password' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('The two do not match yet.')).toBeTruthy();
  });

  it('hands the reader on to sign in, and does not pretend they are signed in', async () => {
    api.resetPassword.mockResolvedValue(undefined);
    mount(<ResetPasswordPage />, at, path);
    await screen.findByRole('button', { name: 'Set password' });

    type('New password', 'hunter2');
    type('New password again', 'hunter2');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    const go = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.click(go);
    expect(await screen.findByText('landed:login')).toBeTruthy();
  });

  it('shows an expired token’s refusal', async () => {
    api.resetPassword.mockRejectedValue(new FakeApiError(400, ['This link has expired.']));
    mount(<ResetPasswordPage />, at, path);
    await screen.findByRole('button', { name: 'Set password' });

    type('New password', 'hunter2');
    type('New password again', 'hunter2');
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('This link has expired.')).toBeTruthy();
  });
});
