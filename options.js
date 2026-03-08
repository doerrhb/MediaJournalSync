const DEFAULT_URLS = {
    "Letterboxd": "https://letterboxd.com/doerrhb/diary/for/2026/",
    "Goodreads": "https://www.goodreads.com/review/list/100083179-heath-doerr?order=d&read_at=2026&sort=date_read&view=table",
    "Backloggd": "https://backloggd.com/u/doerrhb/journal/dates/year:2026/",
    "BoardGameGeek": "https://boardgamegeek.com/geekplay.php?userid=349835&redirect=1&startdate=2026-01-01&dateinput=2026-01-01&dateinput=2026-12-31&enddate=2026-12-31&action=bydate&subtype=boardgame",
    "Serializd": "https://www.serializd.com/user/doerrhb/diary"
};

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('urlForm');
    const resetBtn = document.getElementById('reset');
    const status = document.getElementById('status');

    // Load saved URLs
    const data = await browser.storage.local.get("custom_urls");
    const customUrls = data.custom_urls || {};

    for (const [name, url] of Object.entries(customUrls)) {
        const input = document.getElementById(name);
        if (input) input.value = url;
    }

    // Set placeholders for defaults
    for (const [name, url] of Object.entries(DEFAULT_URLS)) {
        const input = document.getElementById(name);
        if (input && !input.value) {
            input.value = url;
        }
    }

    // Save
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUrls = {};
        for (const name of Object.keys(DEFAULT_URLS)) {
            const input = document.getElementById(name);
            if (input) newUrls[name] = input.value;
        }

        await browser.storage.local.set({ custom_urls: newUrls });
        
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 2000);
    });

    // Reset
    resetBtn.addEventListener('click', () => {
        if (confirm("Reset all URLs to defaults?")) {
            for (const [name, url] of Object.entries(DEFAULT_URLS)) {
                const input = document.getElementById(name);
                if (input) input.value = url;
            }
        }
    });
});
