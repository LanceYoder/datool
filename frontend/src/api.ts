import type {
  Analysis,
  AnalysisSummary,
  CorpusWord,
  Document,
  FirstPassResult,
  TaxonomyEntry,
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

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
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

export function createAnalysis(input: { title?: string; document: Document }): Promise<Analysis> {
  return request<Analysis>('/api/analyses', 'POST', input);
}

export function getAnalysis(id: string): Promise<Analysis> {
  return request<Analysis>(`/api/analyses/${encodeURIComponent(id)}`);
}

export function updateAnalysis(
  id: string,
  input: { title?: string; document?: Document },
): Promise<Analysis> {
  return request<Analysis>(`/api/analyses/${encodeURIComponent(id)}`, 'PUT', input);
}

export function deleteAnalysis(id: string): Promise<void> {
  return request<void>(`/api/analyses/${encodeURIComponent(id)}`, 'DELETE');
}

export function firstPass(text: string): Promise<FirstPassResult> {
  return request<FirstPassResult>('/api/first-pass', 'POST', { text });
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

/** Fetch the English (WEB) verses touching an inclusive word range, chunked
 * like getCorpusWords. A verse spanning a chunk boundary comes back from both
 * chunks — the FIRST occurrence carries the true verse start, so later
 * duplicates are dropped. */
export async function getCorpusVerses(start: number, end: number): Promise<VerseText[]> {
  const out: VerseText[] = [];
  const seen = new Set<string>();
  for (let from = start; from <= end; from += WORD_RANGE_CAP) {
    const to = Math.min(from + WORD_RANGE_CAP - 1, end);
    for (const verse of await request<VerseText[]>(`/api/corpus/verses?start=${from}&end=${to}`)) {
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

/** Human-readable message list from any thrown error. */
export function errorMessages(err: unknown): string[] {
  if (err instanceof ApiError) return err.errors;
  if (err instanceof Error) return [err.message];
  return [String(err)];
}
