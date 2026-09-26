import { useState } from 'react';
import { Text, Box, useInput } from 'ink';
import type { AppConfig, VcsProvider } from '@n10/vcs-core';
import { useConfig } from '@n10/app-core';
import type { KeyPress } from '@n10/core';
import { handleTextInput } from '@n10/core';
import { resolveValue, type SettingsField } from '@n10/core';

interface FieldsStepProps {
  provider: VcsProvider;
  config: AppConfig;
  fields: SettingsField[];
  ghUsername: string | null;
  ghChecked: boolean;
  isActive: boolean;
  onAdvance: () => void;
  onSkip: () => void;
}

export function FieldsStep({
  provider,
  config,
  fields,
  ghUsername,
  ghChecked,
  isActive,
  onAdvance,
  onSkip,
}: FieldsStepProps) {
  const { updateField } = useConfig();
  const [fieldIndex, setFieldIndex] = useState(0);
  const [editBuffer, setEditBuffer] = useState('');
  const [editing, setEditing] = useState(false);

  const fieldValue = (field: SettingsField): string =>
    resolveValue(config, field);

  /** While the editor is open a keypress is text, never a command. */
  const handleEditKey = (input: string, key: KeyPress) => {
    if (!key.return) {
      handleTextInput(input, key, setEditBuffer);
      return;
    }
    const field = fields[fieldIndex]!;
    const value = editBuffer.trim() || undefined;
    if (value) updateField(field, value);
    setEditing(false);
    setEditBuffer('');
  };

  useInput(
    (input, key) => {
      if (key.escape) {
        if (!editing) return onSkip();
        setEditing(false);
        setEditBuffer('');
        return;
      }
      if (editing) {
        handleEditKey(input, key);
        return;
      }
      if (input === 'j' || key.downArrow) {
        setFieldIndex((i) => Math.min(i + 1, fields.length - 1));
        return;
      }
      if (input === 'k' || key.upArrow) {
        setFieldIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return) {
        if (fieldIndex === fields.length - 1) {
          onAdvance();
          return;
        }
        setEditing(true);
        setEditBuffer(fieldValue(fields[fieldIndex]!));
        return;
      }
      if (key.tab) return onAdvance();
    },
    { isActive }
  );

  const currentField = fields[fieldIndex]!;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        Setup — {provider.displayName}
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      <Text> </Text>
      {provider.id === 'azure-devops' && currentField.key === 'pat' ? (
        <>
          <Text>Create a Personal Access Token at:</Text>
          <Text color="blue">
            https://dev.azure.com/{config.vendorProject.org || '{org}'}
            /_usersSettings/tokens
          </Text>
          <Text dimColor>
            Required scopes: Code (Read & Write), Build (Read), Project and Team
            (Read)
          </Text>
          <Text> </Text>
        </>
      ) : null}
      {provider.id === 'github' && currentField.key === 'username' ? (
        <>
          {ghChecked && ghUsername ? (
            <Text>
              Detected GitHub user:{' '}
              <Text bold color="green">
                {ghUsername}
              </Text>
            </Text>
          ) : ghChecked ? (
            <Text dimColor>
              Not logged in via gh CLI. Run{' '}
              <Text color="cyan">gh auth login</Text> for automatic detection.
            </Text>
          ) : (
            <Text dimColor>Checking gh auth status...</Text>
          )}
          <Text> </Text>
        </>
      ) : null}
      {fields.map((field, i) => {
        const isCurrent = i === fieldIndex;
        const value = fieldValue(field);
        return (
          <Text key={field.key}>
            <Text color={isCurrent ? 'cyan' : undefined}>
              {isCurrent ? '› ' : '  '}
            </Text>
            <Text bold={isCurrent}>{field.label}: </Text>
            {isCurrent && editing ? (
              <Text color="cyan">
                {field.masked ? '*'.repeat(editBuffer.length) : editBuffer}
                <Text dimColor>_</Text>
              </Text>
            ) : value ? (
              <Text color="green">{field.masked ? '****' : value}</Text>
            ) : (
              <Text dimColor>(not set)</Text>
            )}
          </Text>
        );
      })}
      <Text> </Text>
      <Text dimColor>
        {editing
          ? 'Type value · Enter to save · Esc to cancel'
          : 'j/k nav · Enter edit · Tab next step · Esc skip'}
      </Text>
    </Box>
  );
}
