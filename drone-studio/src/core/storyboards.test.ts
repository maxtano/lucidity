import { describe, expect, it, vi } from 'vitest';
import { projectSchema } from './model';
import { createZorroStopStoryboard } from './zorro-test';
import {
  createStoryboard,
  deleteStoryboard,
  isStoryboardDeleted,
  loadDeletedStoryboards,
  loadStoryboards,
  resolveInitialStoryboard,
  restoreStoryboard,
  saveStoryboard,
  shouldPersistInitialStoryboard,
  STORYBOARDS_STORAGE_KEY,
} from './storyboards';

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(STORYBOARDS_STORAGE_KEY, initial);
  values.set('lucidity.studio.project.v1', 'existing current-project autosave');
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe('storyboard library', () => {
  it('renames only the former generated idle template while preserving authored changes', () => {
    const old = createZorroStopStoryboard('existing-id');
    old.name = 'Zorro kill-switch test';
    old.cues[0].name = 'All-four motor stop';
    old.cues[0].metadata!.note = 'keep me';
    const store = storage(JSON.stringify([{ project: old, updatedAt: 12 }]));
    const loaded = loadStoryboards(store)[0].project;
    expect(loaded.name).toBe('Props-off idle');
    expect(loaded.cues[0].name).toBe('Armed idle');
    expect(loaded.cues[0].metadata?.note).toBe('keep me');
    expect(loaded.id).toBe(old.id);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('starts empty without touching the existing project autosave', () => {
    const store = storage();
    expect(loadStoryboards(store)).toEqual([]);
    expect(store.getItem).toHaveBeenCalledWith(STORYBOARDS_STORAGE_KEY);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values.get('lucidity.studio.project.v1')).toBe(
      'existing current-project autosave'
    );
  });

  it('round-trips multiple documents and updates only the matching ID', () => {
    const store = storage();
    const first = createStoryboard('First', 'first');
    const second = createStoryboard('Second', 'second');
    saveStoryboard(store, first, 100);
    saveStoryboard(store, second, 200);
    const edited = structuredClone(first);
    edited.revision = 7;
    edited.name = 'First revised';
    edited.cues[0].droneEdits!['1'].position = [3, 5, 8];
    const saved = saveStoryboard(store, edited, 300);
    expect(saved).toEqual([
      { project: edited, updatedAt: 300 },
      { project: second, updatedAt: 200 },
    ]);
    expect(loadStoryboards(store)).toEqual(saved);
    expect(store.values.get('lucidity.studio.project.v1')).toBe(
      'existing current-project autosave'
    );
    expect(store.setItem.mock.calls.every(([key]) => key === STORYBOARDS_STORAGE_KEY)).toBe(true);
  });

  it('owns nested projects and metadata across input, returned results and later reads', () => {
    const store = storage();
    const source = createStoryboard('Owned', 'owned');
    source.cues[0].metadata = { notes: { colors: ['cyan'] } };
    const saved = saveStoryboard(store, source, 100);
    source.cues[0].droneEdits!['1'].position![0] = 99;
    (source.cues[0].metadata.notes as { colors: string[] }).colors.push('gold');
    saved[0].project.cues[0].droneEdits!['1'].position![1] = 42;
    (saved[0].project.cues[0].metadata!.notes as { colors: string[] }).colors.push('rose');
    const firstRead = loadStoryboards(store);
    expect(firstRead[0].project.cues[0].droneEdits!['1'].position).toEqual([0, 0, 0]);
    expect(firstRead[0].project.cues[0].metadata).toEqual({ notes: { colors: ['cyan'] } });
    firstRead[0].project.name = 'Changed only in memory';
    expect(loadStoryboards(store)[0].project.name).toBe('Owned');
  });

  it.each([
    '',
    '{broken',
    'null',
    '{}',
    '[{"project":{},"updatedAt":10}]',
    JSON.stringify([{ project: createStoryboard('Valid', 'valid'), updatedAt: -1 }]),
    JSON.stringify([{ project: createStoryboard('Valid', 'valid'), updatedAt: 1, deletedAt: -1 }]),
    JSON.stringify([{ project: createStoryboard('Valid', 'valid'), updatedAt: 1, deletedAt: null }]),
    JSON.stringify([{ project: createStoryboard('Valid', 'valid'), updatedAt: 1, extra: true }]),
    JSON.stringify([
      { project: createStoryboard('First', 'same-id'), updatedAt: 1 },
      { project: createStoryboard('Second', 'same-id'), updatedAt: 2 },
    ]),
  ])('refuses a malformed existing library without overwriting any bytes: %s', (raw) => {
    const store = storage(raw);
    expect(() => loadStoryboards(store)).toThrow(/malformed/);
    expect(() => loadDeletedStoryboards(store)).toThrow(/malformed/);
    expect(() => isStoryboardDeleted(store, 'valid')).toThrow(/malformed/);
    expect(() => saveStoryboard(store, createStoryboard('New', 'new'), 50)).toThrow(/malformed/);
    expect(() => deleteStoryboard(store, 'valid', 50)).toThrow(/malformed/);
    expect(() => restoreStoryboard(store, 'valid')).toThrow(/malformed/);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values.get(STORYBOARDS_STORAGE_KEY)).toBe(raw);
  });

  it('surfaces quota failures and preserves every prior entry without pruning', () => {
    const store = storage();
    saveStoryboard(store, createStoryboard('Existing', 'existing'), 100);
    const original = store.values.get(STORYBOARDS_STORAGE_KEY);
    store.setItem.mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() => saveStoryboard(store, createStoryboard('New', 'new'), 200)).toThrow(
      /Could not save/
    );
    expect(store.values.get(STORYBOARDS_STORAGE_KEY)).toBe(original);
    expect(loadStoryboards(store).map((entry) => entry.project.id)).toEqual(['existing']);
  });

  it('does not write if storage cannot be read or the new document/timestamp is invalid', () => {
    const store = storage();
    store.getItem.mockImplementationOnce(() => {
      throw new Error('Storage blocked');
    });
    expect(() => saveStoryboard(store, createStoryboard('Valid', 'valid'), 10)).toThrow(
      /Could not read/
    );
    const invalid = createStoryboard('Valid', 'valid');
    invalid.droneCount = 0;
    expect(() => saveStoryboard(store, invalid, 10)).toThrow();
    expect(() => saveStoryboard(store, createStoryboard('Valid', 'valid'), Infinity)).toThrow();
    expect(store.setItem).not.toHaveBeenCalled();
  });
});

