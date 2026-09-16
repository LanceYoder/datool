// @vitest-environment jsdom
//
// The two pages a role opens onto (accounts-spec §8): the admin's members
// table with its one way to make an account (by email), and the professor's
// students with the policy they work under.
//
// The claim worth pinning on the admin side is the HAND-OUT: when the server
// answers with an invite or reset link (mail could not be sent), that is the
// only time anyone will ever see it, so the page must show it rather than
// swallow it — and when mail went out, there is nothing to show but a notice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrgMember, Policy } from '../../types';
import { DEFAULT_POLICY } from '../../types';

const PROFESSOR_ROW: OrgMember = {
  membershipId: 11,
  user: { id: 3, email: 'prof@example.edu', name: 'Prof Ada' },
  role: 'professor',
  professor: null,
  active: true,
  pending: false,
  provisioned: true,
};

const STUDENT_ROW: OrgMember = {
  membershipId: 12,
  user: { id: 4, email: 'sam@example.edu', name: 'Sam Smith' },
  role: 'student',
  professor: { id: 11, name: 'Prof Ada' },
  active: true,
  pending: false,
  provisioned: true,
};

/** A member who joined with an account of their own: nobody here resets it. */
const JOINED_ROW: OrgMember = {
  membershipId: 15,
  user: { id: 7, email: 'own@example.edu', name: 'Own Account' },
  role: 'student',
  professor: { id: 11, name: 'Prof Ada' },
  active: true,
  pending: false,
  provisioned: false,
};

const api = {
  listOrgMembers: vi.fn(),
  createOrgMember: vi.fn(),
  updateOrgMember: vi.fn(),
  resetMemberPassword: vi.fn(),
  getOrgPolicy: vi.fn(),
  setOrgPolicy: vi.fn(),
  setMemberPolicyOverride: vi.fn(),
};

vi.mock('../../api', () => ({
  errorMessages: (err: unknown) => [String(err)],
  listOrgMembers: (id: string) => api.listOrgMembers(id),
  createOrgMember: (id: string, input: unknown) => api.createOrgMember(id, input),
  updateOrgMember: (id: string, mid: number, input: unknown) =>
    api.updateOrgMember(id, mid, input),
  resetMemberPassword: (id: string, mid: number) => api.resetMemberPassword(id, mid),
  getOrgPolicy: (id: string) => api.getOrgPolicy(id),
  setOrgPolicy: (id: string, policy: Policy) => api.setOrgPolicy(id, policy),
  setMemberPolicyOverride: (id: string, mid: number, override: unknown) =>
    api.setMemberPolicyOverride(id, mid, override),
}));

const OrgPage = (await import('../OrgPage')).default;
const TeachPage = (await import('../TeachPage')).default;

