const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('isotopus', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  setZoomFactor: factor => ipcRenderer.invoke('window:setZoomFactor', factor),
  chooseMusicFolder: () => ipcRenderer.invoke('library:chooseFolder'),
  removeMusicFolder: folder => ipcRenderer.invoke('library:removeFolder', folder),
  deleteMusicTrack: id => ipcRenderer.invoke('library:deleteTrack', id),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  mediaUrl: id => ipcRenderer.invoke('library:mediaUrl', id),
  exportPlaylist: tracks => ipcRenderer.invoke('playlist:export', tracks),
  getDownloadConsent: () => ipcRenderer.invoke('downloads:consent:get'),
  setDownloadConsent: accepted => ipcRenderer.invoke('downloads:consent:set', accepted),
  checkFfmpeg: () => ipcRenderer.invoke('downloads:check-ffmpeg'),
  downloadAudio: options => ipcRenderer.invoke('downloads:start', options),
  cancelDownload: () => ipcRenderer.invoke('downloads:cancel'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  onDownloadProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  },
  getLocalLyrics: id => ipcRenderer.invoke('lyrics:local', id),
  openLyricsFile: () => ipcRenderer.invoke('lyrics:openFile'),
  saveLyrics: (id, content) => ipcRenderer.invoke('lyrics:save', { id, content }),
  searchLyrics: track => ipcRenderer.invoke('lyrics:search', track),
  searchLyricsWeb: track => ipcRenderer.invoke('lyrics:webSearch', track),
  getLyricsState: id => ipcRenderer.invoke('lyrics:state:get', id),
  saveLyricsState: (id, state) => ipcRenderer.invoke('lyrics:state:set', { id, state }),
  alignLyrics: (id, samples, lines, duration, model) => ipcRenderer.invoke('lyrics:align', { id, samples, lines, duration, model }),
  cancelLyricsAlignment: () => ipcRenderer.invoke('lyrics:align:cancel'),
  listWhisperModels: () => ipcRenderer.invoke('lyrics:models:list'),
  deleteWhisperModel: model => ipcRenderer.invoke('lyrics:models:delete', model),
  onLyricsAlignProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('lyrics:align-progress', listener);
    return () => ipcRenderer.removeListener('lyrics:align-progress', listener);
  },
  getPersistentStore: () => ipcRenderer.sendSync('store:get'),
  setPersistentStore: (key, value) => ipcRenderer.send('store:set', { key, value }),
  openMiniPlayer: () => ipcRenderer.invoke('mini-player:open'),
  publishMiniPlayerState: state => ipcRenderer.send('mini-player:state', state),
  onMiniPlayerCommand: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('mini-player:command', listener); return () => ipcRenderer.removeListener('mini-player:command', listener); },
  onMiniPlayerVisibility: callback => { const listener = (_event, visible) => callback(Boolean(visible)); ipcRenderer.on('mini-player:visibility', listener); return () => ipcRenderer.removeListener('mini-player:visibility', listener); },
  onMiniPlayerRequestState: callback => { const listener = () => callback(); ipcRenderer.on('mini-player:request-state', listener); return () => ipcRenderer.removeListener('mini-player:request-state', listener); },
  onMiniPlayerState: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('mini-player:state', listener); return () => ipcRenderer.removeListener('mini-player:state', listener); },
  requestMiniPlayerState: () => ipcRenderer.send('mini-player:request-state'),
  setMiniPlayerCompact: compact => ipcRenderer.send('mini-player:compact', Boolean(compact)),
  sendMiniPlayerCommand: command => ipcRenderer.send('mini-player:command', command),
  setMiniPlayerAlwaysOnTop: enabled => ipcRenderer.send('mini-player:always-on-top', Boolean(enabled)),
  closeMiniPlayer: () => ipcRenderer.send('mini-player:close'),
  onTrayUnavailable: callback => ipcRenderer.on('tray:unavailable', callback),
  onLibraryUpdated: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('library:updated', listener);
    return () => ipcRenderer.removeListener('library:updated', listener);
  }
});
