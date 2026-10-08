// Shared domain types for datool. The Document shape mirrors the server's
// schema and is the single source of truth for analyses.
//
// Two schema versions exist:
//   v1 — a single connected `tree`; every proposition hangs off one root.
//   v2 — a `forest` of ordered roots; disconnected propositions are legal and
//        are simply roots of their own.
// v1 documents still LOAD (normalizeDocument turns them into a forest of one);
// the editor always SAVES v2.

export interface CorpusSource {
  kind: 'corpus';
  /** Inclusive start word index into the corpus. */
  start: number;
  /** Inclusive end word index into the corpus. */
  end: number;
}

export interface RawSource {
  kind: 'raw';
  text: string;
}

export type PropositionSource = CorpusSource | RawSource;

export interface Proposition {
  id: string;
  /** Verse label shown in the gutter, e.g. "1:6a". */
  label: string;
  source: PropositionSource;
  color?: string;
}

export interface PropRefNode {
  kind: 'prop';
  /** References a Proposition id. */
  ref: string;
}

export interface BracketNode {
  kind: 'bracket';
  /** Taxonomy relationship code. */
  rel: string;
  /**
   * Index of the prominent child. Valid child index iff the relationship is
   * subordinate; null iff the relationship is coordinate.
   */
  prominent: number | null;
  /**
   * DERIVED, never user-set: true when the starred end is the one that would
   * otherwise carry labels[1 - starredLabel]. Commands recompute it; the
   * geometry only reads it. Absent/false on coordinate and n-ary brackets.
   */
  reversed?: boolean;
  /** 'review' renders the bracket in amber. */
  flag?: 'review';
  /**
   * Newly created brackets are BINARY (exactly two children). Legacy n-ary
   * brackets still load and display. In-order leaves across the whole forest
   * match the propositions list order.
   */
  children: TreeNode[];
}

/**
 * A hole: units that USED to hang from the bracket above them and no longer
 * do. Deleting a relationship inside a tree leaves its units unattached
 * without disturbing anything above, and the hole is what holds their place
 * in the document's order while they wait to be re-connected. It carries no
 * relationship, and a document containing one is INCOMPLETE — an editing
 * state, not an analysis.
 *
 * A hole holding a SINGLE unit is still a hole (spec §10 A1): the group has
 * been assembled and the analyst has not yet said it is finished. Nothing
 * collapses it back into the slot — only their own pickup-dot gesture does
 * (§10 A2) — and a bracket may carry a hole at each end while the work is in
 * progress (§10 A4).
 */
export interface HoleNode {
  kind: 'hole';
  children: TreeNode[];
}

export type TreeNode = PropRefNode | BracketNode | HoleNode;

/** A stored color block: the pid that begins it, and the palette color it
 * keeps for as long as it exists. */
export interface SectionBreak {
  start: string;
  color: number;
}

/**
 * The marks TYPED around one word of a flow line — the ( ) and [ ] the
 * handout puts around an embedded clause (Text Flow Instructions §10), left
 * where the words stand. Only those four characters, and a word may carry
 * several of them ("([", "])"). Marks within a line are ordered by word.
 */
export interface TextFlowMark {
  /** Corpus word index, within the owning line. */
  at: number;
  /** Characters typed just before the word. */
  before?: string;
  /** Characters typed just after the word. */
  after?: string;
}

/** One clause line of the text flow. */
export interface TextFlowLine {
  /** Inclusive corpus word range. */
  start: number;
  end: number;
  /** Steps of indentation under what the clause modifies, 0..8. */
  indent: number;
  marks?: TextFlowMark[];
}

/**
 * The pedagogical step BEFORE the bracketing: the passage broken into clause
 * lines, dependent clauses indented under what they modify, word order kept.
 * Lines are contiguous — each line's start is the previous line's end + 1 —
 * so the flow covers one gapless corpus range.
 */
export interface TextFlow {
  lines: TextFlowLine[];
}

export interface Document {
  schemaVersion: 1 | 2;
  propositions: Proposition[];
  /** The text flow, when one has been started; absent until then. */
  textFlow?: TextFlow;
  /**
   * Color blocks: the breaks that BEGIN one, in proposition order. The
   * document always opens inside its first block (first palette color), so
   * the first proposition is never listed; absent or empty means the passage
   * is one undivided block. Documents written before colors were stored may
   * carry plain pid strings (see normalizeBreaks); the editor always writes
   * {start, color}.
   */
  sections?: (SectionBreak | string)[];
  /** v1 only: the single connected root. Absent in v2. */
  tree?: TreeNode;
  /** v2: ordered forest roots. Absent in v1. */
  forest?: TreeNode[];
}

