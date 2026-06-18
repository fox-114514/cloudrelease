# StudyShot Relay Desktop

Electron + TypeScript desktop receiver for Windows and Linux.

## Current MVP

- Register this computer with a server bind code.
- Create a bind code by logging in as the owner user.
- Store the device token with Electron `safeStorage` when available.
- Connect to `/api/v1/ws` with the device token.
- Send `hello` and heartbeat `ping`.
- Reconnect with exponential backoff, capped at 60 seconds.
- Fetch pending deliveries after connection.
- Download images to a configured local folder.
- Verify downloaded image sha256 before ACK.
- ACK `downloaded` or `failed`.
- Optionally write the downloaded image to the system clipboard.
- Optionally show a system notification after a successful download.
- Save receive settings locally.
- Enable or disable OS login startup.
- Run in the system tray.
- Hide the window to tray when closed.
- Pause or resume auto receive from the tray menu.
- Persist recent receive history locally.
- Re-copy a received image to the clipboard.
- Locate a received image in the file manager.
- Log in to an in-memory owner/admin session.
- List devices in the owner space.
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
- download directory
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
4. Log in as the owner and generate a bind code, or paste an existing bind code.
5. Bind the device.
6. Upload an image from an authorized device.
7. Confirm the desktop app downloads it into the selected folder.
8. Confirm the server delivery is ACKed.
9. If clipboard is enabled, confirm the image can be pasted into a target app.

## Current Limits

- User and group management UI is not implemented yet.
- Delivery retry from the history page is not implemented yet. The current backend excludes `failed` deliveries from automatic download authorization, so retry needs a backend rule change first.
- Linux clipboard behavior still needs verification on the target desktop session, especially Wayland.
- Login startup needs verification on the target Windows and Linux desktop sessions.
