import { useEffect, useRef } from 'react';

/** A ref to focus once, when its element mounts: the heading of a view
 *  that replaced the one holding focus. Give the element tabIndex -1. */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}
