// The policy's own arithmetic (accounts-spec §5): the default is "everything
// allowed", an override wins key by key, a withheld reading aid is forced OFF
// rather than merely hidden, and the tier picker never leaves a student with
// nowhere to start. Two groups only — the tiers and the aids — by ruling
// (2026-09-12): the gestures are not in a policy at all.

import { describe, expect, it } from 'vitest';
import {
  POLICY_GROUPS,
  allowedTiers,
  applyPolicyToView,
  lockedRules,
  mergePolicy,
  pickTier,
} from '../policy';
import { DEFAULT_POLICY } from '../types';
import { DEFAULT_VIEW_SETTINGS } from '../editor/viewSettings';
import type { Policy } from '../types';

/** DEFAULT_POLICY with one group changed. */
function withPolicy(patch: Partial<Policy>): Policy {
  return { ...DEFAULT_POLICY, ...patch };
}

describe('the default policy', () => {
  it('allows everything — an individual account’s experience', () => {
    expect(lockedRules(DEFAULT_POLICY)).toEqual([]);
    expect(allowedTiers(DEFAULT_POLICY)).toEqual(['none', 'minimal', 'full']);
  });

  it('has exactly two groups: the tiers and the reading aids', () => {
    expect(Object.keys(DEFAULT_POLICY).sort()).toEqual(['aids', 'firstPass']);
    expect(Object.keys(DEFAULT_POLICY.aids).sort()).toEqual([
      'colorCoding',
      'english',
      'verbs',
      'verses',
    ]);
  });

  it('is not shared state: nothing edits it in place', () => {
    const copy = mergePolicy(DEFAULT_POLICY, { aids: { english: false } });
    expect(copy.aids.english).toBe(false);
    expect(DEFAULT_POLICY.aids.english).toBe(true);
  });
});

describe('mergePolicy', () => {
  it('lets the override’s keys win and leaves the rest of the group alone', () => {
    const merged = mergePolicy(DEFAULT_POLICY, { aids: { verbs: false } });
    expect(merged.aids).toEqual({ english: true, verses: true, verbs: false, colorCoding: true });
  });

  it('takes null for “uses your default”', () => {
    expect(mergePolicy(DEFAULT_POLICY, null)).toBe(DEFAULT_POLICY);
  });

  it('merges both groups at once', () => {
    const merged = mergePolicy(DEFAULT_POLICY, {
      aids: { english: false },
      firstPass: { allowed: ['minimal'] },
    });
    expect(merged.aids.english).toBe(false);
    expect(merged.aids.verbs).toBe(true);
    expect(merged.firstPass.allowed).toEqual(['minimal']);
  });
});

describe('tiers', () => {
  it('keeps the picker’s order however the policy lists them', () => {
    const policy = withPolicy({ firstPass: { allowed: ['full', 'none'] } });
    expect(allowedTiers(policy)).toEqual(['none', 'full']);
  });

  it('falls back to minimal when a policy allows nothing at all', () => {
    expect(allowedTiers(withPolicy({ firstPass: { allowed: [] } }))).toEqual(['minimal']);
  });

  it('replaces a remembered tier the policy has withdrawn', () => {
    const policy = withPolicy({ firstPass: { allowed: ['none'] } });
    expect(pickTier(policy, 'full')).toBe('none');
    expect(pickTier(policy, 'none')).toBe('none');
    expect(pickTier(DEFAULT_POLICY, null)).toBe('none');
  });
});

describe('applyPolicyToView', () => {
  it('changes nothing — and returns the SAME object — under the default', () => {
    expect(applyPolicyToView(DEFAULT_VIEW_SETTINGS, DEFAULT_POLICY)).toBe(DEFAULT_VIEW_SETTINGS);
  });

  it('forces a withheld aid off whatever the browser remembered', () => {
    const remembered = { ...DEFAULT_VIEW_SETTINGS, english: true, verbs: true, verses: 'esv' as const };
    const policy = withPolicy({
      aids: { english: false, verses: false, verbs: false, colorCoding: true },
    });
    const applied = applyPolicyToView(remembered, policy);
    expect(applied.english).toBe(false);
    expect(applied.verbs).toBe(false);
    expect(applied.verses).toBe('off');
    // What the policy did NOT withhold is untouched.
    expect(applied.blocks).toBe(remembered.blocks);
  });

  it('never turns an aid ON that the reader had off', () => {
    const off = { ...DEFAULT_VIEW_SETTINGS, english: false };
    expect(applyPolicyToView(off, DEFAULT_POLICY).english).toBe(false);
  });
});

describe('lockedRules — what the student is told', () => {
  it('names each withheld aid once, in the policy’s own terms', () => {
    const policy = mergePolicy(DEFAULT_POLICY, {
      aids: { english: false, colorCoding: false },
    });
    expect(lockedRules(policy)).toEqual(['English line off', 'relationship colors off']);
  });

  it('has nothing to say about the tiers — the picker shows those for itself', () => {
    expect(lockedRules(withPolicy({ firstPass: { allowed: ['none'] } }))).toEqual([]);
  });
});

describe('the professor’s switches', () => {
  it('are the reading aids, and nothing else', () => {
    expect(POLICY_GROUPS.map((g) => g.title)).toEqual(['Show students']);
    expect(POLICY_GROUPS[0]!.toggles.map((t) => t.key)).toEqual([
      'aids.english',
      'aids.verses',
      'aids.verbs',
      'aids.colorCoding',
    ]);
  });

  it('read and write the key they name, without touching the default', () => {
    const verbs = POLICY_GROUPS[0]!.toggles[2]!;
    expect(verbs.read(DEFAULT_POLICY)).toBe(true);
    const off = verbs.write(DEFAULT_POLICY, false);
    expect(off.aids.verbs).toBe(false);
    expect(off.aids.english).toBe(true);
    expect(DEFAULT_POLICY.aids.verbs).toBe(true);
  });
});
