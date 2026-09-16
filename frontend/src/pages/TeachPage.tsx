// The professor's page (accounts-spec §8): their students, the DEFAULT policy
// every one of them works under, and the per-student overrides that bend it.
//
// The switches are the policy's own key set said in plain language (§5), and
// the wording is shared with the "Class rules" line the student reads under
// the toolbar — one list, so the two can never say different things.
//
// A per-student switch has three positions, not two: "uses your default" is a
// state of its own, and it is the one every student starts in.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createOrgMember,
  errorMessages,
  getOrgPolicy,
  listOrgMembers,
  resetMemberPassword,
  setMemberPolicyOverride,
  setOrgPolicy,
} from '../api';
import { POLICY_GROUPS, TIER_CHOICES } from '../policy';
import type { FirstPassTier, OrgMember, Policy, PolicyOverride } from '../types';
import { HandOut, canReset, memberName } from './OrgPage';
import type { LinkHandout } from './OrgPage';

/** Read a dotted policy path out of an override, or undefined when unset. */
function overrideValue(override: PolicyOverride | null, key: string): boolean | undefined {
  const [group, field] = key.split('.') as [keyof PolicyOverride, string];
  const bag = override?.[group] as Record<string, unknown> | undefined;
  const value = bag?.[field];
  return typeof value === 'boolean' ? value : undefined;
}

/** Set (or clear) one dotted path in an override; an emptied override is null. */
function withOverride(
  override: PolicyOverride | null,
  key: string,
  value: boolean | undefined,
): PolicyOverride | null {
  const [group, field] = key.split('.') as [keyof PolicyOverride, string];
  const next: Record<string, Record<string, unknown>> = {};
  for (const [g, bag] of Object.entries(override ?? {})) {
    next[g] = { ...(bag as Record<string, unknown>) };
  }
  const bag = { ...(next[group] ?? {}) };
  if (value === undefined) delete bag[field];
  else bag[field] = value;
  if (Object.keys(bag).length === 0) delete next[group];
  else next[group] = bag;
  return Object.keys(next).length === 0 ? null : (next as PolicyOverride);
}

/**
 * The tiers this student is pinned to, or undefined for "uses your default".
 *
 * §5 gives an override the same key set as the default policy, and
 * `firstPass.allowed` is part of it — a professor may want one student to
 * build from nothing while the class starts from minimal. The switch groups
 * above carry booleans only, so the tier row is written out separately.
 */
function overrideTiers(override: PolicyOverride | null): FirstPassTier[] | undefined {
  const allowed = override?.firstPass?.allowed;
  return Array.isArray(allowed) ? allowed : undefined;
}

/** Set (or clear) the tier list in an override; an emptied override is null. */
function withTierOverride(
  override: PolicyOverride | null,
  tiers: FirstPassTier[] | undefined,
): PolicyOverride | null {
  const next: Record<string, unknown> = { ...(override ?? {}) };
  if (tiers === undefined) delete next.firstPass;
  else next.firstPass = { allowed: tiers };
  return Object.keys(next).length === 0 ? null : (next as PolicyOverride);
}

