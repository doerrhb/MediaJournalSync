const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getConfigs:        ()            => ipcRenderer.invoke('get-configs'),
    scrapeSite:        (args)        => ipcRenderer.invoke('scrape-site', args),
    openLoginWindow:   (args)        => ipcRenderer.invoke('open-login-window', args),
    saveImage:         (args)        => ipcRenderer.invoke('save-image', args),
    appendCSV:         (args)        => ipcRenderer.invoke('append-csv', args),
    syncSheets:        (args)        => ipcRenderer.invoke('sync-sheets', args),
    gitPush:           ()            => ipcRenderer.invoke('git-push'),
    loadSettings:      ()            => ipcRenderer.invoke('load-settings'),
    saveSettings:      (s)           => ipcRenderer.invoke('save-settings', s),
    openFolder:        (f)           => ipcRenderer.invoke('open-folder', f),
    chooseFolder:      ()            => ipcRenderer.invoke('choose-folder')
});
