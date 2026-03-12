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
// doGet: ping + lastRow endpoint
// ?action=lastRow&tab=Movies  → returns the last data row from that tab
// (no params)                 → returns { pong: true } for connectivity check
function doGet(e) {
  var params = e ? (e.parameter || {}) : {};

  if (params.action === 'lastRow') {
    try {
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(params.tab);
      if (!sheet) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'Tab not found' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var last = sheet.getLastRow();
      // Row 1 is the header — if only a header exists, no data yet
      if (last < 2) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true, row: null }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var numCols = sheet.getLastColumn();
      var rowData = sheet.getRange(last, 1, 1, numCols).getValues()[0];
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, row: rowData }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Default: ping
  return ContentService
    .createTextOutput(JSON.stringify({ pong: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// doPost: append a data row, return the row number
// Images are named by this row number: row 34 → 0034.png
function doPost(e) {
  try {
    var data  = JSON.parse(e.postData.contents);
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

    // Always append — never modify or remove existing rows
    sheet.appendRow(data.row);
    var rowNumber = sheet.getLastRow();

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, rowNumber: rowNumber }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. **Deploy → New deployment → Web app**
4. Execute as: **Me** | Access: **Anyone**
5. Copy the Web app URL into the app's Settings → Google Sheets

> **Row 1** of each tab = your header row (add once manually — the app never writes headers).
> Images are named by sheet row: first data row (row 2) → `0002.png`, row 34 → `0034.png`.


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
