/* ═══════════════════════════════════════════════════════
   Media Journal Sync — Renderer / app.js
   ═══════════════════════════════════════════════════════ */

let SITE_CONFIGS = [];
let settings     = {};
let scanResults  = {};
let entryStates  = {};

// ══════════════════════════════════════════════════════════════════════════════
// LOGGING
// ══════════════════════════════════════════════════════════════════════════════

let allLogLines     = [];   // { ts, level, site, message }
let activeFilter    = 'ALL';
let errorCount      = 0;
let autoScroll      = true;

function initLogging() {
    // Receive live log lines from main process
    window.api.onLogLine(data => {
        addLogLine(data);
    });

    // Filter buttons
    document.querySelectorAll('.log-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.level;
            applyLogFilters();
        });
    });

    // Text search
    document.getElementById('logSearch').addEventListener('input', applyLogFilters);

    // Clear
    document.getElementById('clearLogBtn').addEventListener('click', () => {
        allLogLines = [];
        errorCount  = 0;
        document.getElementById('logContainer').innerHTML =
            '<div id="logEmpty" style="color:var(--muted);padding:20px;font-family:inherit;font-size:13px;">Log cleared.</div>';
        updateErrorBadge();
    });

    // Open log folder
    document.getElementById('openLogFolderBtn').addEventListener('click', () => {
        window.api.openLogFolder();
    });

    // Copy all
    document.getElementById('copyLogBtn').addEventListener('click', () => {
        const text = allLogLines
            .map(l => `[${l.ts}] [${l.level}] [${l.site}] ${l.message}`)
            .join('\n');
        navigator.clipboard.writeText(text).catch(() => {});
        const btn = document.getElementById('copyLogBtn');
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy all'; }, 2000);
    });

    // Auto-scroll toggle: if user scrolls up, stop auto-scroll
    const container = document.getElementById('logContainer');
    container.addEventListener('scroll', () => {
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
        autoScroll = atBottom;
    });
}

function addLogLine(data) {
    const { ts, level, site, message } = data;
    allLogLines.push(data);

    // Track errors for badge
    if (level === 'ERROR') {
        errorCount++;
        updateErrorBadge();
        // Flash the Logs tab if not currently active
        const logsTab = document.querySelector('[data-tab="logs"]');
        if (!logsTab.classList.contains('active')) {
            document.getElementById('errorBadge').classList.add('visible');
        }
    }

    const container = document.getElementById('logContainer');

    // Remove the "no entries" placeholder
    const empty = document.getElementById('logEmpty');
    if (empty) empty.remove();

    // Build line element
    const line = document.createElement('div');
    line.className = `log-line level-${level}`;
    line.dataset.level   = level;
    line.dataset.site    = site;
    line.dataset.message = message.toLowerCase();

    // Timestamp: show only HH:MM:SS
    const timeStr = ts ? ts.substring(11, 19) : '';

    line.innerHTML = `
        <span class="ll-ts">${timeStr}</span>
        <span class="ll-level ${level}">${level}</span>
        <span class="ll-site">${escHtml(site)}</span>
        <span class="ll-msg">${escHtml(message)}</span>
    `;

    // Apply current filter immediately
    if (!lineMatchesFilter(data)) {
        line.classList.add('filtered');
    }

    container.appendChild(line);

    // Auto-scroll to bottom
    if (autoScroll) {
        container.scrollTop = container.scrollHeight;
    }
}

function lineMatchesFilter(data) {
    const searchText = (document.getElementById('logSearch')?.value || '').toLowerCase();
    const levelOk = activeFilter === 'ALL' || data.level === activeFilter;
    const textOk  = !searchText ||
        data.message.toLowerCase().includes(searchText) ||
        (data.site || '').toLowerCase().includes(searchText);
    return levelOk && textOk;
}

function applyLogFilters() {
    const container = document.getElementById('logContainer');
    container.querySelectorAll('.log-line').forEach((line, i) => {
        const matches = lineMatchesFilter(allLogLines[i]);
        line.classList.toggle('filtered', !matches);
    });
}

