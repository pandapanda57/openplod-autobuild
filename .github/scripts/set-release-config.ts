/**
 * Points the app's updater at this repository's releases and trusts only this repository's
 * public key; stamps the build's version. Runs after OpenPlod's own scripts/release-config.ts.
 * Updater artifacts stay off here: signing happens in the separate publish job.
 *
 * Usage: bun set-release-config.ts <tauri.release.conf.json> <version> <public key file> <repo>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [path, version, pubkeyFile, repo] = process.argv.slice(2);
const config = JSON.parse(readFileSync(path, 'utf8'));
config.version = version;
config.bundle = { ...config.bundle, createUpdaterArtifacts: false };
// The bundled ffmpeg folder, when the workflow placed one. Tauri merges this map with the
// resources in tauri.conf.json, so OpenPlod's own resources stay.
if (existsSync(join(dirname(path), 'resources', 'ffmpeg', 'ffmpeg.exe'))) {
  config.bundle.resources = { ...config.bundle.resources, 'resources/ffmpeg/': 'ffmpeg/' };
}
config.plugins = { ...config.plugins, updater: { ...config.plugins?.updater,
  pubkey: readFileSync(pubkeyFile, 'utf8').trim(),
  endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
  windows: { installMode: 'passive' } } };
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[config] version ${version}, updater -> ${repo}`);
