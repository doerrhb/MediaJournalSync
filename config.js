/*
  Media Journal Sync - Configuration File
  Edit this file to add or update selectors for different sites.

  reviewFields defines exactly what the review panel shows for each site.
  Each entry: { key, label, placeholder, required, width }
    key         - matches entry property (title, date, rating, year, platform)
    label       - shown above the input
    placeholder - hint text when empty
    required    - highlights red if missing
    width       - "full" or "half" (default half for short fields)
*/

const SITE_CONFIGS = [
    {
        name: "Letterboxd",
        urlPattern: "letterboxd.com",
        pathPattern: "/diary/",
        fetchDetail: true,
        sheetTab: "Movies",
        csvFields: ["title", "date", "rating", "year"],
        csvHeaders: "Movie Name,Date Watched,Rating,Year",
        reviewFields: [
            { key: "title",  label: "Movie Title",   placeholder: "",          required: true,  width: "full" },
            { key: "date",   label: "Date Watched",  placeholder: "M/D/YYYY",  required: false, width: "half" },
            { key: "rating", label: "Rating (★/5)",  placeholder: "e.g. 3.5",  required: false, width: "half" },
            { key: "year",   label: "Release Year",  placeholder: "YYYY",      required: true,  width: "half" }
        ],
        selectors: {
            entryLink: 'a[href*="/film/"]',
            row: 'tr, li, div',
            title: ".td-title h3, .td-title .name",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img",
            dateSelector: "td.td-calendar a, .td-calendar a",
            dateAttribute: "href",
            dateParse: "letterboxd-href",
            ratingSelector: "span.rating[class*='rated-']",
            ratingAttribute: "class",
            ratingParse: "letterboxd-class",
            detailImage: "section.poster-container a img, .film-poster img, .poster img"
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
        sheetTab: "Video Games",
        csvFields: ["title", "date", "rating", "platform"],
        csvHeaders: "Video Game Name,Date Played,Rating,Platform",
        reviewFields: [
            { key: "title",    label: "Game Title",    placeholder: "",          required: true,  width: "full" },
            { key: "platform", label: "Platform",      placeholder: "e.g. PC",   required: true,  width: "full" },
            { key: "date",     label: "Date Played",   placeholder: "M/D/YYYY",  required: false, width: "half" },
            { key: "rating",   label: "Rating (★/5)",  placeholder: "e.g. 4.5",  required: false, width: "half" }
        ],
        selectors: {
            entryLink: 'a[href^="/games/"]:not([href*="/lib/"]):not([href*="/popular/"]):not([href*="/releases/"]):not([href*="/browse/"])',
            row: ".journal-entry, .card.game-cover, .game-card, .mx-auto.row",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img.card-img, img.game-cover",
            dateSelector: "time, .date, .journal-date, .played-date, [class*='date']",
            dateAttribute: "datetime",
            dateParse: "datetime-or-text",
            ratingSelector: ".rating, .star-rating, [class*='rating']",
            ratingParse: "text-numeric",
            subtitle: 'a[href*="played_platform"]',
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
            { key: "title",  label: "Game Title",     placeholder: "",          required: true,  width: "full" },
            { key: "date",   label: "Date Played",    placeholder: "M/D/YYYY",  required: false, width: "half" },
            { key: "rating", label: "Rating (1–10)",  placeholder: "e.g. 7",    required: false, width: "half" }
        ],
        selectors: {
            entryLink: 'main table a[href*="/boardgame/"]',
            row: "tr[id^='play_'], .collection_table tr, main table tr, tr",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img.collection_thumbnail, img.thumbnail, img",
            dateSelector: "td.collection_plays, td[class*='date'], td:nth-child(1)",
            dateParse: "text",
            ratingSelector: "td.collection_bggrating, td[class*='rating'], .play-rating",
            ratingParse: "text-numeric",
            detailImage: ".game-header-image-container img, img.img-responsive"
        },
        filename: "bgg_plays.csv",
        folder: "Images/boardgames"
    },
    {
        name: "Serializd",
        urlPattern: "serializd.com",
        pathPattern: "/user/",
        sheetTab: "TV Shows",
        csvFields: ["title", "date", "rating"],
        csvHeaders: "TV Show Name,Date Watched,Rating",
        reviewFields: [
            { key: "title",  label: "Show & Season",  placeholder: "",          required: true,  width: "full" },
            { key: "date",   label: "Date Watched",   placeholder: "M/D/YYYY",  required: false, width: "half" },
            { key: "rating", label: "Rating (★/5)",   placeholder: "e.g. 5",    required: false, width: "half" }
        ],
        selectors: {
            entryLink: 'a[href*="/show/"]',
            row: ".diary-entry, .show-card, .search-result-row, .diary-entry-details, div.jsx-3985971936",
            title: "h2, .show-title, .title",
            subtitle: ".small-text, .season-text, div[style*='margin-top: 4px']",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img",
            dateSelector: "time, .diary-date, .watched-date, [class*='date']",
            dateAttribute: "datetime",
            dateParse: "datetime-or-text",
            ratingSelector: ".rating, .star-rating, [class*='rating']",
            ratingParse: "text-or-class"
        },
        filename: "serializd_shows.csv",
        folder: "Images/tvshows"
    }
];

if (typeof module !== 'undefined') {
    module.exports = SITE_CONFIGS;
}
