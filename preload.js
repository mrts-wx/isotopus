const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('isotopus', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseMusicFolder: () => ipcRenderer.invoke('library:chooseFolder'),
  removeMusicFolder: folder => ipcRenderer.invoke('library:removeFolder', folder),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  mediaUrl: id => ipcRenderer.invoke('library:mediaUrl', id),
  exportPlaylist: tracks => ipcRenderer.invoke('playlist:export', tracks),
  getLocalLyrics: id => ipcRenderer.invoke('lyrics:local', id),
  openLyricsFile: () => ipcRenderer.invoke('lyrics:openFile'),
  saveLyrics: (id, content) => ipcRenderer.invoke('lyrics:save', { id, content }),
  searchLyrics: track => ipcRenderer.invoke('lyrics:search', track),
  onLibraryUpdated: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('library:updated', listener);
    return () => ipcRenderer.removeListener('library:updated', listener);
  }
});
