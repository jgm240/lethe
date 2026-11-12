# Third-party notices

Lethe's own code is MIT-licensed (see `LICENSE`). It is built on, and ships with, the following.

## Electron and Chromium
- **Electron** — MIT License, © Electron contributors and GitHub Inc. Packaged builds include `LICENSE.electron.txt`.
- **Chromium** and its bundled components — BSD-3-Clause and various other licenses. Packaged builds include `LICENSES.chromium.html`, which lists every component and its license. That file must stay with any redistributed build.

## Libraries
- **Leaflet 1.9.4** (vendored as `pages/leaflet.js` and `pages/leaflet.css`) — BSD-2-Clause.
  Copyright (c) 2010-2023, Vladimir Agafonkin. Copyright (c) 2010-2011, CloudMade. All rights reserved.
  Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: (1) redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer; (2) redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
- **tz-lookup 6.x** — CC0-1.0 (public-domain dedication). Used to turn map coordinates into a time zone, offline.

## Services contacted at the user's request
- **OpenStreetMap** map tiles (© OpenStreetMap contributors, ODbL), loaded only while the location map in Settings is open, under the [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Tile requests identify this app in the `User-Agent`. If this project is distributed widely, consider hosting or licensing your own tile source.
- **DuckDuckGo** search and search suggestions, **YouTube** (privacy-enhanced embed and oEmbed title lookup, used by the Lethe Player).

## Trademarks
DuckDuckGo, YouTube, OpenStreetMap, Chromium, Electron, Windows, Linux and other product names are trademarks of their respective owners. Lethe is an independent project and is **not affiliated with, endorsed by, or sponsored by** any of them. The app icon and background artwork are original works of this project.
