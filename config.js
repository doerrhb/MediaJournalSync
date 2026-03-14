const SITE_CONFIGS = [
    {
        name: "Letterboxd",
        urlPattern: "letterboxd.com",
        pathPattern: "/diary/",
        fetchDetail: true,        // fallback for when in-row thumbnail is a lazy-load placeholder
        titleStripYear: true,     // "Bloodsport (1988)" → title="Bloodsport" year="1988"
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
            row: "tr",
            title: "span.frame-title",
            // Date confirmed from DOM: <a class="daydate" href="/doerrhb/diary/films/for/2026/03/07/">07</a>
            // normalizeDate() matches /for/YYYY/MM/DD/ in the href
            dateSelector: "a.daydate",
            dateAttribute: "href",
            // Rating confirmed: <span class="rating rated-8"> in td.col-rating
            ratingSelector: "td.col-rating span.rating",
            ratingParse: "letterboxd-class",
            // Poster confirmed in row DOM: <img class="image" src="a.ltrbxd.com/resized/sm/upload/...">
            // getBestSrc picks up srcset 2x, upscaleImage converts to 1000×1500.
            // fetchDetail=true provides fallback via film page when row has empty-poster placeholder.
            image: "img.image",
            // Film detail page poster (e.g. letterboxd.com/film/the-artifice-girl/)
            detailImage: ".film-poster img, #film-poster img, section.poster-container img"
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
            ratingSelector: "td.field.rating span.staticStars, td.field.rating .stars",
            ratingAttribute: "data-rating",
            detailImage: "img#coverImage, .EditionDetails img, #main-content img.book-cover"
        },
        filename: "goodreads_books.csv",
        folder: "Images/books"
    },
    {
        name: "Backloggd",
        urlPattern: "backloggd.com",
        pathPattern: "/u/",
        // Date: extractBackloggdDate() finds div.date-entry (day sibling) + div.month-year-date (month/year sibling)
        // Rating: .stars-top style="width:90%" → 4.5 stars
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
            image: "img.card-img, img.game-cover",
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
        waitForSelector: "main table tr a[href*='/boardgame/']",
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
            image: "img"
        },
        filename: "bgg_plays.csv",
        folder: "Images/boardgames"
    },
    {
        name: "Serializd",
        urlPattern: "serializd.com",
        pathPattern: "/user/",
        fetchDetail: true,
        // Date: extractSerializdDate() walks ancestors for short date text near the diary entry
        // Falls back to <time> element or JSON-LD on detail page
        waitForSelector: 'a[href*="/show/"]',
        sheetTab: "TV Shows",
        csvFields: ["title", "date", "rating"],
        csvHeaders: "TV Show Name,Date Watched,Rating",
        reviewFields: [
            { key: "title",  label: "Show & Season", placeholder: "",         required: true,  width: "full" },
            { key: "date",   label: "Date Watched",  placeholder: "M/D/YYYY", required: false, width: "half" },
            { key: "rating", label: "Rating (★/5)",  placeholder: "e.g. 5",   required: false, width: "half" }
        ],
        selectors: {
            entryLink: 'a[href*="/show/"]',
            row: ".diary-log, .diary-entry, div[class*='diary']",
            title: "h2",
            subtitle: ".small-text",
            image: "img",
            detailLinkSelector: "a[href*='/review/']",
            detailImage: "img[alt*='Poster'], img[src*='tmdb'], img[src*='serializd-tmdb']"
        },
        filename: "serializd_shows.csv",
        folder: "Images/tvshows"
    }
];

if (typeof module !== 'undefined') module.exports = SITE_CONFIGS;
