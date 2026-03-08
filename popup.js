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

    // Export Current Page
    exportBtn.addEventListener('click', async () => {
        statusDiv.textContent = "Exporting...";
        statusDiv.style.display = 'block';
        
        try {
            const response = await browser.runtime.sendMessage({
                action: "export_page",
                tab: tab
            });

            if (response && response.success) {
                statusDiv.textContent = "Success!";
                statusDiv.style.color = "green";
            } else {
                statusDiv.textContent = "Error: " + (response ? response.error : "Unknown error");
                statusDiv.style.color = "red";
            }
        } catch (err) {
            statusDiv.textContent = "Error: " + err.message;
            statusDiv.style.color = "red";
        }

        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
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
