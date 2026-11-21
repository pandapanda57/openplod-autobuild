/**
 * Holds back crate versions published less than MIN_AGE seconds ago (Cargo has no built-in
 * release-age setting). Handles one too-new crate at a time, pinning it to the newest compatible,
 * non-yanked version that is old enough, then re-reads Cargo.lock (a pin can move other crates).
 * If a too-new crate cannot be pinned (another updated crate requires it), the whole Rust update
 * for this lockfile is rolled back to the pre-update copy: no crate younger than MIN_AGE ships,
 * and the update is retried on the next daily run. Exit code 0 either way; 1 only on errors.
 *
 * Usage: bun cargo-age-gate.ts <crate dir> <Cargo.lock copy from before cargo update> <min age s>
 */
import { appendFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Pkg = { name: string; version: string; source?: string };
const [dir, beforePath, minAgeText] = process.argv.slice(2);
const minAgeMs = Number(minAgeText) * 1000;
if (!dir || !beforePath || !Number.isFinite(minAgeMs)) throw new Error('usage: cargo-age-gate.ts <dir> <before.lock> <seconds>');

const lockPath = join(dir, 'Cargo.lock');
const lock = (path: string): Pkg[] => (Bun.TOML.parse(readFileSync(path, 'utf8')) as { package?: Pkg[] }).package ?? [];
const registry = (pkg: Pkg) => pkg.source?.startsWith('registry+') ?? false;
const parse = (v: string) => /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null;
const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const compatible = (a: number[], b: number[]) => a[0] === b[0] && (a[0] !== 0 || a[1] === b[1]) && (a[0] !== 0 || a[1] !== 0 || a[2] === b[2]);
const headers = { 'User-Agent': 'openplod-autobuild (GitHub Actions release-age check)' };

const versionsCache = new Map<string, { num: string; created_at: string; yanked: boolean }[]>();
async function versions(name: string) {
  if (!versionsCache.has(name)) {
    const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}/versions?per_page=100`, { headers });
    if (!response.ok) throw new Error(`crates.io lookup failed for ${name}: HTTP ${response.status}`);
    versionsCache.set(name, ((await response.json()) as { versions: { num: string; created_at: string; yanked: boolean }[] }).versions);
    await Bun.sleep(1100); // crates.io asks automated clients for at most one request per second
  }
  return versionsCache.get(name)!;
}

function rollBack(reason: string) {
  copyFileSync(beforePath, lockPath);
  const note = `Rust crates in ${dir} were not updated today: ${reason}. The next daily run tries again.`;
  console.log(`[age-gate] ${note}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${note}\n`);
  process.exit(0);
}

const before = new Set(lock(beforePath).filter(registry).map(p => `${p.name}@${p.version}`));
const now = Date.now();
for (let round = 1; round <= 40; round++) {
  let young: { pkg: Pkg; fallback: string | null } | null = null;
  for (const pkg of lock(lockPath).filter(p => registry(p) && !before.has(`${p.name}@${p.version}`))) {
    const list = await versions(pkg.name);
    const entry = list.find(v => v.num === pkg.version);
    if (!entry || now - Date.parse(entry.created_at) >= minAgeMs) continue;
    const current = parse(pkg.version);
    const fallback = current ? list.filter(v => !v.yanked && now - Date.parse(v.created_at) >= minAgeMs)
      .map(v => ({ num: v.num, parsed: parse(v.num) })).filter(v => v.parsed && compatible(v.parsed, current) && compare(v.parsed, current) < 0)
      .sort((a, b) => compare(b.parsed!, a.parsed!))[0]?.num ?? null : null;
    young = { pkg, fallback };
    break;
  }
  if (!young) { console.log(`[age-gate] ${dir}: every new crate version is at least ${minAgeText} s old`); process.exit(0); }
  const { pkg, fallback } = young;
  if (!fallback) rollBack(`${pkg.name} ${pkg.version} is less than a day old and has no older compatible version`);
  console.log(`[age-gate] holding back ${pkg.name} ${pkg.version} -> ${fallback}`);
  const run = Bun.spawnSync(['cargo', 'update', '--manifest-path', join(dir, 'Cargo.toml'), '-p', `${pkg.name}@${pkg.version}`, '--precise', fallback!], { stdout: 'inherit', stderr: 'inherit' });
  if (run.exitCode !== 0) rollBack(`${pkg.name} ${pkg.version} is less than a day old and another updated crate requires it`);
}
rollBack('crate versions did not settle after 40 rounds');
