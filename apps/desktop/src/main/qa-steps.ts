import { app, type BrowserWindow } from 'electron';

// N10_QA_STEPS='[{"js":"...","waitMs":500,"shot":"/tmp/a.png"}]'
// runs each step's JS in the page, waits, captures a PNG, then quits.
// Dev/CI only — lets us screenshot the real app under xvfb.

interface QaStep {
  js?: string;
  waitMs?: number;
  shot?: string;
}

export async function runQaSteps(win: BrowserWindow): Promise<void> {
  const raw = process.env.N10_QA_STEPS;
  if (!raw) return;
  let steps: QaStep[] = [];
  try {
    steps = JSON.parse(raw) as QaStep[];
  } catch (err) {
    console.error('[desktop] bad N10_QA_STEPS:', err);
    app.quit();
    return;
  }
  const { writeFile } = await import('node:fs/promises');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Hidden/occluded windows may never paint, which makes capturePage
  // hang — force the window visible and un-throttled for the run.
  win.show();
  win.focus();
  win.webContents.setBackgroundThrottling(false);
  console.log(`[desktop] qa: ${steps.length} steps`);
  await sleep(1500);
  let i = 0;
  for (const step of steps) {
    i += 1;
    try {
      if (step.js) {
        const r: unknown = await win.webContents.executeJavaScript(
          step.js,
          true
        );
        console.log(`[desktop] qa step ${i} js →`, r);
      }
      await sleep(step.waitMs ?? 600);
      if (step.shot) {
        const img = await win.webContents.capturePage();
        await writeFile(step.shot, img.toPNG());
        console.log(`[desktop] qa step ${i} shot → ${step.shot}`);
      }
    } catch (err) {
      console.error(`[desktop] qa step ${i} failed:`, err);
    }
  }
  app.quit();
}