/**
 * A v2 document with its forest materialized — what normalizeDocument returns
 * and what the editor writes back.
 */
export interface DocumentV2 extends Document {
  schemaVersion: 2;
  forest: TreeNode[];
}

export interface AnalysisSummary {
  id: string;
  title: string;
  passageRef: string;
  updatedAt: string;
  /**
   * The owning user's id (da/serializers.py). The SPA uses it to notice that
   * an analysis it opened is somebody else's — a professor reading a student's
   * work — and lock the page before offering a Save the server would refuse.
   *
   * Optional, and null-tolerant, on purpose: the 43 analyses made in
   * single-user local mode have no owner at all until `assign_orphans` runs
   * (accounts-spec §7), and a page that cannot tell must fall back to the
   * route rather than guess. Safety never rests on it — PUT and DELETE are
   * owner-only on the server.
   */
  ownerId?: number | null;
}

export interface Analysis extends AnalysisSummary {
  document: Document;
  /** Exegetical comments on the analysis as a whole; '' when never written. */
  notes: string;
}

/** A row of Recently Deleted: what it was, and how long it has left. */
export interface DeletedAnalysisSummary extends AnalysisSummary {
  deletedAt: string;
  /** Whole days before it is purged for good. */
  daysLeft: number;
}

export interface CorpusWord {
  index: number;
  /** Display form (with punctuation/casing) — join with spaces for display. */
  text: string;
  word: string;
  norm: string;
  lemma: string;
  pos: string;
  parsing: string;
  book: number;
  bookName: string;
  chapter: number;
  verse: number;
  /** TBESG transliteration (STEPBible.org, CC BY 4.0), null when unglossed. */
  translit: string | null;
  /** TBESG short English gloss, null when the lemma has no entry. */
  gloss: string | null;
  /** BSB contextual English of THIS word in THIS verse (null ≈0.4%). */
  eng: string | null;
  /** BSB English word-order key — relative order within one verse only. */
  engOrd: number | null;
}

/** One English (BSB) verse from GET /api/corpus/verses. */
export interface VerseText {
  book: number;
  chapter: number;
  verse: number;
  /** Corpus index of the verse's FIRST word (may precede the fetched range). */
  start: number;
  ref: string;
  text: string;
}

export interface TaxonomyEntry {
  code: string;
  name: string;
  /** What the relationship is, in the course's terms — behind the menu's "i". */
  description: string;
  family: string;
  symbol: string;
  labels: string[];
  starredLabel: number | null;
  coordinate: boolean;
}

export interface Alignment {
  ref: string;
  start: number;
  end: number;
  exact: boolean;
  matchedTokens: number;
  totalTokens: number;
  mismatchedPositions: number[];
}

export interface FirstPassResult {
  document: Document;
  alignment: Alignment | null;
}

// ---------------------------------------------------------------------------
// Accounts, organizations and teaching policies (docs/accounts-spec.md §5–§6).
//
// Everything below is the WIRE shape, camelCase, exactly as the API serializes
// it. Nothing here is derived or renamed on the way in.

/**
 * How much the auto-analysis proposes when an analysis is created.
 * 'none' is the policy-only tier: every proposition a root, no relationships
 * proposed, so the student builds the whole tree.
 */
export type FirstPassTier = 'none' | 'minimal' | 'full';

/** The three tiers in the order the picker offers them. */
export const FIRST_PASS_TIERS: readonly FirstPassTier[] = ['none', 'minimal', 'full'];

/** What the picker calls each tier, and what it means in one line. */
export const TIER_LABELS: Readonly<Record<FirstPassTier, string>> = {
  none: 'Nothing',
  minimal: 'Minimal',
  full: 'Max',
};

export type Role = 'admin' | 'professor' | 'student';

/**
 * The teaching policy (§5): a fixed key set, defaults "everything allowed" —
 * an individual account's experience. A professor's default policy and a
 * student's per-student override are both shaped like this (the override
 * carrying only the keys that differ).
 *
 * Two groups, by ruling (2026-09-12): which first-pass tiers a student may
 * start from, and which reading aids they see. Every editing gesture —
 * relationships, clearing, splitting and merging, color blocks, the text
 * flow, notes — is always available, and is not in here.
 */
export interface Policy {
  firstPass: {
    /** Which tiers the student may choose. Exactly one ⇒ the picker is hidden. */
    allowed: FirstPassTier[];
  };
  aids: {
    english: boolean;
    verses: boolean;
    verbs: boolean;
    colorCoding: boolean;
  };
}

