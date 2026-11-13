import UIKit
import WebKit

final class Tab {
    let webView: WKWebView
    init(webView: WKWebView) { self.webView = webView }

    var title: String {
        let t = webView.title ?? ""
        if !t.isEmpty { return t }
        return webView.url?.host ?? "New Tab"
    }
    var hasContent: Bool { return webView.url != nil || webView.isLoading }
}

final class BrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UITextFieldDelegate {
    private var tabs: [Tab] = []
    private var current: Tab?
    private var httpAllow = Set<String>()
    private var upgraded = Set<String>()

    private let topBar = UIView()
    private let addressField = UITextField()
    private let progress = UIProgressView(progressViewStyle: .bar)
    private let content = UIView()
    private let startView = StartView()
    private let toolbar = UIToolbar()
    private var backItem = UIBarButtonItem()
    private var forwardItem = UIBarButtonItem()
    private var ejectItem = UIBarButtonItem()
    private var tabsItem = UIBarButtonItem()
    private var menuItem = UIBarButtonItem()
    private var kvoContext = 0
    private let observedKeys = ["estimatedProgress", "title", "URL", "canGoBack", "canGoForward", "loading"]

    override var preferredStatusBarStyle: UIStatusBarStyle { return .lightContent }

    // MARK: - Setup

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.bar
        buildUI()
        if Prefs.shared.canal { Eraser.eraseAll { } } // leftovers from a previous run
        Blocker.shared.prepare { [weak self] in self?.newTab(url: nil) }
    }

    private func buildUI() {
        topBar.backgroundColor = Theme.bar
        topBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(topBar)

        addressField.translatesAutoresizingMaskIntoConstraints = false
        addressField.backgroundColor = Theme.field
        addressField.layer.cornerRadius = 10
        addressField.textColor = .white
        addressField.font = UIFont.systemFont(ofSize: 16)
        addressField.attributedPlaceholder = NSAttributedString(string: "Search or enter address", attributes: [NSAttributedString.Key.foregroundColor: Theme.muted])
        addressField.autocapitalizationType = .none
        addressField.autocorrectionType = .no
        addressField.keyboardType = .webSearch
        addressField.returnKeyType = .go
        addressField.clearButtonMode = .whileEditing
        addressField.keyboardAppearance = .dark
        addressField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 10))
        addressField.leftViewMode = .always
        addressField.delegate = self
        topBar.addSubview(addressField)

        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.progressTintColor = Theme.accent
        progress.trackTintColor = .clear
        topBar.addSubview(progress)

        content.translatesAutoresizingMaskIntoConstraints = false
        content.backgroundColor = Theme.bg
        view.addSubview(content)
        startView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(startView)
        pin(startView, to: content)

        backItem = makeItem("‹", #selector(goBack), size: 30)
        forwardItem = makeItem("›", #selector(goForward), size: 30)
        ejectItem = makeItem("≋ Λήθη", #selector(showEjectMenu), size: 17)
        ejectItem.tintColor = Theme.papyrus
        tabsItem = makeItem("▢ 1", #selector(showTabs), size: 17)
        menuItem = makeItem("⋯", #selector(showMenu), size: 26)
        func flex() -> UIBarButtonItem { return UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil) }
        toolbar.setItems([backItem, flex(), forwardItem, flex(), ejectItem, flex(), tabsItem, flex(), menuItem], animated: false)
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        toolbar.barTintColor = Theme.bar
        toolbar.tintColor = Theme.accent
        toolbar.isTranslucent = false
        view.addSubview(toolbar)

        let topAnchorGuide: NSLayoutYAxisAnchor
        let bottomAnchorGuide: NSLayoutYAxisAnchor
        if #available(iOS 11.0, *) {
            topAnchorGuide = view.safeAreaLayoutGuide.topAnchor
            bottomAnchorGuide = view.safeAreaLayoutGuide.bottomAnchor
        } else {
            topAnchorGuide = topLayoutGuide.bottomAnchor
            bottomAnchorGuide = view.bottomAnchor
        }

        NSLayoutConstraint.activate([
            topBar.topAnchor.constraint(equalTo: view.topAnchor),
            topBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            addressField.topAnchor.constraint(equalTo: topAnchorGuide, constant: 6),
            addressField.leadingAnchor.constraint(equalTo: topBar.leadingAnchor, constant: 12),
            addressField.trailingAnchor.constraint(equalTo: topBar.trailingAnchor, constant: -12),
            addressField.heightAnchor.constraint(equalToConstant: 38),
            topBar.bottomAnchor.constraint(equalTo: addressField.bottomAnchor, constant: 8),
            progress.leadingAnchor.constraint(equalTo: topBar.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: topBar.trailingAnchor),
            progress.bottomAnchor.constraint(equalTo: topBar.bottomAnchor),

            content.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: toolbar.topAnchor),

            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.bottomAnchor.constraint(equalTo: bottomAnchorGuide)
        ])
    }

    private func makeItem(_ title: String, _ action: Selector, size: CGFloat) -> UIBarButtonItem {
        let item = UIBarButtonItem(title: title, style: .plain, target: self, action: action)
        item.setTitleTextAttributes([NSAttributedString.Key.font: UIFont.systemFont(ofSize: size)], for: .normal)
        item.setTitleTextAttributes([NSAttributedString.Key.font: UIFont.systemFont(ofSize: size)], for: .disabled)
        return item
    }

    private func pin(_ child: UIView, to parent: UIView) {
        NSLayoutConstraint.activate([
            child.topAnchor.constraint(equalTo: parent.topAnchor),
            child.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
            child.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            child.trailingAnchor.constraint(equalTo: parent.trailingAnchor)
        ])
    }

    // MARK: - Tabs

    private func makeWebView() -> WKWebView {
        let cfg = WKWebViewConfiguration()
        // Canal to Lethe: every tab gets its own in-memory store, destroyed with the tab.
        cfg.websiteDataStore = Prefs.shared.canal ? WKWebsiteDataStore.nonPersistent() : WKWebsiteDataStore.default()
        cfg.allowsInlineMediaPlayback = true
        let gpc = "try{Object.defineProperty(Navigator.prototype,'globalPrivacyControl',{value:true,configurable:true})}catch(e){}"
        cfg.userContentController.addUserScript(WKUserScript(source: gpc, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        Blocker.shared.install(in: cfg.userContentController)
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.allowsBackForwardNavigationGestures = true
        wv.navigationDelegate = self
        wv.uiDelegate = self
        return wv
    }

    private func observe(_ wv: WKWebView) {
        for k in observedKeys { wv.addObserver(self, forKeyPath: k, options: [.new], context: &kvoContext) }
    }

    private func unobserve(_ wv: WKWebView) {
        for k in observedKeys { wv.removeObserver(self, forKeyPath: k, context: &kvoContext) }
    }

    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
        if context == &kvoContext {
            if let wv = object as? WKWebView, wv === current?.webView { updateUI() }
        } else {
            super.observeValue(forKeyPath: keyPath, of: object, change: change, context: context)
        }
    }

    func newTab(url: URL?) {
        let wv = makeWebView()
        let tab = Tab(webView: wv)
        tabs.append(tab)
        observe(wv)
        select(tab)
        if let u = url { wv.load(URLRequest(url: u)) }
        if url == nil && current === tab { addressField.becomeFirstResponder() }
    }

    private func select(_ tab: Tab) {
        current?.webView.removeFromSuperview()
        current = tab
        let wv = tab.webView
        wv.translatesAutoresizingMaskIntoConstraints = false
        content.insertSubview(wv, belowSubview: startView)
        pin(wv, to: content)
        updateUI()
    }

    private func close(_ tab: Tab) {
        guard let i = tabs.firstIndex(where: { $0 === tab }) else { return }
        unobserve(tab.webView)
        tab.webView.stopLoading()
        tab.webView.removeFromSuperview()
        tabs.remove(at: i)
        if tab === current {
            current = nil
            if tabs.isEmpty { newTab(url: nil) } else { select(tabs[min(i, tabs.count - 1)]) }
        } else {
            updateUI()
        }
    }

    private func closeAllTabs() {
        for t in tabs {
            unobserve(t.webView)
            t.webView.stopLoading()
            t.webView.removeFromSuperview()
        }
        tabs.removeAll()
        current = nil
    }

    private func updateUI() {
        tabsItem.title = "▢ \(tabs.count)"
        ejectItem.title = Prefs.shared.canal ? "≋ Λήθη ·" : "≋ Λήθη"
        guard let tab = current else { return }
        let wv = tab.webView
        backItem.isEnabled = wv.canGoBack
        forwardItem.isEnabled = wv.canGoForward
        startView.isHidden = tab.hasContent
        if !addressField.isFirstResponder { addressField.text = display(wv.url) }
        progress.isHidden = !wv.isLoading
        progress.progress = Float(wv.estimatedProgress)
    }

    private func display(_ url: URL?) -> String {
        guard let u = url, let scheme = u.scheme, scheme.hasPrefix("http") else { return "" }
        let host = Net.bareHost(u.host ?? u.absoluteString)
        return (scheme == "https" ? "🔒 " : "⚠︎ ") + host
    }

    // MARK: - Navigation

    private func go(_ input: String) {
        guard let url = Net.normalize(input) else { return }
        if current == nil { newTab(url: nil) }
        current?.webView.load(URLRequest(url: url))
    }

    private func open(_ urlString: String) {
        guard let u = URL(string: urlString) else { return }
        if current == nil { newTab(url: u); return }
        current?.webView.load(URLRequest(url: u))
    }

    @objc private func goBack() { current?.webView.goBack() }
    @objc private func goForward() { current?.webView.goForward() }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        go(textField.text ?? "")
        return true
    }

    func textFieldDidBeginEditing(_ textField: UITextField) {
        textField.text = current?.webView.url?.absoluteString ?? ""
        DispatchQueue.main.async { textField.selectAll(nil) }
    }

    func textFieldDidEndEditing(_ textField: UITextField) { updateUI() }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "http" || scheme == "https" {
            if navigationAction.targetFrame?.isMainFrame ?? true {
                let fixed = Net.rewrite(url, httpAllow: httpAllow)
                if fixed != url {
                    if url.scheme?.lowercased() == "http", fixed.scheme?.lowercased() == "https", let h = fixed.host { upgraded.insert(h.lowercased()) }
                    decisionHandler(.cancel)
                    webView.load(URLRequest(url: fixed))
                    return
                }
            }
            decisionHandler(.allow)
        } else if ["about", "data", "blob", "file", "javascript"].contains(scheme) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel) // other apps (tel:, mailto:, app links) are not opened silently
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let u = webView.url, u.scheme?.hasPrefix("http") == true {
            Library.shared.addHistory(title: webView.title ?? "", url: u.absoluteString)
        }
        updateUI()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        let failed = ns.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        // The site does not support HTTPS: fall back to plain HTTP for that host.
        if let f = failed, f.scheme?.lowercased() == "https", let host = f.host?.lowercased(), upgraded.contains(host), !httpAllow.contains(host) {
            httpAllow.insert(host)
            if var c = URLComponents(url: f, resolvingAgainstBaseURL: false) {
                c.scheme = "http"
                if let u = c.url { webView.load(URLRequest(url: u)); return }
            }
        }
        let message = ns.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
        let html = "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='font-family:-apple-system,sans-serif;background:#0e1030;color:#f2dfb8;text-align:center;padding:18vh 24px'><h2>Λήθη</h2><p>This page could not be opened.</p><p style='opacity:.6'>\(message)</p></body>"
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url { newTab(url: u) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: webView.url?.host, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true, completion: nil)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: webView.url?.host, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        present(a, animated: true, completion: nil)
    }

    // MARK: - Menus

    private typealias SheetAction = (String, UIAlertAction.Style, () -> Void)

    private func sheet(_ title: String?, _ actions: [SheetAction], from item: UIBarButtonItem) {
        let s = UIAlertController(title: title, message: nil, preferredStyle: .actionSheet)
        for (name, style, run) in actions {
            s.addAction(UIAlertAction(title: name, style: style) { _ in run() })
        }
        s.addAction(UIAlertAction(title: "Cancel", style: .cancel, handler: nil))
        s.popoverPresentationController?.barButtonItem = item
        present(s, animated: true, completion: nil)
    }

    private func presentList(_ vc: UIViewController) {
        let nav = UINavigationController(rootViewController: vc)
        Theme.style(nav)
        nav.modalPresentationStyle = .formSheet
        present(nav, animated: true, completion: nil)
    }

    @objc private func showEjectMenu() {
        addressField.resignFirstResponder()
        var actions: [SheetAction] = []
        actions.append(("Eject to Lethe…", .destructive, { [weak self] in self?.confirmEject() }))
        let canalTitle = Prefs.shared.canal ? "Close the Canal (keep history again)" : "Open the Canal to Lethe (forget everything as I go)"
        actions.append((canalTitle, .default, { [weak self] in self?.toggleCanal() }))
        actions.append(("Forget the last hour", .default, { [weak self] in self?.forget(seconds: 3600, label: "hour") }))
        actions.append(("Forget the last day", .default, { [weak self] in self?.forget(seconds: 86400, label: "day") }))
        if let host = current?.webView.url?.host {
            let site = Net.bareHost(host)
            actions.append(("Forget \(site) only", .default, { [weak self] in self?.forget(site: site) }))
        }
        sheet("Eject to Lethe", actions, from: ejectItem)
    }

    @objc private func showMenu() {
        addressField.resignFirstResponder()
        var actions: [SheetAction] = []
        actions.append(("New Tab", .default, { [weak self] in self?.newTab(url: nil) }))
        if let u = current?.webView.url, u.scheme?.hasPrefix("http") == true {
            let saved = Library.shared.isBookmarked(u.absoluteString)
            actions.append((saved ? "Remove Bookmark" : "Add Bookmark", .default, { [weak self] in
                guard let self = self, let wv = self.current?.webView else { return }
                Library.shared.toggleBookmark(title: wv.title ?? "", url: u.absoluteString)
                self.toast(saved ? "Bookmark removed" : "Bookmarked")
            }))
            actions.append(("Share…", .default, { [weak self] in self?.share(u) }))
        }
        actions.append(("Bookmarks", .default, { [weak self] in self?.showBookmarks() }))
        actions.append(("History", .default, { [weak self] in self?.showHistory() }))
        actions.append(("Settings", .default, { [weak self] in self?.showSettings() }))
        sheet(nil, actions, from: menuItem)
    }

    private func share(_ url: URL) {
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.barButtonItem = menuItem
        present(vc, animated: true, completion: nil)
    }

    @objc private func showTabs() {
        addressField.resignFirstResponder()
        let list = ListViewController(title: "Tabs")
        list.items = tabs.map { Entry(title: $0.title, url: $0.webView.url?.absoluteString ?? "New tab", time: 0) }
        list.emptyText = "No tabs"
        list.addTitle = "+ New"
        list.onAdd = { [weak self] in self?.newTab(url: nil) }
        list.onSelect = { [weak self] i in
            guard let self = self, i < self.tabs.count else { return }
            self.select(self.tabs[i])
        }
        list.onDelete = { [weak self] i in
            guard let self = self, i < self.tabs.count else { return }
            self.close(self.tabs[i])
        }
        presentList(list)
    }

    private func showBookmarks() {
        let list = ListViewController(title: "Bookmarks")
        list.items = Library.shared.bookmarks
        list.emptyText = "No bookmarks yet"
        list.onSelect = { [weak self] i in
            let marks = Library.shared.bookmarks
            if i < marks.count { self?.open(marks[i].url) }
        }
        list.onDelete = { i in Library.shared.removeBookmark(at: i) }
        presentList(list)
    }

    private func showHistory() {
        let list = ListViewController(title: Prefs.shared.canal ? "History (Canal is open)" : "History")
        list.items = Library.shared.history
        list.emptyText = Prefs.shared.canal ? "The Canal keeps no history" : "No history"
        list.onSelect = { [weak self] i in
            let h = Library.shared.history
            if i < h.count { self?.open(h[i].url) }
        }
        list.onDelete = { i in Library.shared.removeHistory(at: i) }
        list.onClear = { Library.shared.clearHistory() }
        presentList(list)
    }

    private func showSettings() {
        let vc = SettingsViewController()
        vc.onEject = { [weak self, weak vc] in
            vc?.dismiss(animated: true) { self?.confirmEject() }
        }
        vc.onCanalOpened = { [weak self, weak vc] in
            vc?.dismiss(animated: true) { self?.doEject(animated: Prefs.shared.animation) }
        }
        presentList(vc)
    }

    // MARK: - Forgetting

    private func confirmEject() {
        guard Prefs.shared.confirmEject else { doEject(animated: Prefs.shared.animation); return }
        let a = UIAlertController(title: "Eject to Lethe?",
                                  message: "Closes every tab and throws your history, cookies, site data and cache into the river. Bookmarks and settings are kept.",
                                  preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Eject to Lethe", style: .destructive) { [weak self] _ in self?.doEject(animated: Prefs.shared.animation) })
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel, handler: nil))
        present(a, animated: true, completion: nil)
    }

    private func doEject(animated: Bool) {
        addressField.resignFirstResponder()
        if animated { EjectOverlay.play(in: view) }
        closeAllTabs()
        Eraser.eraseAll { [weak self] in
            self?.newTab(url: nil)
        }
    }

    private func toggleCanal() {
        if Prefs.shared.canal {
            Prefs.shared.canal = false
            updateUI()
            toast("Canal closed. History is saved again.")
        } else {
            Dialogs.confirmCanal(from: self, onYes: { [weak self] in
                Prefs.shared.canal = true
                self?.doEject(animated: Prefs.shared.animation)
            })
        }
    }

    private func forget(seconds: TimeInterval, label: String) {
        Eraser.erase(since: Date(timeIntervalSinceNow: -seconds)) { [weak self] in
            self?.toast("Forgot the last \(label)")
        }
    }

    private func forget(site: String) {
        Eraser.erase(site: site) { [weak self] in
            self?.toast("Forgot \(site)")
        }
    }

    private func toast(_ text: String) {
        let box = UIView()
        box.backgroundColor = Theme.papyrus
        box.layer.cornerRadius = 16
        box.translatesAutoresizingMaskIntoConstraints = false
        let label = UILabel()
        label.text = text
        label.textColor = Theme.bg
        label.font = UIFont.systemFont(ofSize: 14, weight: UIFont.Weight.semibold)
        label.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(label)
        view.addSubview(box)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: box.topAnchor, constant: 9),
            label.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -9),
            label.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -16),
            box.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            box.bottomAnchor.constraint(equalTo: toolbar.topAnchor, constant: -14)
        ])
        box.alpha = 0
        UIView.animate(withDuration: 0.2, animations: { box.alpha = 1 }, completion: { _ in
            UIView.animate(withDuration: 0.4, delay: 2.2, options: [], animations: { box.alpha = 0 }, completion: { _ in box.removeFromSuperview() })
        })
    }
}
