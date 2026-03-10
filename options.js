const DEFAULT_URLS = {
    "Letterboxd":    "https://letterboxd.com/doerrhb/diary/for/2026/",
    "Goodreads":     "https://www.goodreads.com/review/list/100083179-heath-doerr?order=d&read_at=2026&sort=date_read&view=table",
    "Backloggd":     "https://backloggd.com/u/doerrhb/journal/dates/year:2026/",
    "BoardGameGeek": "https://boardgamegeek.com/geekplay.php?userid=349835&redirect=1&startdate=2026-01-01&dateinput=2026-01-01&dateinput=2026-12-31&enddate=2026-12-31&action=bydate&subtype=boardgame",
    "Serializd":     "https://www.serializd.com/user/doerrhb/diary"
};

// Default image folders matching config.js
const DEFAULT_FOLDERS = {
    "Letterboxd":    "Images/movies",
    "Goodreads":     "Images/books",
    "Backloggd":     "Images/videogames",
    "BoardGameGeek": "Images/boardgames",
    "Serializd":     "Images/tvshows"
};

const DEFAULT_TAB_NAMES = {
    "Letterboxd":    "Movies",
    "Goodreads":     "Books",
    "Backloggd":     "Video Games",
    "BoardGameGeek": "Board Games",
    "Serializd":     "TV Shows"
};