function updateErrorBadge() {
    const badge = document.getElementById('errorBadge');
    if (errorCount > 0) {
        badge.textContent = errorCount > 99 ? '99+' : errorCount;
        badge.classList.add('visible');
    } else {
        badge.classList.remove('visible');
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════════════════════

async function init() {
    SITE_CONFIGS = await window.api.getConfigs();
    settings     = await window.api.loadSettings();

    initLogging();
    applySettings();
    buildSiteGrid();
    buildSettingsPage();
    wireNavTabs();
    wireBottomBar();
}

function applySettings() {
    const sp = document.getElementById('sheetsPill');
    if (settings.sheetsScriptUrl) { sp.textContent = 'Sheets ✓'; sp.className = 'pill sheets-on'; }
    const gp = document.getElementById('gitPill');
    if (settings.gitRepoPath) { gp.textContent = 'Git ✓'; gp.className = 'pill git-on'; }
}

// ══════════════════════════════════════════════════════════════════════════════
// SITE GRID
// ══════════════════════════════════════════════════════════════════════════════

function buildSiteGrid() {
    const grid = document.getElementById('siteGrid');
    grid.innerHTML = '';
    SITE_CONFIGS.forEach(cfg => {
        const url  = (settings.diaryUrls || {})[cfg.name] || DEFAULT_URLS[cfg.name] || '';
        const card = document.createElement('div');
        card.className = 'site-card';
        card.id = `card-${sanitizeId(cfg.name)}`;
        card.innerHTML = `
            <div class="sc-name ${cfg.name.replace(/\s+/g,'')}">${cfg.name}</div>
            <div class="sc-status" id="status-${sanitizeId(cfg.name)}">Ready</div>
            <button class="sc-login" data-site="${cfg.name}" data-url="${url}">🔑 Log in / Open</button>
        `;
        grid.appendChild(card);
    });

    grid.querySelectorAll('.sc-login').forEach(btn => {
        btn.addEventListener('click', () => {
            const url = btn.dataset.url;
            if (url) {
                window.api.openLoginWindow({ url, siteName: btn.dataset.site });
            } else {
                setSiteStatus(btn.dataset.site, '⚠ No URL — add one in Settings', 'error');
            }
        });
    });

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

    document.getElementById('reviewArea').style.display = 'none';
    document.getElementById('updateAllBtn').disabled    = true;
    document.getElementById('entryList').innerHTML      = '';
    scanResults = {};
    entryStates = {};

    // Auto-switch to Logs tab so user can watch progress
    switchTab('logs');
    errorCount = 0;
    updateErrorBadge();

    const urls = settings.diaryUrls || {};

    for (const cfg of SITE_CONFIGS) {
        setSiteStatus(cfg.name, 'Scanning…', 'scanning');
        const url = urls[cfg.name] || DEFAULT_URLS[cfg.name] || '';

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
                setSiteStatus(cfg.name, `✓ ${result.title}`, 'done');
                scanResults[cfg.name] = result;
                entryStates[cfg.name] = 'approved';
            } else {
                setSiteStatus(cfg.name, '✗ Nothing found — see Logs', 'error');
                scanResults[cfg.name] = null;
            }
        } catch (err) {
            setSiteStatus(cfg.name, `✗ ${err.message}`, 'error');
            scanResults[cfg.name] = null;
        }
    }

    btn.disabled    = false;
    btn.textContent = '▶ Scan All Sites';

    const found = SITE_CONFIGS.filter(c => scanResults[c.name]);
    if (found.length > 0) {
        buildReviewCards(found);
        document.getElementById('reviewArea').style.display = 'flex';
        document.getElementById('updateAllBtn').disabled    = false;
        // Switch to scan tab to show the results
        switchTab('scan');
        document.getElementById('reviewArea').scrollIntoView({ behavior: 'smooth' });
    } else {
        // Stay on logs so they can see what went wrong
        document.getElementById('bottomMsg').textContent = 'No entries found — check the Logs tab for details.';
    }

    updateBottomMsg();
}

