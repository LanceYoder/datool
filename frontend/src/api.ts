import type {
  Analysis,
  AnalysisSummary,
  DeletedAnalysisSummary,
  CorpusWord,
  Document,
  FirstPassResult,
  FirstPassTier,
  Me,
  MemberPolicyResult,
  Membership,
  OrgMember,
  Policy,
  PolicyOverride,
  ProvisionResult,
  ResetPasswordResult,
  Role,
  TaxonomyEntry,
  TextFlow,
  VerseText,
} from './types';

/** Error thrown for non-2xx responses; `errors` carries the server's 400 {errors} list. */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];

  constructor(status: number, errors: string[]) {
    super(errors.length > 0 ? errors.join('; ') : `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Session mechanics (accounts-spec §3): the cookie goes with every request, and
// every mutating one carries Django's CSRF header, read from the cookie the
// `GET /api/auth/csrf` bootstrap sets.

/** Django's CSRF cookie name (settings default). */
const CSRF_COOKIE = 'csrftoken';

/** Methods Django checks the CSRF token on. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The cookie's value, or null when it has not been set yet. */
export function csrfToken(): string | null {
  const cookie = typeof document === 'undefined' ? '' : document.cookie;
  for (const part of cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === CSRF_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

/**
 * Endpoints whose own 401 is an ANSWER, not an expired session: signing in
 * with the wrong password must not bounce the page to /login and lose what was
 * typed. Everything else that answers 401 has lost its session.
 */
const PUBLIC_PATHS = [
  '/api/auth/csrf',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
];

/**
 * Whether a 401 on this request means "your session is gone, go and sign in
 * again" (§8) — or is simply the answer to what was asked.
 *
 * `GET /api/auth/me` is the second kind, and the distinction is not academic:
 * SessionProvider asks it on EVERY page load, including the public ones, so
 * bouncing on it would send a signed-out visitor from /register, from
 * /forgot-password, and — worst — from the /reset-password/<uid>/<token> link
 * in their invitation mail, to /login, with the token gone. A signed-out
 * visitor to a page that does need a session is already redirected by
 * RequireAuth, which is where that decision belongs.
 *
 * Writing to /auth/me (a name change on /account) is a different matter: a 401
 * there really is a session that expired under the reader's hands.
 */
function bounceOn401(path: string, method: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return false;
  if (path === '/api/auth/me' && method === 'GET') return false;
  return true;
}

type UnauthorizedHandler = (path: string) => void;

let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * What to do when the server says the session is gone. SessionProvider installs
 * it (refresh, then redirect to /login?next=…); returns the uninstaller so a
 * provider that unmounts leaves nothing behind.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): () => void {
  onUnauthorized = handler;
  return () => {
    if (onUnauthorized === handler) onUnauthorized = null;
  };
}

/** The CSRF bootstrap: sets the cookie, answers `{ok: true}`. */
export function fetchCsrf(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/auth/csrf');
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  // The session cookie travels on EVERY request, read or write.
  const init: RequestInit = { method, credentials: 'same-origin' };
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (MUTATING.has(method)) {
    // A mutating call made before anything set the cookie bootstraps it first,
    // so the very first POST of a page load (a login, say) is not refused.
    let token = csrfToken();
    if (token === null && path !== '/api/auth/csrf') {
      await fetchCsrf().catch(() => undefined);
      token = csrfToken();
    }
    if (token !== null) headers['X-CSRFToken'] = token;
  }
  if (Object.keys(headers).length > 0) init.headers = headers;
  const res = await fetch(path, init);
  if (res.status === 401 && bounceOn401(path, method)) {
    onUnauthorized?.(path);
  }
  if (!res.ok) {
    let errors: string[] = [];
    try {
      const data: unknown = await res.json();
      if (
        typeof data === 'object' &&
        data !== null &&
        Array.isArray((data as { errors?: unknown }).errors)
      ) {
        errors = ((data as { errors: unknown[] }).errors).map(String);
      }
    } catch {
      // response body was not JSON
    }
    throw new ApiError(res.status, errors.length > 0 ? errors : [`${res.status} ${res.statusText}`]);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

export function listAnalyses(): Promise<AnalysisSummary[]> {
  return request<AnalysisSummary[]>('/api/analyses');
}

/**
 * `firstPassTier` is the tier the auto-analysis actually ran at: the server
 * records it (and the effective policy) on the row, and checks it against the
 * caller's policy (§6).
 */
export function createAnalysis(input: {
  title?: string;
  document: Document;
  firstPassTier?: FirstPassTier;
}): Promise<Analysis> {
  return request<Analysis>('/api/analyses', 'POST', input);
}

export function getAnalysis(id: string): Promise<Analysis> {
  return request<Analysis>(`/api/analyses/${encodeURIComponent(id)}`);
}

export function updateAnalysis(
  id: string,
  input: { title?: string; document?: Document; notes?: string },
): Promise<Analysis> {
  return request<Analysis>(`/api/analyses/${encodeURIComponent(id)}`, 'PUT', input);
}

/** Move an analysis to Recently Deleted, or — with purge — end it there. */
export function deleteAnalysis(id: string, purge = false): Promise<void> {
  const path = `/api/analyses/${encodeURIComponent(id)}${purge ? '?purge=1' : ''}`;
  return request<void>(path, 'DELETE');
}

export function listDeletedAnalyses(): Promise<DeletedAnalysisSummary[]> {
  return request<DeletedAnalysisSummary[]>('/api/analyses/deleted');
}

export function restoreAnalysis(id: string): Promise<Analysis> {
  return request<Analysis>(`/api/analyses/${encodeURIComponent(id)}/restore`, 'POST');
}

/**
 * The auto-analysis at one of the three tiers (§6). `maximal` is the retired
 * boolean — the server still accepts it as a deprecated alias, but nothing
 * here sends it any more: 'none' cannot be said as a boolean at all.
 */
export function firstPass(text: string, tier: FirstPassTier = 'minimal'): Promise<FirstPassResult> {
  return request<FirstPassResult>('/api/first-pass', 'POST', { text, tier });
}

/**
 * The Text Flow the first pass derives for a corpus range — the same clause
 * division and indents an analysis made today ships with (da/treebuild.py's
 * build_text_flow), offered on its own for one saved before that, or one whose
 * flow was cleared.
 *
 * NOT chunked, unlike getCorpusWords below: the indents are read off a whole
 * sentence at a time, so a flow assembled from pieces would be wrong at every
 * seam. A passage over the server's cap is refused instead.
 */
export async function getTextFlow(start: number, end: number): Promise<TextFlow> {
  const { textFlow } = await request<{ textFlow: TextFlow }>(
    `/api/text-flow?start=${start}&end=${end}`,
  );
  return textFlow;
}

/** Server-side cap on one corpus words request (see da/views.py). */
const WORD_RANGE_CAP = 2000;

/** Fetch an inclusive corpus word range, chunking past the server's cap so
 * long passages (e.g. several chapters) load fully. */
export async function getCorpusWords(start: number, end: number): Promise<CorpusWord[]> {
  const out: CorpusWord[] = [];
  for (let from = start; from <= end; from += WORD_RANGE_CAP) {
    const to = Math.min(from + WORD_RANGE_CAP - 1, end);
    out.push(...(await request<CorpusWord[]>(`/api/corpus/words?start=${from}&end=${to}`)));
  }
  return out;
}

/** Fetch the English verses touching an inclusive word range, chunked like
 * getCorpusWords. A verse spanning a chunk boundary comes back from both
 * chunks — the FIRST occurrence carries the true verse start, so later
 * duplicates are dropped. `translation` is 'bsb' (local) or 'esv' (live
 * Crossway API; rejects when the server has no key configured). */
export async function getCorpusVerses(
  start: number,
  end: number,
  translation: 'bsb' | 'esv' = 'bsb',
): Promise<VerseText[]> {
  const out: VerseText[] = [];
  const seen = new Set<string>();
  for (let from = start; from <= end; from += WORD_RANGE_CAP) {
    const to = Math.min(from + WORD_RANGE_CAP - 1, end);
    for (const verse of await request<VerseText[]>(
      `/api/corpus/verses?start=${from}&end=${to}&translation=${translation}`,
    )) {
      const key = `${verse.book}:${verse.chapter}:${verse.verse}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(verse);
      }
    }
  }
  return out;
}

