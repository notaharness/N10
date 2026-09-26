import { llms } from 'fumadocs-core/source/llms';
import { llmsFullContent } from '../generated/llms-full-content';
import { source } from './source';

const index = llms(source);

/** `llms.txt`: the page tree as a Markdown index, titles and descriptions only. */
export function getLlmsIndex(): string {
  return index.index();
}

/**
 * `llms-full.txt`: every page's raw MDX source, concatenated at build
 * time by scripts/generate-llms-full.mjs (part of the `sync-content` Nx
 * target) into src/generated/llms-full-content.ts — see that script for
 * why this isn't a runtime file read.
 */
export function getLlmsFull(): string {
  return llmsFullContent;
}
