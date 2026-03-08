(function () {

    console.log("Scraper running");

    const links = [...document.querySelectorAll('a[href*="/film/"]')];

    if (links.length === 0) {
        console.log("No film links found");
        return null;
    }

    const first = links[0];

    const href = first.href;

    console.log("Film URL:", href);

    // extract slug
    const match = href.match(/film\/([^\/]+)/);

    if (!match) {
        console.log("Could not extract film slug");
        return null;
    }

    const slug = match[1];

    // convert slug to title
    const title = slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, l => l.toUpperCase());

    // find nearby year
    const row = first.closest("tr, li, div");

    let year = "";

    if (row) {
        const yearMatch = row.textContent.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) year = yearMatch[0];
    }

    // poster
    let poster = null;

    if (row) {
        const img = row.querySelector("img");
        if (img) poster = img.src;
    }

    console.log("Extracted:", title, year, poster);

    return {
        title,
        year,
        poster
    };

})();