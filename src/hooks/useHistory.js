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
    past   : [], // array of { type: 'state', state } OR { type: 'thunk', undo, redo }
    present: initialState,
    future : [],
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

  const pushThunk = useCallback((thunk) => {
    setHistory((h) => {
      return {
        past: [...h.past, { type: 'thunk', undo: thunk.undo, redo: thunk.redo }],
        present: h.present,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const past = [...h.past];
      const last = past.pop();

      if (last.type === 'state') {
        return {
          past,
          present: last.state,
          future: [{ type: 'state', state: h.present }, ...h.future],
        };
      } else {
        last.undo();
        return {
          past,
          present: h.present,
          future: [last, ...h.future],
        };
      }
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const future = [...h.future];
      const first = future.shift();

      if (first.type === 'state') {
        return {
          past: [...h.past, { type: 'state', state: h.present }],
          present: first.state,
          future,
        };
      } else {
        first.redo();
        return {
          past: [...h.past, first],
          present: h.present,
          future,
        };
      }
    });
  }, []);

  return {
    state  : history.present,
    commit,
    pushThunk,
    undo,
    redo,
    canUndo: history.past.length   > 0,
    canRedo: history.future.length > 0,
  };
}
