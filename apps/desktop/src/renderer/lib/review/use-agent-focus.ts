import { useState } from 'react';
import { focusesAgent, type AgentPresence } from './review-model.js';

/**
 * The terminal takes over the pane whenever an agent starts, and
 * whenever the user comes back to a tab that already has one running —
 * the agent is what they returned for, not the diff. {@link focusesAgent}
 * owns which changes count as either.
 *
 * Written as state adjusted during render (React's own pattern for
 * "derive from a prop change") rather than an effect, so the pane never
 * paints the diff for one frame before switching.
 */
export function useAgentFocus(
  next: AgentPresence,
  onFocusAgent: () => void
): void {
  const [prev, setPrev] = useState(next);
  if (
    prev.hasSession !== next.hasSession ||
    prev.running !== next.running ||
    prev.active !== next.active
  ) {
    setPrev(next);
    if (focusesAgent(prev, next)) onFocusAgent();
  }
}
