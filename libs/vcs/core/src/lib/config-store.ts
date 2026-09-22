import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentId,
  AppConfig,
  KeyDescriptorConfig,
  VcsProvider,
} from './types.js';
import { detectProvider } from './registry.js';

const WM_DIR = join(homedir(), '.n10');
const GLOBAL_CONFIG_PATH = join(WM_DIR, 'config.json');

// ── Internal file helpers ──────────────────────────────────────────

/** Hash CWD to a 16-char hex key for per-project config */
export function projectKey(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

function projectConfigPath(cwd: string): string {
  return join(WM_DIR, 'projects', projectKey(cwd), 'config.json');
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    const data = readFileSync(path, 'utf8');
    return { ...fallback, ...JSON.parse(data) };
  } catch {
    return { ...fallback };
  }
}

function writeJsonFile<T>(path: string, data: T): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ── Raw config shapes (on-disk) ────────────────────────────────────

interface RawGlobalConfig {
  pat?: string;
  prPollInterval?: number;
  aiCommand?: string;
  agentId?: AgentId;
  claudeConfigDirs?: string[];
  vendorAuth?: Record<string, Record<string, string>>;
  autoDeleteOnMerge?: boolean;
  autoRebase?: boolean;
  autoHideSidebar?: boolean;
  jumpToInactiveOnEscape?: boolean;
  mergePollInterval?: number;
  editor?: string;
  worktreePath?: string;
  keybindPreset?: string;
  keybindOverrides?: Record<string, KeyDescriptorConfig[]>;
}

interface RawProjectConfig {
  org?: string;
  project?: string;
  repo?: string;
  email?: string;
  vendor?: string;
  vendorProject?: Record<string, string>;
  editor?: string;
}

// ── Migration from old flat format ─────────────────────────────────

function migrateGlobalConfig(raw: RawGlobalConfig): RawGlobalConfig {
  if (raw.pat && !raw.vendorAuth) {
    raw.vendorAuth = {
      'azure-devops': { pat: raw.pat },
    };
    delete raw.pat;
  }
  return raw;
}

function migrateProjectConfig(raw: RawProjectConfig): RawProjectConfig {
  if ((raw.org || raw.project || raw.repo) && !raw.vendorProject) {
    raw.vendor = 'azure-devops';
    raw.vendorProject = {};
    if (raw.org) {
      raw.vendorProject.org = raw.org;
      delete raw.org;
    }
    if (raw.project) {
      raw.vendorProject.project = raw.project;
      delete raw.project;
    }
    if (raw.repo) {
      raw.vendorProject.repo = raw.repo;
      delete raw.repo;
    }
  }
  return raw;
}

// ── Public API ──────────────────────────────────────────────────────

export function readGlobalConfig(): RawGlobalConfig {
  const raw = readJsonFile<RawGlobalConfig>(GLOBAL_CONFIG_PATH, {});
  return migrateGlobalConfig(raw);
}

export function writeGlobalConfig(config: RawGlobalConfig): void {
  writeJsonFile(GLOBAL_CONFIG_PATH, config);
}

export function readProjectConfig(cwd = process.cwd()): RawProjectConfig {
  const raw = readJsonFile<RawProjectConfig>(projectConfigPath(cwd), {});
  return migrateProjectConfig(raw);
}

export function writeProjectConfig(
  config: RawProjectConfig,
  cwd = process.cwd()
): void {
  writeJsonFile(projectConfigPath(cwd), config);
}

