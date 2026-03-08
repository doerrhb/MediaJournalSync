async function getScrapedData(tab) {
    console.log("Media Journal Sync - Scraping triggered");

    // Load configs from storage or fallback to SITE_CONFIGS
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
            await browser.storage.local.get("last_debug_logs").then(async (data) => {
                await browser.storage.local.set({ last_debug_logs: entry.debugLogs });
            });
        }

        if (!entry || entry.error) {
            return { success: false, error: entry ? entry.error : "No entry found on page.", debugLogs: entry ? entry.debugLogs : [] };
        }

        return { success: true, entry, config };

    } catch (err) {
        console.error("Scrape error:", err);
        return { success: false, error: err.message };
    }
}

async function handleSave(data) {
    const { entry, config } = data;
    
    try {
        const storageKey = `entries_${config.name.toLowerCase()}`;
        const storageData = await browser.storage.local.get(storageKey);
        const entries = storageData[storageKey] || [];

        const exists = entries.find(e =>
            e.title === entry.title && e.year === entry.year
        );

        if (!exists) {
            entries.push(entry);
        }

        await browser.storage.local.set({ [storageKey]: entries });

        // Downloads
        const csv = buildCSV(entries);
        const blob = new Blob([csv], {type: "text/csv"});
        const url = URL.createObjectURL(blob);

        await browser.downloads.download({
            url,
            filename: config.filename,
            conflictAction: "uniquify"
        });

        if (entry.poster) {
            await browser.downloads.download({
                url: entry.poster,
                filename: `${config.folder}/${sanitize(entry.title)}_${entry.year || 'unknown'}.jpg`,
                conflictAction: "uniquify"
            });
        }

        return { success: true };
    } catch (err) {
        console.error("Save error:", err);
        return { success: false, error: err.message };
    }
}

async function downloadDebugLogs() {
    const data = await browser.storage.local.get("last_debug_logs");
    const logs = data.last_debug_logs || ["No logs found. Try running an export first."];
    const blob = new Blob([logs.join("\n")], {type: "text/plain"});
    const url = URL.createObjectURL(blob);
    
    await browser.downloads.download({
        url,
        filename: "media_sync_debug_log.txt",
        conflictAction: "uniquify"
    });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scrape_page") {
        getScrapedData(message.tab).then(sendResponse);
        return true;
    } else if (message.action === "save_entry") {
        handleSave(message).then(sendResponse);
        return true;
    } else if (message.action === "download_logs") {
        downloadDebugLogs().then(() => sendResponse({ success: true }));
        return true;
    }
});

function buildCSV(movies) {

    let csv = "Title,Year\n";

    for (const m of movies) {
        csv += `"${m.title}",${m.year}\n`;
    }

    return csv;
}

function sanitize(text) {
    return text.replace(/[^\w\d]/g, "_").toLowerCase();
}