(async function () {
    if (typeof SITE_CONFIG === 'undefined') {
        const errorMsg = "SITE_CONFIG not found in content script";
        console.error(errorMsg);
        return { error: errorMsg, debugLogs: [errorMsg] };
    }

    const config = SITE_CONFIG;
    const selectors = config.selectors;

    const logs = [`Scraper started for: ${config.name}`];
    const log = (msg) => { console.log(msg); logs.push(msg); };

    // ── Date helpers ──────────────────────────────────────────────────────────

    function normalizeDate(raw, parseMode, siteName) {
        if (!raw) return "";
        raw = raw.trim();

        // Letterboxd: href like "/doerrhb/diary/for/2026/01/15/"
        if (parseMode === "letterboxd-href") {
            const m = raw.match(/\/diary\/for\/(\d{4})\/(\d{2})\/(\d{2})/);
            if (m) return `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}`;
            return "";
        }

        // ISO date: "2026-01-15" or "2026-01-15T00:00:00"
        const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${parseInt(iso[2])}/${parseInt(iso[3])}/${iso[1]}`;

        // "Jan 15, 2026" / "January 15, 2026"
        const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
        const longM = raw.match(/(\w{3,9})\s+(\d{1,2})[,\s]+(\d{4})/i);
        if (longM) {
            const mon = months[longM[1].toLowerCase().slice(0,3)];
            if (mon) return `${mon}/${parseInt(longM[2])}/${longM[3]}`;
        }

        // "15 Jan 2026" / "15 January 2026"
        const dayFirst = raw.match(/(\d{1,2})\s+(\w{3,9})\s+(\d{4})/i);
        if (dayFirst) {
            const mon = months[dayFirst[2].toLowerCase().slice(0,3)];
            if (mon) return `${mon}/${parseInt(dayFirst[1])}/${dayFirst[3]}`;
        }

        // MM/DD/YYYY passthrough
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return raw;

        return "";
    }

    function extractDate(row, selectors, siteName) {
        // Strategy 1: in-row CSS selector
        if (selectors.dateSelector) {
            const dateEl = row.querySelector(selectors.dateSelector);
            if (dateEl) {
                let raw = "";
                if (selectors.dateAttribute) raw = dateEl.getAttribute(selectors.dateAttribute) || "";
                if (!raw) raw = dateEl.textContent.trim();
                const parsed = normalizeDate(raw, selectors.dateParse, siteName);
                if (parsed) {
                    log(`Date extracted: ${parsed} (raw: "${raw.slice(0,60)}")`);
                    return parsed;
                }
                log(`Date selector found element but could not parse: "${raw.slice(0,80)}"`);
            } else {
                log(`Date selector '${selectors.dateSelector}' found no element.`);
            }
        }

        // Strategy 2: regex scan of full row text (for ISO dates like BGG "2026-03-10")
        if (selectors.dateRegex) {
            const rowText = row.textContent || "";
            const match = rowText.match(new RegExp(selectors.dateRegex));
            if (match) {
                const parsed = normalizeDate(match[0], 'text', siteName);
                if (parsed) {
                    log(`Date extracted via dateRegex: ${parsed}`);
                    return parsed;
                }
            }
            log(`dateRegex '${selectors.dateRegex}' found no match in row text.`);
        }

        return "";
    }

    // Walk upward from the row to find a date heading in preceding siblings.
    // Used by Backloggd and Serializd where the date is a section header above cards.
    function extractDateFromParent(row, siteName) {
        const MAX_LEVELS = 6;
        let el = row;
        for (let level = 0; level < MAX_LEVELS; level++) {
            el = el.parentElement;
            if (!el) break;

            // Check preceding siblings of the current ancestor
            let sib = el.previousElementSibling;
            let sibsChecked = 0;
            while (sib && sibsChecked < 5) {
                const text = sib.textContent.trim().slice(0, 60);
                const parsed = normalizeDate(text, 'text', siteName);
                if (parsed) {
                    log(`Date found in preceding sibling (level ${level}): ${parsed}`);
                    return parsed;
                }
                sib = sib.previousElementSibling;
                sibsChecked++;
            }

            // Also check immediate text content of the ancestor itself
            // (some sites put a date label directly in the parent div)
            const directText = [...el.childNodes]
                .filter(n => n.nodeType === 3)   // TEXT_NODE
                .map(n => n.textContent.trim())
                .join(' ')
                .trim()
                .slice(0, 60);
            if (directText) {
                const parsed = normalizeDate(directText, 'text', siteName);
                if (parsed) {
                    log(`Date found in parent text (level ${level}): ${parsed}`);
                    return parsed;
                }
            }
        }
        log(`dateFromParent: no date found in ${MAX_LEVELS} ancestor levels.`);
        return "";
    }

    // ── Rating helpers ────────────────────────────────────────────────────────

    function extractRating(row, selectors, siteName) {
        // Serializd: SVG fa-star icons — no class selector available.
        // Count colored (filled) stars directly from the row.
        if (siteName === 'Serializd') {
            const allStars = [...row.querySelectorAll('svg[data-icon="star"]')];
            if (allStars.length > 0) {
                const filledStars = allStars.filter(svg => {
                    const c = (svg.getAttribute('color') || '').toLowerCase();
                    // Filled stars are teal (#00a99e); empty would be grey
                    return c && c !== '#ccc' && c !== '#cccccc' && c !== 'grey' && c !== 'gray' && c !== '#808080';
                }).length;
                const count = filledStars > 0 ? filledStars : allStars.length;
                log(`Rating (Serializd SVG stars): ${count}`);
                return count.toString();
            }
            log(`Rating: no SVG stars found in Serializd row.`);
            return "";
        }

        if (!selectors.ratingSelector) return "";

        const ratingEl = row.querySelector(selectors.ratingSelector);
        if (!ratingEl) {
            log(`Rating selector '${selectors.ratingSelector}' found no element.`);
            return "";
        }

        const parseMode = selectors.ratingParse || "text-numeric";
        let rating = "";

        // Letterboxd CSS class: "rating rated-8" → 4.0
        if (parseMode === "letterboxd-class") {
            const cls = ratingEl.getAttribute("class") || "";
            const m = cls.match(/rated-(\d+)/);
            if (m) {
                rating = (parseInt(m[1]) / 2).toString();
                log(`Rating (Letterboxd class): ${rating}`);
                return rating;
            }
        }

        // data-rating attribute (Goodreads)
        if (parseMode === "data-attr" || selectors.ratingAttribute) {
            const val = ratingEl.getAttribute(selectors.ratingAttribute || "data-rating");
            if (val && !isNaN(parseFloat(val))) {
                rating = val.trim();
                log(`Rating (data attribute): ${rating}`);
                return rating;
            }
        }

        // Count filled stars in child elements
        const filledStars = ratingEl.querySelectorAll(
            '.star-filled, .icon-star-filled, [class*="filled"], [class*="active"], [aria-label*="star"]'
        ).length;
        if (filledStars > 0) {
            log(`Rating (filled stars): ${filledStars}`);
            return filledStars.toString();
        }

        // aria-label: "4 out of 5 stars"
        const aria = ratingEl.getAttribute("aria-label") || "";
        const ariaMatch = aria.match(/(\d+(?:\.\d+)?)\s*(?:out\s*of|\/)/i);
        if (ariaMatch) {
            log(`Rating (aria-label): ${ariaMatch[1]}`);
            return ariaMatch[1];
        }

        // Plain numeric text
        const text = ratingEl.textContent.trim();
        const numMatch = text.match(/(\d+(?:\.\d+)?)/);
        if (numMatch && parseFloat(numMatch[1]) <= 10) {
            rating = numMatch[1];
            log(`Rating (text): ${rating}`);
            return rating;
        }

        // Star characters ★ / ½
        const starCount = (text.match(/★/g) || []).length;
        const halfStar = text.includes('½') ? 0.5 : 0;
        if (starCount > 0) {
            rating = (starCount + halfStar).toString();
            log(`Rating (star chars): ${rating}`);
            return rating;
        }

        log(`Could not parse rating from: "${text}"`);
        return "";
    }

    // ── Image helpers ─────────────────────────────────────────────────────────

    const getBestSrc = (img) => {
        if (!img) return null;
        const srcset = img.getAttribute('srcset');
        if (srcset) {
            const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
            if (sources.length > 0) return sources[sources.length - 1];
        }
        return img.getAttribute('data-src') ||
               img.getAttribute('data-original') ||
               img.getAttribute('data-lazy-src') ||
               img.getAttribute('src');
    };

    const isInvalidImage = (url) => {
        if (!url) return true;
        return /backdrop|background|banner|hero|empty-poster|placeholder|spacer|pixel/i.test(url) ||
               /-1200-.*-675-/i.test(url);
    };

    // Upscale known CDN thumbnail URLs to full-res poster sizes
    function upscaleImage(url, siteName) {
        if (!url) return url;
        // Letterboxd: "-0-70-0-105-crop.jpg" → "-0-460-0-690-crop.jpg"
        if (url.includes('ltrbxd.com') || url.includes('a.ltrbxd.com')) {
            const bigger = url.replace(/-0-\d+-0-\d+-crop\.jpg/, '-0-460-0-690-crop.jpg');
            if (bigger !== url) log(`Letterboxd image upscaled to 460×690`);
            return bigger;
        }
        // IGDB (Backloggd): t_cover_big / t_thumb → t_1080p
        if (url.includes('images.igdb.com')) {
            const bigger = url.replace(/\/t_cover_big_2x\/|\/t_cover_big\/|\/t_thumb\/|\/t_micro\//, '/t_1080p/');
            if (bigger !== url) log(`IGDB image upscaled to t_1080p`);
            return bigger;
        }
        // TMDB (Serializd): /w300/ or /w185/ → /w500/
        if (url.includes('tmdb') || url.includes('serializd-tmdb')) {
            const bigger = url.replace(/\/w(185|300|342)\//, '/w500/');
            if (bigger !== url) log(`TMDB image upscaled to w500`);
            return bigger;
        }
        return url;
    }

    // ── Entry-link / row detection ────────────────────────────────────────────

    log(`Searching for entry links with selector: ${selectors.entryLink}`);
    let links = [...document.querySelectorAll(selectors.entryLink)];

    // BGG: only keep links with a numeric boardgame ID
    if (config.name === "BoardGameGeek") {
        const initialCount = links.length;
        links = links.filter(a => /\/boardgame\/\d+/.test(a.getAttribute('href')));
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

        if (!potentialRow) {
            potentialRow = link.closest("tr") || link.closest("li") || link.closest(".card") || link.closest("div.row");
        }

        if (potentialRow) {
            first = link;
            row = potentialRow;
            log(`Found valid row for: ${link.href}`);
            break;
        } else {
            let p = link.parentElement;
            let hierarchy = [];
            for (let i = 0; i < 3 && p; i++) {
                hierarchy.push(`${p.tagName}.${Array.from(p.classList).join('.')}`);
                p = p.parentElement;
            }
            log(`Skipping link (no row container). Hierarchy: ${hierarchy.join(' > ')} | ${link.href}`);
        }
    }

    if (!row) {
        log(`FAILURE: Could not find any valid row container among ${links.length} links.`);
        return { error: "Row container not found", debugLogs: logs };
    }

    log(`Row container found. Extracting data...`);

    // Optional DOM dump for debugging
    if (config.debugDom) {
        const limit = config.debugDomLimit || 5000;
        log(`[DOM DUMP] Row outerHTML (first ${limit} chars):\n${(row.outerHTML || '').slice(0, limit)}`);
    }

    // ── Title ─────────────────────────────────────────────────────────────────

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

    // Normalize whitespace (Goodreads multi-line titles have embedded newlines)
    if (title) title = title.replace(/\s+/g, ' ').trim();

    // Strip trailing " (YYYY)" year suffix if config requests it
    // Letterboxd span.frame-title returns "Bloodsport (1988)"
    if (config.titleStripYear && title) {
        title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
        log(`Title after year strip: ${title}`);
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

    // ── Year ──────────────────────────────────────────────────────────────────

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

    // ── Date ──────────────────────────────────────────────────────────────────

    log(`Extracting date...`);
    let date = extractDate(row, selectors, config.name);

    // Parent-walking fallback: Backloggd/Serializd put dates in section headers above cards
    if (!date && config.dateFromParent) {
        log(`Trying dateFromParent...`);
        date = extractDateFromParent(row, config.name);
    }

    // ── Rating ────────────────────────────────────────────────────────────────

    log(`Extracting rating...`);
    const rating = extractRating(row, selectors, config.name);

    // ── Platform (Backloggd) ──────────────────────────────────────────────────

    let platform = "";
    if (selectors.platformSelector) {
        const platformEl = row.querySelector(selectors.platformSelector);
        if (platformEl) {
            platform = platformEl.textContent.trim();
            log(`Platform found: ${platform}`);
        }
    }

    // ── Poster / Image ────────────────────────────────────────────────────────

    let poster = null;

    // Detail page fetch for high-res images
    if (config.fetchDetail && first && first.href) {
        // Allow config to override which link to follow for details
        let detailLink = first;
        if (selectors.detailLinkSelector) {
            const alt = row.querySelector(selectors.detailLinkSelector);
            if (alt && alt.href) {
                detailLink = alt;
                log(`Using detailLinkSelector link: ${alt.href}`);
            }
        }

        let fetchUrl = detailLink.href;

        // Letterboxd: normalise user diary URL → canonical film URL
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
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // 1. Specific selector
            if (selectors.detailImage) {
                const detailImg = doc.querySelector(selectors.detailImage);
                if (detailImg) {
                    const src = getBestSrc(detailImg);
                    if (src) {
                        const abs = new URL(src, fetchUrl).href;
                        if (!isInvalidImage(abs)) { poster = abs; log(`High-res via selector: ${poster}`); }
                    }
                }
                if (!poster && selectors.detailImage.includes(' img')) {
                    const cont = doc.querySelector(selectors.detailImage.split(' img')[0]);
                    if (cont) {
                        const inner = cont.querySelector('img');
                        if (inner) {
                            const src = getBestSrc(inner);
                            if (src) {
                                const abs = new URL(src, fetchUrl).href;
                                if (!isInvalidImage(abs)) { poster = abs; log(`High-res via container: ${poster}`); }
                            }
                        }
                    }
                }
            }

            // 2. OpenGraph meta
            if (!poster) {
                const og = doc.querySelector('meta[property="og:image"], meta[property="og:image:url"]');
                if (og && og.content) {
                    const abs = new URL(og.content, fetchUrl).href;
                    if (!isInvalidImage(abs)) { poster = abs; log(`High-res via OpenGraph: ${poster}`); }
                }
            }

            // 3. Also try to extract date from JSON-LD on detail page (Serializd reviews)
            if (!date) {
                const jsonLd = doc.querySelector('script[type="application/ld+json"]');
                if (jsonLd) {
                    try {
                        const ld = JSON.parse(jsonLd.textContent);
                        const rawDate = ld.datePublished || ld.dateCreated || ld.dateModified || "";
                        if (rawDate) {
                            const parsed = normalizeDate(rawDate, 'text', config.name);
                            if (parsed) { date = parsed; log(`Date from JSON-LD: ${date}`); }
                        }
                    } catch(e) { /* ignore JSON parse errors */ }
                }
            }

            // 4. Last ditch: any img with "poster" in src/class/alt
            if (!poster) {
                log(`No poster via selectors or meta. Scanning all images...`);
                const images = [...doc.querySelectorAll('img')];
                const best = images.find(img => {
                    const src = getBestSrc(img) || "";
                    const cls = img.className || "";
                    const id = img.id || "";
                    const alt = img.getAttribute('alt') || "";
                    return (src.includes('poster') || cls.includes('poster') || id.includes('poster') || alt.toLowerCase().includes('poster')) && !isInvalidImage(src);
                });
                if (best) {
                    poster = new URL(getBestSrc(best), fetchUrl).href;
                    log(`High-res via last-ditch: ${poster}`);
                } else {
                    log(`FAILURE: No high-res poster found on detail page.`);
                }
            }
        } catch (err) {
            log(`Error fetching detail page: ${err.message}`);
        }
    }

    // ── Title cleanup ─────────────────────────────────────────────────────────

    if (title) title = title.replace(/^(Board|Video|Card) Game:\s+/i, "");

    // ── Local image fallback ──────────────────────────────────────────────────

    if (!poster && selectors.image) {
        log(`Searching for artwork with selector: ${selectors.image}`);
        const img = row.querySelector(selectors.image);
        if (img) {
            let localSrc = getBestSrc(img);
            if (localSrc) {
                if (!localSrc.startsWith('http')) localSrc = new URL(localSrc, window.location.href).href;
                if (!isInvalidImage(localSrc)) {
                    poster = localSrc;
                    log(`Artwork found: ${poster}`);
                } else {
                    log(`Skipping local image (invalid/placeholder): ${localSrc}`);
                }
            }
        }
        if (!poster) log(`Artwork selector returned no valid element.`);
    }

    // ── Upscale poster to highest available resolution ────────────────────────

    if (poster) poster = upscaleImage(poster, config.name);

    log(`Extraction complete: title="${title}" date="${date}" rating="${rating}" year="${year}" platform="${platform}"`);

    return { title, year, date, rating, platform, poster, debugLogs: logs };

})();
