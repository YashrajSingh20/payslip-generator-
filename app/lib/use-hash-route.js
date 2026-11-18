'use client';

import { useCallback, useEffect, useState } from 'react';

const read = () => (typeof window === 'undefined' ? '/' : window.location.hash.replace(/^#/, '') || '/');

/**
 * Tiny hash router for the single-page shell: '#/runs/abc' -> ['runs', 'abc'].
 * Keeps the back button and deep links working without server routes.
 */
export function useHashRoute() {
  const [path, setPath] = useState('/');

  useEffect(() => {
    setPath(read());
    const onChange = () => setPath(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((to) => {
    if (read() === to) return;
    window.location.hash = to;
  }, []);

  return { path, segments: path.split('/').filter(Boolean), navigate };
}