function mount(page: React.ReactNode, path: string, at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path={path} element={page} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listOrgMembers.mockResolvedValue([PROFESSOR_ROW, STUDENT_ROW]);
  api.getOrgPolicy.mockResolvedValue(DEFAULT_POLICY);
  api.setOrgPolicy.mockImplementation((_id: string, policy: Policy) => Promise.resolve(policy));
  api.setMemberPolicyOverride.mockResolvedValue(undefined);
  api.updateOrgMember.mockResolvedValue(STUDENT_ROW);
  vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('/org/:id — the members table', () => {
  it('lists each member with their email', async () => {
    mount(<OrgPage />, '/org/:id', '/org/5');
    // "Prof Ada" also names an <option> in the professor pickers, so the row
    // is looked for where a row lives.
    await screen.findByText('prof@example.edu');
    const cells = [...document.querySelectorAll('.member-table td')].map((td) => td.textContent);
    expect(cells).toContain('Prof Ada');
    expect(cells).toContain('Sam Smith');
    expect(cells).toContain('sam@example.edu');
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeTruthy();
  });

  it('adds a member by email, name, role and professor — and says the mail went out', async () => {
    api.createOrgMember.mockResolvedValue({ invited: true, membershipId: 14, inviteLink: null });
    mount(<OrgPage />, '/org/:id', '/org/5');
    await screen.findByText('prof@example.edu');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.edu' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Newcomer' } });
    fireEvent.change(screen.getByLabelText('Professor'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => {
      expect(api.createOrgMember).toHaveBeenCalledWith('5', {
        role: 'student',
        email: 'new@example.edu',
        name: 'Newcomer',
        professor: 11,
      });
    });
    expect(await screen.findByText(/new@example\.edu has been sent an email/)).toBeTruthy();
    // Nothing to hand out: the link went by mail.
    expect(document.querySelector('.handout')).toBeNull();
  });

  it('shows the invite link, once, when mail could not be sent', async () => {
    api.createOrgMember.mockResolvedValue({
      invited: true,
      membershipId: 14,
      inviteLink: 'https://datool.example/reset-password/MQ/tok',
    });
    mount(<OrgPage />, '/org/:id', '/org/5');
    await screen.findByText('prof@example.edu');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(
      await screen.findByText('https://datool.example/reset-password/MQ/tok'),
    ).toBeTruthy();
    expect(screen.getByText(/shown once/)).toBeTruthy();
  });

  it('offers no account kind and no password: an email is the only way in', async () => {
    mount(<OrgPage />, '/org/:id', '/org/5');
    await screen.findByText('prof@example.edu');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect((screen.getByLabelText('Email') as HTMLInputElement).type).toBe('email');
  });

  it('assigns a student to a professor by MEMBERSHIP id', async () => {
    mount(<OrgPage />, '/org/:id', '/org/5');
    await screen.findByText('Sam Smith');
    fireEvent.change(screen.getByLabelText('Professor for Sam Smith'), {
      target: { value: '11' },
    });
    await waitFor(() => {
      expect(api.updateOrgMember).toHaveBeenCalledWith('5', 12, { professor: 11 });
    });
  });

  it('deactivates a member rather than deleting them', async () => {
    mount(<OrgPage />, '/org/:id', '/org/5');
    await screen.findByText('Sam Smith');
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[1]!);
    await waitFor(() => {
      expect(api.updateOrgMember).toHaveBeenCalledWith('5', 12, { active: false });
    });
  });

  it('sends a reset link to a PROVISIONED member, and offers none to their own account', async () => {
    api.listOrgMembers.mockResolvedValue([PROFESSOR_ROW, STUDENT_ROW, JOINED_ROW]);
    api.resetMemberPassword.mockResolvedValue({ sent: true, resetLink: null });
    mount(<OrgPage />, '/org/:id', '/org/5');
    await screen.findByText('Own Account');
    // Two provisioned accounts get the control; the one they brought does not.
    const buttons = screen.getAllByRole('button', { name: 'Send reset link' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    await waitFor(() => {
      expect(api.resetMemberPassword).toHaveBeenCalledWith('5', 12);
    });
    expect(await screen.findByText(/A reset link is on its way to Sam Smith/)).toBeTruthy();
    expect(document.querySelector('.handout')).toBeNull();
  });

  it('shows the reset link, once, when the reset mail could not be sent', async () => {
    api.resetMemberPassword.mockResolvedValue({
      sent: false,
      resetLink: 'https://datool.example/reset-password/Mg/tok2',
    });
    mount(<OrgPage />, '/org/:id', '/org/5');
    await screen.findByText('Sam Smith');
    fireEvent.click(screen.getAllByRole('button', { name: 'Send reset link' })[1]!);
    expect(
      await screen.findByText('https://datool.example/reset-password/Mg/tok2'),
    ).toBeTruthy();
  });
});

