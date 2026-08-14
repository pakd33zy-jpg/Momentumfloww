# Build the MomentumFlow Android phone app

This repository is configured to produce an installable Android APK automatically with GitHub Actions.

## Fast path
1. Upload this project to a GitHub repository.
2. Open **Actions** -> **Build MomentumFlow Android APK** -> **Run workflow**.
3. When the workflow finishes, download the artifact named **MomentumFlow-Android-APK**.
4. Extract it and install `MomentumFlow.apk` on your Android phone.

## Backend address
The app supports two ways to point at the MomentumFlow backend:

- Recommended: add a GitHub Actions repository secret named `MOMENTUMFLOW_API_URL` containing the HTTPS backend URL before building.
- Or build without that secret and set the backend URL from **Settings -> App connection** inside the phone app.

The Node/Express backend must be hosted on HTTPS for the phone build to use the trading/session APIs. Keep `LIVE_TRADING_ENABLED=false` until paper testing is complete.
