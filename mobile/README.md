# Teebox for iOS

An iPhone/iPad app that runs the Teebox golf game from this repo. It wraps the browser game in
`../public` with [Capacitor](https://capacitorjs.com) (a native `WKWebView` shell), so the game code stays
in one place. Nothing is copied by hand: `npm run sync` rebuilds the app's web assets from `../public`
and layers a small iOS overlay on top (`mobile-src/`).

The app opens on a home screen with two paths over the same physics and course engine:

- **Play** (game path): course-first. A slim hole bar shows hole, par, yardage to pin and round score; Tapping Play opens a course picker first. Course, hole, tees and conditions live behind the ☰ menu, which also has Courses to switch. Game mode is locked on.
- **Simulator**: the full panel (driving range, launch-monitor status, conditions, shot table). Pick **Game mode** in the panel at any time to play from here; the simulator remembers its own mode and scene separately from the Play path.

In game mode, pick a club, set your aim, then pull down on the swing pad and push back up.
Course data is bundled, so it works fully offline. Launch-monitor input (the Node server) is a desktop feature
and is not part of the app.

## Requirements

- macOS with **Xcode 15+** (built and tested with Xcode 27 / iOS 26 simulator)
- **Node.js 18+**
- No CocoaPods needed; Capacitor uses Swift Package Manager.
- Running on a real device needs a free Apple ID added in Xcode (Settings → Accounts).

## Install and run

```sh
cd mobile
npm install
npm run sync      # copies ../public into www/ and into the Xcode project
npm run open      # opens ios/App/App.xcodeproj in Xcode
```

In Xcode, choose an iPhone simulator (or your device) at the top and press **Run** (⌘R).

### Real device

1. Plug in the iPhone, enable Developer Mode (Settings → Privacy & Security).
2. In Xcode select the **App** target → **Signing & Capabilities**, tick *Automatically manage signing*,
   and pick your Team. Change the bundle identifier (`com.teebox.golf`) if Apple says it is taken.
3. Select your device and Run. First launch: trust the developer in Settings → General → VPN & Device Management.

### Command line build (simulator)

```sh
cd mobile/ios/App
xcodebuild -scheme App -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## After changing the game

Edit files in `../public` as usual, then run `npm run sync` in `mobile/` and rebuild in Xcode.
`www/` and `ios/App/App/public/` are generated; don't edit them.

## What differs from the browser

| Area | iOS app |
| --- | --- |
| Layout | Safe-area aware, portrait or landscape, no pinch zoom |
| Navigation | Home screen with Play / Simulator paths; ☰ menu in Play returns home or switches to Simulator |
| Hidden | Server/launch-monitor status, CSV export, Courses importer page |
| Feedback | Haptic tick on touch-down and a thump on swing release |
| Swinging | A **Shot** button (bottom right) locks in club and aim. Tapping it dims the scene and centres a large swing pad; Cancel backs out, and it closes by itself once the ball is hit. Pull distance is scaled to the pad, so the bottom of the pad is full power |
| Aiming | Drag across the scene to aim (replaces the slider); a top-right preview shows the ground around your expected landing zone: ball at the bottom, aim line straight up, zoom set by the selected club, and the flag drawn where the pin really is (or on the edge, pointing toward it, when it is off the map) (slightly see-through so the scene shows behind it). When you hit, the ball's track is drawn on it live and the carry and total are shown; the range gets a distance radar |
| Wording | "Mouse" text becomes "Touch" |

The overlay lives in `mobile-src/mobile.css`, `mobile-src/mobile.js`, and the patching in `scripts/sync-web.js`.

## Tests

```sh
npm test
```

## Layout

```
mobile/
  capacitor.config.json   app id, name, web dir
  scripts/sync-web.js     builds www/ from ../public + overlay
  mobile-src/             iOS-only CSS/JS
  ios/                    generated Xcode project (committed)
  www/                    generated, git-ignored
```

## Troubleshooting

- **Blank screen on first launch in the simulator:** wait a few seconds, or relaunch.
- **Stale game after edits:** you skipped `npm run sync`.
- **Signing error on device:** set a Team and unique bundle id (above).
