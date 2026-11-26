// main.ts — the hand-in program for Pelican Post: Island Mail Run.
//
// The game itself is the plain static site in game/ (open game/index.html
// in a browser and fly). This program is what make.fun runs: it copies
// game/ and screenshots/ into the output directory and writes the dossier
// the judges read, using the kit's vendored buildDossier library.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(from: string, to: string) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

mkdirSync(outputDir, { recursive: true });
copyTree(join(repoDir, 'game'), join(outputDir, 'game'));
copyTree(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'));

// The gate's own caps, mirrored so the dossier we write is exactly the one
// the scorer rebuilds: at most 4 screenshots of 256 KiB, at most 993 files
// and 48 MiB under game/, no game path over 1000 bytes, dossier text capped
// at 160 KiB.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163_840,
  screenshots: { max: 4, max_bytes: 262_144 },
  game_max_files: 993,
  game_max_bytes: 50_331_648,
  game_path_max_bytes: 1_000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(`Pelican Post handed in: game/, screenshots/ and dossier.json -> ${outputDir}`);
