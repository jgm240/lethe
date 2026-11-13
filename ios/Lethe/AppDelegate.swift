import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = Theme.bg
        w.rootViewController = BrowserViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

enum Theme {
    static let bg = UIColor(red: 0.055, green: 0.063, blue: 0.188, alpha: 1)
    static let bar = UIColor(red: 0.090, green: 0.100, blue: 0.270, alpha: 1)
    static let field = UIColor(red: 0.140, green: 0.150, blue: 0.360, alpha: 1)
    static let accent = UIColor(red: 0.620, green: 0.540, blue: 0.980, alpha: 1)
    static let papyrus = UIColor(red: 0.950, green: 0.870, blue: 0.720, alpha: 1)
    static let muted = UIColor(white: 1, alpha: 0.6)

    static func style(_ nav: UINavigationController) {
        nav.navigationBar.barStyle = .black
        nav.navigationBar.barTintColor = bar
        nav.navigationBar.tintColor = accent
        nav.navigationBar.isTranslucent = false
    }
}
