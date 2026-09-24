import { test as base } from './desktop.js';
import { FakeBeam, type FakeBeamScenario } from '../setup/fake-beam.js';

/**
 * The desktop fixture with a scripted beam daemon in its HOME. The fake
 * starts before the app, which finds it at launch; without a scenario
 * the app starts the real `beam daemon` itself.
 */
export const test = base.extend<{
  beamScenario: FakeBeamScenario | null;
  beam: FakeBeam | null;
}>({
  beamScenario: [null, { option: true }],
  beam: async ({ fixtureHome, beamScenario }, provide) => {
    const beam = beamScenario
      ? await FakeBeam.start(fixtureHome, beamScenario)
      : null;
    await provide(beam);
    await beam?.close();
  },
  desktop: async ({ beam, desktop }, provide) => {
    void beam; // started first, so the app connects at launch
    await provide(desktop);
  },
});

export { expect } from './desktop.js';
