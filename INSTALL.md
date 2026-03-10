# Media Journal Sync — Permanent Firefox Installation Guide

## The Problem
Loading via `about:debugging → Load Temporary Add-on` only lasts until Firefox restarts.
Firefox requires extensions to be **signed by Mozilla** to install permanently — *unless* you
use **Firefox Developer Edition**, which lets you bypass signing for personal/local extensions.

---

## Step 1 — Install Firefox Developer Edition (one-time)

Download from: https://www.mozilla.org/en-US/firefox/developer/

This is a separate Firefox profile from your regular Firefox. You can run both side by side.
All your regular Firefox bookmarks, logins, etc. are unaffected.

---

## Step 2 — Allow Unsigned Extensions (one-time, in Dev Edition only)

1. Open Firefox Developer Edition
2. Navigate to `about:config` in the address bar
3. Accept the warning
4. Search for: `xpinstall.signatures.required`
5. Double-click it to set it to **`false`**

> ⚠️ This setting only works in Firefox Developer Edition and Firefox Nightly.
> It has no effect in regular Firefox (it will revert to true and be ignored).

---

## Step 3 — Package the Extension as a .xpi File

A `.xpi` file is just a renamed ZIP of your extension folder.

### On Windows:
1. Select all files inside your extension folder (not the folder itself — select the contents):
   `config.js`, `scraper.js`, `background.js`, `popup.html`, `popup.js`,
   `options.html`, `options.js`, `manifest.json`, `icon128.png`
2. Right-click → **Send to → Compressed (zipped) folder**
3. Rename the resulting `Archive.zip` to `media-journal-sync.xpi`

### On Mac:
Open Terminal inside your extension folder and run:
```
zip -r media-journal-sync.xpi . -x "*.DS_Store" -x "__MACOSX/*"
```

### On Linux:
```
zip -r media-journal-sync.xpi . --exclude="*.git*"
```

---

## Step 4 — Install the .xpi Permanently

1. Open Firefox Developer Edition
2. Go to `about:addons` (or ☰ Menu → Add-ons and Themes)
3. Click the gear icon ⚙ → **Install Add-on From File…**
4. Select your `media-journal-sync.xpi`
5. Click **Add** on the confirmation dialog

The extension will now appear in your toolbar and survive all Firefox restarts. ✓

---

## Step 5 — After Making Code Changes

Whenever you edit any extension files, you need to repackage and reinstall:

1. Delete the old `.xpi` file
2. Repackage (Step 3)
3. Go to `about:addons` → find Media Journal Sync → click the three dots → **Remove**
4. Reinstall (Step 4)

> **Tip:** Your extension settings (Sheets URL, tab names, diary URLs) are stored in
> Firefox's local storage and survive uninstall/reinstall as long as you don't clear
> browser data.

---

## Alternative: Keep Using about:debugging (No Dev Edition Needed)

If you prefer to stay on regular Firefox:

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Navigate into your extension folder and select `manifest.json`

You'll need to redo this after each Firefox restart, but your stored settings persist.
Create a desktop shortcut to `about:debugging` to make this faster.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "This add-on could not be installed because it appears to be corrupt" | Make sure you zipped the *contents* of the folder, not the folder itself. Open the zip and verify `manifest.json` is at the root level. |
| Extension installs but doesn't appear in toolbar | Right-click the toolbar → Customize → drag the Media Journal Sync icon into the toolbar |
| Settings lost after reinstall | This shouldn't happen — settings are stored by extension ID. If it does, re-enter them in ⚙ Settings. |
| "xpinstall.signatures.required" setting reverts | You're on regular Firefox, not Developer Edition. This flag is locked to `true` in release Firefox. |
