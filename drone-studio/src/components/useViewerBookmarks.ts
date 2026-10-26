import { useEffect, useRef, useState } from 'react';
import {
  loadViewerBookmarks,
  saveViewerBookmarks,
  type ViewerBookmark,
} from '../core/viewer-bookmarks';
import type { ViewerSnapshot } from '../core/viewer';

/** Explicit local saves, isolated from the show and from other projects. */
export function useViewerBookmarks(projectId: string) {
  const [archive, setArchive] = useState<{
    projectId: string;
    items: ViewerBookmark[];
    writable: boolean;
  }>({ projectId, items: [], writable: false });
  const [message, setMessage] = useState('');
  const current = useRef(archive);

  useEffect(() => {
    try {
      const next = {
        projectId,
        items: loadViewerBookmarks(localStorage, projectId),
        writable: true,
      };
      current.current = next;
      setArchive(next);
      setMessage('Saved on this device. Recall a view at any point in the show.');
    } catch (error) {
      const next = { projectId, items: [], writable: false };
      current.current = next;
      setArchive(next);
      setMessage(error instanceof Error ? error.message : 'Saved views are unavailable.');
    }
  }, [projectId]);

  const persist = (update: (items: ViewerBookmark[]) => ViewerBookmark[], success: string) => {
    try {
      if (current.current.projectId !== projectId || !current.current.writable)
        throw new Error('Saved views could not be loaded. Existing storage has been preserved.');
      // A second preview can save views too; never overwrite its newer local list.
      const items = update(loadViewerBookmarks(localStorage, projectId));
      saveViewerBookmarks(localStorage, projectId, items);
      const next = { projectId, items, writable: true };
      current.current = next;
      setArchive(next);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The view could not be saved.');
    }
  };

  return {
    bookmarks: archive.projectId === projectId ? archive.items : [],
    message,
    save: (name: string, snapshot: ViewerSnapshot) => {
      const bookmark = { id: crypto.randomUUID(), name: name.trim(), snapshot };
      persist((items) => [...items, bookmark], `Saved “${bookmark.name}” on this device.`);
    },
    remove: (id: string) => {
      persist((items) => items.filter((item) => item.id !== id), 'View removed.');
    },
    recall: (id: string): ViewerSnapshot | undefined => {
      if (current.current.projectId !== projectId) return;
      const bookmark = current.current.items.find((item) => item.id === id);
      if (!bookmark) return;
      setMessage(`Viewing “${bookmark.name}”. The playhead stays where it is.`);
      return structuredClone(bookmark.snapshot);
    },
  };
}
