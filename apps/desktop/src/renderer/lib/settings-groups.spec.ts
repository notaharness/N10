import { describe, expect, it } from 'vitest';
import type { SettingsFieldView } from '../../host/contract.js';
import { visibleSettingsGroups } from './settings-groups.js';

function field(
  key: string,
  group: SettingsFieldView['group']
): SettingsFieldView {
  return { label: key, key, value: '', group, kind: 'text' };
}

describe('visibleSettingsGroups', () => {
  it('shows Appearance even when the host sends nothing at all', () => {
    // The theme and window-frame rows are this shell's own; a host that
    // is unreachable or still loading must not empty the page.
    expect(visibleSettingsGroups(undefined).map((g) => g.key)).toEqual([
      'appearance',
    ]);
    expect(visibleSettingsGroups([])[0]?.fields).toEqual([]);
  });

  it('drops sections the host sent no fields for', () => {
    const groups = visibleSettingsGroups([field('agentCommand', 'agent')]);
    expect(groups.map((g) => g.key)).toEqual(['appearance', 'agent']);
  });

  it('orders sections by the page order, not the order fields arrive', () => {
    const groups = visibleSettingsGroups([
      field('pat', 'provider'),
      field('editor', 'general'),
      field('backend', 'terminal'),
    ]);
    // The jump nav and the page render from this one list, so a section
    // order that tracked the host's arbitrary field order would move
    // the nav around whenever the catalog was reordered.
    expect(groups.map((g) => g.key)).toEqual([
      'appearance',
      'general',
      'terminal',
      'provider',
    ]);
  });

  it('keeps each section its own fields, in the order given', () => {
    const groups = visibleSettingsGroups([
      field('editor', 'general'),
      field('agentCommand', 'agent'),
      field('worktreePath', 'general'),
    ]);
    const general = groups.find((g) => g.key === 'general');
    expect(general?.fields.map((f) => f.key)).toEqual([
      'editor',
      'worktreePath',
    ]);
    expect(groups.find((g) => g.key === 'agent')?.fields).toHaveLength(1);
  });

  it('ignores a field naming a section this build does not know', () => {
    const rogue = field('mystery', 'quantum' as SettingsFieldView['group']);
    const groups = visibleSettingsGroups([rogue, field('editor', 'general')]);
    expect(groups.map((g) => g.key)).toEqual(['appearance', 'general']);
  });
});