describe('/teach/:id — the policy editor', () => {
  it('lists the students, with their email, and links to their analyses', async () => {
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    const link = await screen.findByRole('link', { name: 'Analyses' });
    expect(link.getAttribute('href')).toBe('/students/12?org=5');
    expect(screen.getByText('sam@example.edu')).toBeTruthy();
  });

  it('adds a student by email and name, and says the mail went out', async () => {
    api.createOrgMember.mockResolvedValue({ invited: true, membershipId: 21, inviteLink: null });
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    await screen.findByRole('link', { name: 'Analyses' });
    expect(screen.queryByRole('radiogroup')).toBeNull();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kid@example.edu' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add student' }));

    await waitFor(() => {
      expect(api.createOrgMember).toHaveBeenCalledWith('5', {
        role: 'student',
        email: 'kid@example.edu',
        name: 'Kid',
      });
    });
    expect(await screen.findByText(/kid@example\.edu has been sent an email/)).toBeTruthy();
    expect(document.querySelector('.handout')).toBeNull();
  });

  it('shows the invite link only when the server returned one', async () => {
    api.createOrgMember.mockResolvedValue({
      invited: true,
      membershipId: 21,
      inviteLink: 'https://datool.example/reset-password/Mw/tok3',
    });
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    await screen.findByRole('link', { name: 'Analyses' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kid@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add student' }));
    expect(
      await screen.findByText('https://datool.example/reset-password/Mw/tok3'),
    ).toBeTruthy();
  });

  it('resets a PROVISIONED student by mail, and offers no reset for their own account', async () => {
    api.listOrgMembers.mockResolvedValue([PROFESSOR_ROW, STUDENT_ROW, JOINED_ROW]);
    api.resetMemberPassword.mockResolvedValue({ sent: true, resetLink: null });
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    await screen.findByText('Own Account');
    const buttons = screen.getAllByRole('button', { name: 'Reset password' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(api.resetMemberPassword).toHaveBeenCalledWith('5', 12);
    });
    expect(await screen.findByText(/A reset link is on its way to Sam Smith/)).toBeTruthy();
    expect(document.querySelector('.handout')).toBeNull();
  });

  it('says in plain language what students see — and offers no gesture switch', async () => {
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    expect(await screen.findByText('the English line')).toBeTruthy();
    expect(screen.getByText('verb highlighting')).toBeTruthy();
    // The gestures are not class rules (§5): no switch for them exists.
    expect(screen.queryByText('make relationships')).toBeNull();
    expect(screen.queryByText('delete relationships')).toBeNull();
    expect(screen.queryByText('write notes')).toBeNull();
  });

  it('saves one switch as a whole policy, the other keys untouched', async () => {
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    await screen.findByText('verb highlighting');
    fireEvent.click(screen.getByLabelText('verb highlighting'));
    await waitFor(() => {
      expect(api.setOrgPolicy).toHaveBeenCalledWith('5', {
        ...DEFAULT_POLICY,
        aids: { ...DEFAULT_POLICY.aids, verbs: false },
      });
    });
  });

  it('narrows the tiers a student may start from', async () => {
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    await screen.findByText('nothing');
    fireEvent.click(screen.getByLabelText('full'));
    await waitFor(() => {
      expect(api.setOrgPolicy).toHaveBeenCalledWith('5', {
        ...DEFAULT_POLICY,
        firstPass: { allowed: ['none', 'minimal'] },
      });
    });
  });

  it('will not leave a student with nowhere to start', async () => {
    api.getOrgPolicy.mockResolvedValue({
      ...DEFAULT_POLICY,
      firstPass: { allowed: ['minimal'] },
    });
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    await screen.findByText('minimal');
    fireEvent.click(screen.getByLabelText('minimal'));
    expect(api.setOrgPolicy).not.toHaveBeenCalled();
  });

  it('starts every student on “uses your default”, and sends null to go back', async () => {
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    const toggle = await screen.findByRole('button', { name: /Uses your default/ });
    fireEvent.click(toggle);

    // Each override switch offers the default as a position of its own. The
    // per-student panel says the same words as the class default above it, so
    // the queries are scoped to the panel that was opened.
    const panel = within(document.querySelector('.policy-override') as HTMLElement);
    const row = panel.getByLabelText('the English line');
    expect([...row.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Uses your default (yes)',
      'Yes',
      'No',
    ]);

    fireEvent.change(row, { target: { value: 'no' } });
    await waitFor(() => {
      expect(api.setMemberPolicyOverride).toHaveBeenCalledWith('5', 12, {
        aids: { english: false },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back to your default' }));
    await waitFor(() => {
      expect(api.setMemberPolicyOverride).toHaveBeenCalledWith('5', 12, null);
    });
  });

  it('overrides the first-pass tiers for ONE student', async () => {
    // §5 gives an override the same key set as the default policy, and the
    // tier list is part of it: one student may build from nothing while the
    // rest of the class starts from minimal.
    api.getOrgPolicy.mockResolvedValue({
      ...DEFAULT_POLICY,
      firstPass: { allowed: ['minimal', 'full'] },
    });
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    fireEvent.click(await screen.findByRole('button', { name: /Uses your default/ }));

    const panel = within(document.querySelector('.policy-override') as HTMLElement);
    const tierRow = panel.getByLabelText('first pass');
    expect([...tierRow.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Uses your default (minimal, full)',
      'Just for this student',
    ]);

    // Overriding starts from the class default, then the switches narrow it.
    fireEvent.change(tierRow, { target: { value: 'override' } });
    await waitFor(() => {
      expect(api.setMemberPolicyOverride).toHaveBeenCalledWith('5', 12, {
        firstPass: { allowed: ['minimal', 'full'] },
      });
    });
    fireEvent.click(panel.getByLabelText('nothing'));
    await waitFor(() => {
      expect(api.setMemberPolicyOverride).toHaveBeenLastCalledWith('5', 12, {
        firstPass: { allowed: ['none', 'minimal', 'full'] },
      });
    });
    // Back to the default: the key goes, and an emptied override is null.
    fireEvent.change(panel.getByLabelText('first pass'), { target: { value: '' } });
    await waitFor(() => {
      expect(api.setMemberPolicyOverride).toHaveBeenLastCalledWith('5', 12, null);
    });
  });

  it('shows an invited student as pending, and offers nothing to do to them', async () => {
    api.listOrgMembers.mockResolvedValue([
      PROFESSOR_ROW,
      {
        ...STUDENT_ROW,
        membershipId: 20,
        pending: true,
        provisioned: false,
        user: { id: null, email: 'joiner@example.edu', name: '' },
      },
    ]);
    mount(<TeachPage />, '/teach/:id', '/teach/5');
    expect(await screen.findByText(/waiting for their answer/)).toBeTruthy();
    // No work to open, no password to reset, no rules to bend: they have not
    // agreed to be here yet.
    expect(screen.queryByRole('link', { name: 'Analyses' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset password' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Uses your default/ })).toBeNull();
  });
});
