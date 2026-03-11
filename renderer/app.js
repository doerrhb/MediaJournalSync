/* ═══════════════════════════════════════════════════════════════════════════
   Media Journal Sync — Renderer
   ═══════════════════════════════════════════════════════════════════════════ */

let SITE_CONFIGS = [];
let settings     = {};
let scanResults  = {};   // { siteName: entry|null }
let entryStates  = {};   // { siteName: 'approved'|'skipped'|'pending'|'saved' }

// ── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
    SITE_CONFIGS = await window.api.getConfigs();
    settings     = await window.api.loadSettings();

    applySettings();
    buildSiteGrid();
    buildSettingsPage();
    wireNavTabs();
    wireBottomBar();
}

function applySettings() {
    // Sheets pill
    const sp = document.getElementById('sheetsPill');
    if (settings.sheetsScriptUrl) {
        sp.textContent = 'Sheets ✓';
        sp.className   = 'pill sheets-on';
    }
    // Git pill
    const gp = document.getElementById('gitPill');
    if (settings.gitRepoPath) {
        gp.textContent = 'Git ✓';
        gp.className   = 'pill git-on';
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// SITE GRID
// ══════════════════════════════════════════════════════════════════════════════

function buildSiteGrid() {
    const grid = document.getElementById('siteGrid');
    grid.innerHTML = '';

    SITE_CONFIGS.forEach(cfg => {
        const card = document.createElement('div');
        card.className = 'site-card';
        card.id = `card-${sanitizeId(cfg.name)}`;

        const url = (settings.diaryUrls || {})[cfg.name] || DEFAULT_URLS[cfg.name] || '';

        card.innerHTML = `
            <div class="sc-name ${cfg.name.replace(/\s+/g,'')}">${cfg.name}</div>
            <div class="sc-status" id="status-${sanitizeId(cfg.name)}">Ready</div>
            <button class="sc-login" data-site="${cfg.name}" data-url="${url}">
                🔑 Log in / Open
            </button>
        `;
        grid.appendChild(card);
    });

    // Login buttons
    grid.querySelectorAll('.sc-login').forEach(btn => {
        btn.addEventListener('click', () => {
            const url = btn.dataset.url;
            if (url) {
                window.api.openLoginWindow({ url, siteName: btn.dataset.site });
            } else {
                const siteName = btn.dataset.site;
                setSiteStatus(siteName, '⚠ No URL — add one in Settings', 'error');
            }
        });
    });

    // Scan all
    document.getElementById('scanAllBtn').addEventListener('click', scanAll);
}

function setSiteStatus(name, msg, state) {
    const card = document.getElementById(`card-${sanitizeId(name)}`);
    const stat = document.getElementById(`status-${sanitizeId(name)}`);
    if (!card || !stat) return;
    card.className = `site-card ${state || ''}`;
    stat.textContent = msg;
    stat.className   = `sc-status${state === 'error' ? ' err' : ''}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SCANNING
// ══════════════════════════════════════════════════════════════════════════════

async function scanAll() {
    const btn = document.getElementById('scanAllBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Scanning…';

    document.getElementById('reviewArea').style.display  = 'none';
    document.getElementById('updateAllBtn').disabled     = true;
    document.getElementById('entryList').innerHTML       = '';
    scanResults  = {};
    entryStates  = {};

    const urls = settings.diaryUrls || {};

    for (const cfg of SITE_CONFIGS) {
        setSiteStatus(cfg.name, 'Scanning…', 'scanning');

        const url = urls[cfg.name];
        if (!url) {
            setSiteStatus(cfg.name, '⚠ No URL configured', 'error');
            continue;
        }

        try {
            const result = await window.api.scrapeSite({ config: cfg, url });

            if (result && result.error) {
                setSiteStatus(cfg.name, `✗ ${result.error}`, 'error');
                scanResults[cfg.name] = null;
            } else if (result && result.title) {
                setSiteStatus(cfg.name, `✓ Found: ${result.title}`, 'done');
                scanResults[cfg.name] = result;
                entryStates[cfg.name] = 'approved';  // default to approved
            } else {
                setSiteStatus(cfg.name, '✗ Nothing found', 'error');
                scanResults[cfg.name] = null;
            }
        } catch (err) {
            setSiteStatus(cfg.name, `✗ ${err.message}`, 'error');
            scanResults[cfg.name] = null;
        }
    }

    btn.disabled    = false;
    btn.textContent = '▶ Scan All Sites';

    // Build review cards for anything found
    const found = SITE_CONFIGS.filter(c => scanResults[c.name]);
    if (found.length > 0) {
        buildReviewCards(found);
        document.getElementById('reviewArea').style.display = 'flex';
        document.getElementById('updateAllBtn').disabled    = false;
        document.getElementById('reviewArea').scrollIntoView({ behavior: 'smooth' });
    }

    updateBottomMsg();
}

// ══════════════════════════════════════════════════════════════════════════════
// REVIEW CARDS
// ══════════════════════════════════════════════════════════════════════════════

function buildReviewCards(configs) {
    const list = document.getElementById('entryList');
    list.innerHTML = '';

    configs.forEach(cfg => {
        const entry = scanResults[cfg.name];
        if (!entry) return;

        const card = document.createElement('div');
        card.className = 'entry-card approved';
        card.id = `ec-${sanitizeId(cfg.name)}`;
        card.innerHTML = buildCardHTML(cfg, entry);
        list.appendChild(card);

        // Wire expand/collapse
        const hdr = card.querySelector('.ec-header');
        const body = card.querySelector('.ec-body');
        hdr.addEventListener('click', () => {
            const open = body.classList.toggle('open');
            hdr.classList.toggle('open', open);
        });
        // Start expanded
        body.classList.add('open');
        hdr.classList.add('open');

        // Wire approve/skip
        card.querySelector('.ec-approve').addEventListener('click', e => {
            e.stopPropagation();
            setEntryState(cfg.name, 'approved');
        });
        card.querySelector('.ec-skip').addEventListener('click', e => {
            e.stopPropagation();
            setEntryState(cfg.name, 'skipped');
        });

        // Wire field inputs -> live Sheets preview update
        cfg.reviewFields.forEach(f => {
            const el = card.querySelector(`[data-field="${f.key}"]`);
            if (!el) return;
            el.addEventListener('input', () => {
                syncEntryFromCard(cfg);
                refreshSheetsPreview(card, cfg, readCardEntry(cfg, entry));
                refreshImagePath(card, cfg, readCardEntry(cfg, entry));
            });
        });

        // Image quality badge
        const img = card.querySelector('.ec-poster img');
        if (img) {
            img.addEventListener('load', () => {
                const w = img.naturalWidth, h = img.naturalHeight;
                const badge = card.querySelector('.qual-badge');
                if (!badge) return;
                if (w >= 600 || h >= 800) { badge.className = 'qual-badge good'; badge.textContent = `✓ ${w}×${h}`; }
                else if (w >= 200)         { badge.className = 'qual-badge ok';   badge.textContent = `⚠ ${w}×${h}`; }
                else                       { badge.className = 'qual-badge low';  badge.textContent = `✗ ${w}×${h}`; }
                badge.style.display = 'block';
            });
        }
    });
}

function buildCardHTML(cfg, entry) {
    const tabName = ((settings.sheetsTabNames || {})[cfg.name]) || cfg.sheetTab;

    // Poster
    const posterHTML = entry.poster
        ? `<img src="${entry.poster}" alt="Cover" loading="lazy"><div class="qual-badge" style="display:none;"></div>`
        : `<div class="no-img"><span style="font-size:28px">🖼</span>No image found</div>`;

    // Image path
    const imgPath = computeImagePath(cfg, entry);

    // Fields
    const fieldsHTML = buildFieldsHTML(cfg, entry);

    // Sheets preview
    const headers = (cfg.csvHeaders || '').split(',').map(h => h.trim());
    const vals    = rowValues(cfg, entry);
    const hCells  = headers.map(h => `<div class="sm-cell">${h}</div>`).join('');
    const vCells  = headers.map((_, i) => {
        const v = (vals[i] || '').toString().trim();
        return `<div class="sm-cell${v ? '' : ' empty'}">${v || '(missing)'}</div>`;
    }).join('');

    const noSheetsNote = settings.sheetsScriptUrl
        ? '' : '<span style="margin-left:auto;color:#ef5350;font-size:10px;">⚠ not configured</span>';

    return `
    <div class="ec-header">
        <div class="ec-site-dot ${cfg.name.replace(/\s+/g,'')}"></div>
        <div class="ec-title">${entry.title || '(no title)'}</div>
        <div class="ec-meta">${entry.date || ''} ${entry.rating ? '· ' + entry.rating : ''}</div>
        <div class="ec-chevron">▼</div>
    </div>
    <div class="ec-body">
        <div class="ec-poster">${posterHTML}</div>
        <div class="ec-fields">
            ${fieldsHTML}

            <div>
                <label style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);display:block;margin-bottom:4px;">
                    📁 Save image as
                </label>
                <div class="path-row">
                    <span class="path-icon">📄</span>
                    <input type="text" class="img-path-input" value="${imgPath}" data-cfg="${cfg.name}">
                </div>
            </div>

            <div>
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:5px;">
                    📊 Sheets row — Tab: ${tabName} ${noSheetsNote}
                </div>
                <div class="sheets-mini">
                    <div class="sm-header">📋 ${tabName}</div>
                    <div class="sm-row hdrs">${hCells}</div>
                    <div class="sm-row vals sheets-vals">${vCells}</div>
                </div>
            </div>

            <div class="ec-actions">
                <button class="ec-approve active">✓ Approve</button>
                <button class="ec-skip">✕ Skip</button>
                <span class="ec-saved-label" style="display:none;">✓ Saved!</span>
            </div>
        </div>
    </div>`;
}

function buildFieldsHTML(cfg, entry) {
    // Group fields: full-width get their own row, halves are paired
    const fields = cfg.reviewFields || [];
    let html = '';
    let i = 0;

    while (i < fields.length) {
        const f = fields[i];
        if (f.width === 'full') {
            const val = entry[f.key] || '';
            html += `
            <div class="field-row">
                <div class="field-group full">
                    <label>${f.label}</label>
                    <input type="text" data-field="${f.key}" value="${escHtml(val)}"
                           placeholder="${f.placeholder || ''}"
                           class="${val ? 'ok' : (f.required ? 'missing' : '')}">
                </div>
            </div>`;
            i++;
        } else {
            // Pair up to 2 halves
            const pair = [];
            while (i < fields.length && fields[i].width !== 'full' && pair.length < 2) {
                pair.push(fields[i++]);
            }
            const cells = pair.map(pf => {
                const val = entry[pf.key] || '';
                return `
                <div class="field-group">
                    <label>${pf.label}</label>
                    <input type="text" data-field="${pf.key}" value="${escHtml(val)}"
                           placeholder="${pf.placeholder || ''}"
                           class="${val ? 'ok' : (pf.required ? 'missing' : '')}">
                </div>`;
            }).join('');
            html += `<div class="field-row">${cells}</div>`;
        }
    }
    return html;
}

// ── Read current field values from a card ─────────────────────────────────────
function readCardEntry(cfg, baseEntry) {
    const card = document.getElementById(`ec-${sanitizeId(cfg.name)}`);
    const out  = Object.assign({}, baseEntry);
    if (!card) return out;
    card.querySelectorAll('[data-field]').forEach(el => {
        out[el.dataset.field] = el.value.trim();
    });
    return out;
}

function syncEntryFromCard(cfg) {
    const base  = scanResults[cfg.name];
    scanResults[cfg.name] = readCardEntry(cfg, base);
}

function refreshSheetsPreview(card, cfg, entry) {
    const vals  = rowValues(cfg, entry);
    const cells = card.querySelectorAll('.sheets-vals .sm-cell');
    cells.forEach((c, i) => {
        const v = (vals[i] || '').toString().trim();
        c.textContent = v || '(missing)';
        c.className   = `sm-cell${v ? '' : ' empty'}`;
    });
}

function refreshImagePath(card, cfg, entry) {
    const input = card.querySelector('.img-path-input');
    if (input) input.value = computeImagePath(cfg, entry);
}

function rowValues(cfg, entry) {
    return (cfg.csvFields || []).map(f => entry[f] || '');
}

function computeImagePath(cfg, entry) {
    const baseFolder = settings.imageBaseFolder || '';
    const subFolder  = cfg.folder;            // e.g. "Images/movies"
    const safeTitle  = sanitizeFilename(entry.title || 'unknown');
    const suffix     = entry.year ? `_${entry.year}` : (entry.date ? `_${entry.date.replace(/\//g, '-')}` : '');
    // Return relative path — main process prepends baseFolder
    return `${subFolder}/${safeTitle}${suffix}.jpg`;
}

// ── Approve / Skip ────────────────────────────────────────────────────────────
function setEntryState(siteName, state) {
    entryStates[siteName] = state;
    const card = document.getElementById(`ec-${sanitizeId(siteName)}`);
    if (!card) return;
    card.className = `entry-card ${state}`;
    card.querySelector('.ec-approve').classList.toggle('active', state === 'approved');
    card.querySelector('.ec-skip').classList.toggle('active', state === 'skipped');
    updateBottomMsg();
}

function updateBottomMsg() {
    const approved = Object.values(entryStates).filter(s => s === 'approved').length;
    const total    = Object.values(scanResults).filter(Boolean).length;
    document.getElementById('bottomMsg').textContent =
        total ? `${approved} of ${total} entries approved` : '';
    document.getElementById('updateAllBtn').disabled = approved === 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE (SAVE ALL APPROVED)
// ══════════════════════════════════════════════════════════════════════════════

function wireBottomBar() {
    document.getElementById('updateAllBtn').addEventListener('click', updateAll);
}

async function updateAll() {
    const btn = document.getElementById('updateAllBtn');
    btn.disabled    = true;
    btn.textContent = '⏳ Saving…';

    const bar  = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    bar.style.display = 'block';

    const approved = SITE_CONFIGS.filter(c =>
        entryStates[c.name] === 'approved' && scanResults[c.name]
    );

    let done = 0;
    const results = [];

    for (const cfg of approved) {
        const card  = document.getElementById(`ec-${sanitizeId(cfg.name)}`);
        const entry = readCardEntry(cfg, scanResults[cfg.name]);

        // Get the (possibly edited) image path from the card
        const imgPathInput = card ? card.querySelector('.img-path-input') : null;
        const imgRelPath   = imgPathInput ? imgPathInput.value.trim() : computeImagePath(cfg, entry);

        setBottomMsg(`Saving ${cfg.name}…`);

        // 1. Save image
        const imgResult = await window.api.saveImage({
            imageUrl: entry.poster,
            destPath: imgRelPath
        });

        // 2. Append CSV
        const csvResult = await window.api.appendCSV({ config: cfg, entry });

        // 3. Sync Sheets
        const sheetsResult = await window.api.syncSheets({ entry, config: cfg });

        results.push({ cfg, imgResult, csvResult, sheetsResult });

        // Mark card as saved
        setEntryState(cfg.name, 'saved');
        const savedLabel = card ? card.querySelector('.ec-saved-label') : null;
        if (savedLabel) savedLabel.style.display = 'inline';

        done++;
        fill.style.width = `${Math.round((done / approved.length) * 100)}%`;
    }

    // 4. Git push (once, after all saves)
    if (settings.gitRepoPath) {
        setBottomMsg('Pushing to GitHub…');
        const gitResult = await window.api.gitPush();
        if (gitResult.success) {
            setBottomMsg('✓ All saved and pushed to GitHub!');
        } else if (gitResult.skipped) {
            setBottomMsg(`✓ All saved. Git: ${gitResult.reason}`);
        } else {
            setBottomMsg(`✓ Saved. Git error: ${gitResult.error}`);
        }
    } else {
        setBottomMsg('✓ All approved entries saved!');
    }

    bar.style.display   = 'none';
    fill.style.width    = '0%';
    btn.textContent     = '⬆ Update All Approved';
    btn.disabled        = false;
}

function setBottomMsg(msg) {
    document.getElementById('bottomMsg').textContent = msg;
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS PAGE
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_URLS = {
    "Letterboxd":    "https://letterboxd.com/doerrhb/diary/for/2026/",
    "Goodreads":     "https://www.goodreads.com/review/list/100083179-heath-doerr?order=d&read_at=2026&sort=date_read&view=table",
    "Backloggd":     "https://backloggd.com/u/doerrhb/journal/dates/year:2026/",
    "BoardGameGeek": "https://boardgamegeek.com/geekplay.php?userid=349835&redirect=1&startdate=2026-01-01&dateinput=2026-01-01&dateinput=2026-12-31&enddate=2026-12-31&action=bydate&subtype=boardgame",
    "Serializd":     "https://www.serializd.com/user/doerrhb/diary"
};

const DEFAULT_TABS = {
    "Letterboxd": "Movies", "Goodreads": "Books",
    "Backloggd": "Video Games", "BoardGameGeek": "Board Games", "Serializd": "TV Shows"
};

function buildSettingsPage() {
    // ── Diary URL fields ──────────────────────────────────────────────────────
    const urlContainer = document.getElementById('urlFields');
    urlContainer.innerHTML = '';
    const urls = settings.diaryUrls || {};

    SITE_CONFIGS.forEach(cfg => {
        const div = document.createElement('div');
        div.className = 's-field';
        div.innerHTML = `
            <label>${cfg.name}</label>
            <input type="url" id="url-${sanitizeId(cfg.name)}"
                   value="${escHtml(urls[cfg.name] || DEFAULT_URLS[cfg.name] || '')}"
                   placeholder="https://…">
        `;
        urlContainer.appendChild(div);
    });

    // ── Tab name fields ───────────────────────────────────────────────────────
    const tabContainer = document.getElementById('tabNameFields');
    tabContainer.innerHTML = '';
    const tabs = settings.sheetsTabNames || {};

    SITE_CONFIGS.forEach(cfg => {
        const div = document.createElement('div');
        div.className = 's-field';
        div.innerHTML = `
            <label>${cfg.name}</label>
            <input type="text" id="tab-${sanitizeId(cfg.name)}"
                   value="${escHtml(tabs[cfg.name] || DEFAULT_TABS[cfg.name] || cfg.sheetTab || '')}"
                   placeholder="${DEFAULT_TABS[cfg.name] || cfg.sheetTab}">
        `;
        tabContainer.appendChild(div);
    });

    // ── Pre-fill other settings ───────────────────────────────────────────────
    if (settings.imageBaseFolder)  document.getElementById('imageFolderInput').value = settings.imageBaseFolder;
    if (settings.sheetsScriptUrl)  document.getElementById('sheetsUrlInput').value   = settings.sheetsScriptUrl;
    if (settings.gitRepoPath)      document.getElementById('gitRepoInput').value     = settings.gitRepoPath;

    // ── Save: URLs ────────────────────────────────────────────────────────────
    document.getElementById('saveUrlsBtn').addEventListener('click', async () => {
        const newUrls = {};
        SITE_CONFIGS.forEach(cfg => {
            const el = document.getElementById(`url-${sanitizeId(cfg.name)}`);
            if (el) newUrls[cfg.name] = el.value.trim();
        });
        settings.diaryUrls = newUrls;
        await window.api.saveSettings(settings);
        buildSiteGrid();    // refresh login buttons with new URLs
        showMsg('urlsMsg', 'URLs saved!', 'ok');
    });

    // ── Save: folder ──────────────────────────────────────────────────────────
    document.getElementById('browseFolderBtn').addEventListener('click', async () => {
        const folder = await window.api.chooseFolder();
        if (folder) document.getElementById('imageFolderInput').value = folder;
    });
    document.getElementById('saveFolderBtn').addEventListener('click', async () => {
        settings.imageBaseFolder = document.getElementById('imageFolderInput').value.trim();
        await window.api.saveSettings(settings);
        showMsg('folderMsg', 'Folder saved!', 'ok');
    });

    // ── Save: Sheets ──────────────────────────────────────────────────────────
    document.getElementById('saveSheetBtn').addEventListener('click', async () => {
        settings.sheetsScriptUrl = document.getElementById('sheetsUrlInput').value.trim();
        const tabs = {};
        SITE_CONFIGS.forEach(cfg => {
            const el = document.getElementById(`tab-${sanitizeId(cfg.name)}`);
            if (el) tabs[cfg.name] = el.value.trim() || DEFAULT_TABS[cfg.name];
        });
        settings.sheetsTabNames = tabs;
        await window.api.saveSettings(settings);
        applySettings();
        showMsg('sheetsMsg', 'Sheets settings saved!', 'ok');
    });

    // ── Test Sheets ───────────────────────────────────────────────────────────
    document.getElementById('testSheetBtn').addEventListener('click', async () => {
        const url = document.getElementById('sheetsUrlInput').value.trim();
        if (!url) { showMsg('sheetsMsg', 'Enter a URL first.', 'err'); return; }
        showMsg('sheetsMsg', 'Testing…', 'ok');
        const tabs       = settings.sheetsTabNames || DEFAULT_TABS;
        const firstTab   = Object.values(tabs)[0] || 'Movies';
        // Temporarily use a fake config for the test
        const testResult = await window.api.syncSheets({
            entry: { title: '__TEST__', date: new Date().toLocaleDateString('en-US') },
            config: { csvFields: ['title','date'], sheetTab: firstTab, name: SITE_CONFIGS[0].name }
        });
        if (testResult.success && !testResult.duplicate)
            showMsg('sheetsMsg', `✓ Connected! Test row added to "${firstTab}" tab.`, 'ok');
        else if (testResult.duplicate)
            showMsg('sheetsMsg', '✓ Connected! (duplicate guard fired — already exists)', 'ok');
        else if (testResult.error)
            showMsg('sheetsMsg', `✗ Error: ${testResult.error}`, 'err');
        else
            showMsg('sheetsMsg', '✗ Could not connect. Check the URL.', 'err');
    });

    // ── Save: Git ─────────────────────────────────────────────────────────────
    document.getElementById('browseRepoBtn').addEventListener('click', async () => {
        const folder = await window.api.chooseFolder();
        if (folder) document.getElementById('gitRepoInput').value = folder;
    });
    document.getElementById('saveGitBtn').addEventListener('click', async () => {
        settings.gitRepoPath = document.getElementById('gitRepoInput').value.trim();
        await window.api.saveSettings(settings);
        applySettings();
        showMsg('gitMsg', 'Git settings saved!', 'ok');
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// NAV
// ══════════════════════════════════════════════════════════════════════════════

function wireNavTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`page-${tab.dataset.tab}`).classList.add('active');
        });
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function sanitizeId(name)       { return name.replace(/[^a-z0-9]/gi, '_'); }
function sanitizeFilename(text) { return (text||'').replace(/[^\w\d\-]/g,'_').replace(/_+/g,'_').toLowerCase().slice(0,80); }
function escHtml(str)           { return (str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function showMsg(id, msg, type, ms) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent  = msg;
    el.className    = `s-msg ${type}`;
    el.style.display = 'block';
    if (ms !== 0) setTimeout(() => { el.style.display = 'none'; }, ms || 3000);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
init();
