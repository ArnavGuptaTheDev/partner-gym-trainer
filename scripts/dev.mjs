// Runs the API (wrangler dev on :8788) and the Astro dev server (:4321)
// together. Open http://localhost:4321.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

// wrangler dev needs the assets directory to exist; run `npm run build` once
// for real pages on :8788 (the Astro server on :4321 serves them in dev).
if (!existsSync('dist')) mkdirSync('dist');
const run = (cmd) => spawn(cmd, { stdio: 'inherit', shell: true });
const procs = [run('npm run dev:api'), run('npm run dev:web')];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