let taxonomyPromise: Promise<TaxonomyEntry[]> | null = null;

/** Taxonomy is static (18 entries) — fetched once per page load and cached. */
export function getTaxonomy(): Promise<TaxonomyEntry[]> {
  if (taxonomyPromise === null) {
    taxonomyPromise = request<TaxonomyEntry[]>('/api/taxonomy').catch((err: unknown) => {
      taxonomyPromise = null;
      throw err;
    });
  }
  return taxonomyPromise;
}

// ---------------------------------------------------------------------------
// Accounts (accounts-spec §6). One thin function per endpoint: the body it
// posts and the shape it returns, and nothing else — every decision about what
// to do with the answer belongs to the page that asked.

export function register(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<Me> {
  return request<Me>('/api/auth/register', 'POST', input);
}

/** `login` is the email OR the handle — the server's backend tries both. */
export function login(input: { login: string; password: string }): Promise<Me> {
  return request<Me>('/api/auth/login', 'POST', input);
}

export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', 'POST');
}

export function getMe(): Promise<Me> {
  return request<Me>('/api/auth/me');
}

/** The one thing a person may change about themselves: their display name. */
export function updateMe(input: { name: string }): Promise<Me> {
  return request<Me>('/api/auth/me', 'PATCH', input);
}

/** Always answers 200 — whether or not the address is a known account. */
export function forgotPassword(email: string): Promise<void> {
  return request<void>('/api/auth/password/forgot', 'POST', { email });
}

