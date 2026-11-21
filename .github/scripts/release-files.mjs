/**
 * After signing: checks the signature was made by the key whose public half the app trusts,
 * then writes latest.json (what the in-app updater reads) and SHA256SUMS.txt.
 *
 * Runs on Node (the publish job installs nothing else). Usage: node release-files.mjs <dir> <installer name> <version> <tag> <repo> <public key file> <notes file>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, installer, version, tag, repo, pubkeyFile, notesFile] = process.argv.slice(2);
// Tauri keys and signatures are base64 of a two-line minisign text; bytes 2..10 of the decoded
// second line are the key ID, which must match.
const keyId = (b64) => Buffer.from(Buffer.from(b64.trim(), 'base64').toString('utf8').split('\n')[1].trim(), 'base64').subarray(2, 10).toString('hex');
const signature = readFileSync(join(dir, `${installer}.sig`), 'utf8').trim();
const pubkey = readFileSync(pubkeyFile, 'utf8').trim();
if (keyId(signature) !== keyId(pubkey)) throw new Error('The update was signed with a different key than the one the app trusts.');
const url = `https://github.com/${repo}/releases/download/${tag}/${installer}`;
const platform = { signature, url };
writeFileSync(join(dir, 'latest.json'), `${JSON.stringify({ version, notes: readFileSync(notesFile, 'utf8').trim(), pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64-nsis': platform, 'windows-x86_64': platform } }, null, 2)}\n`);
const sum = createHash('sha256').update(readFileSync(join(dir, installer))).digest('hex');
writeFileSync(join(dir, 'SHA256SUMS.txt'), `${sum} *${installer}\n`);
console.log(`[release] key ${keyId(pubkey)} ok; ${installer} sha256 ${sum}`);
