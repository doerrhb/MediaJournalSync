browser.browserAction.onClicked.addListener(async (tab) => {

    console.log("Letterboxd exporter triggered");

    if (!tab.url.includes("/diary")) {
        console.log("Not on a diary page");
        return;
    }

    try {

        const results = await browser.tabs.executeScript(tab.id, {
            file: "scraper.js"
        });

        const movie = results[0];

        console.log("Scraped movie:", movie);

        if (!movie) {
            console.log("No movie found on page");
            return;
        }

        const data = await browser.storage.local.get("movies");
        const movies = data.movies || [];

        const exists = movies.find(m =>
            m.title === movie.title && m.year === movie.year
        );

        if (!exists) {
            movies.push(movie);
        }

        await browser.storage.local.set({ movies });

        const csv = buildCSV(movies);

        const blob = new Blob([csv], {type: "text/csv"});
        const url = URL.createObjectURL(blob);

        await browser.downloads.download({
            url,
            filename: "letterboxd_movies.csv"
        });

        console.log("CSV download triggered");

        if (movie.poster) {

            await browser.downloads.download({
                url: movie.poster,
                filename: `letterboxd_posters/${sanitize(movie.title)}_${movie.year}.jpg`
            });

            console.log("Poster download triggered");
        }

    } catch (err) {

        console.error("Extension error:", err);

    }

});

function buildCSV(movies) {

    let csv = "Title,Year\n";

    for (const m of movies) {
        csv += `"${m.title}",${m.year}\n`;
    }

    return csv;
}

function sanitize(text) {
    return text.replace(/[^\w\d]/g, "_").toLowerCase();
}