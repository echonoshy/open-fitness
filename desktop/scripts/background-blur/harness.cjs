const { app, BrowserWindow, protocol, net, session, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const root = path.resolve(process.env.BLUR_OUTPUT);
const desktop = path.resolve(__dirname, '../..');
app.setName('open-fitness 背景虚化验证');
app.setPath('userData', path.join(root, 'profile'));
app.commandLine.appendSwitch('disable-accelerated-video-encode');
protocol.registerSchemesAsPrivileged([{ scheme: 'coach', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.whenReady().then(async () => {
  protocol.handle('coach', request => {
    const u = new URL(request.url);
    if (u.host !== 'app') return new Response('Not found', { status: 404 });
    let base = root, route = decodeURIComponent(u.pathname);
    if (route.startsWith('/assets/')) { base = path.join(desktop, 'public'); route = route.slice(7); }
    if (route.startsWith('/fixtures/')) { base = path.join(desktop, 'output/pose-model-comparison'); route = route.slice(9); }
    const file = path.resolve(base, '.' + route);
    if (!file.startsWith(base + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  session.defaultSession.setPermissionCheckHandler((_w, p, origin) => origin.startsWith('coach://app') && p === 'media');
  session.defaultSession.setPermissionRequestHandler((_w, p, cb, d) => cb(d.requestingUrl.startsWith('coach://app') && p === 'media'));
  ipcMain.handle('save-blur-artifact', (_event, { name, data }) => {
    if (!/^[a-z0-9_.-]+$/i.test(name)) throw Error('Invalid artifact filename');
    fs.writeFileSync(path.join(root, name), Buffer.from(data));
  });
  const win = new BrowserWindow({ width: 1440, height: 980, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs'),
  } });
  await win.loadURL('coach://app/index.html');
});
app.on('window-all-closed', () => app.quit());
