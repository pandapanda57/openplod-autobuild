# openplod-autobuild

**Unofficial personal builds of [OpenPlod](https://github.com/RemiPelloux/OpenPlod) for Windows x64. Not affiliated with the OpenPlod project.**

This repository holds only a GitHub Actions workflow, a few patch files and small check scripts. Once a day the workflow takes the newest official OpenPlod release, applies the patches, updates its building blocks, checks the result and, when something changed, publishes a signed installer here. OpenPlod's built-in updater (a banner at start-up and **Settings → Check for updates**) installs it in one click, after an automatic vault backup.

What each build changes compared with official OpenPlod:

- **Bun**: the newest release, checksum and Windows signature verified.
- **Rust**: the newest stable compiler.
- **ffmpeg**: the newest stable release line, bundled with the app (LGPL build from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), checksum verified; licence text ships in the app's `ffmpeg` folder; source at [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg)). OpenPlod uses it instead of any ffmpeg installed on the computer.
- **npm packages and Rust crates**: newest versions within OpenPlod's own version ranges, once they have been public for at least a day. Security fixes for npm packages are applied at once.
- **Patches** in `.github/patches/`:
  - Windows fix for Plaud Bluetooth imports (resume file opened without append mode)
  - "Delete from recorder" for recordings whose vault copy is verified (size and SHA-256 of the kept original), desktop app only
  - an update banner that backs up the vault before installing
  - the bundled ffmpeg put first on the path of OpenPlod's background service
- **Updater**: points at this repository and trusts only this repository's signing key.

Before anything is published, every build must pass: the patches applying cleanly, OpenPlod's typecheck and tests (five test files that also fail on Windows in the official release are allowed to fail), no high or critical advisory in a shipped npm package, no blocking Rust advisory (`.github/osv-ignore.txt` lists the accepted ones with reasons), and a scan of the built files for credentials. A failed run opens an issue and publishes nothing.

Builds are **unsigned for Windows** (SmartScreen may warn on a manual install). Updates are signed with this repository's updater key, and the app refuses any update not signed with it.