export default function TeachPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openStudent, setOpenStudent] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, PolicyOverride | null>>({});
  const [handout, setHandout] = useState<LinkHandout | null>(null);
  // What just happened when there is no link to hand over — the mail went out.
  const [notice, setNotice] = useState<string | null>(null);
  // A professor may make their own students (§6): by email, assigned to
  // themselves by the server.
  const [newStudent, setNewStudent] = useState({ email: '', name: '' });

  const load = useCallback(async () => {
    try {
      const rows = await listOrgMembers(id);
      setMembers(rows);
      setOverrides((prev) => {
        const next = { ...prev };
        for (const m of rows) {
          if (m.role === 'student' && !(m.membershipId in next)) {
            next[m.membershipId] = m.policyOverride ?? null;
          }
        }
        return next;
      });
    } catch (err) {
      setErrors(errorMessages(err));
    }
    try {
      setPolicy(await getOrgPolicy(id));
    } catch (err) {
      setErrors(errorMessages(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const students = (members ?? []).filter((m) => m.role === 'student');

  const savePolicy = async (next: Policy) => {
    setPolicy(next);
    setBusy(true);
    setErrors([]);
    setSaved(false);
    try {
      setPolicy(await setOrgPolicy(id, next));
      setSaved(true);
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  const saveOverride = async (mid: number, next: PolicyOverride | null) => {
    setOverrides((prev) => ({ ...prev, [mid]: next }));
    setErrors([]);
    try {
      await setMemberPolicyOverride(id, mid, next);
    } catch (err) {
      setErrors(errorMessages(err));
    }
  };

  const addStudent = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors([]);
    setHandout(null);
    setNotice(null);
    try {
      const who = newStudent.email.trim();
      const created = await createOrgMember(id, {
        role: 'student',
        email: who,
        ...(newStudent.name.trim() === '' ? {} : { name: newStudent.name.trim() }),
      });
      // The answer carries no member row (deliberately — see types.ts); the
      // roster reload below shows the new student.
      if (created.inviteLink) {
        setHandout({ who, link: created.inviteLink });
      } else {
        setNotice(
          `${who} has been sent an email to set their password — or, if they already had an account, an invitation to accept.`,
        );
      }
      setNewStudent({ email: '', name: '' });
      await load();
    } catch (err) {
      setErrors(errorMessages(err));
    }
  };

  const resetStudent = async (m: OrgMember) => {
    setErrors([]);
    setHandout(null);
    setNotice(null);
    try {
      const out = await resetMemberPassword(id, m.membershipId);
      if (out.resetLink) setHandout({ who: memberName(m), link: out.resetLink });
      else setNotice(`A reset link is on its way to ${memberName(m)}.`);
    } catch (err) {
      setErrors(errorMessages(err));
    }
  };

  const tiers: FirstPassTier[] = policy?.firstPass.allowed ?? [];

  return (
    <div className="teach-page">
      <h2>Students</h2>
      {errors.length > 0 && (
        <ul className="error-box">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {handout !== null && <HandOut who={handout.who} link={handout.link} />}
      {members === null && <p className="muted">Loading…</p>}
      {members !== null && students.length === 0 && <p className="muted">No students yet.</p>}
      {students.length > 0 && (
        <ul className="analysis-list">
          {students.map((m) => {
            const override = overrides[m.membershipId] ?? null;
            const open = openStudent === m.membershipId;
            return (
              <li key={m.membershipId} className="student-row">
                <div className="student-line">
                  <span className="analysis-title">{memberName(m)}</span>
                  <span className="muted">{m.user.email}</span>
                  {!m.active && <span className="muted">deactivated</span>}
                  {/* An invitation is not a student yet: they have agreed to
                      nothing, so there is nothing here to open, reset or
                      govern until they answer it. */}
                  {m.pending ? (
                    <span className="muted">invited — waiting for their answer</span>
                  ) : (
                    <>
                      <Link to={`/students/${m.membershipId}?org=${encodeURIComponent(id)}`}>
                        Analyses
                      </Link>
                      {canReset(m) && (
                        <button type="button" onClick={() => void resetStudent(m)}>
                          Reset password
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={open}
                        onClick={() => setOpenStudent(open ? null : m.membershipId)}
                      >
                        {override === null ? 'Uses your default' : 'Has an override'}{' '}
                        {open ? '▾' : '▸'}
                      </button>
                    </>
                  )}
                </div>
                {open && !m.pending && policy !== null && (
                  <div className="policy-override">
                    <div className="policy-group">
                      <h3>Auto-analysis may start from</h3>
                      <label className="policy-row">
                        <select
                          className="form-select"
                          value={overrideTiers(override) === undefined ? '' : 'override'}
                          onChange={(event) =>
                            void saveOverride(
                              m.membershipId,
                              withTierOverride(
                                override,
                                event.target.value === ''
                                  ? undefined
                                  : [...policy.firstPass.allowed],
                              ),
                            )
                          }
                        >
                          <option value="">
                            Uses your default ({policy.firstPass.allowed.join(', ')})
                          </option>
                          <option value="override">Just for this student</option>
                        </select>
                        <span className="policy-label">first pass</span>
                      </label>
                      {overrideTiers(override) !== undefined && (
                        <div className="policy-tiers">
                          {TIER_CHOICES.map((choice) => {
                            const chosen = overrideTiers(override) ?? [];
                            const on = chosen.includes(choice.tier);
                            return (
                              <label className="switch" key={choice.tier}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(event) => {
                                    const wanted = event.target.checked
                                      ? [...chosen, choice.tier]
                                      : chosen.filter((t) => t !== choice.tier);
                                    // A student must be able to start
                                    // SOMEWHERE — the same guard as the class
                                    // default above.
                                    if (wanted.length === 0) return;
                                    void saveOverride(
                                      m.membershipId,
                                      withTierOverride(
                                        override,
                                        TIER_CHOICES.map((c) => c.tier).filter((t) =>
                                          wanted.includes(t),
                                        ),
                                      ),
                                    );
                                  }}
                                />
                                <span className="switch-track" aria-hidden="true" />
                                <span className="switch-label">{choice.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {POLICY_GROUPS.map((group) => (
                      <div className="policy-group" key={group.title}>
                        <h3>{group.title}</h3>
                        {group.toggles.map((t) => {
                          const value = overrideValue(override, t.key);
                          const fallback = t.read(policy) ? 'yes' : 'no';
                          return (
                            <label className="policy-row" key={t.key}>
                              <select
                                className="form-select"
                                value={value === undefined ? '' : value ? 'yes' : 'no'}
                                onChange={(event) =>
                                  void saveOverride(
                                    m.membershipId,
                                    withOverride(
                                      override,
                                      t.key,
                                      event.target.value === ''
                                        ? undefined
                                        : event.target.value === 'yes',
                                    ),
                                  )
                                }
                              >
                                <option value="">
                                  Uses your default ({fallback === 'yes' ? 'yes' : 'no'})
                                </option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                              <span className="policy-label">{t.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                    <div className="row-actions">
                      <button
                        type="button"
                        disabled={override === null}
                        onClick={() => void saveOverride(m.membershipId, null)}
                      >
                        Back to your default
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section className="card">
        <h2>Add a student</h2>
        <form onSubmit={(event) => void addStudent(event)}>
          <label className="form-row">
            <span className="form-label">Email</span>
            <input
              className="form-input"
              type="email"
              value={newStudent.email}
              placeholder="student@example.edu"
              onChange={(event) => setNewStudent({ ...newStudent, email: event.target.value })}
            />
          </label>
          <label className="form-row">
            <span className="form-label">Name</span>
            <input
              className="form-input"
              value={newStudent.name}
              onChange={(event) => setNewStudent({ ...newStudent, name: event.target.value })}
            />
          </label>
          <div className="row-actions">
            <button type="submit" className="primary" disabled={newStudent.email.trim() === ''}>
              Add student
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Default class rules</h2>
        <p className="muted">
          Two things are yours to set: where the auto-analysis may start, and
          which reading aids students see. Everything else in the editor —
          relationships, splitting, blocks, the text flow, notes — is always
          theirs.
        </p>
        {policy === null && <p className="muted">Loading…</p>}
        {policy !== null && (
          <>
            <div className="policy-group">
              <h3>Auto-analysis students may start from</h3>
              <div className="policy-tiers">
                {TIER_CHOICES.map((choice) => {
                  const on = tiers.includes(choice.tier);
                  return (
                    <label className="switch" key={choice.tier}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(event) => {
                          const wanted = event.target.checked
                            ? [...tiers, choice.tier]
                            : tiers.filter((t) => t !== choice.tier);
                          // A student must be able to start SOMEWHERE: the last
                          // tier cannot be switched off.
                          if (wanted.length === 0) return;
                          void savePolicy({
                            ...policy,
                            firstPass: {
                              allowed: TIER_CHOICES.map((c) => c.tier).filter((t) =>
                                wanted.includes(t),
                              ),
                            },
                          });
                        }}
                      />
                      <span className="switch-track" aria-hidden="true" />
                      <span className="switch-label">{choice.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            {POLICY_GROUPS.map((group) => (
              <div className="policy-group" key={group.title}>
                <h3>{group.title}</h3>
                {group.toggles.map((t) => (
                  <label className="switch policy-switch" key={t.key}>
                    <input
                      type="checkbox"
                      checked={t.read(policy)}
                      onChange={(event) => void savePolicy(t.write(policy, event.target.checked))}
                    />
                    <span className="switch-track" aria-hidden="true" />
                    <span className="switch-label">{t.label}</span>
                  </label>
                ))}
              </div>
            ))}
            <p className="muted form-aside" role="status">
              {busy ? 'Saving…' : saved ? 'Saved.' : 'Changes save as you make them.'}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
