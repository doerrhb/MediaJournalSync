const { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

// ── Paths ─────────────────────────────────────────────────────────────────────
const USER_DATA   = app.getPath('userData');
const SETTINGS_F  = path.join(USER_DATA, 'settings.json');
const LOG_DIR     = path.join(USER_DATA, 'logs');
const SCRAPER_SRC = fs.readFileSync(path.join(__dirname, 'scraper.js'), 'utf8');

nativeTheme.themeSource = 'dark';

// ══════════════════════════════════════════════════════════════════════════════
// LOGGING
// Log lines are:
//   - Written to a rolling log file in %AppData%\media-journal-sync\logs\
//   - Forwarded to the renderer via IPC so the UI log panel updates live
//   - Also printed to stdout for npm start debugging
// ══════════════════════════════════════════════════════════════════════════════

fs.mkdirSync(LOG_DIR, { recursive: true });

// One log file per day, named YYYY-MM-DD.log
function todayLogPath() {
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.log`;
    return path.join(LOG_DIR, name);
}

// Keep only last 30 log files
function pruneOldLogs() {
    try {
        const files = fs.readdirSync(LOG_DIR)
            .filter(f => f.endsWith('.log'))
            .sort()
            .reverse();
        files.slice(30).forEach(f => {
            try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch(_) {}
        });
    } catch(_) {}
}

pruneOldLogs();

let mainWin = null;

/**
 * Central log function — every log in the app goes through here.
 * level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SCRAPER'
 */
function log(level, site, message) {
    const ts   = new Date().toISOString();
    const line = `[${ts}] [${level.padEnd(7)}] [${(site||'APP').padEnd(15)}] ${message}`;

    // 1. Write to file
    try { fs.appendFileSync(todayLogPath(), line + '\n'); } catch(_) {}

    // 2. Print to terminal (useful during npm start development)
    console.log(line);

    // 3. Forward to renderer if window is ready
    if (mainWin && !mainWin.isDestroyed()) {
        try {
            mainWin.webContents.send('log-line', { ts, level, site: site || 'APP', message });
        } catch(_) {}
    }
}

// Convenience wrappers
const logInfo  = (site, msg) => log('INFO',    site, msg);
const logWarn  = (site, msg) => log('WARN',    site, msg);
const logError = (site, msg) => log('ERROR',   site, msg);
const logDebug = (site, msg) => log('DEBUG',   site, msg);

// Expose log path to renderer
ipcMain.handle('get-log-dir',      ()  => LOG_DIR);
ipcMain.handle('get-today-log',    ()  => todayLogPath());
ipcMain.handle('open-log-folder',  ()  => shell.openPath(LOG_DIR));

// ── Settings ──────────────────────────────────────────────────────────────────
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_F)) return JSON.parse(fs.readFileSync(SETTINGS_F, 'utf8'));
    } catch (e) { logError('APP', `Failed to load settings: ${e.message}`); }
    return {};
}
function saveSettings(s) {
    try { fs.writeFileSync(SETTINGS_F, JSON.stringify(s, null, 2)); }
    catch (e) { logError('APP', `Failed to save settings: ${e.message}`); }
}

// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow() {
    mainWin = new BrowserWindow({
        width:  1200,
        height: 860,
        minWidth:  900,
        minHeight: 640,
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

    mainWin.webContents.on('did-finish-load', () => {
        logInfo('APP', `Media Journal Sync started. Log dir: ${LOG_DIR}`);
        logInfo('APP', `Settings file: ${SETTINGS_F}`);
    });
}

// ── UA spoof ──────────────────────────────────────────────────────────────────
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

app.whenReady().then(() => {
    const { session } = require('electron');
    session.defaultSession.setUserAgent(CHROME_UA);
    session.fromPartition('persist:scraper').setUserAgent(CHROME_UA);
    createMainWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

// ── Load config ───────────────────────────────────────────────────────────────
const { SITE_CONFIGS } = (() => {
    const src = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8')
        .replace(/if\s*\(typeof module.*\}\s*$/s, '');
    const fn = new Function(`${src}; return SITE_CONFIGS;`);
    return { SITE_CONFIGS: fn() };
})();

ipcMain.handle('get-configs', () => SITE_CONFIGS);

// ══════════════════════════════════════════════════════════════════════════════
// SCRAPING
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('scrape-site', async (event, { config, url }) => {
    logInfo(config.name, `Starting scrape → ${url}`);

    return new Promise((resolve) => {
        const win = new BrowserWindow({
            show: false,
            webPreferences: {
                partition:        'persist:scraper',
                contextIsolation: false,
                nodeIntegration:  false
            }
        });

        win.webContents.setUserAgent(CHROME_UA);

        // Forward console.log from the scraper page to our log system
        win.webContents.on('console-message', (e, level, message) => {
            // Suppress noisy but harmless browser warnings
            const noise = /Third-party cookie|NitroAds|fun-hooks|Audigent|attribution-reporting|encryptedSignalProviders|googletag.setConfig|CORS policy/i;
            if (!noise.test(message)) {
                logDebug(config.name, `[page console] ${message}`);
            }
        });

        const timeout = setTimeout(() => {
            logError(config.name, 'Scrape timed out after 30s');
            win.destroy();
            resolve({ error: 'Timed out waiting for page to load.' });
        }, 30000);

        win.webContents.on('did-start-loading', () => {
            logInfo(config.name, 'Page loading started…');
        });

        win.webContents.on('did-navigate', (e, navUrl) => {
            logInfo(config.name, `Navigated to: ${navUrl}`);
        });

        win.webContents.on('did-finish-load', async () => {
            logInfo(config.name, 'Page loaded. Injecting scraper…');
            clearTimeout(timeout);
            try {
                // Wait for dynamic content if site needs it (React / SPA)
                if (config.waitForSelector) {
                    logInfo(config.name, 'Waiting for selector: ' + config.waitForSelector);
                    const appeared = await win.webContents.executeJavaScript(`
                        new Promise((resolve) => {
                            const sel = ${JSON.stringify(config.waitForSelector)};
                            if (document.querySelector(sel)) { resolve(true); return; }
                            let tries = 0;
                            const iv = setInterval(() => {
                                if (document.querySelector(sel)) { clearInterval(iv); resolve(true); }
                                else if (++tries >= 40) { clearInterval(iv); resolve(false); }
                            }, 250);
                        })
                    `);
                    logInfo(config.name, appeared
                        ? 'Selector appeared. Proceeding.'
                        : 'WARNING: selector never appeared after 10s — page may not have rendered.');
                }

                // CRITICAL: scraper.js is already an async IIFE returning a Promise.
                // Do NOT wrap in another function — the return value will be lost.
                await win.webContents.executeJavaScript(
                    `var SITE_CONFIG = ${JSON.stringify(config)};`
                );
                const result = await win.webContents.executeJavaScript(SCRAPER_SRC);

                // Forward every scraper debug log line to our log system
                if (result && result.debugLogs) {
                    result.debugLogs.forEach(line => {
                        log('SCRAPER', config.name, line);
                    });
                }

                if (result && result.error) {
                    logError(config.name, `Scraper reported error: ${result.error}`);
                } else if (result && result.title) {
                    // BGG: rating is Angular-rendered — do live 2nd page load
                    if (config.name === 'BoardGameGeek' && result.detailUrl && !result.rating) {
                        logInfo('BoardGameGeek', 'Phase 2: fetching rating from game page…');
                        const bggRating = await loadBGGRating(result.detailUrl);
                        if (bggRating) result.rating = bggRating;
                    }

                    // Letterboxd: in-page fetch() always returns skeleton HTML (React page).
                    // Phase 2 = real browser load. Always try, regardless of what the scraper returned.
                    if (config.name === 'Letterboxd') {
                        const filmUrl = result.filmUrl || null;
                        if (!filmUrl) {
                            logWarn('Letterboxd', 'No filmUrl returned from scraper — cannot fetch poster');
                        } else if (!result.poster) {
                            logInfo('Letterboxd', `Phase 2: fetching poster for ${filmUrl}…`);
                            // Fast path: static fetch from main process → OG meta tag
                            const ogPoster = await fetchLBPosterStatic(filmUrl);
                            if (ogPoster) {
                                result.poster = ogPoster;
                                logInfo('Letterboxd', `  ✓ Poster from static OG fetch: ${ogPoster}`);
                            } else {
                                // Slow path: real browser window + React rendering
                                logInfo('Letterboxd', `  Static fetch failed, trying real browser…`);
                                const lbPoster = await loadLBPoster(filmUrl);
                                if (lbPoster) {
                                    result.poster = lbPoster;
                                    logInfo('Letterboxd', `  ✓ Poster from browser render: ${lbPoster}`);
                                } else {
                                    logWarn('Letterboxd', '  All poster methods failed — user can paste URL manually in review card');
                                }
                            }
                        }
                    }
                    logInfo(config.name, `✓ Extracted: title="${result.title}" date="${result.date}" rating="${result.rating}" year="${result.year || ''}" platform="${result.platform || ''}"`);
                } else {
                    logWarn(config.name, 'Scraper returned empty result (no title found)');
                    logWarn(config.name, `Full result: ${JSON.stringify(result)}`);
                }

                win.destroy();
                resolve(result || { error: 'Scraper returned no result.' });

            } catch (err) {
                logError(config.name, `JavaScript execution error: ${err.message}`);
                logError(config.name, err.stack || '(no stack)');
                win.destroy();
                resolve({ error: err.message });
            }
        });

        win.webContents.on('did-fail-load', (e, code, desc, validatedUrl) => {
            logError(config.name, `Page failed to load: ${desc} (code ${code}) url=${validatedUrl}`);
            clearTimeout(timeout);
            win.destroy();
            resolve({ error: `Page failed to load: ${desc} (${code})` });
        });

        win.webContents.on('did-navigate-in-page', (e, navUrl) => {
            logDebug(config.name, `In-page navigation: ${navUrl}`);
        });

        logInfo(config.name, `Loading URL: ${url}`);
        win.loadURL(url);
    });
});

// ── Login window ──────────────────────────────────────────────────────────────
ipcMain.handle('open-login-window', async (event, { url, siteName }) => {
    logInfo(siteName, `Opening login window → ${url}`);
    const win = new BrowserWindow({
        width:  1100,
        height: 800,
        title:  `Log in to ${siteName} — close when done`,
        webPreferences: { partition: 'persist:scraper' }
    });
    win.webContents.setUserAgent(CHROME_UA);
    win.on('closed', () => logInfo(siteName, 'Login window closed'));
    win.loadURL(url);
    return true;
});

// ══════════════════════════════════════════════════════════════════════════════
// BGG RATING — live Angular page load
// The rating is Angular-rendered on the game's own page, not on the play log.
// XPath confirmed: /html/body/div[2]/main/div[2]/div/div[2]/div[2]/ng-include/div/
//                  ng-include/div/div[2]/div[2]/div[4]/span[1]/div/div/span[2]/span
// ══════════════════════════════════════════════════════════════════════════════

const BGG_RATING_XPATH = '/html/body/div[2]/main/div[2]/div/div[2]/div[2]/ng-include/div/ng-include/div/div[2]/div[2]/div[4]/span[1]/div/div/span[2]/span';

async function loadBGGRating(gameUrl) {
    logInfo('BoardGameGeek', `Loading game page for rating: ${gameUrl}`);
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            show: false,
            webPreferences: { partition: 'persist:scraper', contextIsolation: false, nodeIntegration: false }
        });
        win.webContents.setUserAgent(CHROME_UA);

        const timeout = setTimeout(() => {
            logWarn('BoardGameGeek', 'Rating page timed out after 20s');
            win.destroy();
            resolve('');
        }, 20000);

        win.webContents.on('did-finish-load', async () => {
            clearTimeout(timeout);
            try {
                // Poll for Angular to render the rating span (up to 10s / 40 tries)
                const rating = await win.webContents.executeJavaScript(`
                    new Promise(resolve => {
                        const xpath = ${JSON.stringify(BGG_RATING_XPATH)};
                        let tries = 0;
                        const check = () => {
                            try {
                                const r = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
                                const text = (r.stringValue || '').trim().replace(/\\s+/g, '');
                                if (text && !isNaN(parseFloat(text)) && parseFloat(text) > 0) {
                                    resolve(text);
                                    return;
                                }
                            } catch(e) {}
                            if (++tries >= 40) { resolve(''); return; }
                            setTimeout(check, 250);
                        };
                        check();
                    })
                `);
                win.destroy();
                if (rating) logInfo('BoardGameGeek', `  ✓ Rating from game page: ${rating}`);
                else         logWarn('BoardGameGeek',  `  Rating span not found after 10s on game page`);
                resolve(rating || '');
            } catch(e) {
                logError('BoardGameGeek', `Rating page JS error: ${e.message}`);
                win.destroy();
                resolve('');
            }
        });

        win.webContents.on('did-fail-load', (e, code, desc) => {
            logError('BoardGameGeek', `Rating page failed: ${desc} (${code})`);
            clearTimeout(timeout);
            win.destroy();
            resolve('');
        });

        win.loadURL(gameUrl);
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// LETTERBOXD POSTER — Fast path: static HTTPS fetch from main process
// Letterboxd's film detail page includes og:image in the initial static HTML.
// This is faster than a full browser render and doesn't require waiting for React.
// ══════════════════════════════════════════════════════════════════════════════

function fetchLBPosterStatic(filmUrl) {
    return new Promise((resolve) => {
        const options = {
            headers: {
                'User-Agent': CHROME_UA,
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            }
        };
        logInfo('Letterboxd', `  Static fetch: ${filmUrl}`);

        const req = https.get(filmUrl, options, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                logInfo('Letterboxd', `  Redirect → ${res.headers.location}`);
                fetchLBPosterStatic(res.headers.location).then(resolve);
                return;
            }
            if (res.statusCode !== 200) {
                logWarn('Letterboxd', `  Static fetch HTTP ${res.statusCode}`);
                resolve('');
                return;
            }
            let html = '';
            res.on('data', chunk => { html += chunk; if (html.length > 80000) req.destroy(); });
            res.on('end', () => {
                // Extract og:image content from raw HTML — fast regex, no DOM parsing needed
                const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
                if (match && match[1]) {
                    const url = match[1];
                    // Reject backdrops/landscape crops (LB OG on film pages IS the poster, but double-check)
                    const isBackdrop = /-1200-.*-675-/i.test(url) || /backdrop/i.test(url);
                    if (!isBackdrop) { resolve(url); return; }
                }
                // Also try the film-poster img src in raw HTML
                const imgMatch = html.match(/class="film-poster[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
                if (imgMatch && imgMatch[1] && !imgMatch[1].includes('empty-poster')) {
                    resolve(imgMatch[1]);
                    return;
                }
                logInfo('Letterboxd', '  No poster in static HTML');
                resolve('');
            });
            res.on('error', (e) => { logWarn('Letterboxd', `  Static fetch error: ${e.message}`); resolve(''); });
        });
        req.on('error', (e) => { logWarn('Letterboxd', `  Static fetch request error: ${e.message}`); resolve(''); });
        req.setTimeout(8000, () => { logWarn('Letterboxd', '  Static fetch timeout'); req.destroy(); resolve(''); });
    });
}


// ══════════════════════════════════════════════════════════════════════════════
// LETTERBOXD POSTER — Phase 2 real browser load
// fetch() inside the page context is blocked by Letterboxd anti-bot.
// This loads the canonical film page in a hidden Electron window and waits
// for the .film-poster img element to resolve its src.
// ══════════════════════════════════════════════════════════════════════════════

async function loadLBPoster(filmUrl) {
    logInfo('Letterboxd', `Phase 2: loading ${filmUrl}`);
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            show: false,
            webPreferences: { partition: 'persist:scraper', contextIsolation: false, nodeIntegration: false }
        });
        win.webContents.setUserAgent(CHROME_UA);

        const timeout = setTimeout(() => {
            logWarn('Letterboxd', 'Poster page timed out after 20s');
            win.destroy();
            resolve('');
        }, 20000);

        win.webContents.on('did-finish-load', async () => {
            clearTimeout(timeout);
            try {
                // Poll up to 8s for .film-poster img to have a real src
                const posterUrl = await win.webContents.executeJavaScript(`
                    new Promise(resolve => {
                        let tries = 0;
                        const check = () => {
                            // Try multiple selectors in priority order
                            const selectors = [
                                '.film-poster img',
                                '#film-poster img',
                                'section.poster-container img',
                                'div[data-film-poster] img',
                                'img[src*="a.ltrbxd.com/resized/film-poster"]'
                            ];
                            for (const sel of selectors) {
                                const img = document.querySelector(sel);
                                if (img) {
                                    // Prefer currentSrc (resolved), then src property
                                    const url = img.currentSrc || img.src || img.getAttribute('src') || '';
                                    const isPlaceholder = /empty-poster|placeholder|spacer|pixel|s\.ltrbxd\.com\/static\/img/i.test(url);
                                    if (url && url.startsWith('http') && !isPlaceholder) {
                                        resolve(url);
                                        return;
                                    }
                                }
                            }
                            // Also try srcset on any ltrbxd image
                            const lbImg = document.querySelector('img[srcset*="a.ltrbxd.com"]');
                            if (lbImg) {
                                const ss = lbImg.srcset || lbImg.getAttribute('srcset') || '';
                                const parts = ss.split(',').map(s => s.trim().split(' ')[0]).filter(Boolean);
                                if (parts.length) { resolve(parts[parts.length - 1]); return; }
                                const s = lbImg.currentSrc || lbImg.src || '';
                                if (s && !s.includes('empty-poster')) { resolve(s); return; }
                            }
                            if (++tries >= 32) { resolve(''); return; }
                            setTimeout(check, 250);
                        };
                        check();
                    })
                `);
                win.destroy();
                if (posterUrl) resolve(posterUrl);
                else { logWarn('Letterboxd', '  No .film-poster img found after 8s'); resolve(''); }
            } catch(e) {
                logError('Letterboxd', `Poster page JS error: ${e.message}`);
                win.destroy();
                resolve('');
            }
        });

        win.webContents.on('did-fail-load', (e, code, desc) => {
            logWarn('Letterboxd', `Poster page failed to load: ${desc} (${code})`);
            clearTimeout(timeout);
            win.destroy();
            resolve('');
        });

        win.loadURL(filmUrl);
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// IMAGE NORMALIZATION  (mirrors processImage() in index.html)
// All saved posters are normalized to:  506 × 759 px  PNG
//   - letterbox-fit: maintain source aspect ratio, fit WITHIN the frame
//   - transparent padding (not black bars) to fill unused space
//   - any source format (jpg, webp, gif …) is converted to PNG
// Target size matches the media card display dimensions used in the viewer.
// ══════════════════════════════════════════════════════════════════════════════

const TARGET_W = 506;
const TARGET_H = 759;

function normalizeImageBuffer(rawBuffer) {
    try {
        const img = nativeImage.createFromBuffer(rawBuffer);
        if (img.isEmpty()) {
            logWarn('APP', '  normalize: could not decode image — saving raw');
            return rawBuffer;
        }

        const { width: srcW, height: srcH } = img.getSize();
        if (srcW === 0 || srcH === 0) {
            logWarn('APP', '  normalize: zero-dimension image — saving raw');
            return rawBuffer;
        }

        // ── Step 1: calculate letterbox draw size (fit-within, maintain AR) ─
        const scaleX  = TARGET_W / srcW;
        const scaleY  = TARGET_H / srcH;
        const scale   = Math.min(scaleX, scaleY);
        const drawW   = Math.max(1, Math.round(srcW * scale));
        const drawH   = Math.max(1, Math.round(srcH * scale));
        const offsetX = Math.floor((TARGET_W - drawW) / 2);
        const offsetY = Math.floor((TARGET_H - drawH) / 2);

        logDebug('APP', `  normalize: ${srcW}×${srcH} → draw ${drawW}×${drawH} at (${offsetX},${offsetY}) in ${TARGET_W}×${TARGET_H}`);

        // ── Step 2: resize the source to draw dimensions ─────────────────────
        const resized     = img.resize({ width: drawW, height: drawH, quality: 'best' });
        const resizedBgra = resized.toBitmap();   // raw BGRA, row-major

        // ── Step 3: allocate a transparent 506×759 BGRA canvas ───────────────
        const canvas = Buffer.alloc(TARGET_W * TARGET_H * 4, 0);  // all zeros = transparent

        // ── Step 4: blit resized image row-by-row into the canvas ────────────
        for (let y = 0; y < drawH; y++) {
            const srcOff = y * drawW * 4;
            const dstOff = ((y + offsetY) * TARGET_W + offsetX) * 4;
            resizedBgra.copy(canvas, dstOff, srcOff, srcOff + drawW * 4);
        }

        // ── Step 5: encode canvas as PNG ─────────────────────────────────────
        const final = nativeImage.createFromBitmap(canvas, { width: TARGET_W, height: TARGET_H });
        logDebug('APP', `  normalize: → ${TARGET_W}×${TARGET_H} PNG (transparent letterbox)`);
        return final.toPNG();

    } catch (e) {
        logError('APP', `  normalize error: ${e.message} — saving raw`);
        return rawBuffer;
    }
}



ipcMain.handle('save-image', async (event, { imageUrl, destPath }) => {
    if (!imageUrl) {
        logWarn('APP', `save-image skipped — no imageUrl provided (destPath: ${destPath})`);
        return { skipped: true };
    }

    const settings   = loadSettings();
    const baseFolder = settings.imageBaseFolder || app.getPath('downloads');
    logInfo('APP', `Image base folder: ${baseFolder} (from ${settings.imageBaseFolder ? 'settings' : 'default downloads'})`);

    // Always save as .png regardless of source extension
    const pngDestPath = destPath.replace(/\.(jpe?g|webp|gif|bmp|tiff?)$/i, '') + '.png';
    const fullPath    = path.join(baseFolder, pngDestPath);

    logInfo('APP', `Saving image → ${fullPath}`);
    logDebug('APP', `  Source URL: ${imageUrl}`);

    try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

        // Download raw bytes
        const rawBuffer = await new Promise((resolve, reject) => {
            const proto = imageUrl.startsWith('https') ? https : http;
            const chunks = [];
            proto.get(imageUrl, { headers: { 'User-Agent': CHROME_UA } }, res => {
                logDebug('APP', `  HTTP ${res.statusCode} from image server`);
                if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                res.on('data', c => chunks.push(c));
                res.on('end',  () => resolve(Buffer.concat(chunks)));
            }).on('error', reject);
        });

        // Normalize: resize + convert to PNG
        const pngBuffer = normalizeImageBuffer(rawBuffer);
        fs.writeFileSync(fullPath, pngBuffer);

        logInfo('APP', `  ✓ Image saved as PNG (${Math.round(pngBuffer.length/1024)}KB) → ${fullPath}`);
        return { success: true, fullPath };
    } catch (err) {
        logError('APP', `save-image error: ${err.message}`);
        return { error: err.message };
    }
});

ipcMain.handle('append-csv', async (event, { config, entry }) => {
    const settings  = loadSettings();
    const baseFolder = settings.imageBaseFolder || app.getPath('downloads');
    const csvPath    = path.join(baseFolder, config.filename);

    logInfo(config.name, `Appending to CSV → ${csvPath}`);

    const fields = config.csvFields || [];
    const row    = fields.map(f => `"${(entry[f] || '').toString().replace(/"/g, '""')}"`).join(',');

    if (!fs.existsSync(csvPath)) {
        fs.mkdirSync(path.dirname(csvPath), { recursive: true });
        fs.writeFileSync(csvPath, config.csvHeaders + '\n');
        logInfo(config.name, '  CSV file created with headers');
    }

    const existing = fs.readFileSync(csvPath, 'utf8');
    const lines    = existing.split('\n').slice(1).filter(Boolean);
    const titleIdx = fields.indexOf('title');
    const dateIdx  = fields.indexOf('date');
    const isDupe   = lines.some(line => {
        const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
        return cols[titleIdx]?.toLowerCase() === (entry.title || '').toLowerCase() &&
               cols[dateIdx] === (entry.date || '');
    });

    if (isDupe) {
        logWarn(config.name, `  Duplicate detected — skipping CSV row for "${entry.title}"`);
        return { skipped: true };
    }

    fs.appendFileSync(csvPath, row + '\n');
    logInfo(config.name, `  ✓ Row appended: ${row}`);
    return { success: true };
});

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE SHEETS
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('sync-sheets', async (event, { entry, config }) => {
    const settings  = loadSettings();
    const scriptUrl = settings.sheetsScriptUrl;
    if (!scriptUrl) {
        logWarn(config.name, 'Sheets sync skipped — no script URL configured');
        return { skipped: true, reason: 'not_configured' };
    }

    const tabNames = settings.sheetsTabNames || {};
    const tabName  = tabNames[config.name] || config.sheetTab;
    const row      = (config.csvFields || []).map(f => entry[f] || '');

    logInfo(config.name, `Syncing to Sheets tab "${tabName}": ${JSON.stringify(row)}`);

    try {
        const result = await postJSON(scriptUrl, { tab: tabName, row });
        if (result.rowNumber) {
            logInfo(config.name, `  ✓ Sheets row appended at row ${result.rowNumber}`);
        } else if (result.success) {
            logInfo(config.name, `  ✓ Sheets row appended (no rowNumber in response)`);
        } else {
            logError(config.name, `  Sheets error: ${result.error}`);
        }
        return result;
    } catch (err) {
        logError(config.name, `  Sheets POST failed: ${err.message}`);
        return { error: err.message };
    }
});