export function resetPassword(input: {
  uid: string;
  token: string;
  password: string;
}): Promise<void> {
  return request<void>('/api/auth/password/reset', 'POST', input);
}

export function changePassword(input: { current: string; password: string }): Promise<void> {
  return request<void>('/api/auth/password/change', 'POST', input);
}

/**
 * Accept an invitation to join an organization — the moment a membership over
 * an account that already existed becomes real. Answers with the updated `me`,
 * so the header's links appear without a second call.
 */
export function acceptInvitation(membershipId: number): Promise<Me> {
  return request<Me>(`/api/invitations/${membershipId}/accept`, 'POST');
}

/** Decline one: the row goes, and the organization can invite again. */
export function declineInvitation(membershipId: number): Promise<void> {
  return request<void>(`/api/invitations/${membershipId}/decline`, 'POST');
}

/** The caller's memberships, with their roles. */
export function listMyOrgs(): Promise<Membership[]> {
  return request<Membership[]>('/api/orgs/mine');
}

/** Admin: every member. Professor: their own students, and themselves. */
export function listOrgMembers(orgId: string | number): Promise<OrgMember[]> {
  return request<OrgMember[]>(`/api/orgs/${encodeURIComponent(String(orgId))}/members`);
}

/**
 * Provision an account: `email` for one that gets an invitation mail, or
 * `handle` for a learning account with no email at all. The answer may carry
 * an invite link (mail could not be sent) or a temporary password (a handle
 * account made without one) — both to be shown to the provisioner once.
 */
export function createOrgMember(
  orgId: string | number,
  input: {
    role: Role;
    email?: string;
    handle?: string;
    name?: string;
    password?: string;
    /** The professor's MEMBERSHIP id, for a student being assigned at once. */
    professor?: number | null;
  },
): Promise<ProvisionResult> {
  return request<ProvisionResult>(
    `/api/orgs/${encodeURIComponent(String(orgId))}/members`,
    'POST',
    input,
  );
}

/** Admin: change a member's role, their professor, or deactivate them. */
export function updateOrgMember(
  orgId: string | number,
  membershipId: number,
  input: { role?: Role; professor?: number | null; active?: boolean },
): Promise<OrgMember> {
  return request<OrgMember>(
    `/api/orgs/${encodeURIComponent(String(orgId))}/members/${membershipId}`,
    'PATCH',
    input,
  );
}

/**
 * Admin, or the student's own professor: set a handle account's password (or
 * have one generated), or send an email account its reset mail.
 */
export function resetMemberPassword(
  orgId: string | number,
  membershipId: number,
  password?: string,
): Promise<ResetPasswordResult> {
  return request<ResetPasswordResult>(
    `/api/orgs/${encodeURIComponent(String(orgId))}/members/${membershipId}/reset-password`,
    'POST',
    password === undefined ? {} : { password },
  );
}

/**
 * The professor's DEFAULT policy for all their students. The endpoint answers
 * with the policy; a server that wraps it as `{policy}` is unwrapped here, so
 * the page always sees a Policy.
 */
export async function getOrgPolicy(orgId: string | number): Promise<Policy> {
  const data = await request<Policy | { policy: Policy }>(
    `/api/orgs/${encodeURIComponent(String(orgId))}/policy`,
  );
  return 'policy' in data ? data.policy : data;
}

export async function setOrgPolicy(orgId: string | number, policy: Policy): Promise<Policy> {
  const data = await request<Policy | { policy: Policy }>(
    `/api/orgs/${encodeURIComponent(String(orgId))}/policy`,
    'PUT',
    { policy },
  );
  return 'policy' in data ? data.policy : data;
}

/** One student's override, or null to put them back on the default. */
export function setMemberPolicyOverride(
  orgId: string | number,
  membershipId: number,
  override: PolicyOverride | null,
): Promise<MemberPolicyResult> {
  return request<MemberPolicyResult>(
    `/api/orgs/${encodeURIComponent(String(orgId))}/members/${membershipId}/policy`,
    'PUT',
    { override },
  );
}

/** A student's analyses, listed for their professor. */
export function listStudentAnalyses(
  orgId: string | number,
  membershipId: number,
): Promise<AnalysisSummary[]> {
  return request<AnalysisSummary[]>(
    `/api/orgs/${encodeURIComponent(String(orgId))}/students/${membershipId}/analyses`,
  );
}

/** Human-readable message list from any thrown error. */
export function errorMessages(err: unknown): string[] {
  if (err instanceof ApiError) return err.errors;
  if (err instanceof Error) return [err.message];
  return [String(err)];
}