// ══════════════════════════════════════════════════════════════════════════════
// ENTRY CARDS
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

        const hdr  = card.querySelector('.ec-header');
        const body = card.querySelector('.ec-body');
        hdr.addEventListener('click', () => {
            const open = body.classList.toggle('open');
            hdr.classList.toggle('open', open);
        });
        body.classList.add('open');
        hdr.classList.add('open');

        card.querySelector('.ec-approve').addEventListener('click', e => {
            e.stopPropagation();
            setEntryState(cfg.name, 'approved');
        });
        card.querySelector('.ec-skip').addEventListener('click', e => {
            e.stopPropagation();
            setEntryState(cfg.name, 'skipped');
        });

        cfg.reviewFields.forEach(f => {
            const el = card.querySelector(`[data-field="${f.key}"]`);
            if (!el) return;
            el.addEventListener('input', () => {
                syncEntryFromCard(cfg);
                refreshSheetsPreview(card, cfg, readCardEntry(cfg, entry));
                refreshImagePath(card, cfg, readCardEntry(cfg, entry));
            });
        });

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
    const tabName    = ((settings.sheetsTabNames || {})[cfg.name]) || cfg.sheetTab;
    const posterHTML = entry.poster
        ? `<img src="${entry.poster}" alt="Cover" loading="lazy"><div class="qual-badge" style="display:none;"></div>`
        : `<div class="no-img"><span style="font-size:28px">🖼</span>No image found</div>`;
    const imgPath    = computeImagePath(cfg, entry);
    const fieldsHTML = buildFieldsHTML(cfg, entry);

    const headers = (cfg.csvHeaders || '').split(',').map(h => h.trim());
    const vals    = rowValues(cfg, entry);
    const hCells  = headers.map(h => `<div class="sm-cell">${h}</div>`).join('');
    const vCells  = headers.map((_, i) => {
        const v = (vals[i] || '').toString().trim();
        return `<div class="sm-cell${v ? '' : ' empty'}">${v || '(missing)'}</div>`;
    }).join('');
    const noSheetsNote = settings.sheetsScriptUrl ? '' :
        '<span style="margin-left:auto;color:#ef5350;font-size:10px;">⚠ not configured</span>';

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
                <label style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);display:block;margin-bottom:4px;">📁 Save image as</label>
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
    const fields = cfg.reviewFields || [];
    let html = '', i = 0;
    while (i < fields.length) {
        const f = fields[i];
        if (f.width === 'full') {
            const val = entry[f.key] || '';
            html += `<div class="field-row"><div class="field-group full">
                <label>${f.label}</label>
                <input type="text" data-field="${f.key}" value="${escHtml(val)}"
                       placeholder="${f.placeholder||''}" class="${val?'ok':(f.required?'missing':'')}">
            </div></div>`;
            i++;
        } else {
            const pair = [];
            while (i < fields.length && fields[i].width !== 'full' && pair.length < 2) pair.push(fields[i++]);
            const cells = pair.map(pf => {
                const val = entry[pf.key] || '';
                return `<div class="field-group">
                    <label>${pf.label}</label>
                    <input type="text" data-field="${pf.key}" value="${escHtml(val)}"
                           placeholder="${pf.placeholder||''}" class="${val?'ok':(pf.required?'missing':'')}">
                </div>`;
            }).join('');
            html += `<div class="field-row">${cells}</div>`;
        }
    }
    return html;
}

function readCardEntry(cfg, baseEntry) {
    const card = document.getElementById(`ec-${sanitizeId(cfg.name)}`);
    const out  = Object.assign({}, baseEntry);
    if (!card) return out;
    card.querySelectorAll('[data-field]').forEach(el => { out[el.dataset.field] = el.value.trim(); });
    return out;
}
function syncEntryFromCard(cfg) { scanResults[cfg.name] = readCardEntry(cfg, scanResults[cfg.name]); }

