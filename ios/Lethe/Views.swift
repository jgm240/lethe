import UIKit

/// New-tab page, shown over the web view while a tab is empty.
final class StartView: UIView {
    override class var layerClass: AnyClass { return CAGradientLayer.self }

    override init(frame: CGRect) {
        super.init(frame: frame)
        if let g = layer as? CAGradientLayer {
            g.colors = [
                UIColor(red: 0.09, green: 0.10, blue: 0.34, alpha: 1).cgColor,
                UIColor(red: 0.36, green: 0.23, blue: 0.53, alpha: 1).cgColor,
                UIColor(red: 0.12, green: 0.12, blue: 0.40, alpha: 1).cgColor,
                UIColor(red: 0.04, green: 0.10, blue: 0.25, alpha: 1).cgColor
            ]
            g.locations = [0, 0.5, 0.52, 1]
        }
        let title = UILabel()
        title.text = "Λήθη"
        title.font = UIFont(name: "Times New Roman", size: 54) ?? UIFont.systemFont(ofSize: 54, weight: UIFont.Weight.bold)
        title.textColor = Theme.papyrus
        let tag = UILabel()
        tag.text = "Forget instantly."
        tag.font = UIFont.systemFont(ofSize: 18)
        tag.textColor = UIColor(white: 1, alpha: 0.85)
        let sub = UILabel()
        sub.text = "Trackers blocked · HTTPS upgraded\nType in the bar above to search privately"
        sub.numberOfLines = 0
        sub.textAlignment = .center
        sub.font = UIFont.systemFont(ofSize: 14)
        sub.textColor = Theme.muted
        let stack = UIStackView(arrangedSubviews: [title, tag, sub])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -30),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

/// The river animation shown by Eject to Lethe.
final class EjectOverlay: UIView {
    static func play(in host: UIView) {
        let o = EjectOverlay(frame: host.bounds)
        o.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        o.backgroundColor = Theme.bg
        o.alpha = 0
        host.addSubview(o)
        UIView.animate(withDuration: 0.25, animations: { o.alpha = 1 }, completion: { _ in
            o.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.9) {
                UIView.animate(withDuration: 0.45, animations: { o.alpha = 0 }, completion: { _ in o.removeFromSuperview() })
            }
        })
    }

    private func wave(width: CGFloat, height: CGFloat, base: CGFloat, amp: CGFloat, length: CGFloat) -> CGPath {
        let p = UIBezierPath()
        p.move(to: CGPoint(x: 0, y: height))
        p.addLine(to: CGPoint(x: 0, y: base))
        var x: CGFloat = 0
        while x <= width {
            p.addLine(to: CGPoint(x: x, y: base + sin(x / length * 2 * CGFloat.pi) * amp))
            x += 4
        }
        p.addLine(to: CGPoint(x: width, y: height))
        p.close()
        return p.cgPath
    }

    private func run() {
        let w = bounds.width, h = bounds.height
        let colors: [UIColor] = [
            UIColor(red: 0.36, green: 0.25, blue: 0.55, alpha: 0.9),
            UIColor(red: 0.20, green: 0.20, blue: 0.50, alpha: 0.95),
            UIColor(red: 0.08, green: 0.12, blue: 0.32, alpha: 1)
        ]
        for i in 0..<3 {
            let layer = CAShapeLayer()
            layer.frame = CGRect(x: 0, y: 0, width: w * 2, height: h)
            layer.path = wave(width: w * 2, height: h, base: h * (0.50 + CGFloat(i) * 0.09), amp: 10 + CGFloat(i) * 4, length: w / 2)
            layer.fillColor = colors[i].cgColor
            self.layer.addSublayer(layer)
            let a = CABasicAnimation(keyPath: "transform.translation.x")
            a.fromValue = 0
            a.toValue = -w
            a.duration = 3.2 - Double(i) * 0.6
            a.repeatCount = .infinity
            layer.add(a, forKey: "flow")
        }
        // A scroll drifting down the river and sinking.
        let scroll = CALayer()
        scroll.bounds = CGRect(x: 0, y: 0, width: 64, height: 22)
        scroll.cornerRadius = 10
        scroll.backgroundColor = Theme.papyrus.cgColor
        scroll.position = CGPoint(x: -40, y: h * 0.52)
        self.layer.addSublayer(scroll)
        let move = CAKeyframeAnimation(keyPath: "position")
        move.values = [CGPoint(x: -40, y: h * 0.52), CGPoint(x: w * 0.45, y: h * 0.50), CGPoint(x: w + 40, y: h * 0.56)].map { NSValue(cgPoint: $0) }
        move.duration = 1.9
        move.isRemovedOnCompletion = false
        move.fillMode = .forwards
        scroll.add(move, forKey: "drift")
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1
        fade.toValue = 0
        fade.beginTime = CACurrentMediaTime() + 1.1
        fade.duration = 0.8
        fade.isRemovedOnCompletion = false
        fade.fillMode = .forwards
        scroll.add(fade, forKey: "sink")

        let label = UILabel()
        label.text = "Λήθη"
        label.font = UIFont(name: "Times New Roman", size: 46) ?? UIFont.systemFont(ofSize: 46, weight: UIFont.Weight.bold)
        label.textColor = Theme.papyrus
        label.sizeToFit()
        label.center = CGPoint(x: w / 2, y: h * 0.28)
        addSubview(label)
    }
}

