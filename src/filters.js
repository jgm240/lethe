// Filter-list engine: a pragmatic subset of Adblock-style syntax.
//   network:  ||host^            ||host/path*            @@||host^  (exception)       options: $third-party, resource types
//   cosmetic: ##selector (everywhere)    example.com##selector (one site)
// Rules that use syntax we don't support (regex rules, $domain=, $redirect=, scriptlets, ...) are skipped, never guessed at.
const SUPPORTED_OPTS = new Set(['third-party', '3p', 'script', 'image', 'stylesheet', 'xmlhttprequest', 'subdocument', 'ping', 'media', 'font', 'other', 'object']);
const TYPE_MAP = { script: 'script', image: 'image', stylesheet: 'stylesheet', xmlhttprequest: 'xhr', subdocument: 'subFrame', ping: 'ping', media: 'media', font: 'font', other: 'other', object: 'object' };

function suffixes(host) {
  const p = host.toLowerCase().split('.'), out = [];
  for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i).join('.'));
  return out;
}

function patternToRegex(p) {
  const esc = p.replace(/[.+?${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\^/g, '(?:[^\\w%.-]|$)');
  return new RegExp('^' + esc);
}

function createEngine() {
  const block = new Map();      // host -> { third, types:Set|null }
  const except = new Set();     // hosts excepted entirely
  const paths = new Map();      // host -> [{ re, third, types }]
  const cosGlobal = [];
  const cosHost = new Map();    // host -> [selectors]
  let rules = 0;

  function parseOpts(optStr) {
    const o = { third: false, types: null };
    if (!optStr) return o;
    for (const raw of optStr.split(',')) {
      const name = raw.trim().replace(/^~/, '');
      if (raw.trim().startsWith('~') || !SUPPORTED_OPTS.has(name)) return null; // unsupported => skip rule
      if (name === 'third-party' || name === '3p') o.third = true;
      else { (o.types || (o.types = new Set())).add(TYPE_MAP[name]); }
    }
    return o;
  }

  function addText(text) {
    for (let line of String(text).split(/\r?\n/)) {
      line = line.trim();
      if (!line || line[0] === '!' || line[0] === '[') continue;
      const ci = line.indexOf('##');
      if (ci >= 0 && !line.includes('#@#') && !line.includes('#?#') && !line.includes('#$#')) {
        const doms = line.slice(0, ci), sel = line.slice(ci + 2);
        if (!sel || /[^\x20-\x7e]/.test(sel) || sel.length > 300 || /:-abp-|:has-text|:xpath|:matches-/.test(sel)) continue;
        if (!doms) cosGlobal.push(sel);
        else for (const d of doms.split(',')) if (d && !d.startsWith('~') && !d.includes('*')) { const k = d.toLowerCase(); (cosHost.get(k) || cosHost.set(k, []).get(k)).push(sel); }
        rules++; continue;
      }
      if (line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) continue;
      let isExc = false;
      if (line.startsWith('@@')) { isExc = true; line = line.slice(2); }
      if (!line.startsWith('||')) continue;
      let body = line.slice(2), optStr = '';
      const di = body.lastIndexOf('$');
      if (di >= 0) { optStr = body.slice(di + 1); body = body.slice(0, di); }
      const opts = parseOpts(optStr);
      if (!opts) continue;
      const m = /^([a-z0-9.-]+)(.*)$/i.exec(body);
      if (!m) continue;
      const host = m[1].toLowerCase(), rest = m[2];
      if (!host.includes('.')) continue;
      if (rest === '' || rest === '^' || rest === '^*') {
        if (isExc) { if (!opts.third && !opts.types) except.add(host); }
        else if (!block.has(host)) block.set(host, opts);
        rules++;
      } else if (!isExc && /^[/^]/.test(rest) && rest.length < 200) {
        const arr = paths.get(host) || paths.set(host, []).get(host);
        arr.push({ re: patternToRegex(rest.replace(/^\^/, '/')), third: opts.third, types: opts.types });
        rules++;
      }
    }
  }

  function match(url, pageHost, type) {
    let u;
    try { u = new URL(url); } catch { return false; }
    const host = u.hostname.toLowerCase(), hs = [host, ...suffixes(host)];
    for (const h of hs) if (except.has(h)) return false;
    const pageSuffix = pageHost ? suffixes(pageHost.toLowerCase()).concat(pageHost.toLowerCase()) : [];
    const third = !pageHost || !hs.some(h => pageSuffix.includes(h)) ;
    for (const h of hs) {
      const b = block.get(h);
      if (b && (!b.third || third) && (!b.types || b.types.has(type))) return true;
      const ps = paths.get(h);
      if (ps) for (const r of ps) if ((!r.third || third) && (!r.types || r.types.has(type)) && r.re.test(u.pathname + u.search)) return true;
    }
    return false;
  }

  function cosmeticCss(pageHost, cap = 2500) {
    const sels = cosGlobal.slice(0, cap);
    for (const h of suffixes(pageHost || '').concat(pageHost || '')) { const x = cosHost.get(h.toLowerCase()); if (x) sels.push(...x); }
    let css = '';
    for (let i = 0; i < sels.length; i += 80) css += sels.slice(i, i + 80).join(',\n') + ' { display: none !important; }\n';
    return css;
  }

  return { addText, match, cosmeticCss, get size() { return rules; } };
}

module.exports = { createEngine };
