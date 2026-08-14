import { useCallback, useEffect, useRef, useState } from 'react';

export type AdminResourceState = 'loading' | 'ready' | 'error';

export interface AdminResource<T> {
  state: AdminResourceState;
  data: T | null;
  error: unknown;
  reload: () => void;
}

/**
 * One fetch, one block, one retry button.
 *
 * Every back-office block owns its own copy of this instead of the
 * screen owning one big `Promise.all`. That is the difference between
 * an ops page that says 「语料 12842 段，解析队列读不到」 and one that
 * says nothing at all because the AI stats query was slow.
 *
 * `load` must be stable across renders — pass a module-level function
 * or a `useCallback`. It is a dependency of the effect below, so an
 * inline arrow would re-fetch on every render.
 *
 * The sequence guard is not decoration: pull-to-refresh while a first
 * load is still in flight means two responses race, and without it the
 * older one can land last and overwrite the newer state — including
 * overwriting fresh data with a stale error.
 */
export const useAdminResource = <T>(load: () => Promise<T>): AdminResource<T> => {
  const [state, setState] = useState<AdminResourceState>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  // Set on unmount so a late response does not setState on a screen
  // the operator already navigated away from.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setState('loading');
    load()
      .then((result) => {
        if (!alive.current || mine !== seq.current) return;
        setData(result);
        setError(null);
        setState('ready');
      })
      .catch((caught: unknown) => {
        if (!alive.current || mine !== seq.current) return;
        // The data from the previous successful load is deliberately
        // left in `data`: the block renders the error instead of it, so
        // nothing stale is on screen, but a retry that succeeds does
        // not flash empty first.
        setError(caught);
        setState('error');
      });
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { state, data, error, reload };
};