document.addEventListener('DOMContentLoaded', async () => {
    const form      = document.getElementById('urlForm');
    const resetBtn  = document.getElementById('reset');
    const status    = document.getElementById('status');
    const sheetsStatus = document.getElementById('sheetsStatus');

    // ── Load saved image folders ──────────────────────────────────────────────
    const folderData = await browser.storage.local.get("image_folders");
    const savedFolders = folderData.image_folders || {};
    for (const [name, defaultFolder] of Object.entries(DEFAULT_FOLDERS)) {
        const input = document.getElementById(`folder_${name}`);
        if (input) input.value = savedFolders[name] || defaultFolder;
    }

    document.getElementById('saveFolders').addEventListener('click', async () => {
        const newFolders = {};
        for (const name of Object.keys(DEFAULT_FOLDERS)) {
            const input = document.getElementById(`folder_${name}`);
            newFolders[name] = (input && input.value.trim()) ? input.value.trim() : DEFAULT_FOLDERS[name];
        }
        await browser.storage.local.set({ image_folders: newFolders });
        const el = document.getElementById('folderStatus');
        el.textContent   = "\u2713 Folder settings saved!";
        el.style.display = "block";
        setTimeout(() => { el.style.display = "none"; }, 2000);
    });

    // ── Load saved URLs ───────────────────────────────────────────────────────
    const data = await browser.storage.local.get("custom_urls");
    const customUrls = data.custom_urls || {};

    for (const [name, url] of Object.entries(DEFAULT_URLS)) {
        const input = document.getElementById(name);
        if (input) input.value = customUrls[name] || url;
    }

    // ── Load saved Sheets config ──────────────────────────────────────────────
    const sheetsData = await browser.storage.local.get("sheets_config");
    const sheetsConfig = sheetsData.sheets_config || {};

    if (sheetsConfig.scriptUrl) {
        document.getElementById('scriptUrl').value = sheetsConfig.scriptUrl;
    }

    // Load saved tab names (or fall back to defaults)
    const savedTabs = sheetsConfig.tabNames || {};
    for (const [name, defaultTab] of Object.entries(DEFAULT_TAB_NAMES)) {
        const input = document.getElementById(`tab_${name}`);
        if (input) input.value = savedTabs[name] || defaultTab;
    }

    // ── Save URL settings ─────────────────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUrls = {};
        for (const name of Object.keys(DEFAULT_URLS)) {
            const input = document.getElementById(name);
            if (input) newUrls[name] = input.value.trim();
        }
        await browser.storage.local.set({ custom_urls: newUrls });
        status.style.display = 'block';
        status.textContent   = 'URL settings saved!';
        setTimeout(() => { status.style.display = 'none'; }, 2000);
    });

    // ── Reset URLs ────────────────────────────────────────────────────────────
    resetBtn.addEventListener('click', () => {
        if (confirm("Reset all URLs to defaults?")) {
            for (const [name, url] of Object.entries(DEFAULT_URLS)) {
                const input = document.getElementById(name);
                if (input) input.value = url;
            }
        }
    });

    // ── Save Sheets settings ──────────────────────────────────────────────────
    document.getElementById('saveSheets').addEventListener('click', async () => {
        const scriptUrl = document.getElementById('scriptUrl').value.trim();

        // Read tab names from inputs
        const tabNames = {};
        for (const name of Object.keys(DEFAULT_TAB_NAMES)) {
            const input = document.getElementById(`tab_${name}`);
            tabNames[name] = (input && input.value.trim()) ? input.value.trim() : DEFAULT_TAB_NAMES[name];
        }

        await browser.storage.local.set({
            sheets_config: { scriptUrl, tabNames }
        });

        showSheetsStatus("✓ Sheets settings saved!", "green");
    });

    // ── Test Sheets connection ────────────────────────────────────────────────
    document.getElementById('testSheets').addEventListener('click', async () => {
        const scriptUrl = document.getElementById('scriptUrl').value.trim();
        if (!scriptUrl) {
            showSheetsStatus("Please enter an Apps Script URL first.", "red");
            return;
        }

        // Use the Letterboxd tab name for the test (or first available)
        const testTabInput = document.getElementById('tab_Letterboxd');
        const testTab = (testTabInput && testTabInput.value.trim()) || "Movies";

        showSheetsStatus(`Testing against tab "${testTab}"...`, "#555");

        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tab: testTab,
                    row: ["__CONNECTION_TEST__", new Date().toLocaleString()]
                })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success && !result.skipped) {
                    showSheetsStatus(`✓ Connected! A test row was appended to your "${testTab}" tab. Delete it if you like.`, "green");
                } else if (result.success && result.skipped) {
                    showSheetsStatus(`✓ Connected! (Test row already exists — duplicate guard is working.)`, "green");
                } else {
                    showSheetsStatus(`⚠ Script error: ${result.error}`, "#c00");
                }
            } else {
                showSheetsStatus(`✗ HTTP error: ${response.status} ${response.statusText}`, "red");
            }
        } catch (err) {
            showSheetsStatus("✗ Connection failed: " + err.message, "red");
        }
    });

    function showSheetsStatus(msg, color) {
        sheetsStatus.textContent   = msg;
        sheetsStatus.style.color   = color || "#333";
        sheetsStatus.style.display = "block";
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const form      = document.getElementById('urlForm');
    const resetBtn  = document.getElementById('reset');
    const status    = document.getElementById('status');
    const sheetsStatus = document.getElementById('sheetsStatus');

    // ── Load saved URLs ───────────────────────────────────────────────────────
    const data = await browser.storage.local.get("custom_urls");
    const customUrls = data.custom_urls || {};

    for (const [name, url] of Object.entries(DEFAULT_URLS)) {
        const input = document.getElementById(name);
        if (input) input.value = customUrls[name] || url;
    }

    // ── Load saved Sheets config ──────────────────────────────────────────────
    const sheetsData = await browser.storage.local.get("sheets_config");
    const sheetsConfig = sheetsData.sheets_config || {};
    if (sheetsConfig.scriptUrl) {
        document.getElementById('scriptUrl').value = sheetsConfig.scriptUrl;
    }

    // ── Save URL settings ─────────────────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUrls = {};
        for (const name of Object.keys(DEFAULT_URLS)) {
            const input = document.getElementById(name);
            if (input) newUrls[name] = input.value.trim();
        }
        await browser.storage.local.set({ custom_urls: newUrls });
        status.style.display = 'block';
        status.textContent   = 'URL settings saved!';
        setTimeout(() => { status.style.display = 'none'; }, 2000);
    });

    // ── Reset URLs ────────────────────────────────────────────────────────────
    resetBtn.addEventListener('click', () => {
        if (confirm("Reset all URLs to defaults?")) {
            for (const [name, url] of Object.entries(DEFAULT_URLS)) {
                const input = document.getElementById(name);
                if (input) input.value = url;
            }
        }
    });

    // ── Save Sheets settings ──────────────────────────────────────────────────
    document.getElementById('saveSheets').addEventListener('click', async () => {
        const scriptUrl = document.getElementById('scriptUrl').value.trim();
        await browser.storage.local.set({
            sheets_config: { scriptUrl }
        });
        showSheetsStatus("Sheets settings saved!", "green");
    });

    // ── Test Sheets connection ────────────────────────────────────────────────
    document.getElementById('testSheets').addEventListener('click', async () => {
        const scriptUrl = document.getElementById('scriptUrl').value.trim();
        if (!scriptUrl) {
            showSheetsStatus("Please enter an Apps Script URL first.", "red");
            return;
        }

        showSheetsStatus("Testing connection...", "#555");

        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tab: "_test",
                    row: ["Media Journal Sync - connection test", new Date().toLocaleString()]
                })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    showSheetsStatus("✓ Connection successful! A test row was written to the '_test' tab.", "green");
                } else {
                    showSheetsStatus("⚠ Script responded but reported an error: " + result.error, "orange");
                }
            } else {
                showSheetsStatus(`✗ HTTP error: ${response.status} ${response.statusText}`, "red");
            }
        } catch (err) {
            showSheetsStatus("✗ Connection failed: " + err.message, "red");
        }
    });

    function showSheetsStatus(msg, color) {
        sheetsStatus.textContent  = msg;
        sheetsStatus.style.color  = color || "#333";
        sheetsStatus.style.display = "block";
    }
});
