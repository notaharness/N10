import { realIo } from './io.js';
import { run } from './run.js';

const code = await run(process.argv.slice(2), realIo());
process.exitCode = code;
