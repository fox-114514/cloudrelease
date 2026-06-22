# StudyShot Relay Desktop

Electron + TypeScript desktop receiver for Windows and Linux.

## Current MVP

- Preview the target member before registering with a bind code.
- Bind directly with an owner or member account without persisting the temporary user JWT.
- Display the bound member, safe-use profile, and effective server permissions.
- Refresh effective permissions at startup and periodically; stop upload/receive when the server denies them.
- Watch a local directory and automatically upload new images.
- Exclude selected child directories; exclusions include all descendants.
- Store the device token with Electron `safeStorage` when available.
- Connect to `/api/v1/ws` with the device token.
- Send `hello` and heartbeat `ping`.
- Reconnect with exponential backoff, capped at 60 seconds.
- Ask before receiving deliveries accumulated while the device was offline.
- Download images to a configured local folder.
- Verify downloaded image sha256 before ACK.
- ACK `downloaded` or `failed`.
- Optionally write the downloaded image to the system clipboard.
- Optionally show a system notification after a successful download.
- Save files as `<upload-device>_YYYYMMDD-HHMMSS.ext` and suffix collisions.
- Allow received and watched-upload history entries to be hidden or cleared locally.
- Save receive settings locally.
- Enable or disable OS login startup.
- Run in the system tray.
- Hide the window to tray when closed.
- Pause or resume auto receive from the tray menu.
- Persist recent receive history locally.
- Re-copy a received image to the clipboard.
- Locate a received image in the file manager.
- Log in to an in-memory owner/member management session.
- List devices allowed by the current account role.
- Rename devices.
- Update device permissions.
- Revoke devices.

## Commands

```bash
npm install
npm run build
npm start
```

Packaging commands:

```bash
npm run package:linux
npm run package:win
```

## Local Data

Electron stores app data under its `userData` directory.

Stored settings include:

- server base URL
- device ID
- encrypted device token when `safeStorage` is available
- bound user summary, device profile, and last known effective permissions
- download directory
- watch directory and excluded child directories
- auto upload setting
- auto receive setting
- copy-to-clipboard setting
- notification setting
- start-at-login setting
- recent receive history

The renderer process never receives the device token.

## Manual Verification

1. Start the backend.
2. Ensure a desktop device has `canAutoReceive = true`.
3. Start this app with `npm start`.
4. Bind with the current member account, or paste a bind code and confirm its preview.
5. Select a safe device profile and bind the device.
6. Upload an image from an authorized device.
7. Confirm the desktop app downloads it into the selected folder.
8. Confirm the server delivery is ACKed.
9. If clipboard is enabled, confirm the image can be pasted into a target app.
10. Add a child directory to the exclusion list and confirm images below it are ignored while sibling directories still upload.

## Current Limits

- User and group management UI is not implemented yet.
- Delivery retry from the history page is not implemented yet. The current backend excludes `failed` deliveries from automatic download authorization, so retry needs a backend rule change first.
- Linux clipboard behavior still needs verification on the target desktop session, especially Wayland.
- Login startup needs verification on the target Windows and Linux desktop sessions.
