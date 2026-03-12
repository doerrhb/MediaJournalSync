/* ═══════════════════════════════════════════════════════
   Media Journal Sync — Renderer / app.js
   ═══════════════════════════════════════════════════════ */

let SITE_CONFIGS = [];
let settings     = {};
let scanResults  = {};
let entryStates  = {};
let sheetsOk     = false;   // true only after a successful ping or confirmed working append
let dupWarnings  = {};       // { siteName: { match: 'Title', score: 0.9 } }

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
// FUZZY DUPLICATE DETECTION
// ══════════════════════════════════════════════════════════════════════════════

function normalizeTitle(str) {
    return (str || '').toLowerCase()
        .replace(/[''`]/g, "'")
        .replace(/[^a-z0-9' ]/g, ' ')
        .replace(/\b(a|an|the)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

function titleSimilarity(a, b) {
    const na = normalizeTitle(a), nb = normalizeTitle(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.95;
    const maxLen = Math.max(na.length, nb.length);
    return maxLen === 0 ? 1 : 1 - levenshtein(na, nb) / maxLen;
}

// Check a scraped entry against the last row stored in Sheets for that tab.
// Returns { isDuplicate, score, matchedTitle } or null if check couldn't run.
async function checkDuplicate(cfg, entry) {
    if (!sheetsOk || !settings.sheetsScriptUrl) return null;

    const tabName = ((settings.sheetsTabNames || {})[cfg.name]) || cfg.sheetTab;
    try {
        const res = await window.api.readLastRow({ tab: tabName });
        if (!res.ok || !res.row || !res.row.length) return null;

        // The first csvField is always the title
        const lastTitle = (res.row[0] || '').toString();
        const score = titleSimilarity(entry.title, lastTitle);
        const isDuplicate = score >= 0.75;
        return { isDuplicate, score: Math.round(score * 100), matchedTitle: lastTitle };
    } catch {
        return null;
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

    // ── Sheets connectivity check ─────────────────────────────────────────────
    await checkSheetsOnInit();
}

function applySettings() {
    const sp = document.getElementById('sheetsPill');
    if (settings.sheetsScriptUrl) { sp.textContent = 'Sheets ✓'; sp.className = 'pill sheets-on'; }
    const gp = document.getElementById('gitPill');
    if (settings.gitRepoPath && settings.gitAutoPush) {
        gp.textContent = 'Git ✓'; gp.className = 'pill git-on';
    } else if (settings.gitRepoPath) {
        gp.textContent = 'Git (manual)'; gp.className = 'pill git-on';
    } else {
        gp.textContent = 'Git ✗'; gp.className = 'pill git-off';
    }
}

// ── Status bar ────────────────────────────────────────────────────────────────
function setStatus(state, text) {
    const bar  = document.getElementById('statusBar');
    const span = document.getElementById('statusText');
    if (!bar || !span) return;
    bar.className  = state;   // 'ready' | 'scanning' | 'done' | 'error'
    span.textContent = text;
}

// ── Sheets gate ───────────────────────────────────────────────────────────────
// Sheets is MANDATORY — images are named by row number returned from Sheets.
// Scanning is blocked until Sheets is configured and reachable.

function setSheetsBanner(state, msg) {
    let banner = document.getElementById('sheetsBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'sheetsBanner';
        banner.style.cssText = 'position:sticky;top:0;z-index:100;padding:10px 18px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:10px;';
        const mainContent = document.getElementById('mainContent') || document.querySelector('.main-area') || document.body.firstElementChild;
        mainContent.insertBefore(banner, mainContent.firstChild);
    }
    if (state === 'ok') {
        banner.style.cssText += 'background:#1b5e20;color:#a5d6a7;';
        banner.innerHTML = `<span>✓</span><span>${msg}</span>`;
        banner.style.display = 'none';   // hide when ok — no need to show
    } else if (state === 'warn') {
        banner.style.cssText += 'background:#7f3f00;color:#ffcc80;';
        banner.innerHTML = `<span>⚠</span><span>${msg}</span><a href="#" style="margin-left:auto;color:#ffcc80;text-decoration:underline;" id="goToSettings">Open Settings →</a>`;
        banner.style.display = 'flex';
        const link = banner.querySelector('#goToSettings');
        if (link) link.addEventListener('click', e => { e.preventDefault(); document.getElementById('nav-settings')?.click(); });
    } else {
        banner.style.cssText += 'background:#b71c1c;color:#ffcdd2;';
        banner.innerHTML = `<span>✗</span><span>${msg}</span><a href="#" style="margin-left:auto;color:#ffcdd2;text-decoration:underline;" id="goToSettings">Open Settings →</a>`;
        banner.style.display = 'flex';
        const link = banner.querySelector('#goToSettings');
        if (link) link.addEventListener('click', e => { e.preventDefault(); document.getElementById('nav-settings')?.click(); });
    }
}

function setScanButtonsEnabled(enabled) {
    document.querySelectorAll('.scan-btn, #updateAllBtn').forEach(btn => {
        btn.disabled = !enabled;
        btn.title    = enabled ? '' : 'Google Sheets must be configured and reachable before scanning';
        btn.style.opacity = enabled ? '' : '0.4';
    });
}

async function checkSheetsOnInit() {
    if (!settings.sheetsScriptUrl) {
        sheetsOk = false;
        setSheetsBanner('error', 'Google Sheets is not configured. Images are named by sheet row number — scanning is disabled until Sheets is set up.');
        setScanButtonsEnabled(false);
        return;
    }

    setSheetsBanner('warn', 'Checking Google Sheets connection…');
    const result = await window.api.pingSheets();
    if (result.ok) {
        sheetsOk = true;
        setSheetsBanner('ok', 'Sheets connected');
        setScanButtonsEnabled(true);
    } else {
        sheetsOk = false;
        const reason = result.reason === 'timeout'  ? 'Connection timed out.' :
                       result.reason === 'not_configured' ? 'No script URL set.' :
                       `Could not reach script (${result.reason || 'unknown error'}).`;
        setSheetsBanner('error', `Google Sheets unreachable — ${reason} Check your Apps Script URL in Settings. Scanning is disabled.`);
        setScanButtonsEnabled(false);
    }
}

async function recheckSheets() {
    settings = await window.api.loadSettings();
    await checkSheetsOnInit();
}

// ══════════════════════════════════════════════════════════════════════════════
// SITE GRID
// ══════════════════════════════════════════════════════════════════════════════

function buildSiteGrid() {
    const grid = document.getElementById('siteGrid');
    grid.innerHTML = '';
    SITE_CONFIGS.forEach(cfg => {
        const url    = (settings.diaryUrls || {})[cfg.name] || DEFAULT_URLS[cfg.name] || '';
        const safeId = sanitizeId(cfg.name);
        const card   = document.createElement('div');
        card.className = 'site-card';
        card.id = `card-${safeId}`;
        card.innerHTML = `
            <div class="sc-check">
                <input type="checkbox" id="chk-${safeId}" checked>
                <label for="chk-${safeId}" class="sc-name ${cfg.name.replace(/\s+/g,'')}">${cfg.name}</label>
            </div>
            <div class="sc-status" id="status-${safeId}">Ready</div>
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

function isSiteEnabled(name) {
    const el = document.getElementById(`chk-${sanitizeId(name)}`);
    return el ? el.checked : true;
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
    const btn      = document.getElementById('scanAllBtn');
    const selected = SITE_CONFIGS.filter(c => isSiteEnabled(c.name));

    if (selected.length === 0) {
        setStatus('error', 'No sites selected — check at least one site above.');
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Scanning…';
    setStatus('scanning', `Scanning ${selected.length} site${selected.length > 1 ? 's' : ''}…`);

    document.getElementById('reviewArea').style.display = 'none';
    document.getElementById('updateAllBtn').disabled    = true;
    document.getElementById('entryList').innerHTML      = '';
    scanResults = {};
    entryStates = {};
    dupWarnings = {};

    errorCount = 0;
    updateErrorBadge();

    const urls = settings.diaryUrls || {};

    for (const cfg of selected) {
        setSiteStatus(cfg.name, 'Scanning…', 'scanning');
        setStatus('scanning', `Scanning ${cfg.name}…`);
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
                scanResults[cfg.name] = result;

                // ── Fuzzy duplicate check against last Sheets row ─────────────
                setSiteStatus(cfg.name, 'Checking for duplicates…', 'scanning');
                const dup = await checkDuplicate(cfg, result);
                if (dup && dup.isDuplicate) {
                    dupWarnings[cfg.name] = dup;
                    entryStates[cfg.name] = 'duplicate';
                    setSiteStatus(cfg.name, `⚠ Possible duplicate (${dup.score}% match)`, 'error');
                } else {
                    entryStates[cfg.name] = 'approved';
                    setSiteStatus(cfg.name, `✓ ${result.title}`, 'done');
                }
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
    btn.textContent = '▶ Scan Selected Sites';

    const found = selected.filter(c => scanResults[c.name]);
    if (found.length > 0) {
        buildReviewCards(found);
        document.getElementById('reviewArea').style.display = 'flex';
        document.getElementById('updateAllBtn').disabled    = false;
        document.getElementById('reviewArea').scrollIntoView({ behavior: 'smooth' });
        const dupCount = found.filter(c => entryStates[c.name] === 'duplicate').length;
        setStatus('done',
            dupCount > 0
                ? `${found.length} result${found.length > 1 ? 's' : ''} ready — ${dupCount} possible duplicate${dupCount > 1 ? 's' : ''}`
                : `${found.length} result${found.length > 1 ? 's' : ''} ready for review`
        );
    } else {
        setStatus('error', 'No entries found — check the Logs tab for details.');
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
        const isDup = entryStates[cfg.name] === 'duplicate';
        const card = document.createElement('div');
        card.className = `entry-card ${isDup ? 'duplicate' : 'approved'}`;
        card.id = `ec-${sanitizeId(cfg.name)}`;
        card.innerHTML = buildCardHTML(cfg, entry, isDup ? dupWarnings[cfg.name] : null);
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
                refreshImagePath(card, cfg);
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

function buildCardHTML(cfg, entry, dupInfo) {
    const tabName    = ((settings.sheetsTabNames || {})[cfg.name]) || cfg.sheetTab;
    const posterHTML = entry.poster
        ? `<img src="${entry.poster}" alt="Cover" loading="lazy"><div class="qual-badge" style="display:none;"></div>`
        : `<div class="no-img"><span style="font-size:28px">🖼</span>No image found</div>`;
    const imgPath    = computeImagePath(cfg);
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

    const dupBanner = dupInfo ? `
        <div class="dup-banner">
            <span class="dup-icon">⚠</span>
            <span>Possible duplicate — last entry was <strong>"${dupInfo.matchedTitle.replace(/</g,'&lt;')}"</strong> (${dupInfo.score}% match). Override below if this is a different entry.</span>
        </div>` : '';

    const approveLabel = dupInfo ? '⚠ Approve Anyway' : '✓ Approve';
    const approveClass = dupInfo ? 'ec-approve dup-override' : 'ec-approve active';

    return `
    <div class="ec-header">
        <div class="ec-site-dot ${cfg.name.replace(/\s+/g,'')}"></div>
        <div class="ec-title">${entry.title || '(no title)'}</div>
        <div class="ec-meta">${entry.date || ''} ${entry.rating ? '· ' + entry.rating : ''}</div>
        <div class="ec-chevron">▼</div>
    </div>
    ${dupBanner}
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
                <button class="${approveClass}">${approveLabel}</button>
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
function refreshImagePath(card, cfg) {
    // Image path is driven by Sheets row number at save time — don't recompute from title
    const input = card.querySelector('.img-path-input');
    if (input && !input.dataset.saved) input.value = computeImagePath(cfg);
}
function rowValues(cfg, entry) { return (cfg.csvFields||[]).map(f => entry[f]||''); }
function computeImagePath(cfg) {
    // Image filename is determined by Sheets row number at save time (e.g. 0034.png).
    // Show a clear placeholder so users understand the format before saving.
    return `${cfg.folder}/####.png  ← set to row number when saved`;
}

function setEntryState(siteName, state) {
    entryStates[siteName] = state;
    const card = document.getElementById(`ec-${sanitizeId(siteName)}`);
    if (!card) return;
    card.className = `entry-card ${state}`;
    const approveBtn = card.querySelector('.ec-approve');
    const skipBtn    = card.querySelector('.ec-skip');
    approveBtn.classList.toggle('active', state === 'approved');
    skipBtn.classList.toggle('active',    state === 'skipped');
    // When user manually approves a duplicate, clear the override styling
    if (state === 'approved') {
        approveBtn.textContent = '✓ Approve';
        approveBtn.classList.remove('dup-override');
        const banner = card.querySelector('.dup-banner');
        if (banner) banner.style.opacity = '0.4';
    }
    updateBottomMsg();
}
function updateBottomMsg() {
    const approved  = Object.values(entryStates).filter(s => s === 'approved').length;
    const dups      = Object.values(entryStates).filter(s => s === 'duplicate').length;
    const total     = Object.values(scanResults).filter(Boolean).length;
    let msg = total ? `${approved} of ${total} entries approved` : '';
    if (dups > 0) msg += ` · ${dups} possible duplicate${dups > 1 ? 's' : ''}`;
    document.getElementById('bottomMsg').textContent = msg;
    document.getElementById('updateAllBtn').disabled = approved === 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE
// ══════════════════════════════════════════════════════════════════════════════

function wireBottomBar() {
    document.getElementById('updateAllBtn').addEventListener('click', updateAll);
}

async function updateAll() {
    // ── Gate: Sheets must be working ─────────────────────────────────────────
    if (!sheetsOk) {
        setBottomMsg('✗ Cannot save — Google Sheets is not configured or unreachable. Check Settings.');
        setSheetsBanner('error', 'Google Sheets is not reachable. Check your Apps Script URL in Settings.');
        return;
    }

    const btn = document.getElementById('updateAllBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Saving…';

    const bar  = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    bar.style.display = 'block';

    const approved = SITE_CONFIGS.filter(c => entryStates[c.name] === 'approved' && scanResults[c.name]);
    let done = 0;

    for (const cfg of approved) {
        const card  = document.getElementById(`ec-${sanitizeId(cfg.name)}`);
        const entry = readCardEntry(cfg, scanResults[cfg.name]);

        setBottomMsg(`Saving ${cfg.name} to Sheets…`);

        // ── Step 1: Append to Google Sheets FIRST — row number drives image name
        const sheetsResult = await window.api.syncSheets({ entry, config: cfg });

        if (sheetsResult.error) {
            setBottomMsg(`✗ Sheets error for ${cfg.name}: ${sheetsResult.error} — entry not saved.`);
            setSheetsBanner('error', `Sheets write failed: ${sheetsResult.error}. Remaining entries not saved.`);
            sheetsOk = false;
            setScanButtonsEnabled(false);
            break;   // stop — row numbers would be wrong for remaining entries too
        }

        const rowNumber = sheetsResult.rowNumber;
        if (!rowNumber) {
            setBottomMsg(`✗ Sheets did not return a row number for ${cfg.name}. Update your Apps Script — see README.`);
            break;
        }

        // ── Step 2: Image filename = zero-padded row number (e.g. row 34 → 0034.png)
        const padded  = rowNumber.toString().padStart(4, '0');
        const imgPath = `${cfg.folder}/${padded}.png`;

        const imgPathInput = card ? card.querySelector('.img-path-input') : null;
        if (imgPathInput) imgPathInput.value = imgPath;

        setBottomMsg(`Saving ${cfg.name} image → ${imgPath}…`);

        // ── Step 3: Download + normalize poster to NNNN.png
        if (entry.poster) {
            await window.api.saveImage({ imageUrl: entry.poster, destPath: imgPath });
        } else {
            setBottomMsg(`⚠ No poster for ${cfg.name} — row ${padded} saved to Sheets without image.`);
        }

        // ── Step 4: Append to local CSV backup
        await window.api.appendCSV({ config: cfg, entry });

        setEntryState(cfg.name, 'saved');
        const savedLabel = card ? card.querySelector('.ec-saved-label') : null;
        if (savedLabel) {
            savedLabel.textContent = `✓ Saved (row ${padded})`;
            savedLabel.style.display = 'inline';
        }

        done++;
        fill.style.width = `${Math.round((done / approved.length) * 100)}%`;
    }

    if (settings.gitRepoPath && settings.gitAutoPush && done > 0) {
        setBottomMsg('Pushing to GitHub…');
        const gitResult = await window.api.gitPush();
        if (gitResult.success)        setBottomMsg('✓ All saved and pushed to GitHub!');
        else if (gitResult.skipped)   setBottomMsg(`✓ All saved. Git: ${gitResult.reason}`);
        else                          setBottomMsg(`✓ Saved. Git error: ${gitResult.error}`);
    } else if (done > 0) {
        setBottomMsg(`✓ ${done} entr${done === 1 ? 'y' : 'ies'} saved!`);
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
    const gitToggleEl = document.getElementById('gitAutoPushToggle');
    if (gitToggleEl) gitToggleEl.checked = !!settings.gitAutoPush;

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
        if (folder) {
            document.getElementById('imageFolderInput').value = folder;
            // Auto-save immediately so the setting is never lost
            settings.imageBaseFolder = folder;
            await window.api.saveSettings(settings);
            showMsg('folderMsg', `✓ Folder set: ${folder}`, 'ok');
        }
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
        showMsg('sheetsMsg', 'Sheets settings saved! Testing connection…', 'ok');
        // Re-check connectivity now that URL may have changed
        await recheckSheets();
        if (sheetsOk) showMsg('sheetsMsg', '✓ Sheets saved and connected!', 'ok');
        else          showMsg('sheetsMsg', '✗ Saved but could not reach Sheets — check the URL.', 'err');
    });

    document.getElementById('testSheetBtn').addEventListener('click', async () => {
        const url = document.getElementById('sheetsUrlInput').value.trim();
        if (!url) { showMsg('sheetsMsg', 'Enter a URL first.', 'err'); return; }
        showMsg('sheetsMsg', 'Testing connection…', 'ok');
        const result = await window.api.pingSheets();
        if (result.ok) {
            sheetsOk = true;
            setScanButtonsEnabled(true);
            setSheetsBanner('ok', 'Sheets connected');
            showMsg('sheetsMsg', '✓ Connected to Sheets script!', 'ok');
        } else {
            sheetsOk = false;
            setScanButtonsEnabled(false);
            showMsg('sheetsMsg', `✗ Could not reach script (${result.reason || 'unknown'}). Check the URL.`, 'err');
        }
    });

    document.getElementById('browseRepoBtn').addEventListener('click', async () => {
        const folder = await window.api.chooseFolder();
        if (folder) document.getElementById('gitRepoInput').value = folder;
    });
    document.getElementById('saveGitBtn').addEventListener('click', async () => {
        settings.gitRepoPath  = document.getElementById('gitRepoInput').value.trim();
        const toggle = document.getElementById('gitAutoPushToggle');
        settings.gitAutoPush  = toggle ? toggle.checked : false;
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
