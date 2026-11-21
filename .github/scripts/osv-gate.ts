/**
 * Checks every crates.io package in the given Cargo.lock files against OSV. Fails on any
 * vulnerability that is not informational ("unmaintained" and similar notices) and not listed,
 * with a reason, in .github/osv-ignore.txt. Sends only package names and versions.
 *
 * Usage: bun osv-gate.ts <ignore file> <Cargo.lock>...
 */
import { readFileSync } from 'node:fs';

type Pkg = { name: string; version: string; source?: string };
const [ignoreFile, ...locks] = process.argv.slice(2);
const ignored = new Set(readFileSync(ignoreFile, 'utf8').split('\n').map(line => line.split('#')[0].trim()).filter(Boolean));
let blocking = 0;
const report: string[] = [];
for (const path of locks) {
  const pkgs = ((Bun.TOML.parse(readFileSync(path, 'utf8')) as { package?: Pkg[] }).package ?? []).filter(p => p.source?.startsWith('registry+'));
  const response = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: pkgs.map(p => ({ package: { ecosystem: 'crates.io', name: p.name }, version: p.version })) }) });
  if (!response.ok) throw new Error(`OSV query failed: HTTP ${response.status}`);
  const results = ((await response.json()) as { results: { vulns?: { id: string }[] }[] }).results;
  for (const [index, result] of results.entries()) {
    for (const { id } of result.vulns ?? []) {
      const detail = await (await fetch(`https://api.osv.dev/v1/vulns/${id}`)).json() as { summary?: string; aliases?: string[];
        database_specific?: { informational?: string }; affected?: { database_specific?: { informational?: string } }[] };
      const informational = detail.database_specific?.informational ?? detail.affected?.find(a => a.database_specific?.informational)?.database_specific?.informational;
      const names = [id, ...(detail.aliases ?? [])];
      const state = informational ? `informational (${informational})` : names.some(name => ignored.has(name)) ? 'ignored (see osv-ignore.txt)' : 'BLOCKING';
      if (state === 'BLOCKING') blocking++;
      report.push(`${pkgs[index].name} ${pkgs[index].version}  ${id}  ${state}  ${detail.summary ?? ''}`);
    }
  }
  console.log(`[osv] ${path}: ${pkgs.length} crates checked`);
}
console.log(report.length ? report.join('\n') : '[osv] no advisories');
if (blocking) { console.error(`[osv] ${blocking} blocking advisory(ies)`); process.exit(1); }
