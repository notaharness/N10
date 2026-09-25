import { useState } from 'react';
import { render, Box, useApp } from 'ink';
import type { VcsProvider } from '@n10/vcs-core';
import { azureDevOpsProvider } from '@n10/vcs-azure-devops';
import { githubProvider } from '@n10/vcs-github';
import { DeleteConfirmModal } from './components/DeleteConfirmModal.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import {
  settlePendingRuns,
  ConfigProvider,
  useConfig,
  KeybindProvider,
  NavProvider,
  useNavState,
  AsyncOpsProvider,
  PlanProvider,
  LayoutProvider,
  useLayout,
  ModalProvider,
  useDeleteConfirmState,
  SessionProvider,
  SidebarProvider,
  ToastProvider,
} from '@n10/app-core';
import { killAll, applySessionBackend, probeTmuxAvailability } from '@n10/core';
import {
  repoTitle,
  setWindowTitle,
  restoreWindowTitle,
} from './utils/window-title.js';
import { MainTab } from './screens/main/MainTab.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// Upper bound on how long 'q' waits for in-flight git ops to finish
// before force-exiting. Real worktree/branch ops finish well under this;
// the cap guarantees quit still works if an op wedges.
const EXIT_GRACE_MS = 3_000;

// ── App ────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  // Ink's exit() only unmounts the React tree — it does not stop child
  // processes. Active PTYs (running agents) keep node-pty handles open,
  // so the Node event loop never drains and the process hangs after
  // pressing 'q'. Tear down PTYs first, then force-exit. (#56)
  //
  // But process.exit(0) is synchronous and would abort an in-flight git
  // mutation (worktree create/delete, rebase) mid-write, leaving a
  // half-made worktree or dangling branch on disk. So first let any
  // pending run() op settle — bounded by a grace timeout so a wedged op
  // can't resurrect the #56 hang.
  const handleExit = () => {
    void (async () => {
      await Promise.race([
        settlePendingRuns(),
        new Promise((resolve) => setTimeout(resolve, EXIT_GRACE_MS)),
      ]);
      killAll();
      exit();
      process.exit(0);
    })();
  };
  const { config, provider, vcsConfigured } = useConfig();
  const nav = useNavState();
  const deleteConfirm = useDeleteConfirmState();
  const { termRows } = useLayout();
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  const showOnboarding =
    !onboardingComplete && !!config.vendor && !!provider && !vcsConfigured;

  const terminalFocused = nav.focus === 'terminal';

  if (showOnboarding) {
    return (
      <Box flexDirection="column" height={termRows}>
        <OnboardingWizard onComplete={() => setOnboardingComplete(true)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termRows}>
      <Box flexGrow={1}>
        <MainTab
          terminalFocused={terminalFocused}
          showOnboarding={showOnboarding}
          exit={handleExit}
        />
      </Box>
      {deleteConfirm.confirmDelete && (
        <DeleteConfirmModal
          branch={deleteConfirm.confirmDelete.branch}
          reason={deleteConfirm.confirmDelete.reason}
          mode={deleteConfirm.confirmDelete.mode}
          confirmInput={deleteConfirm.confirmInput}
        />
      )}
    </Box>
  );
}

// ── Entry point ────────────────────────────────────────────────────

/** `n10 --tui [dir]`: `args` follow `--tui`. */
export async function runTui(args: string[]): Promise<void> {
  const targetDir = args.find((a) => !a.startsWith('--'));
  if (targetDir) {
    process.chdir(targetDir);
  }

  // Name the tab after the repo, so a terminal full of n10s is legible.
  // Skip the git lookup entirely when there's no TTY to title (CI, pipes).
  if (process.stdout.isTTY) {
    setWindowTitle(repoTitle());
  }

  process.on('exit', () => {
    killAll();
    restoreWindowTitle();
  });
  process.on('SIGINT', () => {
    killAll();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    killAll();
    process.exit(0);
  });

  // Resolve the requirement before rendering so missing tmux is actionable.
  await probeTmuxAvailability();
  try {
    applySessionBackend();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  render(
    <ConfigProvider providers={providers}>
      <KeybindProvider>
        <LayoutProvider>
          <NavProvider>
            <AsyncOpsProvider>
              <PlanProvider>
                <ModalProvider>
                  <ToastProvider>
                    <SessionProvider>
                      <SidebarProvider>
                        <App />
                      </SidebarProvider>
                    </SessionProvider>
                  </ToastProvider>
                </ModalProvider>
              </PlanProvider>
            </AsyncOpsProvider>
          </NavProvider>
        </LayoutProvider>
      </KeybindProvider>
    </ConfigProvider>
  );
}