describe('deleted storyboards', () => {
  it('archives only the selected document in one write and preserves it through other saves', () => {
    const store = storage();
    const first = createStoryboard('First', 'first');
    const second = createStoryboard('Second', 'second');
    saveStoryboard(store, first, 100);
    saveStoryboard(store, second, 200);
    store.setItem.mockClear();
    expect(deleteStoryboard(store, 'first', 300)).toEqual([{ project: second, updatedAt: 200 }]);
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(loadStoryboards(store)).toEqual([{ project: second, updatedAt: 200 }]);
    expect(loadDeletedStoryboards(store)).toEqual([
      { project: first, updatedAt: 100, deletedAt: 300 },
    ]);
    expect(isStoryboardDeleted(store, 'first')).toBe(true);
    expect(isStoryboardDeleted(store, 'second')).toBe(false);
    expect(isStoryboardDeleted(store, 'unknown')).toBe(false);
    second.name = 'Second revised';
    expect(saveStoryboard(store, second, 400)).toEqual([{ project: second, updatedAt: 400 }]);
    saveStoryboard(store, createStoryboard('Third', 'third'), 500);
    expect(loadDeletedStoryboards(store)).toEqual([
      { project: first, updatedAt: 100, deletedAt: 300 },
    ]);
    expect(store.values.get('lucidity.studio.project.v1')).toBe('existing current-project autosave');
  });

  it('restores the exact original project and timestamp without sharing nested references', () => {
    const store = storage();
    const original = createStoryboard('Original', 'original');
    original.revision = 8;
    original.cues[0].metadata = { notes: { colors: ['cyan'] } };
    original.cues[0].benchCue = { motor: 1, offset: 3 };
    saveStoryboard(store, original, 100);
    deleteStoryboard(store, 'original', 200);
    const archive = loadDeletedStoryboards(store);
    archive[0].project.name = 'Memory only';
    (archive[0].project.cues[0].metadata!.notes as { colors: string[] }).colors.push('gold');
    store.setItem.mockClear();
    const restored = restoreStoryboard(store, 'original');
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(restored).toEqual([{ project: original, updatedAt: 100 }]);
    expect(loadDeletedStoryboards(store)).toEqual([]);
    expect(isStoryboardDeleted(store, 'original')).toBe(false);
    restored[0].project.cues[0].benchCue!.offset = 5;
    expect(loadStoryboards(store)).toEqual([{ project: original, updatedAt: 100 }]);
    expect(JSON.parse(store.values.get(STORYBOARDS_STORAGE_KEY)!)[0]).not.toHaveProperty('deletedAt');
  });

  it('rejects stale autosave of a deleted ID even when the stale revision is newer', () => {
    const store = storage();
    const project = createStoryboard('Deleted', 'deleted');
    saveStoryboard(store, project, 100);
    deleteStoryboard(store, project.id, 200);
    const before = new Map(store.values);
    store.setItem.mockClear();
    project.revision = 100;
    project.name = 'Stale in-memory edit';
    expect(() => saveStoryboard(store, project, 300)).toThrow(/deleted.*Restore/);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values).toEqual(before);
    expect(loadStoryboards(store)).toEqual([]);
    expect(loadDeletedStoryboards(store)[0].project.name).toBe('Deleted');
  });

  it('does not write for missing IDs or repeated delete/restore requests', () => {
    const store = storage();
    expect(deleteStoryboard(store, 'missing', 100)).toEqual([]);
    expect(restoreStoryboard(store, 'missing')).toEqual([]);
    expect(store.setItem).not.toHaveBeenCalled();
    saveStoryboard(store, createStoryboard('Existing', 'existing'), 100);
    store.setItem.mockClear();
    expect(restoreStoryboard(store, 'existing')).toHaveLength(1);
    expect(deleteStoryboard(store, 'missing', 200)).toHaveLength(1);
    expect(restoreStoryboard(store, 'missing')).toHaveLength(1);
    expect(store.setItem).not.toHaveBeenCalled();
    deleteStoryboard(store, 'existing', 0);
    store.setItem.mockClear();
    expect(deleteStoryboard(store, 'existing', 300)).toEqual([]);
    expect(loadDeletedStoryboards(store)[0].deletedAt).toBe(0);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it.each(['delete', 'restore'] as const)('keeps all stored bytes when a %s write fails', (operation) => {
    const store = storage();
    saveStoryboard(store, createStoryboard('Existing', 'existing'), 100);
    saveStoryboard(store, createStoryboard('Other', 'other'), 200);
    if (operation === 'restore') deleteStoryboard(store, 'existing', 300);
    const before = new Map(store.values);
    store.setItem.mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() =>
      operation === 'delete'
        ? deleteStoryboard(store, 'existing', 400)
        : restoreStoryboard(store, 'existing')
    ).toThrow(new RegExp(`Could not ${operation}`));
    expect(store.values).toEqual(before);
    expect(isStoryboardDeleted(store, 'existing')).toBe(operation === 'restore');
  });

  it('rejects an invalid deletion timestamp and unreadable storage without writing', () => {
    const store = storage();
    saveStoryboard(store, createStoryboard('Existing', 'existing'), 100);
    const before = new Map(store.values);
    store.setItem.mockClear();
    expect(() => deleteStoryboard(store, 'existing', Infinity)).toThrow();
    expect(() => deleteStoryboard(store, 'existing', -1)).toThrow();
    store.getItem.mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    expect(() => deleteStoryboard(store, 'existing', 200)).toThrow(/Could not read/);
    expect(() => restoreStoryboard(store, 'existing')).toThrow(/Could not read/);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values).toEqual(before);
  });
});

