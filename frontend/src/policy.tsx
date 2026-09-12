// THE TEACHING POLICY, on the student's side of the glass (accounts-spec §5).
//
// One hook — `usePolicy()` — answers every class-rules question in the app, and
// it answers "everything allowed" unless a professor has said otherwise. That
// is the whole rule: a component asks what it may offer, never who is looking.
// A policy governs two things only: which first-pass tiers a student may start
// from, and which reading aids they see (ruled 2026-09-12). The gestures —
// relationships, clearing, splitting, blocks, the flow, notes — are always
// available, and no policy key names them.
//
// READ-ONLY is the other thing this file carries, and it is deliberately not a
// policy. A professor reading a student's analysis has no gestures — not
// because any rule withholds them, but because the work is somebody else's.
// `ReadOnlyScope` marks that subtree and `useReadOnly()` is what every gesture
// handler reads; the reading aids are untouched by it.
//
// The plain-language wording lives here too, because the professor's switches
// and the student's "Class rules" line must say the same thing about the same
// key — two lists would drift.

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { FirstPassTier, Policy, PolicyOverride } from './types';
import { FIRST_PASS_TIERS } from './types';
import type { ViewSettings } from './editor/viewSettings';
import { useSession } from './session';

const PolicyContext = createContext<Policy | null>(null);
const ReadOnlyContext = createContext(false);

/**
 * The policy in force here: a scope's, if one wraps this component, else the
 * session's (the student's effective policy, or DEFAULT_POLICY for everyone
 * else and for anything rendered outside a provider).
 */
export function usePolicy(): Policy {
  const scoped = useContext(PolicyContext);
  const session = useSession();
  return scoped ?? session.policy;
}

/** Put a different policy in force for one subtree. */
export function PolicyScope({ policy, children }: { policy: Policy; children: ReactNode }) {
  return <PolicyContext.Provider value={policy}>{children}</PolicyContext.Provider>;
}

/**
 * Is this subtree a professor's READ-ONLY view of somebody else's work? Every
 * gesture handler in the editor, the text flow and the notes reads this and
 * does nothing when it is true; the controls for those gestures are not
 * drawn. What the reader SEES is untouched — reading is the point of the visit.
 */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

/** Mark a subtree read-only (or, with `readOnly={false}`, explicitly not). */
export function ReadOnlyScope({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

// ---------------------------------------------------------------------------
// Pure helpers — no React, so they can be tested on their own.

/** default ⊕ override (override keys win), one group at a time (§4). */
export function mergePolicy(base: Policy, override: PolicyOverride | null): Policy {
  if (override === null) return base;
  return {
    firstPass: { ...base.firstPass, ...override.firstPass },
    aids: { ...base.aids, ...override.aids },
  };
}

/**
 * The tiers a student may start from, in the picker's order. A policy that
 * allows none of them (or names only tiers that do not exist) falls back to
 * 'minimal': the tool must always be able to make an analysis.
 */
export function allowedTiers(policy: Policy): FirstPassTier[] {
  const allowed = FIRST_PASS_TIERS.filter((t) => policy.firstPass.allowed.includes(t));
  return allowed.length === 0 ? ['minimal'] : allowed;
}

/**
 * Which tier to use, given what the reader last chose. A remembered choice the
 * policy no longer allows is quietly replaced by the first tier that is.
 */
export function pickTier(policy: Policy, wanted: FirstPassTier | null): FirstPassTier {
  const allowed = allowedTiers(policy);
  return wanted !== null && allowed.includes(wanted) ? wanted : allowed[0]!;
}

/**
 * A reading aid the policy withholds is not merely hidden: it is forced OFF,
 * whatever the browser remembered, so nothing of it survives on the page.
 */
export function applyPolicyToView(view: ViewSettings, policy: Policy): ViewSettings {
  const next = {
    ...view,
    english: view.english && policy.aids.english,
    verbs: view.verbs && policy.aids.verbs,
    colorCoding: view.colorCoding && policy.aids.colorCoding,
    verses: policy.aids.verses ? view.verses : ('off' as const),
  };
  // Identity matters: the editor memoizes on this object, so an unrestricted
  // policy must hand the same settings back rather than a fresh copy.
  const same =
    next.english === view.english &&
    next.verbs === view.verbs &&
    next.colorCoding === view.colorCoding &&
    next.verses === view.verses;
  return same ? view : next;
}

/**
 * What this policy takes away, said the way the student would say it. Empty
 * for an unrestricted policy — and the "Class rules" line only appears when
 * this is not empty, so nothing is announced to an individual.
 */
export function lockedRules(policy: Policy): string[] {
  const out: string[] = [];
  if (!policy.aids.english) out.push('English line off');
  if (!policy.aids.verses) out.push('verse panel off');
  if (!policy.aids.verbs) out.push('verb highlighting off');
  if (!policy.aids.colorCoding) out.push('relationship colors off');
  return out;
}

// ---------------------------------------------------------------------------
// The professor's switches: the same key set, grouped, in plain language (§5).

export interface PolicyToggle {
  /** Dotted path into the policy, e.g. 'aids.english'. */
  key: string;
  label: string;
  read: (policy: Policy) => boolean;
  write: (policy: Policy, value: boolean) => Policy;
}

export interface PolicyGroup {
  title: string;
  toggles: PolicyToggle[];
}

function toggle<G extends keyof Policy>(
  group: G,
  field: keyof Policy[G] & string,
  label: string,
): PolicyToggle {
  return {
    key: `${String(group)}.${field}`,
    label,
    read: (policy) => policy[group][field] === true,
    write: (policy, value) => ({
      ...policy,
      [group]: { ...policy[group], [field]: value },
    }),
  };
}

/** Every switch a professor sets, grouped as §5 presents them. */
export const POLICY_GROUPS: PolicyGroup[] = [
  {
    title: 'Show students',
    toggles: [
      toggle('aids', 'english', 'the English line'),
      toggle('aids', 'verses', 'the verse panel (BSB / ESV)'),
      toggle('aids', 'verbs', 'verb highlighting'),
      toggle('aids', 'colorCoding', 'relationship color coding'),
    ],
  },
];

/** The tier row of the professor's editor: "may start from …". */
export const TIER_CHOICES: { tier: FirstPassTier; label: string }[] = [
  { tier: 'none', label: 'nothing' },
  { tier: 'minimal', label: 'minimal' },
  { tier: 'full', label: 'full' },
];
