/*
  Media Journal Sync - Configuration File
  Edit this file to add or update selectors for different sites.
*/

const SITE_CONFIGS = [
    {
        name: "Letterboxd",
        urlPattern: "letterboxd.com",
        pathPattern: "/diary/",
        fetchDetail: true,
        selectors: {
            entryLink: 'a[href*="/film/"]',
            row: 'tr, li, div', 
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img",
            // High-res poster on detail page - prioritized to specific containers
            detailImage: "section.poster-container a img, .film-poster img, .poster img"
        },
        filename: "letterboxd_movies.csv",
        folder: "letterboxd_posters"
    },
    {
        name: "Goodreads",
        urlPattern: "goodreads.com",
        pathPattern: "/review/list/",
        fetchDetail: true,
        selectors: {
            entryLink: 'a[href*="/book/show/"]',
            row: "tr.review",
            title: ".field.title a",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: ".field.cover img",
            // Goodreads Detail Page cover
            detailImage: "img#coverImage, .EditionDetails img, #main-content img.book-cover"
        },
        filename: "goodreads_books.csv",
        folder: "goodreads_covers"
    },
    {
        name: "Backloggd",
        urlPattern: "backloggd.com",
        pathPattern: "/u/", 
        selectors: {
            entryLink: 'a[href^="/games/"]:not([href*="/lib/"]):not([href*="/popular/"]):not([href*="/releases/"]):not([href*="/browse/"])',
            row: ".journal-entry, .card.game-cover, .game-card, .mx-auto.row", 
            subtitle: 'a[href*="played_platform"]',
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img.card-img, img.game-cover"
        },
        filename: "backloggd_games.csv",
        folder: "backloggd_covers"
    },
    {
        name: "BoardGameGeek",
        urlPattern: "boardgamegeek.com",
        pathPattern: "geekplay.php",
        fetchDetail: true,
        selectors: {
            // Broader link selector, filtering done in JS
            entryLink: 'main table a[href*="/boardgame/"]',
            // Flexible row detection
            row: "tr[id^='play_'], .collection_table tr, main table tr, tr", 
            yearRegex: "\\b(19|20)\\d{2}\\b",
            // Image in the row
            image: "img.collection_thumbnail, img.thumbnail, img",
            // BGG Detail Page image
            detailImage: ".game-header-image-container img, img.img-responsive"
        },
        filename: "bgg_plays.csv",
        folder: "bgg_art"
    },
    {
        name: "Serializd",
        urlPattern: "serializd.com",
        pathPattern: "/user/",
        selectors: {
            entryLink: 'a[href*="/show/"]',
            // Row container that holds both title and season info
            row: ".diary-entry, .show-card, .search-result-row, .diary-entry-details, div.jsx-3985971936",
            title: "h2, .show-title, .title",
            // Subtitle for season info
            subtitle: ".small-text, .season-text, div[style*='margin-top: 4px']",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img"
        },
        filename: "serializd_shows.csv",
        folder: "serializd_posters"
    }
];

if (typeof module !== 'undefined') {
    module.exports = SITE_CONFIGS;
}
