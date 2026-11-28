/**
 * Decides the next release: version number, tag, and whether anything changed since the last
 * one. The fingerprint covers the official OpenPlod release, Bun, Rust, every lockfile after the
 * updates, and this repository's patches, scripts and workflow. Same fingerprint -> no release.
 *
 * Versions always go up: build N on official X.Y.Z is X.Y.(Z*1000+N), e.g. 1.0.3 or 1.0.1001.
 * Usage (from the OpenPlod checkout): bun plan.ts <autobuild repo dir> <official tag>
 * Writes build-inputs.json in the current directory and key=value lines to $GITHUB_OUTPUT.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [autobuild, officialTag] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY!;
const run = (cmd: string[]) => { const r = Bun.spawnSync(cmd, { stderr: 'pipe' }); return r.exitCode === 0 ? r.stdout.toString().trim() : null; };
const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });

const inputs: Record<string, string> = {
  official: `${officialTag} ${run(['git', 'rev-parse', 'HEAD'])}`,
  bun: run(['bun', '--version']) ?? '',
  rustc: run(['rustc', '--version']) ?? '',
  // The version line names the exact ffmpeg commit; the daily-rebuilt zip's own hash would
  // change every day without any change in ffmpeg. The line also ends the version with the
  // build date (e.g. n9.0.2-982-g836df4e858-20261127), so drop that date and keep the commit.
  ffmpeg: (process.env.FFMPEG_VERSION ?? '').replace(/(-g[0-9a-f]+)-\d{8}\b/, '$1'),
};
for (const lock of ['bun.lock', 'web/bun.lock', 'src-tauri/Cargo.lock', 'src-tauri/plaud-bridge/Cargo.lock']) inputs[lock] = hashFile(lock);
for (const path of filesUnder(join(autobuild, '.github')).sort()) inputs[relative(autobuild, path).split('\\').join('/')] = hashFile(path);
const fingerprint = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');

const official = officialTag.replace(/^v/, '').split('.').map(Number);
if (official.length !== 3 || official.some(n => !Number.isInteger(n))) throw new Error(`Unexpected official tag ${officialTag}`);
const releases = JSON.parse(run(['gh', 'release', 'list', '--repo', repo, '--limit', '200', '--json', 'tagName,isLatest']) ?? '[]') as { tagName: string; isLatest: boolean }[];
const prefix = `openplod-${officialTag}-build`;
const build = 1 + Math.max(0, ...releases.map(r => r.tagName.startsWith(prefix) ? Number(r.tagName.slice(prefix.length)) : 0).filter(Number.isFinite));
const version = `${official[0]}.${official[1]}.${official[2] * 1000 + build}`;

let previous = '';
const latest = releases.find(r => r.isLatest)?.tagName;
if (latest && run(['gh', 'release', 'download', latest, '--repo', repo, '--pattern', 'build-inputs.json', '--output', 'previous-inputs.json', '--clobber']) !== null) {
  try { previous = JSON.parse(readFileSync('previous-inputs.json', 'utf8')).fingerprint ?? ''; } catch { previous = ''; }
}
const force = process.env.FORCE === 'true';
const changed = force || previous !== fingerprint;
writeFileSync('build-inputs.json', `${JSON.stringify({ fingerprint, version, tag: `${prefix}${build}`, inputs }, null, 2)}\n`);
const out = { changed: String(changed), version, tag: `${prefix}${build}`, installer: `OpenPlod_${version}_x64-setup.exe` };
console.log(`[plan] ${JSON.stringify(out)} (previous fingerprint ${previous ? 'found' : 'none'})`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
