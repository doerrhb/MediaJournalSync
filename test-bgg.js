const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    win.webContents.on('did-finish-load', async () => {
        const result = await win.webContents.executeJavaScript(`
            (function() {
                var metas = Array.from(document.querySelectorAll('meta')).map(m => m.outerHTML);
                var links = Array.from(document.querySelectorAll('link')).map(l => l.outerHTML);
                var allImgs = Array.from(document.querySelectorAll('img')).map(i => i.src);
                return JSON.stringify({ metas, links, imgs: allImgs.slice(0, 10) });
            })()
        `);
        require('fs').writeFileSync('bgg-dump.json', result);
        console.log("Dumped to bgg-dump.json");
        app.quit();
    });
    win.loadURL('https://boardgamegeek.com/boardgame/161936/pandemic-legacy-season-1');
});
