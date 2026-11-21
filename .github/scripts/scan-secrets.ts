/**
 * Refuses to ship a build that embeds credentials. The build machine holds none of the owner's
 * data, so this looks for credential formats (tokens, private keys, the updater key format).
 *
 * Usage: bun scan-secrets.ts <file>...
 */
const patterns: [string, RegExp][] = [
  ['PEM private key', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['minisign/Tauri secret key', /untrusted comment: (rsign|minisign) encrypted secret key/],
  ['Tauri secret key (base64)', /dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
];
let found = 0;
for (const path of process.argv.slice(2)) {
  const text = Buffer.from(await Bun.file(path).arrayBuffer()).toString('latin1');
  for (const [name, rx] of patterns) if (rx.test(text)) { console.error(`[secrets] ${name} found in ${path}`); found++; }
  console.log(`[secrets] scanned ${path}`);
}
if (found) process.exit(1);
