# InstaOlvidar Browser

*Olvídalo al instante — forget instantly.* A privacy-first desktop browser (Windows, Linux, macOS) built on Electron, with DuckDuckGo as the default search engine.

> Not affiliated with or endorsed by DuckDuckGo, Google/YouTube, OpenStreetMap or any other company mentioned here. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Features
- **Protections:** third-party tracker blocking, smarter HTTPS upgrades, Global Privacy Control, third-party cookie blocking, link-tracking parameter removal, a cookie pop-up manager (only ever rejects), per-site protection toggles.
- **Fire Button** (Ctrl/Cmd+Shift+Backspace): closes every tab and erases history, cookies, cache and site data. Fireproof sites keep their cookies. Optional clear-on-exit.
- **InstaOlvidar Player:** watch YouTube through its privacy-enhanced embed, without personalized ads. Ask / always / never.
- **Themes** (presets + custom colors), New Tab backgrounds, bookmarks with favorites, history, downloads, address-bar suggestions, reopen closed tab.
- **Content controls:** No CSS, No images, No JavaScript.
- **Spoof location:** pick a place from a map (time zone follows) and choose a **user agent** (Chrome, Safari, Firefox, iPhone, Android or custom).
- Internal pages use the `io-browser://` scheme: `io-browser://settings`, `io-browser://history`, `io-browser://bookmarks`, `io-browser://downloads`.

## Install
Download a build from the [Releases](../../releases) page.

| Platform | Files |
|---|---|
| Windows (x64) | `…-Setup-…exe` installer, or the portable `.zip` |
| Linux (x64) | `.AppImage`, `.deb`, or `.tar.gz` |

**Linux AppImage on Ubuntu 24.04+:** if the app won't start with a sandbox error, your system restricts unprivileged user namespaces. Prefer the `.deb` (it installs the sandbox helper correctly), or enable the namespace for this app via AppArmor. Please don't disable the Chromium sandbox on a browser.

These builds are unsigned, so Windows SmartScreen may warn you the first time.

## Build from source
```bash
npm install
npm start            # run
npm run dist         # package for the current OS (output in dist/)
```
Releases are built by GitHub Actions (`.github/workflows/build.yml`) on Windows and Ubuntu runners when a `v*` tag is pushed.

## What it contacts
Only what you use: your search engine (DuckDuckGo by default, plus suggestions if enabled), the sites you visit, YouTube when you use the Player, and OpenStreetMap tiles only while the location map is open. There is no telemetry and no account.

## Honest limits
- "Spoof location" does **not** hide your IP address; use a VPN for that.
- Changing the user agent changes what sites are told, not other fingerprinting signals.
- The "Tell duckduckgo.com I'm using a DuckDuckGo browser" setting is **off by default**. When on, it sends duckduckgo.com the user agent DuckDuckGo's own browser sends, so it may count you in its browser statistics.

## License
MIT (see [LICENSE](LICENSE)). Bundled third-party components keep their own licenses (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
