(function () {

    const logs = [`Scraper started for: ${config.name}`];
    const log = (msg) => {
        console.log(msg);
        logs.push(msg);
    };

    // Find the primary entry link to get context
    log(`Searching for entry links with selector: ${selectors.entryLink}`);
    const links = [...document.querySelectorAll(selectors.entryLink)];

    if (links.length === 0) {
        log(`FAILURE: No entry links found matching: ${selectors.entryLink}`);
        return { error: "No entry links found", debugLogs: logs };
    }

    log(`Found ${links.length} potential entry links. Using the first one: ${links[0].href}`);
    const first = links[0];
    
    log(`Searching for row container with selector: ${selectors.row}`);
    const row = first.closest(selectors.row);

    if (!row) {
        log(`FAILURE: Could not find row container for entry link.`);
        return { error: "Row container not found", debugLogs: logs };
    }

    log(`Row container found. Extracting data...`);

    // Extraction logic
    let title = "";
    if (selectors.title) {
        log(`Searching for title with selector: ${selectors.title}`);
        const titleEl = row.querySelector(selectors.title);
        if (titleEl) {
            title = titleEl.textContent.trim();
            log(`Title found: ${title}`);
        } else {
            log(`Title selector returned no element.`);
        }
    }

    // If no title selector or not found, try common fallbacks
    if (!title) {
        log(`Trying title fallbacks...`);
        if (config.name === "Letterboxd") {
            const href = first.href;
            const match = href.match(/film\/([^\/]+)/);
            if (match) {
                title = match[1].replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
                log(`Title (Letterboxd slug) fallback: ${title}`);
            }
        }
        
        // Try image alt if still no title
        if (!title) {
            const img = row.querySelector("img[alt]");
            if (img) {
                title = img.alt.trim();
                log(`Title (image alt) fallback: ${title}`);
            }
        }

        // Final fallback to text content
        if (!title) {
            title = first.textContent.trim();
            log(`Title (text content) final fallback: ${title}`);
        }
    }

    // Append subtitle if found (e.g., Serializd Seasons)
    if (selectors.subtitle) {
        log(`Searching for subtitle with selector: ${selectors.subtitle}`);
        const subtitleEl = row.querySelector(selectors.subtitle);
        if (subtitleEl) {
            const subtitle = subtitleEl.textContent.trim();
            if (subtitle) {
                title += ` (${subtitle})`;
                log(`Subtitle added: ${subtitle}`);
            }
        }
    }

    let year = "";
    if (selectors.yearRegex) {
        log(`Searching for year with regex: ${selectors.yearRegex}`);
        const regex = new RegExp(selectors.yearRegex);
        const yearMatch = row.textContent.match(regex);
        if (yearMatch) {
            year = yearMatch[0];
            log(`Year found: ${year}`);
        } else {
            log(`No year match found in row text.`);
        }
    }

    let poster = null;
    if (selectors.image) {
        log(`Searching for artwork with selector: ${selectors.image}`);
        const img = row.querySelector(selectors.image);
        if (img) {
            poster = img.src;
            log(`Artwork found: ${poster}`);
        } else {
            log(`Artwork selector returned no element.`);
        }
    }

    log(`Extraction complete for ${title}`);

    return {
        title,
        year,
        poster,
        debugLogs: logs
    };

})();