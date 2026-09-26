#!/usr/bin/env node
// Re-encodes docs/media/*.gif into public/media/*.{mp4,webm} plus a WebP
// poster frame. GIF is a 256-colour palette format with no inter-frame
// compression worth mentioning; a real video codec gets the same motion
// across in a fraction of the bytes (typically 10-20x smaller here). Run
// once and commit the output — see apps/website/README.md for why this
// isn't a build-time step.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const sourceDir = join(repoRoot, 'docs/media');
const outDir = join(projectRoot, 'public/media');

mkdirSync(outDir, { recursive: true });

function run(args) {
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    {
      stdio: 'inherit',
    }
  );
}

function convertGif(file) {
  const name = basename(file, '.gif');
  const input = join(sourceDir, file);

  // H.264 for broad support; even dimensions required by yuv420p.
  run([
    '-i',
    input,
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '28',
    '-preset',
    'veryslow',
    '-an',
    '-movflags',
    '+faststart',
    join(outDir, `${name}.mp4`),
  ]);

  // VP9/WebM as a smaller alternative source in the <video> element.
  run([
    '-i',
    input,
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '34',
    '-b:v',
    '0',
    '-an',
    join(outDir, `${name}.webm`),
  ]);

  // First frame as a poster, shown before the video loads.
  run([
    '-i',
    input,
    '-vframes',
    '1',
    '-c:v',
    'libwebp',
    '-quality',
    '80',
    join(outDir, `${name}-poster.webp`),
  ]);
}

for (const file of readdirSync(sourceDir)) {
  const full = join(sourceDir, file);
  if (!statSync(full).isFile()) continue;
  if (extname(file).toLowerCase() === '.gif') convertGif(file);
}

console.log(`Converted media written to ${outDir}`);