/// One simple list used for tabs, bookmarks and history.
final class ListViewController: UITableViewController {
    var items: [Entry] = []
    var emptyText = "Nothing here"
    var onSelect: ((Int) -> Void)?
    var onDelete: ((Int) -> Void)?
    var onClear: (() -> Void)?
    var onAdd: (() -> Void)?
    var addTitle = "New"

    init(title: String) {
        super.init(style: .plain)
        self.title = title
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.backgroundColor = Theme.bg
        tableView.separatorColor = UIColor(white: 1, alpha: 0.12)
        tableView.tableFooterView = UIView()
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(done))
        if onAdd != nil {
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: addTitle, style: .plain, target: self, action: #selector(add))
        } else if onClear != nil {
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Clear", style: .plain, target: self, action: #selector(clear))
        }
        refreshEmpty()
    }

    private func refreshEmpty() {
        if items.isEmpty {
            let l = UILabel()
            l.text = emptyText
            l.textAlignment = .center
            l.textColor = Theme.muted
            tableView.backgroundView = l
        } else {
            tableView.backgroundView = nil
        }
    }

    @objc private func done() { dismiss(animated: true, completion: nil) }
    @objc private func add() { dismiss(animated: true) { self.onAdd?() } }
    @objc private func clear() {
        onClear?()
        items = []
        tableView.reloadData()
        refreshEmpty()
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { return items.count }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "c") ?? UITableViewCell(style: .subtitle, reuseIdentifier: "c")
        let e = items[indexPath.row]
        cell.backgroundColor = Theme.bg
        cell.textLabel?.textColor = .white
        cell.textLabel?.text = e.title.isEmpty ? e.url : e.title
        cell.detailTextLabel?.textColor = Theme.muted
        cell.detailTextLabel?.text = e.url
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let i = indexPath.row
        dismiss(animated: true) { self.onSelect?(i) }
    }

    override func tableView(_ tableView: UITableView, canEditRowAt indexPath: IndexPath) -> Bool { return onDelete != nil }

    override func tableView(_ tableView: UITableView, commit editingStyle: UITableViewCell.EditingStyle, forRowAt indexPath: IndexPath) {
        guard editingStyle == .delete else { return }
        onDelete?(indexPath.row)
        items.remove(at: indexPath.row)
        tableView.deleteRows(at: [indexPath], with: .automatic)
        refreshEmpty()
    }
}

enum Dialogs {
    /// The confirmation shown before the Canal to Lethe is opened.
    static func confirmCanal(from vc: UIViewController, onYes: @escaping () -> Void, onNo: (() -> Void)? = nil) {
        let a = UIAlertController(
            title: "Open the Canal to Lethe?",
            message: "Closes every tab and erases your history and site data now. From then on each tab gets its own temporary storage that is destroyed when the tab closes, and no history is saved.",
            preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Open the Canal", style: .destructive) { _ in onYes() })
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in onNo?() })
        vc.present(a, animated: true, completion: nil)
    }
}