// Quick connectivity check — calls doGet on the Apps Script
ipcMain.handle('ping-sheets', async () => {
    const settings  = loadSettings();
    const scriptUrl = settings.sheetsScriptUrl;
    if (!scriptUrl) return { ok: false, reason: 'not_configured' };

    logInfo('APP', `Pinging Sheets script: ${scriptUrl}`);
    return new Promise(resolve => {
        const parsed = new URL(scriptUrl);
        const proto  = parsed.protocol === 'https:' ? https : http;
        const req    = proto.get(scriptUrl, { headers: { 'User-Agent': CHROME_UA } }, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(raw);
                    if (j.pong) { logInfo('APP', '  Sheets ping: OK'); resolve({ ok: true }); }
                    else        { logWarn('APP', `  Sheets ping: unexpected response — ${raw.slice(0,80)}`); resolve({ ok: false, reason: 'bad_response' }); }
                } catch {
                    // Apps Script redirect responses aren't JSON — still means it's reachable
                    logInfo('APP', `  Sheets ping: HTTP ${res.statusCode} — reachable`);
                    resolve({ ok: res.statusCode < 500 });
                }
            });
        });
        req.on('error', err => {
            logWarn('APP', `  Sheets ping failed: ${err.message}`);
            resolve({ ok: false, reason: err.message });
        });
        req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    });
});

