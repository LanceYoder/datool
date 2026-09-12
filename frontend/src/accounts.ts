// Small readings of an account that several pages need, kept in one place so
// they cannot drift.
//
// The one fact worth naming: "has no email" reaches the SPA as an EMPTY STRING
// (da/api/shapes.py sends `user.email or ""`), not as null. `??` is therefore
// the wrong operator everywhere it matters — `'' ?? handle` is `''` — and every
// page reads an account through these instead.

/** The value, or null when it is missing or blank. */
export function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface AccountLike {
  email: string | null;
  handle: string | null;
  name: string;
}

/** True for an account that can be reached — and reset — by mail. */
export function hasEmail(user: AccountLike): boolean {
  return nonEmpty(user.email) !== null;
}

/** What this account signs in WITH: its email, or its learning-account handle. */
export function signIn(user: AccountLike): string | null {
  return nonEmpty(user.email) ?? nonEmpty(user.handle);
}

/** What to call this account on screen: their name, else how they sign in. */
export function displayName(user: AccountLike, fallback = 'Account'): string {
  return nonEmpty(user.name) ?? signIn(user) ?? fallback;
}
