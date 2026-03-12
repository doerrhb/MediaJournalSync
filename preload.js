const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getConfigs:       ()       => ipcRenderer.invoke('get-configs'),
    scrapeSite:       (args)   => ipcRenderer.invoke('scrape-site', args),
    openLoginWindow:  (args)   => ipcRenderer.invoke('open-login-window', args),
    saveImage:        (args)   => ipcRenderer.invoke('save-image', args),
    appendCSV:        (args)   => ipcRenderer.invoke('append-csv', args),
    syncSheets:       (args)   => ipcRenderer.invoke('sync-sheets', args),
    gitPush:          ()       => ipcRenderer.invoke('git-push'),
    pingSheets:       ()       => ipcRenderer.invoke('ping-sheets'),
    readLastRow:      (args)   => ipcRenderer.invoke('read-last-row', args),
    loadSettings:     ()       => ipcRenderer.invoke('load-settings'),
    saveSettings:     (s)      => ipcRenderer.invoke('save-settings', s),
    openFolder:       (f)      => ipcRenderer.invoke('open-folder', f),
    openUrl:          (u)      => ipcRenderer.invoke('open-url', u),
    chooseFolder:     ()       => ipcRenderer.invoke('choose-folder'),
    getLogDir:        ()       => ipcRenderer.invoke('get-log-dir'),
    getTodayLog:      ()       => ipcRenderer.invoke('get-today-log'),
    openLogFolder:    ()       => ipcRenderer.invoke('open-log-folder'),

    // Real-time log streaming: renderer calls this to register a listener
    onLogLine: (callback) => {
        ipcRenderer.on('log-line', (event, data) => callback(data));
    }
});