/** Read merged config: global + project → AppConfig */
export function readConfig(cwd = process.cwd()): AppConfig {
  const global = readGlobalConfig();
  const project = readProjectConfig(cwd);

  const vendor = project.vendor;
  const vendorAuth = (vendor ? global.vendorAuth?.[vendor] : undefined) ?? {};
  const vendorProject = project.vendorProject ?? {};

  return {
    email: project.email,
    prPollInterval: global.prPollInterval,
    aiCommand: global.aiCommand,
    agentId: global.agentId,
    claudeConfigDirs: global.claudeConfigDirs,
    vendor,
    vendorAuth,
    vendorProject,
    autoDeleteOnMerge: global.autoDeleteOnMerge,
    autoRebase: global.autoRebase,
    autoHideSidebar: global.autoHideSidebar,
    jumpToInactiveOnEscape: global.jumpToInactiveOnEscape,
    mergePollInterval: global.mergePollInterval,
    editor: project.editor ?? global.editor,
    worktreePath: global.worktreePath,
    keybindPreset: global.keybindPreset,
    keybindOverrides: global.keybindOverrides,
  };
}

/** Check if the given provider is fully configured */
export function isVcsConfigured(
  config: AppConfig,
  provider: VcsProvider | null
): boolean {
  if (!provider) return false;
  return provider.isConfigured(config.vendorAuth, config.vendorProject);
}

/**
 * Copy fields the config does not already have, recording each one as
 * newly detected. What the user (or an earlier detection) already set
 * wins — auto-detection fills blanks, it does not overwrite.
 */
function fillBlankFields(
  target: Record<string, string>,
  extra: Record<string, string>,
  detected: Record<string, string>
): void {
  for (const [key, value] of Object.entries(extra)) {
    if (target[key]) continue;
    target[key] = value;
    detected[key] = value;
  }
}

/**
 * `git ...` for a single value, or null if git has nothing to say.
 * Every caller here is filling in a blank as a convenience, so a
 * missing remote or an unconfigured identity is an ordinary answer
 * rather than a failure.
 */
function gitValue(args: string): string | null {
  try {
    const out = execSync(`git ${args}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Vendor and project fields, read off the `origin` remote. */
function detectVendorFromRemote(
  cfg: RawProjectConfig,
  providers: VcsProvider[],
  detected: Record<string, string>
): void {
  if (cfg.vendor && cfg.vendorProject) return;
  const remoteUrl = gitValue('remote get-url origin');
  if (!remoteUrl) return;
  const match = detectProvider(remoteUrl, providers);
  if (!match) return;
  cfg.vendor = match.provider.id;
  cfg.vendorProject = match.projectConfig;
  detected.vendor = match.provider.id;
  Object.assign(detected, match.projectConfig);
}

/** Provider-specific extras, e.g. the GitHub username. */
function detectProviderFields(
  cfg: RawProjectConfig,
  providers: VcsProvider[],
  detected: Record<string, string>
): void {
  const provider = providers.find((p) => p.id === cfg.vendor);
  if (!provider?.autoDetectFields) return;
  try {
    // Hand the provider what is already known so it can decline: the
    // result is only ever used to fill blanks, so a call that can
    // return nothing new is a call worth not making.
    const extra = provider.autoDetectFields(cfg.vendorProject ?? {});
    if (!extra) return;
    cfg.vendorProject ??= {};
    fillBlankFields(cfg.vendorProject, extra, detected);
  } catch {
    // autoDetectFields may fail — not critical
  }
}

/** Commit email, from git's own config. */
function detectEmail(
  cfg: RawProjectConfig,
  detected: Record<string, string>
): void {
  if (cfg.email) return;
  const email = gitValue('config user.email');
  if (!email) return;
  cfg.email = email;
  detected.email = email;
}

/**
 * Auto-detect project config from the git repo.
 * Tries each provider's parseRemoteUrl to fill vendor + vendorProject.
 * Fills email from `git config user.email`.
 * Writes back if any field was updated.
 */
export function autoDetectProjectConfig(
  cwd = process.cwd(),
  providers: VcsProvider[] = []
): {
  updated: boolean;
  detected: Record<string, string>;
} {
  const cfg = readProjectConfig(cwd);
  const detected: Record<string, string> = {};

  detectVendorFromRemote(cfg, providers, detected);
  detectProviderFields(cfg, providers, detected);
  detectEmail(cfg, detected);

  const updated = Object.keys(detected).length > 0;
  if (updated) {
    writeProjectConfig(cfg, cwd);
  }

  return { updated, detected };
}
