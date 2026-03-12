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

    function normalizeDate(raw) {
        if (!raw) return "";
        raw = raw.trim();

        // Letterboxd daydate href: "/doerrhb/diary/films/for/2026/03/07/"
        // Matches /for/YYYY/MM/DD/ anywhere in path
        const lbHref = raw.match(/\/for\/(\d{4})\/(\d{2})\/(\d{2})\//);
        if (lbHref) return `${parseInt(lbHref[2])}/${parseInt(lbHref[3])}/${lbHref[1]}`;

        // ISO: "2026-01-15"
        const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${parseInt(iso[2])}/${parseInt(iso[3])}/${iso[1]}`;

        // "Jan 15, 2026" / "January 15 2026" / "Feb 24, 2026"
        const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
        const mdy = raw.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
        if (mdy) {
            const mon = months[mdy[1].toLowerCase().slice(0,3)];
            if (mon) return `${mon}/${parseInt(mdy[2])}/${mdy[3]}`;
        }

        // "15 Jan 2026"
        const dmy = raw.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
        if (dmy) {
            const mon = months[dmy[2].toLowerCase().slice(0,3)];
            if (mon) return `${mon}/${parseInt(dmy[1])}/${dmy[3]}`;
        }

        // MM/DD/YYYY passthrough — only if all numbers are plausible
        const mdy2 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mdy2 && parseInt(mdy2[1]) <= 12 && parseInt(mdy2[2]) <= 31) return raw;

        return "";
    }

    // ── Backloggd date: combine sibling month heading + sibling day div ───────
    // Level-0 preceding sibling of row's parent: div.date-entry  → "26"
    // Level-2 preceding sibling:                 div.month-year-date → "February, 2026"
    function extractBackloggdDate(row) {
        const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
        let day = null, monthNum = null, yearNum = null;

        let el = row;
        for (let level = 0; level < 10; level++) {
            el = el.parentElement;
            if (!el) break;

            let sib = el.previousElementSibling;
            while (sib) {
                const cls = sib.className || "";
                const text = sib.textContent.trim().replace(/\s+/g, ' ');
                log(`BL-date lvl${level} sib cls="${cls}" text="${text.slice(0,40)}"`);

                // Day: div.date-entry contains just a day number
                if (cls.includes('date-entry') && day === null) {
                    const n = parseInt(text, 10);
                    if (!isNaN(n) && n >= 1 && n <= 31 && text.replace(/\d/g,'').trim() === '') {
                        day = n;
                        log(`BL-date: day=${day}`);
                    }
                }

                // Month+Year: div.month-year-date contains "February, 2026"
                if (cls.includes('month-year-date') && (monthNum === null || yearNum === null)) {
                    const m = text.match(/([A-Za-z]+),?\s+(\d{4})/);
                    if (m) {
                        const mon = months[m[1].toLowerCase().slice(0,3)];
                        if (mon) { monthNum = mon; yearNum = m[2]; log(`BL-date: month=${monthNum} year=${yearNum}`); }
                    }
                }

                if (day !== null && monthNum !== null) break;
                sib = sib.previousElementSibling;
            }
            if (day !== null && monthNum !== null) break;
        }

        if (day !== null && monthNum !== null && yearNum !== null) {
            const result = `${monthNum}/${day}/${yearNum}`;
            log(`BL-date result: ${result}`);
            return result;
        }
        log(`BL-date: incomplete — day=${day} month=${monthNum} year=${yearNum}`);
        return "";
    }

    // ── BGG date: find bydate link in surrounding table rows ──────────────────
    function extractBGGDate(row) {
        // The date link is in a preceding header <tr> in the same table
        // Walk up to get the tbody/table, then scan preceding sibling rows
        let tbody = row.parentElement;
        if (!tbody) return "";

        // Collect all rows in the tbody
        const allRows = [...tbody.querySelectorAll('tr')];
        const myIdx = allRows.indexOf(row);

        // Search preceding rows (up to 20 back) for a bydate link
        for (let i = myIdx - 1; i >= Math.max(0, myIdx - 20); i--) {
            const dateLink = allRows[i].querySelector('a[href*="/plays/bydate/"]');
            if (dateLink) {
                const text = dateLink.textContent.trim();
                const href = dateLink.getAttribute('href') || '';
                log(`BGG-date: found link text="${text}" href="${href.slice(0,60)}"`);
                // Try text first (e.g. "2026-03-03")
                const fromText = normalizeDate(text);
                if (fromText) return fromText;
                // Try parsing ISO from href: /start/2026-03-03/
                const hrefIso = href.match(/\/start\/(\d{4}-\d{2}-\d{2})/);
                if (hrefIso) return normalizeDate(hrefIso[1]);
            }
        }
        log(`BGG-date: no bydate link found in preceding rows`);
        return "";
    }

    // ── BGG rating: scan surrounding table rows for user's rating span ──────────
    // The plays log page renders via Angular. The user's rating for each play
    // appears in the same <tr> or an adjacent one as:
    //   <span ng-show="collratingctrl.collection.ratingitem.rating > 0" class="ng-binding"> 7 </span>
    function extractBGGRating(row) {
        let tbody = row.parentElement;
        if (!tbody) return "";

        const allRows = [...tbody.querySelectorAll('tr')];
        const myIdx   = allRows.indexOf(row);

        // Search within ±3 rows of the game row
        const start = Math.max(0, myIdx - 3);
        const end   = Math.min(allRows.length - 1, myIdx + 3);

        for (let i = start; i <= end; i++) {
            const span = allRows[i].querySelector('span[ng-show*="ratingitem.rating"]');
            if (span) {
                const text = span.textContent.trim().replace(/\s+/g, '');
                const m    = text.match(/^(\d+(?:\.\d+)?)$/);
                if (m && parseFloat(m[1]) <= 10) {
                    log(`BGG-rating: "${m[1]}" found in row[${i}]`);
                    return m[1];
                }
                log(`BGG-rating: span found but not numeric: "${text.slice(0,20)}"`);
            }
        }

        // Broader search: entire table
        const anySpan = tbody.querySelector('span[ng-show*="ratingitem.rating"]');
        if (anySpan) {
            const text = anySpan.textContent.trim().replace(/\s+/g,'');
            const m    = text.match(/^(\d+(?:\.\d+)?)$/);
            if (m && parseFloat(m[1]) <= 10) {
                log(`BGG-rating: found (broad table search): "${m[1]}"`);
                return m[1];
            }
        }

        log(`BGG-rating: no rating span found in page DOM`);
        return "";
    }

    // ── Serializd date: multi-strategy extraction ─────────────────────────────
    // Page structure (confirmed via XPath inspection):
    //   monthGroup div
    //     div:nth-child(1) > h1          ← "February 2026"
    //     div:nth-child(2) > a.diary-log ← row
    //       a > div > div:nth-child(2) > div > div:nth-child(2) > div  ← "February 15"
    //
    // Strategy A (XPath absolute): use the exact XPaths provided
    // Strategy B (CSS relative):   look inside row's <a> for the day div
    // Strategy C (ancestor h1):    walk up to find the month/year heading sibling
    // Combine day + "Month YYYY" h1 if needed
    function extractSerializdDate(row) {
        const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

        function xpathText(xpath) {
            try {
                const r = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
                return (r.stringValue || '').trim();
            } catch(e) { return ''; }
        }

        // ── Strategy A: absolute XPaths ───────────────────────────────────────
        const MONTH_XPATH = '/html/body/div/div[2]/div[4]/div/div/div[2]/div[1]/h1';
        const DAY_XPATH   = '/html/body/div/div[2]/div[4]/div/div/div[2]/div[2]/a/div/div[2]/div/div[2]/div';
        let monthYearText = xpathText(MONTH_XPATH);
        let dayText       = xpathText(DAY_XPATH);
        log(`Serializd XPath: month="${monthYearText}" day="${dayText}"`);

        // ── Strategy B: CSS selector inside row's <a> child ───────────────────
        if (!dayText) {
            const dayEl = row.querySelector('a > div > div:nth-child(2) > div > div:nth-child(2) > div');
            if (dayEl) { dayText = dayEl.textContent.trim(); log(`Serializd day (CSS): "${dayText}"`); }
        }

        // ── Strategy C: walk ancestors for h1 month/year heading ─────────────
        if (!monthYearText) {
            let el = row;
            outer: for (let level = 0; level < 10; level++) {
                el = el.parentElement;
                if (!el) break;
                // Check preceding siblings of this element for an h1
                for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
                    const h1 = sib.tagName === 'H1' ? sib : sib.querySelector('h1');
                    if (h1) {
                        const t = h1.textContent.trim();
                        if (/[A-Za-z]/.test(t) && /\d{4}/.test(t) && t.length < 25) {
                            monthYearText = t;
                            log(`Serializd month h1 at ancestor level ${level}: "${t}"`);
                            break outer;
                        }
                    }
                }
            }
        }

        // ── Combine ───────────────────────────────────────────────────────────
        // dayText: "February 15"  OR  "15"  OR  "February 15, 2026"
        // monthYearText: "February 2026"

        // Try parsing dayText as a complete date first (e.g. "February 15, 2026")
        if (dayText) {
            const full = normalizeDate(dayText);
            if (full) { log(`Serializd date from day element alone: ${full}`); return full; }
        }

        // Combine: extract year from monthYearText, month from either, day number
        let mon = null, yr = null, day = null;

        if (monthYearText) {
            const m = monthYearText.match(/([A-Za-z]+)[,\s]+(\d{4})/);
            if (m) { mon = MON[m[1].toLowerCase().slice(0,3)]; yr = m[2]; }
        }

        if (dayText) {
            // "February 15" → month override + day
            const mdy = dayText.match(/([A-Za-z]+)\s+(\d{1,2})/);
            if (mdy) {
                const parsedMon = MON[mdy[1].toLowerCase().slice(0,3)];
                if (parsedMon) mon = parsedMon;
                day = parseInt(mdy[2], 10);
            } else {
                // Just a number "15"
                const dm = dayText.match(/(\d{1,2})/);
                if (dm) day = parseInt(dm[1], 10);
            }
        }

        if (mon && day && yr) {
            const result = `${mon}/${day}/${yr}`;
            log(`Serializd date combined: ${result} (mon=${mon} day=${day} yr=${yr})`);
            return result;
        }

        log(`Serializd date: incomplete — month="${monthYearText}" day="${dayText}"`);
        return "";
    }

    // ── Rating ────────────────────────────────────────────────────────────────

    function extractRating(row, selectors, siteName) {
        if (siteName === 'Serializd') {
            const allStars = [...row.querySelectorAll('svg[data-icon="star"]')];
            if (allStars.length > 0) {
                const filled = allStars.filter(svg => {
                    const c = (svg.getAttribute('color') || '').toLowerCase();
                    return c && c !== '#ccc' && c !== '#cccccc' && c !== 'grey' && c !== 'gray' && c !== '#808080';
                }).length;
                const count = filled > 0 ? filled : allStars.length;
                log(`Rating (Serializd SVG stars): ${count}`);
                return count.toString();
            }
            return "";
        }

        if (siteName === 'Backloggd') {
            const starsTop = row.querySelector('.stars-top');
            if (starsTop) {
                const style = starsTop.getAttribute('style') || '';
                const w = style.match(/width\s*:\s*([\d.]+)%/);
                if (w) {
                    const rating = (Math.round(parseFloat(w[1]) / 100 * 5 * 2) / 2).toString();
                    log(`Rating (Backloggd stars-top ${w[1]}%): ${rating}`);
                    return rating;
                }
                const starCount = starsTop.querySelectorAll('span.star').length;
                if (starCount > 0) { log(`Rating (Backloggd star count): ${starCount}`); return starCount.toString(); }
            }
            log(`Rating: no .stars-top in Backloggd row`);
            return "";
        }

        if (siteName === 'BoardGameGeek') {
            // Rating lives in the Angular-rendered game detail page.
            // main.js will load that page live and extract it — nothing to do here.
            log(`BGG-rating: deferred to main.js live page load`);
            return "";
        }

        if (!selectors.ratingSelector) return "";
        const ratingEl = row.querySelector(selectors.ratingSelector);
        if (!ratingEl) { log(`Rating selector '${selectors.ratingSelector}' found no element.`); return ""; }

        if (selectors.ratingParse === 'letterboxd-class') {
            const cls = ratingEl.getAttribute('class') || '';
            const m = cls.match(/rated-(\d+)/);
            if (m) { const r = (parseInt(m[1]) / 2).toString(); log(`Rating (Letterboxd class): ${r}`); return r; }
            log(`Rating: no rated-N class found. class="${cls}"`);
            return "";
        }

        if (selectors.ratingAttribute) {
            const val = ratingEl.getAttribute(selectors.ratingAttribute);
            if (val && !isNaN(parseFloat(val))) { log(`Rating (data attr): ${val.trim()}`); return val.trim(); }
        }

        const text = ratingEl.textContent.trim();
        const numM = text.match(/(\d+(?:\.\d+)?)/);
        if (numM && parseFloat(numM[1]) <= 10) { log(`Rating (text): ${numM[1]}`); return numM[1]; }

        const stars = (text.match(/★/g) || []).length;
        const half = text.includes('½') ? 0.5 : 0;
        if (stars > 0) { const r = (stars + half).toString(); log(`Rating (★ chars): ${r}`); return r; }

        log(`Could not parse rating from: "${text.slice(0,60)}"`);
        return "";
    }

    // ── Image helpers ─────────────────────────────────────────────────────────

    const getBestSrc = (img) => {
        if (!img) return null;
        // Check data-srcset attribute first (lazy-load pattern)
        const dataSrcset = img.getAttribute('data-srcset');
        if (dataSrcset) {
            const sources = dataSrcset.split(',').map(s => s.trim().split(' ')[0]).filter(Boolean);
            if (sources.length > 0) return sources[sources.length - 1];
        }
        // Use img.srcset DOM property — set by React/JS even if the HTML attribute lags behind
        const srcsetProp = img.srcset || img.getAttribute('srcset') || '';
        if (srcsetProp) {
            const sources = srcsetProp.split(',').map(s => s.trim().split(' ')[0]).filter(Boolean);
            if (sources.length > 0) return sources[sources.length - 1];
        }
        // currentSrc = what the browser actually resolved and loaded (post-React hydration)
        if (img.currentSrc && !img.currentSrc.startsWith('data:')) return img.currentSrc;
        // img.src DOM property catches React-set values; getAttribute reads the raw HTML attribute
        return img.getAttribute('data-src') || img.getAttribute('data-original') ||
               img.getAttribute('data-lazy-src') || img.src || img.getAttribute('src');
    };

    const isInvalidImage = (url) => {
        if (!url) return true;
        // Filter placeholders, backdrops, and user avatars (avtr- path = user avatar, not film poster)
        return /backdrop|background|banner|hero|empty-poster|placeholder|spacer|pixel/i.test(url) ||
               /-1200-.*-675-/i.test(url) ||
               /\/avtr-|\/avatar\/upload\//i.test(url);
    };

    function upscaleImage(url) {
        if (!url) return url;
        // Letterboxd: upscale any crop size to 1000×1500
        if (url.includes('ltrbxd.com')) {
            const bigger = url.replace(/-0-\d+-0-\d+-crop(\.jpg)/, '-0-1000-0-1500-crop$1');
            if (bigger !== url) { log(`Letterboxd image upscaled to 1000×1500`); return bigger; }
        }
        // IGDB (Backloggd)
        if (url.includes('images.igdb.com')) {
            const bigger = url.replace(/\/t_cover_big_2x\/|\/t_cover_big\/|\/t_thumb\/|\/t_micro\//, '/t_1080p/');
            if (bigger !== url) { log(`IGDB image upscaled to t_1080p`); return bigger; }
        }
        // TMDB (Serializd)
        if (url.includes('tmdb') || url.includes('serializd-tmdb')) {
            const bigger = url.replace(/\/w(185|300|342)\//, '/w500/');
            if (bigger !== url) { log(`TMDB image upscaled to w500`); return bigger; }
        }
        return url;
    }

    // ── Entry-link / row detection ────────────────────────────────────────────

    log(`Searching for entry links with selector: ${selectors.entryLink}`);
    let links = [...document.querySelectorAll(selectors.entryLink)];

    if (config.name === "BoardGameGeek") {
        const initialCount = links.length;
        links = links.filter(a => /\/boardgame\/\d+/.test(a.getAttribute('href')));
        log(`BGG Filter: Reduced ${initialCount} links to ${links.length} valid boardgame entries.`);
    }

    if (links.length === 0) {
        log(`FAILURE: No entry links found.`);
        return { error: "No entry links found", debugLogs: logs };
    }

    log(`Found ${links.length} potential entry links.`);

    let first = null, row = null;

    for (const link of links) {
        let potentialRow = link.closest(selectors.row);
        if (!potentialRow) {
            potentialRow = link.closest("tr") || link.closest("li") || link.closest(".card") || link.closest("div.row");
        }
        if (potentialRow) { first = link; row = potentialRow; log(`Found valid row for: ${link.href}`); break; }
        else {
            let p = link.parentElement, hierarchy = [];
            for (let i = 0; i < 3 && p; i++) { hierarchy.push(`${p.tagName}.${[...p.classList].join('.')}`); p = p.parentElement; }
            log(`Skipping link (no row). Hierarchy: ${hierarchy.join(' > ')}`);
        }
    }

    if (!row) { log(`FAILURE: No valid row found.`); return { error: "Row container not found", debugLogs: logs }; }

    log(`Row: ${row.tagName}.${row.className.trim().replace(/\s+/g,'.')} | children: ${[...row.children].map((c,i)=>`[${i}]${c.tagName}.${c.className.trim().replace(/\s+/g,'.')||'(no-class)'}`).join('  ')}`);

    if (config.debugDom) {
        const limit = config.debugDomLimit || 5000;
        log(`[DOM DUMP]:\n${(row.outerHTML||'').slice(0, limit)}`);
    }

    // ── Title ─────────────────────────────────────────────────────────────────

    let title = "";
    if (selectors.title) {
        const titleEl = row.querySelector(selectors.title);
        if (titleEl) { title = titleEl.textContent.trim(); log(`Title: "${title}"`); }
        else { log(`Title selector '${selectors.title}' found no element.`); }
    }
    if (!title) {
        if (config.name === "Letterboxd") {
            const m = first.href.match(/film\/([^\/]+)/);
            if (m) { title = m[1].replace(/-/g,' ').replace(/\b\w/g,l=>l.toUpperCase()); log(`Title (LB slug): ${title}`); }
        }
        if (!title) {
            const img = row.querySelector("img[alt]");
            if (img) { title = img.alt.trim().replace(/^Poster for\s+/i,''); log(`Title (img alt): ${title}`); }
        }
        if (!title) { title = first.textContent.trim(); log(`Title (link text): ${title}`); }
    }
    if (title) title = title.replace(/\s+/g,' ').trim();

    // ── Year — extract from title suffix BEFORE stripping ────────────────────

    let year = "";
    if (config.titleStripYear && title) {
        const m = title.match(/\((\d{4})\)\s*$/);
        if (m) { year = m[1]; log(`Year from title: ${year}`); }
        title = title.replace(/\s*\(\d{4}\)\s*$/,'').trim();
        log(`Title after strip: ${title}`);
    }

    if (selectors.subtitle) {
        const subtitleEl = row.querySelector(selectors.subtitle);
        if (subtitleEl) { const s = subtitleEl.textContent.trim(); if (s) { title += ` (${s})`; log(`Subtitle: ${s}`); } }
    }

    if (!year && selectors.yearRegex) {
        const m = row.textContent.match(new RegExp(selectors.yearRegex));
        if (m) { year = m[0]; log(`Year regex: ${year}`); }
    }

    if (title) title = title.replace(/^(Board|Video|Card) Game:\s+/i,'');

    // ── Date ──────────────────────────────────────────────────────────────────

    log(`Extracting date...`);
    let date = "";

    if (config.name === 'Backloggd') {
        date = extractBackloggdDate(row);

    } else if (config.name === 'BoardGameGeek') {
        date = extractBGGDate(row);

    } else if (config.name === 'Serializd') {
        date = extractSerializdDate(row);

    } else if (selectors.dateSelector) {
        // Generic selector-based extraction
        const dateEl = row.querySelector(selectors.dateSelector);
        if (dateEl) {
            let raw = selectors.dateAttribute ? (dateEl.getAttribute(selectors.dateAttribute) || '') : '';
            if (!raw) raw = dateEl.textContent.trim();
            const parsed = normalizeDate(raw);
            if (parsed) { date = parsed; log(`Date: ${date} (raw: "${raw.slice(0,60)}")`); }
            else { log(`Date selector found element but could not parse: "${raw.slice(0,80)}"`); }
        } else {
            log(`Date selector '${selectors.dateSelector}' found no element.`);
        }
    }

    // ── Rating ────────────────────────────────────────────────────────────────

    log(`Extracting rating...`);
    let rating = "";

    if (config.name === 'BoardGameGeek') {
        // Rating is in the Angular-rendered DOM — scan surrounding rows
        rating = extractBGGRating(row);
    } else {
        rating = extractRating(row, selectors, config.name);
    }

    // ── Platform (Backloggd) ──────────────────────────────────────────────────

    let platform = "";
    if (selectors.platformSelector) {
        const el = row.querySelector(selectors.platformSelector);
        if (el) { platform = el.textContent.trim(); log(`Platform: ${platform}`); }
    }

    // ── Poster ────────────────────────────────────────────────────────────────

    let poster = null;

    // ── Letterboxd: try local row image first; only hit detail page if it's a placeholder ──
    if (config.name === 'Letterboxd' && selectors.image) {
        const img = row.querySelector(selectors.image);
        if (img) {
            let src = getBestSrc(img);
            if (src) {
                if (!src.startsWith('http')) src = new URL(src, window.location.href).href;
                if (!isInvalidImage(src)) {
                    poster = upscaleImage(src);
                    log(`Local poster: ${poster}`);
                } else {
                    log(`Local image invalid/placeholder: ${src}`);
                }
            }
        }
        if (!poster) log(`Image selector '${selectors.image}' returned nothing.`);
    }

    if (config.fetchDetail && !poster && first && first.href) {
        let detailLink = first;
        if (selectors.detailLinkSelector) {
            const alt = row.querySelector(selectors.detailLinkSelector);
            if (alt && alt.href) { detailLink = alt; log(`detailLinkSelector: ${alt.href}`); }
        }
        let fetchUrl = detailLink.href;

        // Letterboxd: normalize user diary URL → canonical film page
        // e.g. letterboxd.com/doerrhb/film/the-artifice-girl/ → letterboxd.com/film/the-artifice-girl/
        if (config.name === 'Letterboxd') {
            const lbMatch = fetchUrl.match(/(letterboxd\.com\/)(?:[^\/]+\/)(film\/[^\/]+\/?)/);
            if (lbMatch) {
                fetchUrl = 'https://' + lbMatch[1] + lbMatch[2];
                log(`Letterboxd detail URL normalized: ${fetchUrl}`);
            }
        }

        log(`Fetching detail page: ${fetchUrl}`);
        try {
            const resp = await fetch(fetchUrl);
            if (!resp.ok) throw new Error(`Status ${resp.status}`);
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // 1. Try each comma-separated detailImage selector
            if (selectors.detailImage) {
                for (const sel of selectors.detailImage.split(',').map(s=>s.trim())) {
                    const img = doc.querySelector(sel);
                    if (img) {
                        const src = getBestSrc(img);
                        if (src) {
                            const abs = new URL(src, fetchUrl).href;
                            if (!isInvalidImage(abs)) { poster = abs; log(`Detail poster via "${sel}": ${poster}`); break; }
                        }
                    }
                }
            }

            // 2. OpenGraph meta tag
            // NOTE: Skip og:image on Letterboxd DIARY page (backdrop crop) but film detail pages
            //       have the real vertical poster as og:image — allow it here since fetchUrl
            //       has already been normalized to the canonical film page.
            if (!poster) {
                const og = doc.querySelector('meta[property="og:image"], meta[property="og:image:url"]');
                if (og && og.content) {
                    const abs = new URL(og.content, fetchUrl).href;
                    if (!isInvalidImage(abs)) { poster = abs; log(`Detail poster via OpenGraph: ${poster}`); }
                }
            }

            // 3. Serializd: try date from review detail page
            if (config.name === 'Serializd' && !date) {
                // Try JSON-LD
                const jsonLd = doc.querySelector('script[type="application/ld+json"]');
                if (jsonLd) {
                    try {
                        const ld = JSON.parse(jsonLd.textContent);
                        const raw = ld.datePublished || ld.dateCreated || ld.dateModified || '';
                        if (raw) { const d = normalizeDate(raw); if (d) { date = d; log(`Serializd date from JSON-LD: ${date}`); } }
                    } catch(e) {}
                }
                // Try <time> elements
                if (!date) {
                    const timeEl = doc.querySelector('time[datetime], time');
                    if (timeEl) {
                        const raw = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
                        const d = normalizeDate(raw);
                        if (d) { date = d; log(`Serializd date from <time>: ${date}`); }
                    }
                }
            }

            // 4. Last ditch: any img with "poster" in src/class/alt
            if (!poster) {
                const images = [...doc.querySelectorAll('img')];
                const best = images.find(img => {
                    const src = getBestSrc(img) || '';
                    return (src.includes('poster') || (img.className||'').includes('poster') ||
                            (img.getAttribute('alt')||'').toLowerCase().includes('poster')) && !isInvalidImage(src);
                });
                if (best) { poster = new URL(getBestSrc(best), fetchUrl).href; log(`Detail poster via last-ditch: ${poster}`); }
                else { log(`No poster found on detail page.`); }
            }
        } catch(err) { log(`Error fetching detail page: ${err.message}`); }
    }

    // ── Local image fallback (non-Letterboxd sites) ───────────────────────────

    if (!poster && config.name !== 'Letterboxd' && selectors.image) {
        const img = row.querySelector(selectors.image);
        if (img) {
            let src = getBestSrc(img);
            if (src) {
                if (!src.startsWith('http')) src = new URL(src, window.location.href).href;
                if (!isInvalidImage(src)) { poster = src; log(`Local poster: ${poster}`); }
                else { log(`Local image invalid/placeholder: ${src}`); }
            }
        }
        if (!poster) log(`Image selector '${selectors.image}' returned nothing.`);
    }

    if (poster && !poster.startsWith('data:')) poster = upscaleImage(poster);

    // detailUrl: for BGG, main.js will do a live Angular page load to get rating
    const detailUrl = (config.name === 'BoardGameGeek' && first) ? first.href : null;

    log(`RESULT: title="${title}" date="${date}" rating="${rating}" year="${year}" platform="${platform}"`);
    log(`RESULT: poster=${poster || '(none)'}`);

    return { title, year, date, rating, platform, poster, detailUrl, debugLogs: logs };

})();
