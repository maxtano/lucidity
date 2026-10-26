import { describe, expect, it, vi } from 'vitest';
import {
  localCheckpointByteLimit,
  readCheckpointText,
  removeCheckpointText,
  writeCheckpointText,
  type CheckpointStorage,
} from './checkpoint-storage';

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: CheckpointStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return { values, storage };
}

describe('explicit local draft recovery storage', () => {
  it('isolates project slots and never touches the saved-show key or unrelated data', () => {
    const { storage, values } = memoryStorage();
    values.set('lucidity.studio.project.v1', 'saved show must stay unchanged');
    values.set('another-app-setting', 'keep this too');
    expect(readCheckpointText(storage, 'first')).toBeNull();
    writeCheckpointText(storage, 'first', '{"proposal":"first"}');
    writeCheckpointText(storage, 'second', '{"proposal":"second"}');
    expect(readCheckpointText(storage, 'first')).toBe('{"proposal":"first"}');
    expect(readCheckpointText(storage, 'second')).toBe('{"proposal":"second"}');
    removeCheckpointText(storage, 'first');
    expect(readCheckpointText(storage, 'first')).toBeNull();
    expect(readCheckpointText(storage, 'second')).toBe('{"proposal":"second"}');
    expect(values.get('lucidity.studio.project.v1')).toBe('saved show must stay unchanged');
    expect(values.get('another-app-setting')).toBe('keep this too');
    expect(
      [...values.keys()].filter((key) => key.startsWith('lucidity.agent.checkpoint.v1:'))
    ).toEqual(['lucidity.agent.checkpoint.v1:second']);
  });

  it('encodes IDs without collisions between separators, percent escapes, and Unicode', () => {
    const { storage, values } = memoryStorage();
    const ids = ['a/b', 'a%2Fb', 'a:b', 'a%3Ab', '🚁 夜空', '__proto__'];
    ids.forEach((id, index) => writeCheckpointText(storage, id, `draft-${index}`));
    expect(values.size).toBe(ids.length);
    ids.forEach((id, index) => expect(readCheckpointText(storage, id)).toBe(`draft-${index}`));
    expect(values.has('lucidity.agent.checkpoint.v1:a%2Fb')).toBe(true);
    expect(values.has('lucidity.agent.checkpoint.v1:a%252Fb')).toBe(true);
    expect(values.has('lucidity.agent.checkpoint.v1:%F0%9F%9A%81%20%E5%A4%9C%E7%A9%BA')).toBe(true);
  });

  it('accepts the exact UTF-8 byte bound and rejects oversize ASCII or multibyte text before writing', () => {
    const { storage } = memoryStorage();
    const exact = '🚁'.repeat(localCheckpointByteLimit / 4);
    expect(new TextEncoder().encode(exact).byteLength).toBe(localCheckpointByteLimit);
    writeCheckpointText(storage, 'project', exact);
    expect(readCheckpointText(storage, 'project')).toBe(exact);
    for (const text of [
      exact + 'x',
      'x'.repeat(localCheckpointByteLimit + 1),
      '夜'.repeat(333_334),
    ]) {
      expect(() => writeCheckpointText(storage, 'project', text)).toThrow(
        /1 MB local recovery limit/
      );
    }
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(readCheckpointText(storage, 'project')).toBe(exact);
  });

  it('checks read size too without deleting a malformed or oversized existing slot', () => {
    const { storage, values } = memoryStorage();
    const key = 'lucidity.agent.checkpoint.v1:project';
    const oversized = '🚁'.repeat(250_001);
    values.set(key, oversized);
    expect(() => readCheckpointText(storage, 'project')).toThrow(/1 MB local recovery limit/);
    expect(values.get(key)).toBe(oversized);
    expect(storage.removeItem).not.toHaveBeenCalled();
    values.set(key, '{malformed checkpoint text');
    expect(readCheckpointText(storage, 'project')).toBe('{malformed checkpoint text');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('preserves the old checkpoint when replacement storage is full', () => {
    const { storage, values } = memoryStorage();
    writeCheckpointText(storage, 'project', 'previous valid checkpoint');
    const fullStorage: CheckpointStorage = {
      ...storage,
      setItem: vi.fn(() => {
        throw new DOMException('Synthetic quota failure.', 'QuotaExceededError');
      }),
    };
    expect(() => writeCheckpointText(fullStorage, 'project', 'replacement')).toThrow(
      /previous saved draft was kept/
    );
    expect(readCheckpointText(storage, 'project')).toBe('previous valid checkpoint');
    expect(values.size).toBe(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(fullStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('returns friendly storage errors without leaking underlying error detail', () => {
    const inaccessible: CheckpointStorage = {
      getItem: () => {
        throw new Error('Synthetic private storage details');
      },
      setItem: () => {
        throw new Error('Synthetic private storage details');
      },
      removeItem: () => {
        throw new Error('Synthetic private storage details');
      },
    };
    expect(() => readCheckpointText(inaccessible, 'project')).toThrow(
      'Local draft storage is unavailable in this browser.'
    );
    expect(() => writeCheckpointText(inaccessible, 'project', 'draft')).toThrow(
      /Could not save the draft locally/
    );
    expect(() => removeCheckpointText(inaccessible, 'project')).toThrow(
      'Could not remove the saved draft. Local storage is unavailable.'
    );
  });

  it('rejects empty or unencodable project IDs without accessing storage', () => {
    const { storage } = memoryStorage();
    for (const id of ['', '\ud800']) {
      expect(() => readCheckpointText(storage, id)).toThrow();
      expect(() => writeCheckpointText(storage, id, 'draft')).toThrow();
      expect(() => removeCheckpointText(storage, id)).toThrow();
    }
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
