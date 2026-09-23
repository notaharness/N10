/**
 * `n10 util` in the sessions the desktop launches (`session-bin.ts`),
 * run by the app's own executable as Node.
 */
import { handleUtilCommand } from '@n10/review-comments';

await handleUtilCommand(process.argv.slice(3));
process.exit(0);
