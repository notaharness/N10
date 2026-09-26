import { sessionLabel } from '@n10/core';
import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@n10/vcs-core';
import { useConfig, useKeybindResolve } from '@n10/app-core';
import type { KeybindResolveValue } from '@n10/app-core';
import {
  buildAgentOptions,
  keyDescriptorToString,
  sessionMenuOptions,
  type SessionMenuOptionKey,
} from '@n10/core';

function Option({ label, selected }: { label: string; selected: boolean }) {
  return (
    <Text>
      <Text color={selected ? 'cyan' : undefined}>
        {selected ? '› ' : '  '}
      </Text>
      <Text bold={selected}>{label}</Text>
    </Text>
  );
}

function PrHeader({ pr }: { pr: PullRequestInfo }) {
  return (
    <>
      <Text bold>PR #{pr.id}</Text>
      <Text bold>{pr.title || pr.sourceBranch}</Text>
      <Text dimColor>
        {pr.sourceBranch} → {pr.targetBranch} · by{' '}
        {pr.createdByDisplayName || 'unknown'}
      </Text>
    </>
  );
}

/** The review rows, shown only for items backed by a pull request. */
function ReviewRows({
  optKey,
  instruction,
}: {
  optKey: SessionMenuOptionKey;
  instruction: string;
}) {
  return (
    <>
      <Option label="Start/Continue review" selected={optKey === 'review'} />
      <Box flexDirection="column">
        <Option
          label="Add instructions:"
          selected={optKey === 'instructions'}
        />
        {optKey === 'instructions' && (
          <Text>
            {'    '}
            <Text color="cyan">&gt; {instruction}</Text>
            <Text dimColor>_</Text>
          </Text>
        )}
      </Box>
    </>
  );
}

/** Primary key of an action under the active preset. */
function primaryKey(kb: KeybindResolveValue, actionId: string): string {
  const desc = kb.bindings[actionId]?.[0];
  return desc ? keyDescriptorToString(desc) : '?';
}

/** The hint line per row, spelled with the active preset's keys. */
function buildHints(
  kb: KeybindResolveValue
): Record<SessionMenuOptionKey, string> {
  const nav = `${kb.getNavKeys('confirm')} navigate`;
  const agent = `${primaryKey(kb, 'confirm.cycle-agent-left')}/${primaryKey(
    kb,
    'confirm.cycle-agent-right'
  )} agent`;
  const rest = 'enter select · esc cancel';
  return {
    start: `${nav} · ${agent} · ${rest}`,
    review: `${nav} · ${rest}`,
    instructions: 'type to add instructions · enter start · esc cancel',
    cancel: `${nav} · ${rest}`,
  };
}

/** The row's own label, else its checkout's name. */
function headerLabel(label: string | null, sessionName: string | null): string {
  return label ?? (sessionName ? sessionLabel(sessionName) : 'Session');
}

export const SessionMenuPane = memo(function SessionMenuPane({
  pr,
  sessionName,
  label,
  selectedOption,
  agentIndex,
  instruction,
}: {
  pr: PullRequestInfo | null;
  sessionName: string | null;
  /** What the row is called: its branch, as checked out now. */
  label: string | null;
  selectedOption: number;
  agentIndex: number;
  instruction: string;
}) {
  const config = useConfig();
  const keybinds = useKeybindResolve();
  const hints = useMemo(() => buildHints(keybinds), [keybinds]);
  const agentOptions = useMemo(
    () => buildAgentOptions(config.config),
    [config.config]
  );
  const safeAgentIdx = Math.min(Math.max(agentIndex, 0), agentOptions.length);
  const fresh = safeAgentIdx > 0;
  const agentName = fresh
    ? agentOptions[safeAgentIdx - 1]!.name
    : 'Recorded agent / default';

  const options = sessionMenuOptions(pr != null);
  const optKey = options[Math.min(selectedOption, options.length - 1)]!;
  const startSelected = optKey === 'start';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {pr ? (
        <PrHeader pr={pr} />
      ) : (
        <Text bold>{headerLabel(label, sessionName)}</Text>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text>What would you like to do?</Text>

        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color={startSelected ? 'cyan' : undefined}>
              {startSelected ? '› ' : '  '}
            </Text>
            <Text bold={startSelected}>
              {fresh ? 'Start new session' : 'Open / resume session'}
            </Text>
            <Text dimColor> · agent: </Text>
            <Text color="cyan">{agentName}</Text>
          </Text>

          {pr && <ReviewRows optKey={optKey} instruction={instruction} />}

          <Option label="Cancel" selected={optKey === 'cancel'} />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{hints[optKey]}</Text>
      </Box>
    </Box>
  );
});
