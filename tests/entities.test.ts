/**
 * Entity factories and the read-only EntityRegistry.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EntityRegistry,
  buildCharacter,
  buildItem,
  buildLocation
} from '../src/entities.js';
import { EntityNotFoundError, KindMismatchError } from '../src/errors.js';
import { isValidId, ENTITY_ID_PREFIXES } from '../src/ids.js';
import type { EngineState } from '../src/types.js';

describe('factories', () => {
  it('builds a character with defaults', () => {
    const c = buildCharacter({ name: '张三' }, 1);
    assert.equal(c.kind, 'character');
    assert.equal(c.name, '张三');
    assert.equal(c.role, 'supporting');
    assert.equal(c.introducedAtChapter, 1);
    assert.deepEqual(c.aliases, []);
    assert.deepEqual(c.attributes, {});
    assert.ok(c.id.startsWith(ENTITY_ID_PREFIXES.character));
  });

  it('builds a location with connections and atmosphere', () => {
    const l = buildLocation(
      { name: '青云山', connections: ['loc_backhill'], atmosphere: '多雾' },
      1
    );
    assert.equal(l.kind, 'location');
    assert.deepEqual(l.connections, ['loc_backhill']);
    assert.equal(l.atmosphere, '多雾');
    assert.ok(l.id.startsWith(ENTITY_ID_PREFIXES.location));
  });

  it('builds an item with owner or location binding', () => {
    const held = buildItem({ name: '剑', ownerId: 'ch_a' }, 1);
    assert.equal(held.ownerId, 'ch_a');
    assert.equal(held.locationId, undefined);
    const resting = buildItem({ name: '剑', locationId: 'loc_x' }, 1);
    assert.equal(resting.locationId, 'loc_x');
    assert.equal(resting.ownerId, undefined);
  });

  it('copies input collections instead of aliasing them', () => {
    const tags = ['勇士'];
    const aliases = ['阿甲'];
    const c = buildCharacter({ name: '甲', tags, aliases }, 1);
    tags.push('篡改');
    aliases.push('篡改');
    assert.deepEqual(c.tags, ['勇士']);
    assert.deepEqual(c.aliases, ['阿甲']);
  });
});

describe('EntityRegistry', () => {
  function registry() {
    const state: EngineState = {
      entities: {
        ch_a: buildCharacter({ id: 'ch_a', name: '甲', aliases: ['阿甲'] }, 1),
        loc_a: buildLocation({ id: 'loc_a', name: '甲地', connections: [] }, 1),
        item_a: buildItem({ id: 'item_a', name: '物品甲', ownerId: 'ch_a' }, 1)
      },
      foreshadows: {},
      chapters: [],
      highestChapter: 1
    };
    return new EntityRegistry(state.entities);
  }

  it('returns copies, so callers cannot mutate engine state', () => {
    const reg = registry();
    const a = reg.get('ch_a');
    a!.name = '篡改';
    assert.equal(reg.get('ch_a')!.name, '甲');
  });

  it('has / get / require with kind-aware getters', () => {
    const reg = registry();
    assert.equal(reg.has('ch_a'), true);
    assert.equal(reg.has('ch_nope'), false);
    assert.equal(reg.get('ch_nope'), undefined);
    assert.equal(reg.getCharacter('ch_a')!.kind, 'character');
    assert.equal(reg.getLocation('loc_a')!.kind, 'location');
    assert.equal(reg.getItem('item_a')!.kind, 'item');
    assert.equal(reg.getCharacter('loc_a'), undefined);
    assert.equal(reg.getLocation('ch_a'), undefined);
  });

  it('throws EntityNotFoundError and KindMismatchError from require*', () => {
    const reg = registry();
    assert.throws(() => reg.require('ch_nope'), EntityNotFoundError);
    assert.throws(() => reg.requireCharacter('loc_a'), KindMismatchError);
    assert.throws(() => reg.requireLocation('ch_a'), KindMismatchError);
    assert.throws(() => reg.requireItem('ch_a'), KindMismatchError);
  });

  it('matches by name or alias, and lists by kind', () => {
    const reg = registry();
    assert.equal(reg.byName('甲')[0]?.id, 'ch_a');
    assert.equal(reg.byName('阿甲')[0]?.id, 'ch_a');
    assert.deepEqual(reg.byName('不存在'), []);
    assert.equal(reg.listCharacters().length, 1);
    assert.equal(reg.listLocations().length, 1);
    assert.equal(reg.listItems().length, 1);
    assert.equal(reg.listByKind('character').length, 1);
  });
});

describe('ids', () => {
  it('createId yields valid, prefixed ids', () => {
    assert.deepEqual(
      Object.entries(ENTITY_ID_PREFIXES).map(([k, v]) => [k, v]),
      [
        ['character', 'ch'],
        ['location', 'loc'],
        ['item', 'item']
      ]
    );
    assert.equal(isValidId('ch_abc123'), true);
    assert.equal(isValidId('not an id'), false);
    assert.equal(isValidId(''), false);
  });
});
