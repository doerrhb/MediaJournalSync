async function getScrapedData(tab) {
    console.log("Media Journal Sync - Scraping triggered");

    const storageData = await browser.storage.local.get("custom_urls");
    const customUrls = storageData.custom_urls || {};

    const config = SITE_CONFIGS.find(c => {
        return tab.url.includes(c.urlPattern) && tab.url.includes(c.pathPattern);
    });

    if (!config) {
        return { success: false, error: "Not a supported site or page." };
    }

    try {
        // Inject configuration
        await browser.tabs.executeScript(tab.id, {
            code: `var SITE_CONFIG = ${JSON.stringify(config)};`
        });

        // Execute scraper
        const results = await browser.tabs.executeScript(tab.id, {
            file: "scraper.js"
        });

        const entry = results[0];

        // Store debug logs
        if (entry && entry.debugLogs) {
            await browser.storage.local.set({ last_debug_logs: entry.debugLogs });
        }

        if (!entry || entry.error) {
            return {
                success: false,
                error: entry ? entry.error : "No entry found on page.",
                debugLogs: entry ? entry.debugLogs : []
            };
        }

        return { success: true, entry, config };

    } catch (err) {
        console.error("Scrape error:", err);
        return { success: false, error: err.message };
    }
}

async function handleSave(data) {
    const { entry, config, customImagePath } = data;

    try {
        // ── Local CSV storage ──────────────────────────────────────────────────
        const storageKey = `entries_${config.name.toLowerCase()}`;
        const storageData = await browser.storage.local.get(storageKey);
        const entries = storageData[storageKey] || [];

        const exists = entries.find(e =>
            e.title === entry.title && (e.date === entry.date || e.year === entry.year)
        );

        if (!exists) {
            entries.push(entry);
        }

        await browser.storage.local.set({ [storageKey]: entries });

        // ── CSV Download ───────────────────────────────────────────────────────
        const csv = buildCSV(entries, config);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);

        await browser.downloads.download({
            url,
            filename: config.filename,
            conflictAction: "uniquify"
        });

        // ── Image Download ─────────────────────────────────────────────────────
        // Use the user-confirmed path from the review panel if provided.
        if (entry.poster) {
            let imagePath = customImagePath;
            if (!imagePath) {
                const safeTitle = sanitize(entry.title);
                const suffix = entry.year ? `_${entry.year}` : (entry.date ? `_${entry.date.replace(/\//g, '-')}` : '');
                imagePath = `${config.folder}/${safeTitle}${suffix}.jpg`;
            }
            await browser.downloads.download({
                url: entry.poster,
                filename: imagePath,
                conflictAction: "uniquify"
            });
        }

        // ── Google Sheets ──────────────────────────────────────────────────────
        const sheetsResult = await sendToGoogleSheets(entry, config);

        return { success: true, sheetsResult };
    } catch (err) {
        console.error("Save error:", err);
        return { success: false, error: err.message };
    }
}

// ── Google Sheets via Apps Script Web App ────────────────────────────────────

async function sendToGoogleSheets(entry, config) {
    const settings = await browser.storage.local.get("sheets_config");
    const sheetsConfig = settings.sheets_config || {};
    const scriptUrl = sheetsConfig.scriptUrl;

    if (!scriptUrl) {
        console.log("No Apps Script URL configured. Skipping Google Sheets sync.");
        return { skipped: true, reason: "No Apps Script URL configured." };
    }

    // Use the user-configured tab name for this site, falling back to the config default.
    // This ensures we append to the correct existing tab rather than creating a new one.
    const tabNames = sheetsConfig.tabNames || {};
    const tabName = tabNames[config.name] || config.sheetTab;

    const row = buildSheetsRow(entry, config);

    try {
        const response = await fetch(scriptUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tab: tabName, row })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error("Sheets error:", text);
            return { success: false, error: `HTTP ${response.status}: ${text}` };
        }

        const result = await response.json();
        console.log("Sheets response:", result);

        if (!result.success) {
            return { success: false, error: result.error };
        }
        // result.skipped = true means the Apps Script duplicate guard fired
        return { success: true, duplicate: !!result.skipped };

    } catch (err) {
        console.error("Sheets fetch error:", err.message);
        return { success: false, error: err.message };
    }
}

function buildSheetsRow(entry, config) {
    const fields = config.csvFields || ["title", "date", "rating", "year"];
    return fields.map(f => entry[f] || "");
}

// ── CSV Building ─────────────────────────────────────────────────────────────

function buildCSV(entries, config) {
    const headers = config.csvHeaders || "Title,Year";
    const fields = config.csvFields || ["title", "year"];

    let csv = headers + "\n";
    for (const e of entries) {
        const row = fields.map(f => {
            const val = (e[f] || "").toString().replace(/"/g, '""');
            return `"${val}"`;
        });
        csv += row.join(",") + "\n";
    }
    return csv;
}

// ── Debug Logs ────────────────────────────────────────────────────────────────

async function downloadDebugLogs() {
    const data = await browser.storage.local.get("last_debug_logs");
    const logs = data.last_debug_logs || ["No logs found. Try running an export first."];
    const blob = new Blob([logs.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    await browser.downloads.download({
        url,
        filename: "media_sync_debug_log.txt",
        conflictAction: "uniquify"
    });
}

// ── Export All Stored Entries ─────────────────────────────────────────────────

async function exportAllCSVs() {
    for (const config of SITE_CONFIGS) {
        const storageKey = `entries_${config.name.toLowerCase()}`;
        const storageData = await browser.storage.local.get(storageKey);
        const entries = storageData[storageKey] || [];
        if (entries.length === 0) continue;

        const csv = buildCSV(entries, config);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);

        await browser.downloads.download({
            url,
            filename: config.filename,
            conflictAction: "uniquify"
        });
    }
}

// ── Message Handler ───────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scrape_page") {
        getScrapedData(message.tab).then(sendResponse);
        return true;
    } else if (message.action === "save_entry") {
        // message includes: entry, config, customImagePath
        handleSave(message).then(sendResponse);
        return true;
    } else if (message.action === "download_logs") {
        downloadDebugLogs().then(() => sendResponse({ success: true }));
        return true;
    } else if (message.action === "export_all") {
        exportAllCSVs().then(() => sendResponse({ success: true }));
        return true;
    }
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function sanitize(text) {
    return (text || "").replace(/[^\w\d]/g, "_").toLowerCase().slice(0, 80);
}