function refreshSheetsPreview(card, cfg, entry) {
    const vals  = rowValues(cfg, entry);
    const cells = card.querySelectorAll('.sheets-vals .sm-cell');
    cells.forEach((c, i) => {
        const v = (vals[i]||'').toString().trim();
        c.textContent = v || '(missing)';
        c.className   = `sm-cell${v ? '' : ' empty'}`;
    });
}
function refreshImagePath(card, cfg, entry) {
    const input = card.querySelector('.img-path-input');
    if (input) input.value = computeImagePath(cfg, entry);
}
function rowValues(cfg, entry) { return (cfg.csvFields||[]).map(f => entry[f]||''); }
function computeImagePath(cfg, entry) {
    const subFolder  = cfg.folder;
    const safeTitle  = sanitizeFilename(entry.title || 'unknown');
    const suffix     = entry.year ? `_${entry.year}` : (entry.date ? `_${entry.date.replace(/\//g,'-')}` : '');
    return `${subFolder}/${safeTitle}${suffix}.jpg`;
}

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
    document.getElementById('bottomMsg').textContent = total ? `${approved} of ${total} entries approved` : '';
    document.getElementById('updateAllBtn').disabled = approved === 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE
// ══════════════════════════════════════════════════════════════════════════════

function wireBottomBar() {
    document.getElementById('updateAllBtn').addEventListener('click', updateAll);
}

async function updateAll() {
    const btn = document.getElementById('updateAllBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Saving…';

    const bar  = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    bar.style.display = 'block';

    const approved = SITE_CONFIGS.filter(c => entryStates[c.name] === 'approved' && scanResults[c.name]);
    let done = 0;

    for (const cfg of approved) {
        const card         = document.getElementById(`ec-${sanitizeId(cfg.name)}`);
        const entry        = readCardEntry(cfg, scanResults[cfg.name]);
        const imgPathInput = card ? card.querySelector('.img-path-input') : null;
        const imgRelPath   = imgPathInput ? imgPathInput.value.trim() : computeImagePath(cfg, entry);

        setBottomMsg(`Saving ${cfg.name}…`);

        await window.api.saveImage({ imageUrl: entry.poster, destPath: imgRelPath });
        await window.api.appendCSV({ config: cfg, entry });
        await window.api.syncSheets({ entry, config: cfg });

        setEntryState(cfg.name, 'saved');
        const savedLabel = card ? card.querySelector('.ec-saved-label') : null;
        if (savedLabel) savedLabel.style.display = 'inline';

        done++;
        fill.style.width = `${Math.round((done / approved.length) * 100)}%`;
    }

    if (settings.gitRepoPath) {
        setBottomMsg('Pushing to GitHub…');
        const gitResult = await window.api.gitPush();
        if (gitResult.success)        setBottomMsg('✓ All saved and pushed to GitHub!');
        else if (gitResult.skipped)   setBottomMsg(`✓ All saved. Git: ${gitResult.reason}`);
        else                          setBottomMsg(`✓ Saved. Git error: ${gitResult.error}`);
    } else {
        setBottomMsg('✓ All approved entries saved!');
    }

    bar.style.display = 'none';
    fill.style.width  = '0%';
    btn.textContent   = '⬆ Update All Approved';
    btn.disabled      = false;
}

function setBottomMsg(msg) { document.getElementById('bottomMsg').textContent = msg; }

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
    "Letterboxd":"Movies","Goodreads":"Books","Backloggd":"Video Games",
    "BoardGameGeek":"Board Games","Serializd":"TV Shows"
};

