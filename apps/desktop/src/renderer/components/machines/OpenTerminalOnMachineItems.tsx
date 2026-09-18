import { TerminalIcon } from 'lucide-react';
import type { MachineView } from '../../../host/contract.js';
import { CommandItem } from '../ui/command.js';

/**
 * "Open terminal on <machine>" command-palette entries (ux-machines.md
 * §5) — one per reachable paired machine, none with only the local
 * machine registered (D8, enforced by the caller passing an empty
 * list). Split into its own file to keep CommandPalette.tsx's line
 * budget.
 */
export function OpenTerminalOnMachineItems({
  machines,
  onSelect,
}: {
  machines: MachineView[];
  onSelect: (peerId: string) => void;
}) {
  return (
    <>
      {machines.map((m) => (
        <CommandItem
          key={m.peerId}
          value={`command open terminal on ${m.label}`}
          onSelect={() => onSelect(m.peerId)}
        >
          <TerminalIcon />
          Open terminal on {m.label}
        </CommandItem>
      ))}
    </>
  );
}
