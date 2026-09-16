// Small readings of an account that several pages need, kept in one place so
// they cannot drift.
//
// Every account has an email, and the API sends it as a string that is never
// empty (da/api/shapes.py). The only blank a page ever meets is the NAME — a
// pending invitation carries none, and a person may not have set one — so the
// one reading that matters is "name, else email".

/** The value, or null when it is missing or blank. */
export function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface AccountLike {
  email: string;
  name: string;
}

/** What to call this account on screen: their name, else their email. */
export function displayName(user: AccountLike, fallback = 'Account'): string {
  return nonEmpty(user.name) ?? nonEmpty(user.email) ?? fallback;
}
