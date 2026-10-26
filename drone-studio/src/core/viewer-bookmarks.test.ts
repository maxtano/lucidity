import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VENUE_PLACEMENT, DEFAULT_VIEWER_POSE, type ViewerBookmark } from './viewer';
import {
  loadViewerBookmarks,
  MAX_VIEWER_BOOKMARK_BYTES,
  saveViewerBookmarks,
} from './viewer-bookmarks';

function bookmark(id = 'center', name = 'Center audience'): ViewerBookmark {
  return {
    id,
    name,
    snapshot: { pose: { ...DEFAULT_VIEWER_POSE }, venue: { ...DEFAULT_VENUE_PLACEMENT } },
  };
}
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe('explicit local viewer bookmarks', () => {
  it('uses an isolated versioned project slot and never touches show/checkpoint storage', () => {
    const storage = memoryStorage();
    storage.values.set('lucidity.studio.project.v1', 'authored show');
    storage.values.set('lucidity.agent.checkpoint.v1:project', 'unapplied proposal');
    expect(loadViewerBookmarks(storage, 'project')).toEqual([]);
    saveViewerBookmarks(storage, 'project', [bookmark()]);
    expect(loadViewerBookmarks(storage, 'project')).toEqual([bookmark()]);
    expect(storage.values.get('lucidity.studio.project.v1')).toBe('authored show');
    expect(storage.values.get('lucidity.agent.checkpoint.v1:project')).toBe('unapplied proposal');
    const saved = JSON.parse(storage.values.get('lucidity.viewer.bookmarks.v1:project')!);
    expect(saved).toMatchObject({
      format: 'lucidity.viewer-bookmarks',
      version: 1,
      projectId: 'project',
    });
  });

  it('keeps special/Unicode project IDs separate without encoded-key collisions', () => {
    const storage = memoryStorage();
    const ids = ['a/b', 'a%2Fb', 'a:b', 'a%3Ab', '夜空 🚁', '__proto__'];
    ids.forEach((id, index) => saveViewerBookmarks(storage, id, [bookmark(`view-${index}`)]));
    expect(storage.values.size).toBe(ids.length);
    ids.forEach((id, index) =>
      expect(loadViewerBookmarks(storage, id)[0].id).toBe(`view-${index}`)
    );
  });

  it('retains exact angles and returns independent snapshot objects across repeated saves', () => {
    const storage = memoryStorage();
    const original = bookmark();
    original.snapshot.pose = {
      east: 12.4,
      north: -55.1,
      yaw: 12.123456789012345,
      pitch: 33.1234567890123,
      eyeHeight: 1.73,
      fov: 88.7654321,
    };
    original.snapshot.venue = { east: 34.5, north: 62.7, heading: 271.1234567890123 };
    const before = structuredClone(original);
    let saved = [original];
    for (let iteration = 0; iteration < 20; iteration++) {
      saveViewerBookmarks(storage, 'project', saved);
      saved = loadViewerBookmarks(storage, 'project');
    }
    expect(saved).toEqual([original]);
    expect(original).toEqual(before);
    saved[0].snapshot.pose.yaw = 99;
    saved[0].snapshot.venue.east = 499;
    expect(loadViewerBookmarks(storage, 'project')).toEqual([original]);
  });

  it('normalizes only explicit save inputs, trims names, and preserves the caller', () => {
    const storage = memoryStorage();
    const input = bookmark('near-stage', '  Near stage  ');
    input.snapshot.pose.yaw = 450;
    input.snapshot.pose.north = -999;
    input.snapshot.venue = { east: 999, north: 30, heading: -90 };
    const before = structuredClone(input);
    saveViewerBookmarks(storage, 'project', [input]);
    const saved = loadViewerBookmarks(storage, 'project')[0];
    expect(saved.name).toBe('Near stage');
    expect(saved.snapshot.pose.yaw).toBe(90);
    expect(saved.snapshot.pose.north).toBe(-500);
    expect(saved.snapshot.venue).toEqual({ east: 500, north: 30, heading: 270 });
    expect(input).toEqual(before);
  });

  it('accepts 12 bookmarks and boundary lengths; rejects count, duplicate, name, and ID violations before writing', () => {
    const storage = memoryStorage();
    const exact = Array.from({ length: 12 }, (_, index) =>
      bookmark(String(index).padStart(80, 'x'), 'n'.repeat(48))
    );
    saveViewerBookmarks(storage, 'project', exact);
    expect(loadViewerBookmarks(storage, 'project')).toEqual(exact);
    const calls = storage.setItem.mock.calls.length;
    for (const input of [
      [...exact, bookmark('extra')],
      [bookmark('same'), bookmark('same')],
      [bookmark('')],
      [bookmark(' ')],
      [bookmark('x'.repeat(81))],
      [bookmark('id', '')],
      [bookmark('id', '   ')],
      [bookmark('id', 'n'.repeat(49))],
    ])
      expect(() => saveViewerBookmarks(storage, 'project', input)).toThrow();
    expect(storage.setItem).toHaveBeenCalledTimes(calls);
    expect(loadViewerBookmarks(storage, 'project')).toEqual(exact);
  });

  it('rejects unknown fields and nonfinite values on save without changing previous data', () => {
    const storage = memoryStorage();
    saveViewerBookmarks(storage, 'project', [bookmark()]);
    const invalid = [
      { ...bookmark(), project: { name: 'Do not save show data here' } },
      { ...bookmark(), snapshot: { ...bookmark().snapshot, unknown: true } },
      {
        ...bookmark(),
        snapshot: { ...bookmark().snapshot, pose: { ...DEFAULT_VIEWER_POSE, unknown: true } },
      },
      {
        ...bookmark(),
        snapshot: { ...bookmark().snapshot, venue: { ...DEFAULT_VENUE_PLACEMENT, unknown: true } },
      },
      {
        ...bookmark(),
        snapshot: { ...bookmark().snapshot, pose: { ...DEFAULT_VIEWER_POSE, yaw: NaN } },
      },
      {
        ...bookmark(),
        snapshot: {
          ...bookmark().snapshot,
          venue: { ...DEFAULT_VENUE_PLACEMENT, heading: Infinity },
        },
      },
    ];
    for (const input of invalid)
      expect(() => saveViewerBookmarks(storage, 'project', [input as ViewerBookmark])).toThrow();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(loadViewerBookmarks(storage, 'project')).toEqual([bookmark()]);
  });

  it('rejects malformed/incompatible/cross-project saved envelopes without silently repairing or overwriting them', () => {
    const storage = memoryStorage();
    saveViewerBookmarks(storage, 'project', [bookmark()]);
    const key = 'lucidity.viewer.bookmarks.v1:project';
    const valid = JSON.parse(storage.values.get(key)!);
    const invalid = [
      '{malformed',
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, format: 'wrong-format' }),
      JSON.stringify({ ...valid, projectId: 'different-project' }),
      JSON.stringify({ ...valid, extra: true }),
      JSON.stringify({ ...valid, bookmarks: [bookmark('x', ' untrimmed ')] }),
      JSON.stringify({
        ...valid,
        bookmarks: [
          {
            ...bookmark(),
            snapshot: { ...bookmark().snapshot, pose: { ...DEFAULT_VIEWER_POSE, yaw: 360 } },
          },
        ],
      }),
      JSON.stringify({
        ...valid,
        bookmarks: [
          {
            ...bookmark(),
            snapshot: { ...bookmark().snapshot, venue: { ...DEFAULT_VENUE_PLACEMENT, north: 999 } },
          },
        ],
      }),
      JSON.stringify({ ...valid, bookmarks: [bookmark(), bookmark()] }),
      JSON.stringify({ ...valid, bookmarks: [{ id: 'x', name: 'Missing snapshot' }] }),
      JSON.stringify({
        ...valid,
        bookmarks: Array.from({ length: 13 }, (_, index) => bookmark(`${index}`)),
      }),
    ];
    for (const text of invalid) {
      storage.values.set(key, text);
      expect(() => loadViewerBookmarks(storage, 'project')).toThrow(/Saved viewer bookmarks/);
      expect(storage.values.get(key)).toBe(text);
    }
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('caps incoming data by UTF-8 bytes before parsing', () => {
    const storage = memoryStorage();
    const key = 'lucidity.viewer.bookmarks.v1:project';
    for (const text of [
      'x'.repeat(MAX_VIEWER_BOOKMARK_BYTES + 1),
      '夜'.repeat(Math.floor(MAX_VIEWER_BOOKMARK_BYTES / 3) + 1),
    ]) {
      storage.values.set(key, text);
      expect(() => loadViewerBookmarks(storage, 'project')).toThrow(/64 KB/);
      expect(storage.values.get(key)).toBe(text);
    }
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('surfaces quota/storage exceptions while keeping the previous saved slot', () => {
    const storage = memoryStorage();
    saveViewerBookmarks(storage, 'project', [bookmark()]);
    const full = {
      setItem() {
        throw new DOMException('Synthetic quota', 'QuotaExceededError');
      },
    };
    expect(() => saveViewerBookmarks(full, 'project', [bookmark('replacement')])).toThrow(
      /previous bookmarks were kept/
    );
    expect(loadViewerBookmarks(storage, 'project')).toEqual([bookmark()]);
    expect(() =>
      loadViewerBookmarks(
        {
          getItem() {
            throw new Error('Private storage error');
          },
        },
        'project'
      )
    ).toThrow('Viewer bookmark storage is unavailable in this browser.');
  });

  it('requires valid project IDs before any storage access and allows explicit empty saves', () => {
    const storage = memoryStorage();
    for (const id of ['', 'x'.repeat(101), '\ud800']) {
      expect(() => loadViewerBookmarks(storage, id)).toThrow();
      expect(() => saveViewerBookmarks(storage, id, [bookmark()])).toThrow();
    }
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    saveViewerBookmarks(storage, 'project', []);
    expect(loadViewerBookmarks(storage, 'project')).toEqual([]);
    expect(storage.values.size).toBe(1);
  });
});
