import { createContext, useContext } from 'react';

export const FleetContext = createContext({
  open: false,
  show: (): void => undefined,
});

export function useFleet() {
  return useContext(FleetContext);
}
