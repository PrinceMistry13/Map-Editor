import { useState, useCallback } from 'react';

/**
 * Generic undo/redo history hook supporting both state snapshots and action thunks.
 *
 * commit(newState | updater)  — push state snapshot to history (future cleared)
 * pushThunk({ undo, redo })   — push an action thunk to history (future cleared)
 * undo()                      — move back one step
 * redo()                      — move forward one step
 * canUndo / canRedo           — booleans
 */
export function useHistory(initialState) {
  const [history, setHistory] = useState({
    past: [], // array of { type: 'state', state } OR { type: 'thunk', undo, redo }
    present: initialState,
    future: [],
  });

  const commit = useCallback((newPresentOrUpdater) => {
    setHistory((h) => {
      const next =
        typeof newPresentOrUpdater === 'function'
          ? newPresentOrUpdater(h.present)
          : newPresentOrUpdater;
      return {
        past: [...h.past, { type: 'state', state: h.present }],
        present: next,
        future: [],
      };
    });
  }, []);

  // Mutates `present` directly WITHOUT pushing a history entry and WITHOUT
  // clearing `future`. For use inside a thunk's own undo/redo (see
  // pushThunk below) when part of that thunk's effect is a plain state
  // change (e.g. removing a layer) that should be restored/reapplied by the
  // SAME undo/redo step, not recorded as a second, separate history step.
  const setPresentSilently = useCallback((newPresentOrUpdater) => {
    setHistory((h) => ({
      ...h,
      present: typeof newPresentOrUpdater === 'function'
        ? newPresentOrUpdater(h.present)
        : newPresentOrUpdater,
    }));
  }, []);

  const pushThunk = useCallback((thunk) => {
    setHistory((h) => {
      return {
        past: [...h.past, { type: 'thunk', undo: thunk.undo, redo: thunk.redo }],
        present: h.present,
        future: [],
      };
    });
  }, []);

  // undo/redo call a thunk's real side effect (e.g. recreating a deleted
  // polygon's Google Maps overlay). That side effect must run EXACTLY once.
  // It is deliberately NOT called from inside the setHistory updater below:
  // React (in StrictMode/dev) invokes state-updater functions twice to
  // detect impure updaters, and a real side effect placed there would fire
  // twice — creating two overlays for the same id, where only the second is
  // ever tracked by the manager. The first becomes an orphaned "ghost" that
  // stays on the map forever, since a later delete only finds the tracked
  // one. Reading `history` directly here (a plain, single, synchronous
  // call) avoids that entirely.
  const undo = useCallback(() => {
    if (history.past.length === 0) return;
    const past = [...history.past];
    const last = past.pop();

    if (last.type === 'state') {
      setHistory({
        past,
        present: last.state,
        future: [{ type: 'state', state: history.present }, ...history.future],
      });
    } else {
      last.undo();
      setHistory({
        past,
        present: history.present,
        future: [last, ...history.future],
      });
    }
  }, [history]);

  const redo = useCallback(() => {
    if (history.future.length === 0) return;
    const future = [...history.future];
    const first = future.shift();

    if (first.type === 'state') {
      setHistory({
        past: [...history.past, { type: 'state', state: history.present }],
        present: first.state,
        future,
      });
    } else {
      first.redo();
      setHistory({
        past: [...history.past, first],
        present: history.present,
        future,
      });
    }
  }, [history]);

  return {
    state: history.present,
    commit,
    setPresentSilently,
    pushThunk,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
