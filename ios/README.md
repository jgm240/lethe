# Lethe for iPhone and iPad

A native (Swift, UIKit, WKWebView) take on Lethe. The desktop app is Electron, which cannot run on iOS, so this is a separate, smaller app that shares the name, icon, tracker list and the "forget instantly" ideas.

**Included:** DuckDuckGo search, tabs, bookmarks, history, HTTPS upgrade (with fallback), tracker blocking (iOS 11+), tracking-parameter stripping, third-party cookie blocking (iOS 11+), Global Privacy Control, Eject to Lethe (with river animation), forget the last hour/day/site, and **Canal to Lethe** (each tab gets its own in-memory storage that dies with the tab; no history).

**Not included (desktop only):** filter lists, element zapper, reader mode, per-site rules, command palette, location/user-agent spoofing, Lethe Player.

## Build

Needs Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
cd ios && xcodegen generate && open Lethe.xcodeproj
```

CI (`.github/workflows/ios.yml`) builds an unsigned IPA on a macOS runner. An unsigned IPA must be re-signed with your own Apple ID (AltStore, Sideloadly, or Xcode) before it installs.
