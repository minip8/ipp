import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * False on the server and while React hydrates the server's HTML, true from the render after.
 *
 * For anything that depends on data the server did not have (the session, above all). A boundary
 * under Suspense is hydrated late, by which time a query started by an earlier part of the page
 * may already have answered: rendering from it then would not match the HTML the server sent for
 * that boundary, and React would throw the subtree away and render it again. Reading this first
 * keeps the first render the server's.
 */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
