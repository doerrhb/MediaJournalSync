/*
  Media Journal Sync - Configuration File
  Edit this file to add or update selectors for different sites.
*/

const SITE_CONFIGS = [
    {
        name: "Letterboxd",
        urlPattern: "letterboxd.com",
        pathPattern: "/diary/",
        selectors: {
            // How to find the main list entries
            entryLink: 'a[href*="/film/"]',
            // Container for the entry
            row: 'tr, li, div', 
            // Regex for year extraction from row text
            yearRegex: "\\b(19|20)\\d{2}\\b",
            // Image inside row
            image: "img"
        },
        filename: "letterboxd_movies.csv",
        folder: "letterboxd_posters"
    },
    {
        name: "Goodreads",
        urlPattern: "goodreads.com",
        pathPattern: "/review/list/",
        selectors: {
            entryLink: 'a[href*="/book/show/"]',
            row: "tr.review",
            title: ".field.title a",
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: ".field.cover img"
        },
        filename: "goodreads_books.csv",
        folder: "goodreads_covers"
    },
    {
        name: "Backloggd",
        urlPattern: "backloggd.com",
        pathPattern: "/u/", 
        selectors: {
            entryLink: 'a[href*="/games/"]',
            row: ".journal-entry, .card.game-cover, .game-card, .mx-auto.row", 
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
        selectors: {
            entryLink: 'a[href*="/boardgame/"]',
            row: "tr[id*='play_'], tr.bg-light, tr", 
            yearRegex: "\\b(19|20)\\d{2}\\b",
            image: "img"
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
            row: ".diary-entry, .show-card, div",
            title: "h2",
            subtitle: ".small-text",
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
