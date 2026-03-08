(async function () {
    if (typeof SITE_CONFIG === 'undefined') {
        const errorMsg = "SITE_CONFIG not found in content script";
        console.error(errorMsg);
        return { error: errorMsg, debugLogs: [errorMsg] };
    }

    const config = SITE_CONFIG;
    const selectors = config.selectors;

    const logs = [`Scraper started for: ${config.name}`];
    const log = (msg) => {
        console.log(msg);
        logs.push(msg);
    };

    // Find the primary entry link to get context
    log(`Searching for entry links with selector: ${selectors.entryLink}`);
    let links = [...document.querySelectorAll(selectors.entryLink)];

    // BGG Specific Filter: Must have a numeric ID in the URL
    if (config.name === "BoardGameGeek") {
        const initialCount = links.length;
        links = links.filter(a => {
            const href = a.getAttribute('href');
            return /\/boardgame\/\d+/.test(href);
        });
        log(`BGG Filter: Reduced ${initialCount} links to ${links.length} valid boardgame entries.`);
    }

    if (links.length === 0) {
        log(`FAILURE: No entry links found matching: ${selectors.entryLink}`);
        return { error: "No entry links found", debugLogs: logs };
    }

    log(`Found ${links.length} potential entry links. Searching for a valid row container...`);
    
    let first = null;
    let row = null;

    for (const link of links) {
        let potentialRow = link.closest(selectors.row);
        
        // If specific row selector didn't work, try common containers as fallbacks
        if (!potentialRow) {
            potentialRow = link.closest("tr") || link.closest("li") || link.closest(".card") || link.closest("div.row");
        }

        if (potentialRow) {
            first = link;
            row = potentialRow;
            log(`Found valid row for: ${link.href}`);
            break;
        } else {
            // Log parent hierarchy for debugging
            let p = link.parentElement;
            let hierarchy = [];
            for (let i = 0; i < 3 && p; i++) {
                hierarchy.push(`${p.tagName}.${Array.from(p.classList).join('.')}`);
                p = p.parentElement;
            }
            log(`Skipping link (no row container found). Parent hierarchy: ${hierarchy.join(' > ')} | URL: ${link.href}`);
        }
    }

    if (!row) {
        log(`FAILURE: Could not find any valid row container among ${links.length} links.`);
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

    // Extraction Logic Fallbacks
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
        
        if (!title) {
            const img = row.querySelector("img[alt]");
            if (img) {
                let alt = img.alt.trim();
                alt = alt.replace(/^Poster for\s+/i, "");
                title = alt;
                log(`Title (image alt) fallback: ${title}`);
            }
        }

        if (!title) {
            title = first.textContent.trim();
            log(`Title (text content) final fallback: ${title}`);
        }
    }

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

    const getBestSrc = (img) => {
        if (!img) return null;
        // Try srcset for high-res first
        const srcset = img.getAttribute('srcset');
        if (srcset) {
            const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
            if (sources.length > 0) return sources[sources.length - 1];
        }
        // Try common lazy-load attributes
        return img.getAttribute('data-src') || 
               img.getAttribute('data-original') || 
               img.getAttribute('data-lazy-src') || 
               img.getAttribute('src');
    };

    const isInvalidImage = (url) => {
        if (!url) return true;
        // Block known placeholders, backgrounds, and horizontal crops (backdrops)
        return /backdrop|background|banner|hero|empty-poster|placeholder|spacer|pixel/i.test(url) || 
               /-1200-.*-675-/i.test(url); // Common Letterboxd backdrop pattern
    };

    // Optional Detail Fetching for High-Res Images
    if (config.fetchDetail && first && first.href) {
        let fetchUrl = first.href;
        
        // Letterboxd URL Normalization
        if (config.name === "Letterboxd") {
            const lbMatch = fetchUrl.match(/(letterboxd\.com\/)(?:[^\/]+\/)(film\/[^\/]+\/?)/);
            if (lbMatch) {
                fetchUrl = "https://" + lbMatch[1] + lbMatch[2];
                log(`Normalized Letterboxd URL: ${fetchUrl}`);
            }
        }

        log(`Fetching high-res artwork from: ${fetchUrl}`);
        try {
            const response = await fetch(fetchUrl);
            if (!response.ok) {
                log(`Fetch failed for ${fetchUrl} (Status: ${response.status})`);
                throw new Error(`Status ${response.status}`);
            }
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            
            // 1. Try Specific Selectors First (Highest Priority)
            if (selectors.detailImage) {
                const detailImg = doc.querySelector(selectors.detailImage);
                if (detailImg) {
                    const src = getBestSrc(detailImg);
                    if (src) {
                        const absoluteSrc = new URL(src, fetchUrl).href;
                        if (!isInvalidImage(absoluteSrc)) {
                            poster = absoluteSrc;
                            log(`High-res artwork found via specific selector: ${poster}`);
                        }
                    }
                }

                // 2. Try Container Drilling (If selector was "div img", try finding the div)
                if (!poster && selectors.detailImage.includes(' img')) {
                    const containerSelector = selectors.detailImage.split(' img')[0];
                    const container = doc.querySelector(containerSelector);
                    if (container) {
                        const innerImg = container.querySelector('img');
                        if (innerImg) {
                            const src = getBestSrc(innerImg);
                            if (src) {
                                const absoluteSrc = new URL(src, fetchUrl).href;
                                if (!isInvalidImage(absoluteSrc)) {
                                    poster = absoluteSrc;
                                    log(`High-res artwork found inside container: ${poster}`);
                                }
                            }
                        }
                    }
                }
            }

            // 3. Try OpenGraph Meta Tags (Medium Priority)
            if (!poster) {
                const ogImage = doc.querySelector('meta[property="og:image"], meta[property="og:image:url"]');
                if (ogImage && ogImage.content) {
                    const absoluteOg = new URL(ogImage.content, fetchUrl).href;
                    if (!isInvalidImage(absoluteOg)) {
                        poster = absoluteOg;
                        log(`High-res artwork from OpenGraph found: ${poster}`);
                    }
                }
            }

            // 4. Last Ditch Search (Lowest Priority)
            if (!poster) {
                log(`No poster found via selectors or meta. Scanning all images...`);
                const images = [...doc.querySelectorAll('img')];
                const bestLastDitch = images.find(img => {
                    const src = getBestSrc(img) || "";
                    const cls = img.className || "";
                    const id = img.id || "";
                    const alt = img.getAttribute('alt') || "";
                    // Must contain "poster" but NOT be a backdrop/placeholder
                    return (src.includes('poster') || cls.includes('poster') || id.includes('poster') || alt.includes('poster')) && !isInvalidImage(src);
                });

                if (bestLastDitch) {
                    poster = new URL(getBestSrc(bestLastDitch), fetchUrl).href;
                    log(`High-res artwork found via last-ditch search: ${poster}`);
                } else {
                    log(`FAILURE: No high-res poster found on detail page.`);
                }
            }
        } catch (err) {
            log(`Error fetching detail page: ${err.message}`);
        }
    }

    // Clean title prefix (e.g., "Board Game: Risk: Europe" -> "Risk: Europe")
    if (title) {
        title = title.replace(/^(Board|Video|Card) Game:\s+/i, "");
    }

    // Fallback to local image if detail fetch failed or wasn't requested
    if (!poster && selectors.image) {
        log(`Searching for artwork with selector: ${selectors.image}`);
        const img = row.querySelector(selectors.image);
        if (img) {
            let localSrc = getBestSrc(img);
            if (localSrc) {
                if (!localSrc.startsWith('http')) {
                    localSrc = new URL(localSrc, window.location.href).href;
                }
                if (!isInvalidImage(localSrc)) {
                    poster = localSrc;
                    log(`Artwork found: ${poster}`);
                } else {
                    log(`Skipping local image (invalid/placeholder): ${localSrc}`);
                }
            }
        }
        
        if (!poster) {
            log(`Artwork selector returned no valid element.`);
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