function buildSettingsPage() {
    // URLs
    const urlContainer = document.getElementById('urlFields');
    urlContainer.innerHTML = '';
    const urls = settings.diaryUrls || {};
    SITE_CONFIGS.forEach(cfg => {
        const div = document.createElement('div');
        div.className = 's-field';
        div.innerHTML = `<label>${cfg.name}</label>
            <input type="url" id="url-${sanitizeId(cfg.name)}"
                   value="${escHtml(urls[cfg.name] || DEFAULT_URLS[cfg.name] || '')}" placeholder="https://…">`;
        urlContainer.appendChild(div);
    });

    // Tab names
    const tabContainer = document.getElementById('tabNameFields');
    tabContainer.innerHTML = '';
    const tabs = settings.sheetsTabNames || {};
    SITE_CONFIGS.forEach(cfg => {
        const div = document.createElement('div');
        div.className = 's-field';
        div.innerHTML = `<label>${cfg.name}</label>
            <input type="text" id="tab-${sanitizeId(cfg.name)}"
                   value="${escHtml(tabs[cfg.name] || DEFAULT_TABS[cfg.name] || cfg.sheetTab || '')}"
                   placeholder="${DEFAULT_TABS[cfg.name] || cfg.sheetTab}">`;
        tabContainer.appendChild(div);
    });

    if (settings.imageBaseFolder) document.getElementById('imageFolderInput').value = settings.imageBaseFolder;
    if (settings.sheetsScriptUrl) document.getElementById('sheetsUrlInput').value   = settings.sheetsScriptUrl;
    if (settings.gitRepoPath)     document.getElementById('gitRepoInput').value     = settings.gitRepoPath;

    document.getElementById('saveUrlsBtn').addEventListener('click', async () => {
        const newUrls = {};
        SITE_CONFIGS.forEach(cfg => {
            const el = document.getElementById(`url-${sanitizeId(cfg.name)}`);
            if (el) newUrls[cfg.name] = el.value.trim();
        });
        settings.diaryUrls = newUrls;
        await window.api.saveSettings(settings);
        buildSiteGrid();
        showMsg('urlsMsg', 'URLs saved!', 'ok');
    });

    document.getElementById('browseFolderBtn').addEventListener('click', async () => {
        const folder = await window.api.chooseFolder();
        if (folder) document.getElementById('imageFolderInput').value = folder;
    });
    document.getElementById('saveFolderBtn').addEventListener('click', async () => {
        settings.imageBaseFolder = document.getElementById('imageFolderInput').value.trim();
        await window.api.saveSettings(settings);
        showMsg('folderMsg', 'Folder saved!', 'ok');
    });

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

    document.getElementById('testSheetBtn').addEventListener('click', async () => {
        const url = document.getElementById('sheetsUrlInput').value.trim();
        if (!url) { showMsg('sheetsMsg', 'Enter a URL first.', 'err'); return; }
        showMsg('sheetsMsg', 'Testing…', 'ok');
        const tabs     = settings.sheetsTabNames || DEFAULT_TABS;
        const firstTab = Object.values(tabs)[0] || 'Movies';
        const result   = await window.api.syncSheets({
            entry: { title: '__TEST__', date: new Date().toLocaleDateString('en-US') },
            config: { csvFields: ['title','date'], sheetTab: firstTab, name: SITE_CONFIGS[0].name }
        });
        if (result.success && !result.duplicate) showMsg('sheetsMsg', `✓ Connected! Test row added to "${firstTab}".`, 'ok');
        else if (result.duplicate)               showMsg('sheetsMsg', '✓ Connected! (duplicate guard fired)', 'ok');
        else if (result.error)                   showMsg('sheetsMsg', `✗ ${result.error}`, 'err');
        else                                     showMsg('sheetsMsg', '✗ Could not connect. Check the URL.', 'err');
    });

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
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
}

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t  => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    // Clear error badge when user opens logs
    if (name === 'logs') {
        errorCount = 0;
        updateErrorBadge();
    }
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
    el.textContent = msg; el.className = `s-msg ${type}`; el.style.display = 'block';
    if (ms !== 0) setTimeout(() => { el.style.display = 'none'; }, ms || 3000);
}

init();