describe('new storyboard', () => {
  it('creates an owned, schema-valid one-drone custom scene at the origin', () => {
    const project = createStoryboard('  My storyboard  ', 'new-storyboard');
    expect(projectSchema.parse(project)).toEqual(project);
    expect(project).toMatchObject({
      id: 'new-storyboard',
      name: 'My storyboard',
      revision: 0,
      droneCount: 1,
    });
    expect(project.cues).toHaveLength(1);
    expect(project.cues[0]).toMatchObject({
      shape: 'custom',
      duration: 10,
      transition: 0,
      altitude: 0,
      droneEdits: { '1': { position: [0, 0, 0] } },
    });
    const another = createStoryboard();
    expect(another.name).toBe('Untitled storyboard');
    expect(another.id).not.toBe(createStoryboard().id);
    project.limits.maxSpeed = 2;
    project.cues[0].droneEdits!['1'].position![0] = 99;
    expect(another.limits.maxSpeed).toBe(8);
    expect(another.cues[0].droneEdits!['1'].position).toEqual([0, 0, 0]);
  });

  it('rejects empty or overly long names and IDs through the project schema', () => {
    expect(() => createStoryboard('   ', 'valid')).toThrow();
    expect(() => createStoryboard('x'.repeat(81), 'valid')).toThrow();
    expect(() => createStoryboard('Valid', '')).toThrow();
    expect(() => createStoryboard('Valid', 'x'.repeat(101))).toThrow();
  });
});

