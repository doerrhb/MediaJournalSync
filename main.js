const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

// ── Paths ─────────────────────────────────────────────────────────────────────
const USER_DATA   = app.getPath('userData');
const SETTINGS_F  = path.join(USER_DATA, 'settings.json');
const SCRAPER_SRC = fs.readFileSync(path.join(__dirname, 'scraper.js'), 'utf8');

nativeTheme.themeSource = 'dark';

// ── Settings ──────────────────────────────────────────────────────────────────
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_F)) return JSON.parse(fs.readFileSync(SETTINGS_F, 'utf8'));
    } catch (_) {}
    return {};
}
function saveSettings(s) {
    fs.writeFileSync(SETTINGS_F, JSON.stringify(s, null, 2));
}

// ── Main window ───────────────────────────────────────────────────────────────
let mainWin;

function createMainWindow() {
    mainWin = new BrowserWindow({
        width:  980,
        height: 820,
        minWidth:  760,
        minHeight: 600,
        backgroundColor: '#0f0f1a',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        webPreferences: {
            preload:          path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration:  false
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ── Spoof a real Chrome user agent so sites render normally ──────────────────
// Electron's default UA contains "Electron" which triggers bot detection and
// causes sites like Letterboxd to serve a stripped-down fallback page.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

app.whenReady().then(() => {
    // Set it globally for all sessions
    const { session } = require('electron');
    session.defaultSession.setUserAgent(CHROME_UA);
    // Also set it on the persistent scraper session
    session.fromPartition('persist:scraper').setUserAgent(CHROME_UA);
    createMainWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

// ══════════════════════════════════════════════════════════════════════════════
// SCRAPING  — each site gets a hidden BrowserWindow that loads the real page,
//             so sessions/cookies work exactly like a normal browser visit.
// ══════════════════════════════════════════════════════════════════════════════

// Load config once
const { SITE_CONFIGS } = (() => {
    // config.js uses a global const — eval it to get the array
    const src = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8')
        .replace(/if\s*\(typeof module.*\}\s*$/s, '');
    const fn = new Function(`${src}; return SITE_CONFIGS;`);
    return { SITE_CONFIGS: fn() };
})();

ipcMain.handle('get-configs', () => SITE_CONFIGS);

/**
 * Scrape a single site.
 * Opens a hidden BrowserWindow, navigates to the diary URL,
 * injects SITE_CONFIG + scraper.js, returns the result.
 */
ipcMain.handle('scrape-site', async (event, { config, url }) => {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            show: false,
            webPreferences: {
                partition:        'persist:scraper',
                contextIsolation: false,
                nodeIntegration:  false
            }
        });

        // Ensure the correct UA is set on this window's session
        win.webContents.setUserAgent(CHROME_UA);

        const timeout = setTimeout(() => {
            win.destroy();
            resolve({ error: 'Timed out waiting for page to load.' });
        }, 30000);

        win.webContents.on('did-finish-load', async () => {
            clearTimeout(timeout);
            try {
                // Inject config then run scraper
                await win.webContents.executeJavaScript(
                    `var SITE_CONFIG = ${JSON.stringify(config)};`
                );
                const result = await win.webContents.executeJavaScript(
                    `(async () => { ${SCRAPER_SRC} })()`
                );
                win.destroy();
                resolve(result || { error: 'Scraper returned no result.' });
            } catch (err) {
                win.destroy();
                resolve({ error: err.message });
            }
        });

        win.webContents.on('did-fail-load', (e, code, desc) => {
            clearTimeout(timeout);
            win.destroy();
            resolve({ error: `Page failed to load: ${desc} (${code})` });
        });

        win.loadURL(url);
    });
});

// ── Open a site in a visible window so the user can log in ───────────────────
ipcMain.handle('open-login-window', async (event, { url, siteName }) => {
    const win = new BrowserWindow({
        width:  1100,
        height: 800,
        title:  `Log in to ${siteName} — close when done`,
        webPreferences: {
            partition: 'persist:scraper'
        }
    });
    win.webContents.setUserAgent(CHROME_UA);
    win.loadURL(url);
    return true;
});

// ══════════════════════════════════════════════════════════════════════════════
// FILE SAVE  — download image + write CSV
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('save-image', async (event, { imageUrl, destPath }) => {
    if (!imageUrl) return { skipped: true };

    // destPath is relative to the user-configured base folder
    const settings   = loadSettings();
    const baseFolder  = settings.imageBaseFolder || app.getPath('downloads');
    const fullPath    = path.join(baseFolder, destPath);

    try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

        await new Promise((resolve, reject) => {
            const proto = imageUrl.startsWith('https') ? https : http;
            const file  = fs.createWriteStream(fullPath);
            proto.get(imageUrl, res => {
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', err => {
                fs.unlink(fullPath, () => {});
                reject(err);
            });
        });

        return { success: true, fullPath };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('append-csv', async (event, { config, entry }) => {
    const settings    = loadSettings();
    const baseFolder  = settings.imageBaseFolder || app.getPath('downloads');
    const csvPath     = path.join(baseFolder, config.filename);

    const fields  = config.csvFields || [];
    const row     = fields.map(f => `"${(entry[f] || '').toString().replace(/"/g, '""')}"`).join(',');

    // Write header if file is new
    if (!fs.existsSync(csvPath)) {
        fs.mkdirSync(path.dirname(csvPath), { recursive: true });
        fs.writeFileSync(csvPath, config.csvHeaders + '\n');
    }

    // Duplicate check: scan existing lines for same title+date
    const existing = fs.readFileSync(csvPath, 'utf8');
    const lines    = existing.split('\n').slice(1).filter(Boolean); // skip header
    const titleIdx = fields.indexOf('title');
    const dateIdx  = fields.indexOf('date');
    const isDupe   = lines.some(line => {
        const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
        return cols[titleIdx]?.toLowerCase() === (entry.title || '').toLowerCase() &&
               cols[dateIdx]  === (entry.date  || '');
    });

    if (isDupe) return { skipped: true };
    fs.appendFileSync(csvPath, row + '\n');
    return { success: true };
});

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE SHEETS
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('sync-sheets', async (event, { entry, config }) => {
    const settings  = loadSettings();
    const scriptUrl = settings.sheetsScriptUrl;
    if (!scriptUrl) return { skipped: true };

    const tabNames = settings.sheetsTabNames || {};
    const tabName  = tabNames[config.name]   || config.sheetTab;
    const row      = (config.csvFields || []).map(f => entry[f] || '');

    try {
        const result = await postJSON(scriptUrl, { tab: tabName, row });
        return result;
    } catch (err) {
        return { error: err.message };
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// GITHUB PUSH
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('git-push', async (event) => {
    const settings = loadSettings();
    const repoPath = settings.gitRepoPath;
    if (!repoPath) return { skipped: true, reason: 'No repo path configured.' };

    try {
        const git = require('simple-git')(repoPath);
        await git.add('.');
        const status = await git.status();
        if (status.files.length === 0) return { skipped: true, reason: 'Nothing to commit.' };

        const date = new Date().toLocaleDateString('en-US');
        await git.commit(`Media journal update ${date}`);
        await git.push();
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS  IPC
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('load-settings', ()          => loadSettings());
ipcMain.handle('save-settings', (e, s)      => { saveSettings(s); return true; });
ipcMain.handle('open-folder',   (e, folder) => shell.openPath(folder));
ipcMain.handle('choose-folder', async ()    => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWin, {
        properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});

// ── Helper: POST JSON and return parsed response ──────────────────────────────
function postJSON(url, body) {
    return new Promise((resolve, reject) => {
        const data   = JSON.stringify(body);
        const parsed = new URL(url);
        const proto  = parsed.protocol === 'https:' ? https : http;
        const req    = proto.request({
            hostname: parsed.hostname,
            path:     parsed.pathname + parsed.search,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch { resolve({ raw }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}
