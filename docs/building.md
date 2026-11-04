# Building the apps yourself

[← Documentation](../README.md#documentation)

Most people should use the ready-made downloads. This guide is for publishing your own releases, signing the apps with your own certificates, or building one piece on your own computer.

## Releasing (everything at once, on GitHub)

`.github/workflows/release.yml` builds and tests every download on GitHub's machines: macOS, Windows and Linux installers, the Hearth Server bundles, the Android APK, the iPhone/iPad app and the Docker images.

```bash
node tools/set-version.js 1.7.0
# add a "## 1.7.0" section at the top of hearth/CHANGELOG.md
git commit -am "1.7.0" && git tag v1.7.0 && git push && git push --tags
```

A tag creates a **draft** release with every file attached and notes taken from the changelog. Check it, then press **Publish release**. Once it's published, desktop apps offer the update, and Home Assistant offers it once the Docker images are public.

- Pushing to a `release/…` branch, or running the workflow from the **Actions** tab, builds and tests everything without publishing. The files are under the run's **Artifacts**.
- The first time the Docker images are published, make them public: GitHub → your profile → **Packages** → `hearth`, `hearth-amd64`, `hearth-aarch64` → **Package settings** → **Change visibility** → **Public**.

### What the workflow checks

| Check | How |
|---|---|
| Versions match | `tools/set-version.js --check` |
| Server, desktop and phone-app logic | `npm test` in `server/`, `desktop/`, `mobile/` |
| Each packaged desktop app starts | Runs it with `--smoke-test`: it starts the bundled server and loads the web app |
| The household server works | Installs it as a real systemd / launchd / Windows service, waits for it to answer, removes it |
| macOS signatures | `codesign --verify` on the app and the bundled Node.js |
| Android APK | `apksigner verify`, version and contents |
| iPhone/iPad app | Built for devices; version and web files checked |
| Docker images | Started on amd64 and arm64 and asked for the web app |

## Signing (optional)

Everything builds without signing, but people see more warnings when they install. Add any of these as **repository secrets** (GitHub → Settings → Secrets and variables → Actions):

### Android: always use the same key

Android only installs an update if it's signed with the **same key** as the version already installed. Without your own key, each build is signed with a new temporary one, so people have to uninstall before updating. Create a key once:

```bash
keytool -genkeypair -keystore hearth-release.jks -alias hearth -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Hearth"
base64 -w0 hearth-release.jks > hearth-release.jks.b64      # macOS: base64 -i hearth-release.jks
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `hearth-release.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the password you chose |
| `ANDROID_KEY_ALIAS` | `hearth` |

**Keep `hearth-release.jks` and its password somewhere safe**, such as a password manager. If you lose them, you can't publish updates to the same app.

### macOS: no "can't be verified" warning

Needs an [Apple Developer](https://developer.apple.com/programs/) membership (yearly fee). Export your **Developer ID Application** certificate as a `.p12`.

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | the `.p12`, base64-encoded |
| `MAC_CSC_KEY_PASSWORD` | its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | for notarisation ([app-specific password](https://account.apple.com)) |

Without these, the Mac app is "ad-hoc" signed: it runs, but people have to choose **Open Anyway** once ([macOS guide](install/macos.md#3-open-it-for-the-first-time)).

### Windows: no SmartScreen warning

Needs a code-signing certificate. Set `WIN_CSC_LINK` (the `.pfx`, base64-encoded) and `WIN_CSC_KEY_PASSWORD`.

### iPhone and iPad

To get a signed `.ipa` that installs without Sideloadly or AltStore (through TestFlight, the App Store, or ad-hoc to registered devices), add your **Apple Distribution** certificate and a provisioning profile for `com.shotgn16.hearth` (or your own app ID):

| Secret | Value |
|---|---|
| `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD` | the `.p12` and its password |
| `IOS_PROFILE_BASE64` | the `.mobileprovision`, base64-encoded |
| `APPLE_TEAM_ID` | your team ID |

## Building one piece on your own computer

### Desktop installers

Each platform's installer is built on that platform. You need Node.js 22.13 or newer.

```bash
cd desktop
npm ci
node scripts/prepare-resources.mjs           # downloads Node.js (and WinSW on Windows), bundles the server
npx electron-builder --publish never         # → desktop/dist/
```

`npm start` runs the app from source (run `prepare-resources` first, or add `--local-node` to use your own Node.js).

### Android APK

You need [Android Studio](https://developer.android.com/studio) (or the Android SDK and Java 21).

```bash
cd mobile
npm ci
npm run sync -- android
cd android && ./gradlew assembleRelease      # → app/build/outputs/apk/release/
```

Or `npm run android:open` to open the project in Android Studio and run it on a connected phone. Set `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` to sign the release build. Without a key, Gradle builds an unsigned APK, which phones won't install; use **Build → Generate Signed App Bundle / APK** in Android Studio, or install a debug build (`./gradlew assembleDebug`).

### iPhone and iPad

You need a Mac with [Xcode](https://apps.apple.com/app/xcode/id497799835).

```bash
cd mobile
npm ci
npm run ios:open        # opens the project in Xcode
```

In Xcode:
1. Select the **App** project → **Signing & Capabilities**.
2. Choose your **Team**. A free personal team works for your own devices, but apps signed that way stop opening after 7 days.
3. If Xcode says the bundle identifier is taken, change it (e.g. `com.yourname.hearth`).
4. Connect your iPhone or iPad, select it at the top, and press **Run** (▶).

The same project runs on iPhone and iPad. On Macs with Apple silicon it can run as a Mac app too ("Designed for iPad"), but the [desktop app](install/macos.md) is the better choice there.

### Docker image

```bash
docker build -t hearth ./server
docker run -d -p 8484:8484 -v ./data:/data hearth
```

### Icons

```bash
npx -y playwright@1 install chromium
node tools/make-icons.js      # desktop and phone source icons from server/web/icon.svg
cd mobile && npm run icons    # every Android and iOS size
```
