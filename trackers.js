// Small built-in tracker blocklist (suffix-matched). Extend freely.
const TRACKERS = [
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com', 'googlesyndication.com',
  'googleadservices.com', 'doubleclick.net', 'adservice.google.com', 'analytics.google.com',
  'connect.facebook.net', 'facebook.net', 'pixel.facebook.com', 'graph.facebook.com',
  'scorecardresearch.com', 'quantserve.com', 'quantcast.com', 'hotjar.com', 'hotjar.io',
  'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com', 'fullstory.com', 'mouseflow.com',
  'crazyegg.com', 'clarity.ms', 'bat.bing.com', 'ads.linkedin.com', 'px.ads.linkedin.com',
  'analytics.twitter.com', 'ads-twitter.com', 'static.ads-twitter.com', 'ads.tiktok.com',
  'analytics.tiktok.com', 'ads.pinterest.com', 'ct.pinterest.com', 'snap.licdn.com',
  'adnxs.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'rubiconproject.com',
  'pubmatic.com', 'openx.net', 'casalemedia.com', 'adsrvr.org', 'bluekai.com', 'demdex.net',
  'omtrdc.net', '2o7.net', 'everesttech.net', 'krxd.net', 'agkn.com', 'rlcdn.com', 'tapad.com',
  'mathtag.com', 'bidswitch.net', 'smartadserver.com', 'moatads.com', 'adsafeprotected.com',
  'chartbeat.com', 'chartbeat.net', 'newrelic.com', 'nr-data.net', 'optimizely.com', 'branch.io',
  'appsflyer.com', 'adjust.com', 'kochava.com', 'heap.io', 'heapanalytics.com', 'intercom.io',
  'addthis.com', 'sharethis.com', 'yandex.ru/metrika', 'mc.yandex.ru', 'hs-analytics.net',
  'hubspot.com/__ptq.gif', 'track.hubspot.com', 'sentry.io', 'bugsnag.com', 'tiqcdn.com',
  'adform.net', 'serving-sys.com', 'turn.com', 'yieldmo.com', 'sharethrough.com', 'teads.tv',
  'media.net', 'amazon-adsystem.com', 'advertising.com', 'zemanta.com', 'ml314.com', 'liadm.com'
];

const SET = new Set(TRACKERS.filter(d => !d.includes('/')));
const MULTI = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

function siteOf(host) {
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const p = host.toLowerCase().split('.');
  if (p.length <= 2) return host.toLowerCase();
  const n = p.length;
  if (p[n - 1].length === 2 && MULTI.has(p[n - 2])) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

function isTracker(host) {
  const p = host.toLowerCase().split('.');
  for (let i = 0; i < p.length - 1; i++) {
    if (SET.has(p.slice(i).join('.'))) return true;
  }
  return false;
}

module.exports = { isTracker, siteOf };
