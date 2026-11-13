import Foundation
import WebKit

enum Net {
    static let searchURL = "https://duckduckgo.com/?q="

    private static let trackingParams: Set<String> = [
        "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "mc_eid", "mc_cid", "igshid",
        "yclid", "_hsenc", "_hsmi", "twclid", "ttclid", "li_fat_id", "vero_id", "oly_enc_id", "oly_anon_id"
    ]

    static func isTrackingParam(_ name: String) -> Bool {
        let n = name.lowercased()
        return n.hasPrefix("utm_") || trackingParams.contains(n)
    }

    static func isLocal(_ host: String) -> Bool {
        if host == "localhost" || host.hasSuffix(".local") || host.hasSuffix(".localhost") || host.hasSuffix(".test") { return true }
        if host.contains(":") { return true } // IPv6 literal
        let parts = host.split(separator: ".")
        return parts.count == 4 && parts.allSatisfy { Int($0) != nil } // IPv4 literal
    }

    /// Turn what was typed into a URL: an address, or a DuckDuckGo search.
    static func normalize(_ input: String) -> URL? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if text.contains("://"), let u = URL(string: text) { return u }
        if !text.contains(" ") && (text.contains(".") || text.hasPrefix("localhost")),
           let u = URL(string: "https://" + text), u.host != nil {
            return u
        }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let q = text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
        return URL(string: searchURL + q)
    }

    /// HTTPS upgrade and tracking-parameter stripping. Returns the same URL when nothing changes.
    static func rewrite(_ url: URL, httpAllow: Set<String>) -> URL {
        guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return url }
        var changed = false
        let host = (c.host ?? "").lowercased()
        if scheme == "http" && Prefs.shared.httpsUpgrade && !isLocal(host) && !httpAllow.contains(host) {
            c.scheme = "https"
            if c.port == 80 { c.port = nil }
            changed = true
        }
        if Prefs.shared.stripParams, let items = c.queryItems, !items.isEmpty {
            let kept = items.filter { !isTrackingParam($0.name) }
            if kept.count != items.count {
                c.queryItems = kept.isEmpty ? nil : kept
                changed = true
            }
        }
        if changed, let out = c.url { return out }
        return url
    }

    static func bareHost(_ host: String) -> String {
        return host.lowercased().hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}

/// Tracker blocking through WebKit content rules (iOS 11 and later).
final class Blocker {
    static let shared = Blocker()
    private var compiled: AnyObject?

    func prepare(_ done: @escaping () -> Void) {
        guard #available(iOS 11.0, *) else { done(); return }
        var rules: [[String: Any]] = []
        for domain in TrackerList.domains {
            let escaped = domain.replacingOccurrences(of: ".", with: "\\.")
            rules.append(["trigger": ["url-filter": "^https?://" + escaped + "[:/]"], "action": ["type": "block"]])
            rules.append(["trigger": ["url-filter": "^https?://[^/]*\\." + escaped + "[:/]"], "action": ["type": "block"]])
        }
        rules.append(["trigger": ["url-filter": ".*", "load-type": ["third-party"]], "action": ["type": "block-cookies"]])
        guard let data = try? JSONSerialization.data(withJSONObject: rules),
              let json = String(data: data, encoding: .utf8) else { done(); return }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "lethe-trackers", encodedContentRuleList: json) { list, _ in
            DispatchQueue.main.async {
                self.compiled = list
                done()
            }
        }
    }

    func install(in controller: WKUserContentController) {
        if #available(iOS 11.0, *), Prefs.shared.blockTrackers, let list = compiled as? WKContentRuleList {
            controller.add(list)
        }
    }
}
