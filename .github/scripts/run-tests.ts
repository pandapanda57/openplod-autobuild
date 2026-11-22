/**
 * Runs every OpenPlod test file on its own (120 s limit each). Only the files listed in
 * KNOWN_WINDOWS_FAILURES may fail, and by at most one test: they fail on Windows in the official
 * release too (POSIX file modes, symlinks, file locking). Anything else failing blocks the build.
 *
 * Usage: bun run-tests.ts <OpenPlod checkout>
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const KNOWN_WINDOWS_FAILURES = new Set([
  'src/organizer/markdown-export.test.ts', // symlink EPERM
  'src/sync/plaud-cloud.test.ts', // expects POSIX 0600 mode
  'src/vault/hardening.test.ts', // expects POSIX 0600 mode
  'src/vault/backup.test.ts', // EBUSY removing an open file
  'src/transcription/long-audio.test.ts', // one Windows-only assertion
]);
const root = process.argv[2];
const files: string[] = [];
const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name);
  if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.test.ts')) files.push(relative(root, path).split('\\').join('/')); } };
walk(join(root, 'src'));
files.sort();
// Output goes to files, not pipes, and only the test process itself is waited for.
const logs = mkdtempSync(join(tmpdir(), 'openplod-tests-'));
let pass = 0;
const blocking: string[] = [], lines: string[] = [];
for (const [index, file] of files.entries()) {
  const log = join(logs, `${index}.log`);
  const fd = openSync(log, 'w');
  const started = Date.now();
  // --timeout: Bun's 5 s per-test default is too short for the vault backup test on the hosted
  // Windows runner's disk (build4 run timed out at 5001 ms). The 120 s cap per file still applies.
  const result = spawnSync(process.execPath, ['test', '--timeout', '30000', file], { cwd: root, stdio: ['ignore', fd, fd], timeout: 120_000, windowsHide: true });
  closeSync(fd);
  const text = readFileSync(log, 'utf8');
  const passed = Number(/(\d+) pass/.exec(text)?.[1] ?? 0), failed = Number(/(\d+) fail/.exec(text)?.[1] ?? 0);
  pass += passed;
  const state = result.error ? 'TIMEOUT' : result.status === 0 ? 'ok' : 'FAIL';
  if (state !== 'ok') {
    const allowed = KNOWN_WINDOWS_FAILURES.has(file) && state === 'FAIL' && failed <= 1;
    lines.push(`${state}${allowed ? ' (known on Windows)' : ''}  ${file}  pass=${passed} fail=${failed}  ${Math.round((Date.now() - started) / 1000)}s`);
    if (!allowed) { blocking.push(file); console.log(text.slice(-4000)); }
  }
}
console.log(`[tests] files=${files.length} pass=${pass}`);
console.log(lines.join('\n'));
if (blocking.length) { console.error(`[tests] blocking failures: ${blocking.join(', ')}`); process.exit(1); }