// Fetch the last data row from a specific tab (used for fuzzy duplicate check)
ipcMain.handle('read-last-row', async (event, { tab }) => {
    const settings  = loadSettings();
    const scriptUrl = settings.sheetsScriptUrl;
    if (!scriptUrl) return { ok: false, reason: 'not_configured' };

    const url = `${scriptUrl}?action=lastRow&tab=${encodeURIComponent(tab)}`;
    logInfo('APP', `Fetching last row for tab "${tab}"`);

    try {
        const raw = await getFollowRedirects(url, 6);
        const j   = JSON.parse(raw);
        logInfo('APP', `  Last row [${tab}]: ${JSON.stringify(j).slice(0, 120)}`);
        return { ok: true, row: j.row || null };
    } catch (err) {
        logWarn('APP', `  Last row [${tab}] failed: ${err.message}`);
        return { ok: false, reason: err.message };
    }
});

ipcMain.handle('git-push', async () => {
    const settings = loadSettings();
    const repoPath = settings.gitRepoPath;
    if (!repoPath) {
        logWarn('GIT', 'Git push skipped — no repo path configured');
        return { skipped: true, reason: 'No repo path configured.' };
    }

    logInfo('GIT', `Running git add/commit/push in: ${repoPath}`);
    try {
        const git    = require('simple-git')(repoPath);
        await git.add('.');
        const status = await git.status();
        logInfo('GIT', `  ${status.files.length} file(s) changed`);
        if (status.files.length === 0) {
            logInfo('GIT', '  Nothing to commit');
            return { skipped: true, reason: 'Nothing to commit.' };
        }
        const date = new Date().toLocaleDateString('en-US');
        await git.commit(`Media journal update ${date}`);
        logInfo('GIT', '  Committed. Pushing…');
        await git.push();
        logInfo('GIT', '  ✓ Push complete');
        return { success: true };
    } catch (err) {
        logError('GIT', `Git error: ${err.message}`);
        return { error: err.message };
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS IPC
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('load-settings',  ()         => loadSettings());
ipcMain.handle('save-settings',  (e, s)     => { saveSettings(s); return true; });
ipcMain.handle('open-folder',    (e, folder) => shell.openPath(folder));
ipcMain.handle('open-url',        (e, url)    => shell.openExternal(url));
ipcMain.handle('choose-folder',  async ()   => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWin, {
        properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});

// ── Helper ────────────────────────────────────────────────────────────────────
// GET a URL, following up to maxRedirects 3xx responses.
// Returns the final response body as a string, or rejects on error/timeout.
function getFollowRedirects(url, maxRedirects = 6) {
    return new Promise((resolve, reject) => {
        let hops = 0;

        function doGet(currentUrl) {
            const proto  = currentUrl.startsWith('https') ? https : http;
            const req    = proto.get(currentUrl, { headers: { 'User-Agent': CHROME_UA } }, res => {
                // Follow 3xx redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume(); // discard body
                    if (++hops > maxRedirects) return reject(new Error(`Too many redirects for ${currentUrl}`));
                    const next = res.headers.location.startsWith('http')
                        ? res.headers.location
                        : new URL(res.headers.location, currentUrl).href;
                    return doGet(next);
                }
                let raw = '';
                res.on('data', c => raw += c);
                res.on('end', () => resolve(raw));
            });
            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
        }

        doGet(url);
    });
}

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