/** A policy with only some keys present — what a per-student override is. */
export type PolicyOverride = {
  [K in keyof Policy]?: Partial<Policy[K]>;
};

/**
 * §5: "Defaults = everything allowed, i.e. an individual's experience." This
 * is what `usePolicy()` returns for an individual, for staff, and for anyone
 * whose `/api/auth/me` carries `policy: null`.
 */
export const DEFAULT_POLICY: Policy = {
  firstPass: { allowed: ['none', 'minimal', 'full'] },
  aids: { english: true, verses: true, verbs: true, colorCoding: true },
};

export interface OrgRef {
  id: number;
  name: string;
  slug: string;
}

/** A professor named from a student's side: the professor's MEMBERSHIP id. */
export interface ProfessorRef {
  id: number;
  name: string;
}

/** One of the caller's memberships, as `/api/auth/me` and `/api/orgs/mine` list them. */
export interface Membership {
  membershipId: number;
  org: OrgRef;
  role: Role;
  /** Students only: the professor they are assigned to, when they have one. */
  professor?: ProfessorRef | null;
  active: boolean;
}

/**
 * An organization that has asked this person to join, and is waiting for an
 * answer. It is NOT a membership: it carries no role until it is accepted
 * (`POST /api/invitations/<membershipId>/accept`), and declining it removes it.
 *
 * Beyond §6, which does not say how an account that already exists comes to
 * belong to an org. Adding one outright would let anybody attach a stranger's
 * account to their own classroom, so the row waits here until its holder says
 * yes.
 */
export interface Invitation {
  membershipId: number;
  org: OrgRef;
  role: Role;
}

/** `GET /api/auth/me` — the signed-in user and everything the SPA branches on. */
export interface Me {
  id: number;
  /** The address they sign in with. Every account has one. */
  email: string;
  name: string;
  /** The organizations this person BELONGS to — accepted ones only. */
  memberships: Membership[];
  /** Invitations waiting to be accepted or declined. */
  invitations: Invitation[];
  /** The EFFECTIVE policy for a student; null for everyone else. */
  policy: Policy | null;
  isStaff: boolean;
}

/**
 * The user half of an org member row.
 *
 * For a PENDING row the server sends the invited address and nothing else —
 * `id: null` and an empty name — so that typing an address into an org
 * cannot be used to look up who holds it. Their own name appears the moment
 * they accept.
 */
export interface MemberUser {
  id: number | null;
  email: string;
  name: string;
}

/** One row of `GET /api/orgs/<id>/members`. */
export interface OrgMember {
  membershipId: number;
  user: MemberUser;
  role: Role;
  /** The professor this student is assigned to, or null. */
  professor: ProfessorRef | null;
  active: boolean;
  /**
   * True while an invitation to an account that already existed is waiting to
   * be answered. Such a row holds no role and governs nothing: the person has
   * agreed to nothing yet, and the page must not show them as a member.
   */
  pending: boolean;
  /**
   * True when this organization created the account. Only such an account has
   * its password reset from here (§2's provisioned accounts); somebody who
   * joined with an account of their own resets it themselves.
   */
  provisioned: boolean;
  /**
   * The student's per-student override, when the row carries one. §6 gives no
   * endpoint that READS an override (only the PUT that sets it), so the
   * teaching page uses this when the server sends it and otherwise starts every
   * student on "uses your default".
   */
  policyOverride?: PolicyOverride | null;
}

/**
 * `POST /api/orgs/<id>/members`: the same three keys whether the address
 * already had an account (a pending invitation) or not (a new account whose
 * set-password link went out by mail — or comes back here as `inviteLink`
 * when it could not). Deliberately says nothing about which: typing an
 * address into an org must not be a way to find out who holds one.
 */
export interface InvitedMember {
  invited: true;
  membershipId: number;
  /** The set-password link, only when mail could not be sent. */
  inviteLink: string | null;
}

/**
 * `POST /api/orgs/<id>/members/<mid>/reset-password`, for an account this
 * organization provisioned: the reset mail went out, or — when it could not —
 * the link comes back here to be passed on by hand.
 */
export interface ResetResult {
  sent: boolean;
  resetLink: string | null;
}

/** `PUT /api/orgs/<id>/members/<mid>/policy` — the override, and what it
 * resolves to for that student. */
export interface MemberPolicyResult {
  override: PolicyOverride | null;
  policy: Policy;
}