describe('initial storyboard recovery', () => {
  const legacyKey = 'lucidity.studio.project.v1';
  const fallback = () => createStoryboard('Fallback', 'fallback');

  it('recovers a newer library revision after an interrupted legacy write and preserves it on autosave', () => {
    const store = storage();
    const older = createStoryboard('Older autosave', 'same-project');
    older.revision = 4;
    const newer = structuredClone(older);
    newer.revision = 5;
    newer.name = 'Newer library work';
    newer.cues[0].droneEdits!['1'].position = [2, 4, 9];
    saveStoryboard(store, newer, 200);
    store.values.set(legacyKey, JSON.stringify(older));
    store.setItem.mockClear();
    const recovered = resolveInitialStoryboard(store, legacyKey, fallback());
    expect(recovered).toEqual(newer);
    expect(store.setItem).not.toHaveBeenCalled();
    saveStoryboard(store, recovered, 300);
    expect(loadStoryboards(store)[0].project).toEqual(newer);
  });

  it('uses the canonical library content on a matching revision tie, but keeps a newer legacy revision', () => {
    const store = storage();
    const library = createStoryboard('Canonical', 'same-project');
    library.revision = 3;
    saveStoryboard(store, library, 100);
    const legacy = { ...structuredClone(library), name: 'Legacy tie' };
    store.values.set(legacyKey, JSON.stringify(legacy));
    expect(resolveInitialStoryboard(store, legacyKey, fallback()).name).toBe('Canonical');
    legacy.revision = 4;
    store.values.set(legacyKey, JSON.stringify(legacy));
    expect(resolveInitialStoryboard(store, legacyKey, fallback())).toEqual(legacy);
  });

  it.each([undefined, '{broken', '{}'])(
    'opens the most recent valid library document when legacy is absent or invalid: %s',
    (raw) => {
      const store = storage();
      saveStoryboard(store, createStoryboard('Most recent', 'recent'), 300);
      saveStoryboard(store, createStoryboard('Older but later in array', 'older'), 100);
      if (raw === undefined) store.values.delete(legacyKey);
      else store.values.set(legacyKey, raw);
      store.setItem.mockClear();
      expect(resolveInitialStoryboard(store, legacyKey, fallback()).id).toBe('recent');
      expect(store.setItem).not.toHaveBeenCalled();
    }
  );

  it('preserves a valid legacy document if the library is corrupt, without repairing or writing it', () => {
    const store = storage('{broken library');
    const legacy = createStoryboard('Existing work', 'existing');
    store.values.set(legacyKey, JSON.stringify(legacy));
    const before = new Map(store.values);
    expect(resolveInitialStoryboard(store, legacyKey, fallback())).toEqual(legacy);
    expect(store.values).toEqual(before);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(() => saveStoryboard(store, legacy, 200)).toThrow(/malformed/);
  });

  it('keeps a valid active legacy identity even when another library document is more recent', () => {
    const store = storage();
    const active = createStoryboard('Active', 'active');
    store.values.set(legacyKey, JSON.stringify(active));
    saveStoryboard(store, createStoryboard('Other', 'other'), 1000);
    expect(resolveInitialStoryboard(store, legacyKey, fallback())).toEqual(active);
  });

  it('ignores a deleted legacy identity and recovers the most recent active storyboard', () => {
    const store = storage();
    const deleted = createStoryboard('Deleted', 'deleted');
    saveStoryboard(store, deleted, 500);
    saveStoryboard(store, createStoryboard('Older', 'older'), 100);
    const recent = createStoryboard('Recent active', 'recent');
    saveStoryboard(store, recent, 200);
    deleteStoryboard(store, deleted.id, 600);
    deleted.revision = 99;
    store.values.set(legacyKey, JSON.stringify(deleted));
    store.setItem.mockClear();
    expect(resolveInitialStoryboard(store, legacyKey, fallback())).toEqual(recent);
    expect(shouldPersistInitialStoryboard(store, legacyKey)).toBe(true);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('uses an unsaved fallback when the last storyboard was deleted, even with a stale legacy autosave', () => {
    const store = storage();
    const deleted = createStoryboard('Deleted', 'deleted');
    saveStoryboard(store, deleted, 100);
    store.values.set(legacyKey, JSON.stringify(deleted));
    deleteStoryboard(store, deleted.id, 200);
    const before = new Map(store.values);
    store.setItem.mockClear();
    expect(resolveInitialStoryboard(store, legacyKey, fallback())).toEqual(fallback());
    expect(shouldPersistInitialStoryboard(store, legacyKey)).toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values).toEqual(before);
  });

  it('allows first-run autosave and legacy migration but leaves an intentionally empty library empty', () => {
    const fresh = storage();
    expect(shouldPersistInitialStoryboard(fresh, legacyKey)).toBe(true);
    const empty = storage('[]');
    expect(shouldPersistInitialStoryboard(empty, legacyKey)).toBe(false);
    empty.values.delete(legacyKey);
    expect(shouldPersistInitialStoryboard(empty, legacyKey)).toBe(false);
    const legacy = createStoryboard('Legacy work', 'legacy');
    empty.values.set(legacyKey, JSON.stringify(legacy));
    expect(shouldPersistInitialStoryboard(empty, legacyKey)).toBe(true);
    saveStoryboard(empty, createStoryboard('Unrelated deleted work', 'deleted'), 100);
    deleteStoryboard(empty, 'deleted', 200);
    expect(shouldPersistInitialStoryboard(empty, legacyKey)).toBe(true);
    expect(resolveInitialStoryboard(empty, legacyKey, fallback())).toEqual(legacy);
    expect(fresh.setItem).not.toHaveBeenCalled();
  });

  it('preserves the existing startup error path for malformed or unreadable libraries', () => {
    const malformed = storage('{broken');
    expect(shouldPersistInitialStoryboard(malformed, legacyKey)).toBe(true);
    expect(malformed.setItem).not.toHaveBeenCalled();
    expect(malformed.values.get(STORYBOARDS_STORAGE_KEY)).toBe('{broken');
    const blocked = storage();
    blocked.getItem.mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    expect(shouldPersistInitialStoryboard(blocked, legacyKey)).toBe(true);
    expect(blocked.setItem).not.toHaveBeenCalled();
  });

  it('returns an owned fallback if both reads fail and never aliases any recovery result', () => {
    const store = storage();
    store.getItem.mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    const source = fallback();
    const recovered = resolveInitialStoryboard(store, legacyKey, source);
    expect(recovered).toEqual(source);
    recovered.cues[0].droneEdits!['1'].position![0] = 90;
    expect(source.cues[0].droneEdits!['1'].position).toEqual([0, 0, 0]);
    expect(store.setItem).not.toHaveBeenCalled();
  });
});
