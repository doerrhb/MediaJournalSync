/*
  Media Journal Sync - Configuration File

  reviewFields defines what the review panel shows per site.
  waitForSelector:     CSS selector to poll for before running scraper (React/SPA sites).
  titleStripYear:      strip trailing " (YYYY)" from title after extraction.
  dateFromParent:      walk up the DOM tree to find a date header above the card.
  detailLinkSelector:  override which link is followed for detail-page fetching.
*/

const SITE_CONFIGS = [
    {
        name: "Letterboxd",
        urlPattern: "letterboxd.com",
        pathPattern: "/diary/",
        // fetchDetail disabled — inline URL upscaling handles images reliably.
        // The detail fetch was failing because Letterboxd lazy-loads poster JS.
        fetchDetail: false,
        titleStripYear: true,   // span.frame-title contains "Bloodsport (1988)" — strip year
        sheetTab: "Movies",
        csvFields: ["title", "date", "rating", "year"],
        csvHeaders: "Movie Name,Date Watched,Rating,Year",
        reviewFields: [
            { key: "title",  label: "Movie Title",  placeholder: "",         required: true,  width: "full" },
            { key: "date",   label: "Date Watched", placeholder: "M/D/YYYY", required: false, width: "half" },
            { key: "rating", label: "Rating (★/5)", placeholder: "e.g. 3.5", required: false, width: "half" },
            { key: "year",   label: "Release Year", placeholder: "YYYY",     required: true,  width: "half" }
        ],
        selectors: {
            entryLink: 'a[href*="/film/"]',
            // MUST be "tr" only. "div" in a multi-selector matches the inner div.film-poster
            // BEFORE reaching the <tr>, making sibling td selectors for date/rating invisible.
            row: "tr",
            // span.frame-title inside the poster div: "Bloodsport (1988)"
            // titleStripYear trims the " (YYYY)" suffix
            title: "span.frame-title",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img.image",
            // Calendar td: <a href="/doerrhb/diary/for/2026/03/10/">
            dateSelector: "td.td-calendar a",
            dateAttribute: "href",
            dateParse: "letterboxd-href",
            // Rating td: <span class="rating rated-8"> means 4 stars (rated-X / 2)
            ratingSelector: "td.td-rating span.rating",
            ratingParse: "letterboxd-class"
        },
        filename: "letterboxd_movies.csv",
        folder: "Images/movies"
    },
    {
        name: "Goodreads",
        urlPattern: "goodreads.com",
        pathPattern: "/review/list/",
        fetchDetail: true,
        sheetTab: "Books",
        csvFields: ["title", "date", "rating"],
        csvHeaders: "Book Name,Date Read,Rating",
        reviewFields: [
            { key: "title",  label: "Book Title",   placeholder: "",         required: true,  width: "full" },
            { key: "date",   label: "Date Read",    placeholder: "M/D/YYYY", required: false, width: "half" },
            { key: "rating", label: "Rating (★/5)", placeholder: "e.g. 4",   required: false, width: "half" }
        ],
        selectors: {
            entryLink: 'a[href*="/book/show/"]',
            row: "tr.review",
            title: ".field.title a",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: ".field.cover img",
            dateSelector: "td.field.date_read .date_row, td.field.date_read span",
            dateParse: "text",
            ratingSelector: "td.field.rating span.staticStars, td.field.rating .stars",
            ratingAttribute: "data-rating",
            ratingParse: "data-attr",
            detailImage: "img#coverImage, .EditionDetails img, #main-content img.book-cover"
        },
        filename: "goodreads_books.csv",
        folder: "Images/books"
    },
    {
        name: "Backloggd",
        urlPattern: "backloggd.com",
        pathPattern: "/u/",
        dateFromParent: true,   // date lives in a section/date heading above the game card
        sheetTab: "Video Games",
        csvFields: ["title", "date", "rating", "platform"],
        csvHeaders: "Video Game Name,Date Played,Rating,Platform",
        reviewFields: [
            { key: "title",    label: "Game Title",   placeholder: "",         required: true,  width: "full" },
            { key: "platform", label: "Platform",     placeholder: "e.g. PC",  required: true,  width: "full" },
            { key: "date",     label: "Date Played",  placeholder: "M/D/YYYY", required: false, width: "half" },
            { key: "rating",   label: "Rating (★/5)", placeholder: "e.g. 4.5", required: false, width: "half" }
        ],
        selectors: {
            entryLink: 'a[href^="/games/"]:not([href*="/lib/"]):not([href*="/popular/"]):not([href*="/releases/"]):not([href*="/browse/"])',
            row: ".journal-entry, .card.game-cover, .game-card, .mx-auto.row",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img.card-img, img.game-cover",
            // In-card date as fast path; dateFromParent walks up on miss
            dateSelector: ".date, .journal-date, .played-date, time",
            dateAttribute: "datetime",
            dateParse: "datetime-or-text",
            ratingSelector: ".user-rating, .game-rating, .stars-rating, .rating-display",
            ratingParse: "text-or-class",
            platformSelector: 'a[href*="played_platform"]'
        },
        filename: "backloggd_games.csv",
        folder: "Images/videogames"
    },
    {
        name: "BoardGameGeek",
        urlPattern: "boardgamegeek.com",
        pathPattern: "geekplay.php",
        fetchDetail: true,
        sheetTab: "Board Games",
        csvFields: ["title", "date", "rating"],
        csvHeaders: "Board Game Name,Date Played,Rating",
        reviewFields: [
            { key: "title",  label: "Game Title",    placeholder: "",         required: true,  width: "full" },
            { key: "date",   label: "Date Played",   placeholder: "M/D/YYYY", required: false, width: "half" },
            { key: "rating", label: "Rating (1–10)", placeholder: "e.g. 7",   required: false, width: "half" }
        ],
        selectors: {
            entryLink: 'main table a[href*="/boardgame/"]',
            row: "tr[id^='play_'], .collection_table tr, main table tr, tr",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img.collection_thumbnail, img.thumbnail, img",
            // BGG geekplay shows dates as ISO "2026-03-10" — scan row text with regex
            dateRegex: "\\b\\d{4}-\\d{2}-\\d{2}\\b",
            // User's personal rating column (rightmost numeric cell)
            ratingSelector: "td.collection_yourrating, td.col_yourrating",
            ratingParse: "text-numeric",
            detailImage: ".game-header-image-container img, img.img-responsive, img[src*='cf.geekdo-images.com']"
        },
        filename: "bgg_plays.csv",
        folder: "Images/boardgames"
    },
    {
        name: "Serializd",
        urlPattern: "serializd.com",
        pathPattern: "/user/",
        fetchDetail: true,
        dateFromParent: true,   // date may be in a heading above the diary entry card
        sheetTab: "TV Shows",
        csvFields: ["title", "date", "rating"],
        csvHeaders: "TV Show Name,Date Watched,Rating",
        reviewFields: [
            { key: "title",  label: "Show & Season", placeholder: "",         required: true,  width: "full" },
            { key: "date",   label: "Date Watched",  placeholder: "M/D/YYYY", required: false, width: "half" },
            { key: "rating", label: "Rating (★/5)",  placeholder: "e.g. 5",   required: false, width: "half" }
        ],
        // React SPA — wait for diary entries to render
        waitForSelector: 'a[href*="/show/"]',
        selectors: {
            entryLink: 'a[href*="/show/"]',
            row: ".diary-log, .diary-entry, div[class*='diary']",
            title: "h2",
            subtitle: ".small-text",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img[alt*='Poster'], img[alt*='poster'], img",
            // Right-hand side of the space-between flex container holds the date
            dateSelector: "div[style*='justify-content: space-between'] > div:last-child, div[style*='flex-direction: row'] > div:last-child",
            dateParse: "text",
            // Rating: handled by SVG star counting in scraper.js (no class selector available)
            ratingSelector: null,
            // For detail fetch: follow the review link that wraps the whole entry
            detailLinkSelector: "a[href*='/review/']",
            detailImage: "img[alt*='Poster'], img[src*='tmdb'], .poster img"
        },
        filename: "serializd_shows.csv",
        folder: "Images/tvshows"
    }
];

if (typeof module !== 'undefined') {
    module.exports = SITE_CONFIGS;
}
