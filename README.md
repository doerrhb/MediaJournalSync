# Media Journal Sync — Desktop App

Double-click `Media Journal Sync.exe` to launch. That's it.

---

## First-time setup (one minute)

### 1. Install Node.js
Download from https://nodejs.org (LTS version). Just click through the installer.

### 2. Install dependencies
Open a terminal in this folder and run:
```
npm install
```

### 3. Configure the app
Launch the app (`npm start`) and go to **Settings**:

- **Diary URLs** — your personal URLs for each site (pre-filled with defaults)
- **Image Save Location** — click Browse and pick a folder (e.g. your MediaJournal folder)
- **Google Sheets** — paste your Apps Script URL (see below), enter your tab names exactly
- **GitHub** — browse to your local repo folder if you want auto-push

### 4. Log in to each site (once)
On the Scan tab, click **🔑 Log in / Open** next to each site. A real browser window opens. Log in normally. Close it when done. The session is saved permanently — you won't need to do this again.

---

## Daily use

1. Run `Media Journal Sync.exe`  (or `npm start` during development)
2. Click **▶ Scan All Sites**
3. Review the entries that appear — edit anything that looks wrong
4. Click **⬆ Update All Approved**

Done. Images saved, Sheets updated, GitHub pushed.

---

## Building the .exe

```
npm run build:win
```

The installer appears in `dist/`. Run it once and the app installs like any normal program — Start Menu shortcut included. Future updates: rebuild and run the new installer.

For Mac: `npm run build:mac`
For Linux: `npm run build:linux`

---

## Google Sheets setup

1. Open your Google Sheet → **Extensions → Apps Script**
2. Paste this code (replaces everything):

```javascript
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(data.tab);
    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: 'Tab "' + data.tab + '" not found. Check your tab name in Settings.'
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Duplicate check on title + date
    if (data.row && data.row.length >= 2) {
      var rows = sheet.getDataRange().getValues();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][0].toString().trim().toLowerCase() === data.row[0].toString().trim().toLowerCase() &&
            rows[i][1].toString().trim()               === data.row[1].toString().trim()) {
          return ContentService
            .createTextOutput(JSON.stringify({success: true, skipped: true}))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
    sheet.appendRow(data.row);
    return ContentService
      .createTextOutput(JSON.stringify({success: true, skipped: false}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({success: false, error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. **Deploy → New deployment → Web app**
4. Execute as: **Me** | Access: **Anyone**
5. Copy the Web app URL into the app's Settings → Google Sheets

---

## File structure

```
mediasync/
  main.js          — Electron main process
  preload.js       — Secure IPC bridge
  config.js        — Site configs (same as extension)
  scraper.js       — Scraping logic (same as extension)
  renderer/
    index.html     — App UI
    app.js         — UI logic
  assets/
    icon.png       — App icon (add your own 512×512 PNG)
  package.json
  README.md
```

---

## Notes

- **Sessions persist** between app launches. You only need to log in to each site once.
- **Nothing is sent anywhere** except to your own Google Sheet and your own GitHub repo.
- **Settings** are stored in your OS user data folder (AppData on Windows) and survive app updates.
- The scraper reuses the exact same `config.js` and `scraper.js` as the Firefox extension.
  Any selector fixes you make apply to both automatically.
