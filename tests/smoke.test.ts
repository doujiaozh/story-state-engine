import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createId } from '../src/index.js';

describe('smoke', () => {
  it('creates ids', () => {
    const id = createId('ch');
    assert.ok(id.startsWith('ch_'));
  });
});
