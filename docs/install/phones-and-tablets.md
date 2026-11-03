# Hearth on phones and tablets

[← Installing Hearth](README.md)

The Hearth app for Android, iPhone and iPad connects to **your own Hearth**, whether it runs in the desktop app, on a household server, in Docker or in Home Assistant. Your money stays on that computer; the app shows it.

**Before you start:** Hearth needs to be running somewhere phones can reach. In the desktop app that's **This computer and my phone** or **Our household server**. A **Just me** setup is private to the computer, so phones can't reach it. Change it from the Hearth menu → **Change setup…**.

## Android (phones and tablets)

1. On the phone, open the [downloads page](https://github.com/shotgn16/hearth/releases/latest) and tap `Hearth-<version>-android.apk` to download it.
2. Open the download (from the notification, or the **Files** app → Downloads).
3. If Android says your phone isn't allowed to install unknown apps from this source, tap **Settings**, turn on **Allow from this source**, and go back.
4. Tap **Install**, then **Open**.
   If **Play Protect** warns that it doesn't recognise the app, tap **More details → Install anyway**. This happens because Hearth isn't in the Play Store.

Needs Android 7 or newer. To update, install a newer APK the same way. Your connection is kept.

## iPhone and iPad

Apple only allows apps from the App Store unless you install them yourself with an Apple ID. There are three ways. The first is the easiest and works for most people.

### Option A: add Hearth to your Home Screen (no app needed, recommended)

1. On the computer, open Hearth → **Settings → Phones & devices**, and switch the QR code to **Browser**.
2. Point the iPhone's camera at the code and tap the link. Hearth opens in Safari.
3. Tap the **Share** button → **Add to Home Screen** → **Add**.

Hearth now has its own icon and opens full screen, like an app. Everything works the same.

### Option B: install the Hearth app with Sideloadly or AltStore

This installs the real Hearth app using your own Apple ID. You need a Mac or Windows computer and a USB cable.

1. Download `Hearth-<version>-ios-unsigned.ipa` from the [downloads page](https://github.com/shotgn16/hearth/releases/latest).
2. Install [Sideloadly](https://sideloadly.io) (Mac or Windows) or [AltStore](https://altstore.io).
3. Connect the iPhone or iPad with a cable and unlock it. Tap **Trust** if asked.
4. Drag the `.ipa` into Sideloadly, enter your Apple ID, and press **Start**.
5. On the iPhone: **Settings → General → VPN & Device Management** → your Apple ID → **Trust**.
6. iOS 16 and newer: **Settings → Privacy & Security → Developer Mode → On** (the phone restarts).

With a free Apple ID the app has to be refreshed every 7 days (AltStore can do it automatically over Wi-Fi). With a paid Apple Developer account it lasts a year.

### Option C: build it yourself with Xcode (Mac only)

For people comfortable with developer tools: see [Building the apps yourself](../building.md#iphone-and-ipad).

## Connect the app to your Hearth

1. On the computer, open Hearth → **Settings → Phones & devices** (in the desktop app you can also use the Hearth menu → **Connect a phone…**).
2. On the phone, open the Hearth app and tap **Scan the QR code**, then point it at the code. Or scan the code with the phone's own camera and tap the link; it opens the app and connects.
3. Sign in with **your own** Hearth email and password. Each person in the household has their own login; add people under **Settings → People & household**.

From then on, the app opens straight into Hearth.

**Typing the address instead:** it's shown under the QR code, e.g. `192.168.1.20:8484`.

**More than one Hearth?** Tap your initial (top right) → **Switch server** to choose another, or add a new one.

## Using it away from home

Phones reach Hearth over your home Wi-Fi. When you're out, the simplest safe way is a private VPN such as [Tailscale](https://tailscale.com) (free for personal use):

1. Install Tailscale on the computer running Hearth and on your phone, signed in to the same account.
2. In Hearth, **Settings → Phones & devices** then also lists a *VPN* address (starting `100.`). Connect the app to that one, or add it as a second Hearth.

Don't open Hearth's port to the internet on your router. If you run Hearth in Home Assistant, the **Home Assistant app** already works away from home (via Nabu Casa or your own remote access), and Hearth is in its sidebar.

## Problems

| Problem | Fix |
|---|---|
| "No answer from …" | Is the computer with Hearth on and awake? Is the phone on the same Wi-Fi (not mobile data)? Some routers keep "guest" Wi-Fi separate from the rest of the network. |
| It worked, then stopped | The computer's address may have changed. Use **Phones & devices** again, or give the computer a fixed address in your router (a *DHCP reservation*). |
| "That is Home Assistant itself" | For Home Assistant, set a port on the add-on's **Configuration → Network** (e.g. 8484) and connect to that. Or use the Home Assistant app, where Hearth is in the sidebar. |
| iPhone: nothing happens after scanning | Allow **Local Network** for Hearth: **Settings → Privacy & Security → Local Network**. |
| Camera doesn't open in the app | Allow the camera in the phone's Settings → Hearth, or scan with the phone's camera app instead. |
| iPhone app stopped opening after a week | Free Apple IDs need the app refreshed every 7 days: open AltStore or Sideloadly and refresh it. Or use Option A. |
