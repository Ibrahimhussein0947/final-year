# EthioTalent AI – Android app (Capacitor wrapper)

A thin Android shell that opens the **hosted website**. It does not contain the web code, so the website's `/api` calls and its httpOnly cookie keep working, and website updates reach users without a new release.

## Build a test APK
Needs Android Studio (SDK). Use its bundled Java (Java 25 is too new for this Gradle): set JAVA_HOME to "C:Program FilesAndroidAndroid Studiojbr" and run `android/gradlew.bat assembleDebug` for a command-line build (first build about 8 minutes).
```bash
cd apps/mobile
APP_URL=https://your-domain.example npx cap sync android
npx cap open android      # Android Studio: Build > Build APK(s)
```
Without `APP_URL` the app shows a placeholder page. `APP_URL` must be https and reachable from the phone.

## Publish to Google Play (not done)
Needs a Google Play developer account (one-time fee), a signing key (keep it private, never commit it), a store listing, a privacy policy URL and review. Google may reject apps that are only a website wrapper without added value; adding native features (push notifications, camera upload) helps.

## Not included
iOS (needs a Mac, Xcode and a paid Apple developer account; Apple often rejects pure website wrappers), push notifications, app icons/splash from the brand (default Capacitor icons are used – replace with `pwa-512x512.png`), any testing on a device.