final class SettingsViewController: UITableViewController {
    private enum Row {
        case toggle(String, String, () -> Bool, (Bool) -> Void)
        case button(String, () -> Void)
        case info(String, String)
    }

    var onEject: (() -> Void)?
    var onCanalOpened: (() -> Void)?
    private var sections: [(String, [Row])] = []

    init() { super.init(style: .grouped); title = "Settings" }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.backgroundColor = Theme.bg
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(done))
        let p = Prefs.shared
        let forgetting: [Row] = [
            Row.toggle("Canal to Lethe", "Nothing is kept. Each tab uses temporary storage destroyed when it closes, and no history is saved.",
                       { return p.canal }, { [weak self] (on: Bool) in self?.setCanal(on) }),
            Row.button("Eject to Lethe…", { [weak self] in self?.onEject?() }),
            Row.toggle("Ask before ejecting", "", { return p.confirmEject }, { (v: Bool) in p.confirmEject = v }),
            Row.toggle("River animation", "", { return p.animation }, { (v: Bool) in p.animation = v })
        ]
        let protection: [Row] = [
            Row.toggle("Upgrade to HTTPS", "Loads sites securely when they support it.", { return p.httpsUpgrade }, { (v: Bool) in p.httpsUpgrade = v }),
            Row.toggle("Block trackers", "Applies to tabs you open from now on (iOS 11 and later).", { return p.blockTrackers }, { (v: Bool) in p.blockTrackers = v }),
            Row.toggle("Remove tracking parameters", "Strips utm_*, fbclid, gclid and similar from links.", { return p.stripParams }, { (v: Bool) in p.stripParams = v }),
            Row.toggle("Save browsing history", "Always off while the Canal is open.", { return p.saveHistory }, { (v: Bool) in p.saveHistory = v })
        ]
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let about: [Row] = [
            Row.info("Lethe", "Λήθη — forget instantly"),
            Row.info("Search", "DuckDuckGo"),
            Row.info("Version", version)
        ]
        sections = [("Forgetting", forgetting), ("Protection", protection), ("About", about)]
    }

    private func setCanal(_ on: Bool) {
        if on {
            Dialogs.confirmCanal(from: self, onYes: { [weak self] in
                Prefs.shared.canal = true
                self?.onCanalOpened?()
            }, onNo: { [weak self] in self?.tableView.reloadData() })
        } else {
            Prefs.shared.canal = false
        }
    }

    @objc private func done() { dismiss(animated: true, completion: nil) }

    override func numberOfSections(in tableView: UITableView) -> Int { return sections.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { return sections[section].1.count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { return sections[section].0 }

    override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
        (view as? UITableViewHeaderFooterView)?.textLabel?.textColor = Theme.muted
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.backgroundColor = Theme.bar
        cell.textLabel?.textColor = .white
        cell.detailTextLabel?.textColor = Theme.muted
        cell.detailTextLabel?.numberOfLines = 0
        cell.selectionStyle = .none
        switch sections[indexPath.section].1[indexPath.row] {
        case let .toggle(name, note, get, set):
            cell.textLabel?.text = name
            cell.detailTextLabel?.text = note.isEmpty ? nil : note
            let sw = UISwitch()
            sw.isOn = get()
            sw.onTintColor = Theme.accent
            let handler = ToggleTarget(set)
            sw.addTarget(handler, action: #selector(ToggleTarget.changed(_:)), for: .valueChanged)
            objc_setAssociatedObject(sw, &ToggleTarget.key, handler, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            cell.accessoryView = sw
        case let .button(name, _):
            cell.textLabel?.text = name
            cell.textLabel?.textColor = UIColor(red: 1, green: 0.45, blue: 0.4, alpha: 1)
            cell.selectionStyle = .default
        case let .info(name, value):
            cell.textLabel?.text = name
            cell.detailTextLabel?.text = value
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if case let .button(_, run) = sections[indexPath.section].1[indexPath.row] { run() }
    }
}

private final class ToggleTarget: NSObject {
    static var key = 0
    let set: (Bool) -> Void
    init(_ set: @escaping (Bool) -> Void) { self.set = set }
    @objc func changed(_ sender: UISwitch) { set(sender.isOn) }
}
