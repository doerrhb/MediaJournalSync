document.addEventListener('DOMContentLoaded', async () => {
    const exportBtn = document.getElementById('exportBtn');
    const openSourcesBtn = document.getElementById('openSourcesBtn');
    const settingsLink = document.getElementById('settingsLink');
    const statusDiv = document.getElementById('status');

    // Get current tab
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    // Check if current page is supported
    const isSupported = SITE_CONFIGS.some(c => 
        tab.url.includes(c.urlPattern) && tab.url.includes(c.pathPattern)
    );

    if (!isSupported) {
        exportBtn.disabled = true;
        exportBtn.style.opacity = '0.5';
        exportBtn.title = "Navigate to a supported diary/journal page to export.";
    }

    let currentEntry = null;
    let currentConfig = null;

    // Export/Scrape Logic
    exportBtn.addEventListener('click', async () => {
        statusDiv.textContent = "Scraping...";
        statusDiv.style.display = 'block';
        statusDiv.style.color = "inherit";
        
        try {
            const response = await browser.runtime.sendMessage({
                action: "scrape_page",
                tab: tab
            });

            if (response && response.success) {
                statusDiv.style.display = 'none';
                currentEntry = response.entry;
                currentConfig = response.config;

                // Populate review section
                document.getElementById('reviewTitle').value = currentEntry.title || "";
                document.getElementById('reviewYear').value = currentEntry.year || "";
                document.getElementById('reviewPoster').src = currentEntry.poster || "";
                
                // Show review section, hide main menu
                document.getElementById('mainMenu').style.display = "none";
                document.getElementById('reviewSection').style.display = "block";
            } else {
                statusDiv.textContent = "Error: " + (response ? response.error : "Unknown error");
                statusDiv.style.color = "red";
                setTimeout(() => statusDiv.style.display = 'none', 3000);
            }
        } catch (err) {
            statusDiv.textContent = "Error: " + err.message;
            statusDiv.style.color = "red";
            setTimeout(() => statusDiv.style.display = 'none', 3000);
        }
    });

    // Save Logic
    document.getElementById('saveBtn').addEventListener('click', async () => {
        statusDiv.textContent = "Saving...";
        statusDiv.style.display = 'block';
        statusDiv.style.color = "inherit";
        
        // Update entry with edited values
        currentEntry.title = document.getElementById('reviewTitle').value;
        currentEntry.year = document.getElementById('reviewYear').value;

        try {
            const response = await browser.runtime.sendMessage({
                action: "save_entry",
                entry: currentEntry,
                config: currentConfig
            });

            if (response && response.success) {
                statusDiv.textContent = "Saved successfully!";
                statusDiv.style.color = "green";
                
                setTimeout(() => {
                    document.getElementById('reviewSection').style.display = "none";
                    document.getElementById('mainMenu').style.display = "block";
                    statusDiv.style.display = 'none';
                }, 1500);
            } else {
                statusDiv.textContent = "Error: " + (response ? response.error : "Unknown error");
                statusDiv.style.color = "red";
            }
        } catch (err) {
            statusDiv.textContent = "Error: " + err.message;
            statusDiv.style.color = "red";
        }
    });

    // Cancel Review
    document.getElementById('cancelBtn').addEventListener('click', () => {
        document.getElementById('reviewSection').style.display = "none";
        document.getElementById('mainMenu').style.display = "block";
        statusDiv.style.display = 'none';
    });

    // Open Source Pages
    openSourcesBtn.addEventListener('click', async () => {
        const data = await browser.storage.local.get("custom_urls");
        const customUrls = data.custom_urls || {};

        for (const config of SITE_CONFIGS) {
            const url = customUrls[config.name] || getDefaultUrl(config.name);
            if (url) {
                browser.tabs.create({ url });
            }
        }
    });

    // Debug Logs
    document.getElementById('debugBtn').addEventListener('click', async () => {
        await browser.runtime.sendMessage({ action: "download_logs" });
    });

    // Settings
    settingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        browser.runtime.openOptionsPage();
    });
});

function getDefaultUrl(name) {
    const defaults = {
        "Letterboxd": "https://letterboxd.com/doerrhb/diary/for/2026/",
        "Goodreads": "https://www.goodreads.com/review/list/100083179-heath-doerr?order=d&read_at=2026&sort=date_read&view=table",
        "Backloggd": "https://backloggd.com/u/doerrhb/journal/dates/year:2026/",
        "BoardGameGeek": "https://boardgamegeek.com/geekplay.php?userid=349835&redirect=1&startdate=2026-01-01&dateinput=2026-01-01&dateinput=2026-12-31&enddate=2026-12-31&action=bydate&subtype=boardgame",
        "Serializd": "https://www.serializd.com/user/doerrhb/diary"
    };
    return defaults[name];
}
