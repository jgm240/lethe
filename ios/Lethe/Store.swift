import Foundation
import WebKit

struct Entry: Codable {
    var title: String
    var url: String
    var time: Double
}

/// Settings, kept in UserDefaults.
final class Prefs {
    static let shared = Prefs()
    private let d = UserDefaults.standard

    private init() {
        d.register(defaults: [
            "canal": false, "httpsUpgrade": true, "blockTrackers": true, "stripParams": true,
            "saveHistory": true, "confirmEject": true, "animation": true
        ])
    }

    var canal: Bool { get { return d.bool(forKey: "canal") } set { d.set(newValue, forKey: "canal") } }
    var httpsUpgrade: Bool { get { return d.bool(forKey: "httpsUpgrade") } set { d.set(newValue, forKey: "httpsUpgrade") } }
    var blockTrackers: Bool { get { return d.bool(forKey: "blockTrackers") } set { d.set(newValue, forKey: "blockTrackers") } }
    var stripParams: Bool { get { return d.bool(forKey: "stripParams") } set { d.set(newValue, forKey: "stripParams") } }
    var saveHistory: Bool { get { return d.bool(forKey: "saveHistory") } set { d.set(newValue, forKey: "saveHistory") } }
    var confirmEject: Bool { get { return d.bool(forKey: "confirmEject") } set { d.set(newValue, forKey: "confirmEject") } }
    var animation: Bool { get { return d.bool(forKey: "animation") } set { d.set(newValue, forKey: "animation") } }
}

/// Bookmarks and history. History is never written while the Canal is open.
final class Library {
    static let shared = Library()
    private(set) var bookmarks: [Entry] = []
    private(set) var history: [Entry] = []

    private init() {
        bookmarks = Library.load("bookmarks")
        history = Library.load("history")
    }

    private static func load(_ key: String) -> [Entry] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let list = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return list
    }

    private func save(_ key: String, _ list: [Entry]) {
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }

    func addHistory(title: String, url: String) {
        if Prefs.shared.canal || !Prefs.shared.saveHistory { return }
        if let first = history.first, first.url == url {
            history[0].title = title
        } else {
            history.insert(Entry(title: title, url: url, time: Date().timeIntervalSince1970), at: 0)
        }
        if history.count > 1000 { history.removeLast(history.count - 1000) }
        save("history", history)
    }

    func removeHistory(at index: Int) {
        guard index >= 0 && index < history.count else { return }
        history.remove(at: index)
        save("history", history)
    }

    func removeHistory(since date: Date) {
        let cutoff = date.timeIntervalSince1970
        history = history.filter { $0.time < cutoff }
        save("history", history)
    }

    func removeHistory(site: String) {
        history = history.filter { entry in
            guard let host = URL(string: entry.url)?.host?.lowercased() else { return true }
            return !(host == site || host.hasSuffix("." + site))
        }
        save("history", history)
    }

    func clearHistory() {
        history = []
        save("history", history)
    }

    func isBookmarked(_ url: String) -> Bool {
        return bookmarks.contains { $0.url == url }
    }

    /// Returns true when the page is now bookmarked.
    @discardableResult
    func toggleBookmark(title: String, url: String) -> Bool {
        if let i = bookmarks.firstIndex(where: { $0.url == url }) {
            bookmarks.remove(at: i)
            save("bookmarks", bookmarks)
            return false
        }
        bookmarks.insert(Entry(title: title, url: url, time: Date().timeIntervalSince1970), at: 0)
        save("bookmarks", bookmarks)
        return true
    }

    func removeBookmark(at index: Int) {
        guard index >= 0 && index < bookmarks.count else { return }
        bookmarks.remove(at: index)
        save("bookmarks", bookmarks)
    }
}

/// Everything that erases data.
enum Eraser {
    private static var allTypes: Set<String> { return WKWebsiteDataStore.allWebsiteDataTypes() }

    /// Eject to Lethe: all site data, cache, cookies and history.
    static func eraseAll(_ done: @escaping () -> Void) {
        Library.shared.clearHistory()
        URLCache.shared.removeAllCachedResponses()
        let jar = HTTPCookieStorage.shared
        for c in jar.cookies ?? [] { jar.deleteCookie(c) }
        WKWebsiteDataStore.default().removeData(ofTypes: allTypes, modifiedSince: Date(timeIntervalSince1970: 0)) {
            DispatchQueue.main.async(execute: done)
        }
    }

    /// Forget the last hour / day.
    static func erase(since date: Date, _ done: @escaping () -> Void) {
        Library.shared.removeHistory(since: date)
        WKWebsiteDataStore.default().removeData(ofTypes: allTypes, modifiedSince: date) {
            DispatchQueue.main.async(execute: done)
        }
    }

    /// Forget a single site (cookies, storage, cache) and its history entries.
    static func erase(site: String, _ done: @escaping () -> Void) {
        Library.shared.removeHistory(site: site)
        let store = WKWebsiteDataStore.default()
        store.fetchDataRecords(ofTypes: allTypes) { records in
            let matches = records.filter { r in
                let n = r.displayName.lowercased()
                return site == n || site.hasSuffix("." + n)
            }
            store.removeData(ofTypes: allTypes, for: matches) {
                DispatchQueue.main.async(execute: done)
            }
        }
    }
}
