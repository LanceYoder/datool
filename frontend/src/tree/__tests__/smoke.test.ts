import { describe, expect, it } from 'vitest';
import { assertInvariants, formatForest } from '../core';
import { john1146, john11Max, john11Min } from './wire';

describe('wire fixtures load into the core', () => {
  it('reads all three John 11 fixtures as legal forests', () => {
    for (const load of [john1146, john11Min, john11Max]) {
      const { forest, order, pid } = load();
      assertInvariants(forest, order);
      expect(pid('42b')).toBe('p21');
      expect(formatForest(forest).length).toBeGreaterThan(10);
    }
  });
});
