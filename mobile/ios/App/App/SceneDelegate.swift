import UIKit
import Capacitor

// The Hearth app for iPhone and iPad: it shows your own Hearth server in the app's window.

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
        // hearth://connect?url=… (the QR code on Hearth's Phones & devices screen) while the app is open:
        // go back to the app's connect screen — even if another Hearth is showing — and connect there.
        if let address = URLContexts.lazy.compactMap({ SceneDelegate.connectAddress($0.url) }).first,
           let bridge = window?.rootViewController as? CAPBridgeViewController {
            bridge.webView?.load(URLRequest(url: SceneDelegate.connectPage(address)))
        }
    }

    /// The url=… of a hearth://connect link, if it is an http(s) address
    static func connectAddress(_ link: URL) -> String? {
        guard link.scheme == "hearth", link.host == "connect",
              let url = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value,
              url.hasPrefix("http://") || url.hasPrefix("https://") else { return nil }
        return url
    }

    static func connectPage(_ address: String) -> URL {
        var c = URLComponents(string: "capacitor://localhost/index.html")!
        c.queryItems = [URLQueryItem(name: "connect", value: address)]
        return c.url!
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
