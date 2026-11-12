// User-agent presets. "default" keeps the browser's own (Chromium-based) identity.
const chromeMajor = () => String(process.versions.chrome || '130').split('.')[0];

const PRESETS = [
  { id: 'default', name: 'Default (Lethe / Chromium)' },
  { id: 'chrome-win', name: 'Chrome on Windows', platform: 'Win32', vendor: 'Google Inc.', ch: true, chPlatform: 'Windows', ua: v => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36` },
  { id: 'chrome-mac', name: 'Chrome on macOS', platform: 'MacIntel', vendor: 'Google Inc.', ch: true, chPlatform: 'macOS', ua: v => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36` },
  { id: 'chrome-linux', name: 'Chrome on Linux', platform: 'Linux x86_64', vendor: 'Google Inc.', ch: true, chPlatform: 'Linux', ua: v => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36` },
  { id: 'safari-mac', name: 'Safari on macOS', platform: 'MacIntel', vendor: 'Apple Computer, Inc.', ch: false, ua: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' },
  { id: 'firefox-win', name: 'Firefox on Windows', platform: 'Win32', vendor: '', ch: false, ua: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0' },
  { id: 'firefox-linux', name: 'Firefox on Linux', platform: 'Linux x86_64', vendor: '', ch: false, ua: () => 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0' },
  { id: 'safari-iphone', name: 'Safari on iPhone', platform: 'iPhone', vendor: 'Apple Computer, Inc.', ch: false, ua: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  { id: 'chrome-android', name: 'Chrome on Android', platform: 'Linux armv8l', vendor: 'Google Inc.', ch: true, chPlatform: 'Android', mobile: true, ua: v => `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Mobile Safari/537.36` },
  { id: 'custom', name: 'Custom…' }
];

// Printable ASCII only, no CR/LF, so a custom value can never inject extra HTTP headers.
const validCustom = v => typeof v === 'string' && v.length <= 512 && /^[\x20-\x7e]*$/.test(v);

function resolveUA(settings, baseUA) {
  const id = settings.userAgent.preset, v = chromeMajor();
  if (id === 'custom') {
    const ua = settings.userAgent.custom.trim();
    if (!ua) return { ua: baseUA, spoofed: false, hideCH: false };
    const chromium = /Chrome\//.test(ua);
    return { ua, spoofed: true, hideCH: !chromium, chromeMajor: chromium ? v : 0, chPlatform: /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'Linux', mobile: /Mobile/.test(ua), platform: /Windows/.test(ua) ? 'Win32' : /Mac/.test(ua) ? 'MacIntel' : /Android|Linux/.test(ua) ? 'Linux x86_64' : '', vendor: chromium ? 'Google Inc.' : /Safari\//.test(ua) && !/Firefox/.test(ua) ? 'Apple Computer, Inc.' : '' };
  }
  const p = PRESETS.find(x => x.id === id);
  if (!p || !p.ua) return { ua: baseUA, spoofed: false, hideCH: false };
  return { ua: p.ua(v), spoofed: true, hideCH: !p.ch, chromeMajor: p.ch ? v : 0, chPlatform: p.chPlatform || '', mobile: !!p.mobile, platform: p.platform, vendor: p.vendor };
}

module.exports = { PRESETS, resolveUA, validCustom };
