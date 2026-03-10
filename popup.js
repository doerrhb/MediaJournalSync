document.addEventListener('DOMContentLoaded', async () => {

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const exportBtn      = document.getElementById('exportBtn');
    const openSourcesBtn = document.getElementById('openSourcesBtn');
    const settingsLink   = document.getElementById('settingsLink');
    const statusDiv      = document.getElementById('status');
    const sheetsBadge    = document.getElementById('sheetsBadge');

    // ── Current tab ───────────────────────────────────────────────────────────
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    // ── Load settings ─────────────────────────────────────────────────────────
    const sheetsSettings = await browser.storage.local.get("sheets_config");
    const sheetsConfig   = sheetsSettings.sheets_config || {};
    const scriptUrl      = sheetsConfig.scriptUrl || "";
    const tabNames       = sheetsConfig.tabNames  || {};

    // Load custom image folders (set in options, fall back to config defaults)
    const folderSettings = await browser.storage.local.get("image_folders");
    const imageFolders   = (folderSettings.image_folders) || {};

    // ── Sheets badge ──────────────────────────────────────────────────────────
    if (scriptUrl) {
        sheetsBadge.textContent = "Sheets ✓";
        sheetsBadge.classList.remove("off");
    }

    // ── Check if page is supported ────────────────────────────────────────────
    const matchedConfig = SITE_CONFIGS.find(c =>
        tab.url.includes(c.urlPattern) && tab.url.includes(c.pathPattern)
    );
    if (!matchedConfig) {
        exportBtn.disabled = true;
        exportBtn.title    = "Navigate to a supported diary/journal page first.";
    }

    let currentEntry  = null;
    let currentConfig = null;

    // ══════════════════════════════════════════════════════════════════════════
    // Scrape
    // ══════════════════════════════════════════════════════════════════════════

    exportBtn.addEventListener('click', async () => {
        showStatus("Scraping page…", "#555");

        try {
            const response = await browser.runtime.sendMessage({
                action: "scrape_page",
                tab: tab
            });

            if (response && response.success) {
                hideStatus();
                currentEntry  = response.entry;
                currentConfig = response.config;

                populateReviewPanel(currentEntry, currentConfig);

                document.getElementById('mainMenu').style.display     = "none";
                document.getElementById('reviewSection').style.display = "block";
            } else {
                showStatus("❌ " + (response ? response.error : "Unknown error"), "red");
            }
        } catch (err) {
            showStatus("❌ " + err.message, "red");
        }
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Populate review panel
    // ══════════════════════════════════════════════════════════════════════════

    function populateReviewPanel(entry, config) {

        // Site label
        document.getElementById('siteLabel').textContent = config.name;

        // ── Editable fields ───────────────────────────────────────────────────
        setField('reviewTitle',    entry.title,    true);
        setField('reviewDate',     entry.date,     false);
        setField('reviewRating',   entry.rating,   false);
        setField('reviewYear',     entry.year,     false);
        setField('reviewPlatform', entry.platform, false);

        // Adjust date label by site
        const dateLabels = {
            "Goodreads":     "Date Read",
            "Backloggd":     "Date Played",
            "BoardGameGeek": "Date Played",
        };
        document.getElementById('dateLabelTxt').textContent =
            dateLabels[config.name] || "Date Watched";

        // Show/hide year and platform rows
        const fields = config.csvFields || [];
        document.getElementById('yearField').style.display     = fields.includes("year")     ? "" : "none";
        document.getElementById('platformField').style.display = fields.includes("platform") ? "" : "none";

        // ── Poster ────────────────────────────────────────────────────────────
        const posterImg     = document.getElementById('reviewPoster');
        const posterMissing = document.getElementById('posterMissing');
        if (entry.poster) {
            posterImg.src       = entry.poster;
            posterImg.style.display    = "block";
            posterMissing.style.display = "none";
        } else {
            posterImg.style.display    = "none";
            posterMissing.style.display = "flex";
        }

        // ── Sheets preview ────────────────────────────────────────────────────
        const tabName = tabNames[config.name] || config.sheetTab || config.name;
        document.getElementById('sheetsTabLabel').textContent = `Tab: ${tabName}`;

        const notCfg = document.getElementById('sheetsNotCfg');
        notCfg.style.display = scriptUrl ? "none" : "inline";

        const headers = (config.csvHeaders || "").split(",");
        const vals    = buildRowValues(entry, config);

        const headerRow = document.getElementById('sheetsHeaderRow');
        const dataRow   = document.getElementById('sheetsDataRow');
        headerRow.innerHTML = "";
        dataRow.innerHTML   = "";

        headers.forEach((h, i) => {
            const hCell = document.createElement('div');
            hCell.className   = "sp-cell";
            hCell.textContent = h.trim();
            headerRow.appendChild(hCell);

            const dCell = document.createElement('div');
            const val   = (vals[i] || "").toString().trim();
            dCell.className   = "sp-cell" + (val ? "" : " empty");
            dCell.textContent = val || "(missing)";
            dCell.title       = val;          // tooltip for long values
            dataRow.appendChild(dCell);
        });

        // ── Image save path ───────────────────────────────────────────────────
        const thumbImg     = document.getElementById('thumbPreview');
        const thumbMissing = document.getElementById('thumbMissing');
        if (entry.poster) {
            thumbImg.src              = entry.poster;
            thumbImg.style.display    = "block";
            thumbMissing.style.display = "none";
        } else {
            thumbImg.style.display    = "none";
            thumbMissing.style.display = "flex";
        }

        // Build the default file path
        const folder       = imageFolders[config.name] || config.folder;
        const safeTitle    = sanitizeFilename(entry.title || "unknown");
        const suffix       = entry.year
            ? `_${entry.year}`
            : (entry.date ? `_${entry.date.replace(/\//g, '-')}` : '');
        const defaultPath  = `${folder}/${safeTitle}${suffix}.jpg`;

        document.getElementById('imagePathInput').value = defaultPath;
        document.getElementById('imageSourceUrl').textContent =
            entry.poster ? `Source: ${entry.poster}` : "No image URL found — nothing will be downloaded.";

        // Save button label
        document.getElementById('saveBtn').textContent =
            scriptUrl
                ? "✓ Confirm — Save Image + Sync to Sheets"
                : "✓ Confirm — Save Image Only (Sheets not configured)";
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Live preview: update Sheets row as user types
    // ══════════════════════════════════════════════════════════════════════════

    ['reviewTitle','reviewDate','reviewRating','reviewYear','reviewPlatform'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            if (!currentConfig) return;
            // Sync typed values back to a temporary entry copy for preview
            const preview = Object.assign({}, currentEntry, {
                title:    document.getElementById('reviewTitle').value,
                date:     document.getElementById('reviewDate').value,
                rating:   document.getElementById('reviewRating').value,
                year:     document.getElementById('reviewYear').value,
                platform: document.getElementById('reviewPlatform').value,
            });
            refreshSheetsPreview(preview, currentConfig);
            refreshImagePath(preview, currentConfig);
        });
    });

    function refreshSheetsPreview(entry, config) {
        const vals    = buildRowValues(entry, config);
        const cells   = document.getElementById('sheetsDataRow').children;
        for (let i = 0; i < cells.length; i++) {
            const val = (vals[i] || "").toString().trim();
            cells[i].textContent = val || "(missing)";
            cells[i].className   = "sp-cell" + (val ? "" : " empty");
        }
    }

    function refreshImagePath(entry, config) {
        const folder    = imageFolders[config.name] || config.folder;
        const safeTitle = sanitizeFilename(entry.title || "unknown");
        const suffix    = entry.year
            ? `_${entry.year}`
            : (entry.date ? `_${entry.date.replace(/\//g, '-')}` : '');
        document.getElementById('imagePathInput').value = `${folder}/${safeTitle}${suffix}.jpg`;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Save
    // ══════════════════════════════════════════════════════════════════════════

    document.getElementById('saveBtn').addEventListener('click', async () => {
        showStatus("Saving…", "#555");

        // Commit edited values
        currentEntry.title    = document.getElementById('reviewTitle').value.trim();
        currentEntry.date     = document.getElementById('reviewDate').value.trim();
        currentEntry.rating   = document.getElementById('reviewRating').value.trim();
        currentEntry.year     = document.getElementById('reviewYear').value.trim();
        currentEntry.platform = document.getElementById('reviewPlatform').value.trim();

        // Use the (possibly edited) image path from the input
        const customImagePath = document.getElementById('imagePathInput').value.trim();

        try {
            const response = await browser.runtime.sendMessage({
                action: "save_entry",
                entry: currentEntry,
                config: currentConfig,
                customImagePath   // pass the user-confirmed path
            });

            if (response && response.success) {
                let msg = "✓ Saved!";
                const sr = response.sheetsResult;
                if      (!sr || sr.skipped)   msg += " (Sheets not configured)";
                else if (sr.duplicate)         msg += " (already in Sheets — row skipped)";
                else if (sr.success)           msg += " + synced to Sheets ✓";
                else                           msg += ` (Sheets error: ${sr.error})`;

                showStatus(msg, "#107c10");
                setTimeout(() => {
                    document.getElementById('reviewSection').style.display = "none";
                    document.getElementById('mainMenu').style.display      = "block";
                    hideStatus();
                }, 2500);
            } else {
                showStatus("❌ " + (response ? response.error : "Unknown error"), "red");
            }
        } catch (err) {
            showStatus("❌ " + err.message, "red");
        }
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Cancel
    // ══════════════════════════════════════════════════════════════════════════

    document.getElementById('cancelBtn').addEventListener('click', () => {
        document.getElementById('reviewSection').style.display = "none";
        document.getElementById('mainMenu').style.display      = "block";
        hideStatus();
        currentEntry  = null;
        currentConfig = null;
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Other buttons
    // ══════════════════════════════════════════════════════════════════════════

    openSourcesBtn.addEventListener('click', async () => {
        const data = await browser.storage.local.get("custom_urls");
        const customUrls = data.custom_urls || {};
        for (const config of SITE_CONFIGS) {
            const url = customUrls[config.name] || getDefaultUrl(config.name);
            if (url) browser.tabs.create({ url });
        }
    });

    document.getElementById('exportAllBtn').addEventListener('click', async () => {
        showStatus("Downloading all CSVs…", "#555");
        await browser.runtime.sendMessage({ action: "export_all" });
        showStatus("✓ All CSVs downloaded!", "#107c10", 2000);
    });

    document.getElementById('debugBtn').addEventListener('click', async () => {
        await browser.runtime.sendMessage({ action: "download_logs" });
    });

    settingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        browser.runtime.openOptionsPage();
    });

    // ══════════════════════════════════════════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════════════════════════════════════════

    function buildRowValues(entry, config) {
        return (config.csvFields || []).map(f => entry[f] || "");
    }

    function setField(id, value, required) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value     = value || "";
        el.className = "field-input" + (value ? " ok" : (required ? " missing" : ""));
    }

    function sanitizeFilename(text) {
        return text.replace(/[^\w\d\-]/g, "_").toLowerCase().replace(/_+/g, "_").slice(0, 80);
    }

    function showStatus(msg, color, autoDismissMs) {
        statusDiv.textContent    = msg;
        statusDiv.style.color    = color || "#333";
        statusDiv.style.display  = "block";
        statusDiv.style.background = color === "red" ? "#fdecea" : (color === "#107c10" ? "#e8f5e9" : "#e9e9e9");
        if (autoDismissMs) setTimeout(hideStatus, autoDismissMs);
    }

    function hideStatus() {
        statusDiv.style.display = "none";
    }
});

function getDefaultUrl(name) {
    const defaults = {
        "Letterboxd":    "https://letterboxd.com/doerrhb/diary/for/2026/",
        "Goodreads":     "https://www.goodreads.com/review/list/100083179-heath-doerr?order=d&read_at=2026&sort=date_read&view=table",
        "Backloggd":     "https://backloggd.com/u/doerrhb/journal/dates/year:2026/",
        "BoardGameGeek": "https://boardgamegeek.com/geekplay.php?userid=349835&redirect=1&startdate=2026-01-01&dateinput=2026-01-01&dateinput=2026-12-31&enddate=2026-12-31&action=bydate&subtype=boardgame",
        "Serializd":     "https://www.serializd.com/user/doerrhb/diary"
    };
    return defaults[name];
}
