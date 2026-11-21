const { app, BrowserWindow, dialog, shell, session, screen } = require('electron');
app.name = 'Orion Smart Mirror 3';
if (process.platform === 'win32') { app.setAppUserModelId('com.orion.smartmirror3'); }
const fs = require('fs');
const path = require('path');

function desktopLog(message, error) {
  try {
    const logPath = path.join(path.dirname(process.execPath), 'orion-startup.log');
    const detail = error ? `\n${error.stack || error.message || String(error)}` : '';
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`);
  } catch (_) {
    // Logging must never prevent the app from starting.
  }
}

process.on('uncaughtException', (error) => desktopLog('Uncaught exception', error));
process.on('unhandledRejection', (error) => desktopLog('Unhandled rejection', error));

function loadDesktopEnv(appRoot) {
  let dotenv;
  try {
    dotenv = require('dotenv');
  } catch (error) {
    return;
  }

  const candidateDirs = [
    process.cwd(),
    path.dirname(process.execPath),
    process.resourcesPath,
    appRoot,
  ].filter(Boolean).map((dir) => path.resolve(dir));

  for (const dir of Array.from(new Set(candidateDirs))) {
    dotenv.config({ path: path.join(dir, '.env.local') });
    dotenv.config({ path: path.join(dir, '.env') });
  }
}

loadDesktopEnv();

const APP_PORT = Number(process.env.ORION_PORT || process.env.PORT || 3001);
let serverHandle;

function createWindow(url) {
  const isWindowed = process.argv.includes('--windowed') || process.env.ORION_WINDOWED === 'true';

  // Target smart mirror 768 x 1376 display resolution
  let targetWidth = 768;
  let targetHeight = 1376;

  try {
    const primaryDisplay = screen ? screen.getPrimaryDisplay() : null;
    if (primaryDisplay && primaryDisplay.bounds) {
      const { width: pWidth, height: pHeight } = primaryDisplay.bounds;
      if (pWidth === 768 && pHeight === 1376) {
        targetWidth = 768;
        targetHeight = 1376;
      } else if (pHeight > pWidth) {
        // Vertical / Portrait display orientation
        targetWidth = pWidth;
        targetHeight = pHeight;
      }
    }
  } catch (err) {
    desktopLog('Display detection note', err);
  }

  // CLI override e.g. --res=768x1376 or --resolution=768x1376
  const resArg = process.argv.find(arg => arg.startsWith('--res=') || arg.startsWith('--resolution='));
  if (resArg) {
    const parts = resArg.split('=')[1].toLowerCase().split('x');
    if (parts.length === 2) {
      const parsedW = parseInt(parts[0], 10);
      const parsedH = parseInt(parts[1], 10);
      if (!isNaN(parsedW) && !isNaN(parsedH) && parsedW > 0 && parsedH > 0) {
        targetWidth = parsedW;
        targetHeight = parsedH;
      }
    }
  }

  if (process.env.ORION_WIDTH && process.env.ORION_HEIGHT) {
    const envW = parseInt(process.env.ORION_WIDTH, 10);
    const envH = parseInt(process.env.ORION_HEIGHT, 10);
    if (!isNaN(envW) && !isNaN(envH) && envW > 0 && envH > 0) {
      targetWidth = envW;
      targetHeight = envH;
    }
  }
  const win = new BrowserWindow({
    width: targetWidth,
    height: targetHeight,
    minWidth: 320,
    minHeight: 480,
    title: 'Orion Smart Mirror 3',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    fullscreen: !isWindowed,
    show: false, // Stay hidden until content is fully rendered
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: true,
    },
  });

  // Only show the window once the page has fully rendered â€” no black flash
  win.webContents.on('did-finish-load', () => {
    if (!isWindowed) {
      win.setFullScreen(true);
    }
    win.show();
    win.focus();
  });

  // Enable F11 fullscreen toggle and Escape to exit fullscreen for seamless mirror experience
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
    if (input.key === 'Escape' && input.type === 'keyDown' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(true);
  });

  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (
      targetUrl.startsWith('http://127.0.0.1') ||
      targetUrl.startsWith('http://localhost') ||
      targetUrl.includes('accounts.google.com') ||
      targetUrl.includes('accounts.spotify.com')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
        }
      };
    }
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  win.loadURL(url);
}

async function startDesktopServer() {
  const appRoot = app.getAppPath();
  loadDesktopEnv(appRoot);
  desktopLog(`Starting server. appRoot=${appRoot}, execPath=${process.execPath}, APP_URL=${process.env.APP_URL || ''}, SPOTIFY_REDIRECT_URI=${process.env.SPOTIFY_REDIRECT_URI || ''}`);
  const serverPath = path.join(appRoot, 'dist', 'server.cjs');

  desktopLog(`Checking server bundle at ${serverPath}. exists=${fs.existsSync(serverPath)}`);

  if (!fs.existsSync(serverPath)) {
    throw new Error('Desktop build is missing dist/server.cjs. Run npm run build first.');
  }

  process.env.NODE_ENV = 'production';
  process.env.ORION_SERVER_AUTOSTART = 'false';
  process.env.PORT = String(APP_PORT);
  process.env.APP_URL = process.env.APP_URL || `http://127.0.0.1:${APP_PORT}`;

  const serverModule = require(serverPath);
  if (!serverModule.startServer) {
    throw new Error('dist/server.cjs did not export startServer.');
  }

  serverHandle = await serverModule.startServer({
    port: APP_PORT,
    host: '0.0.0.0',
    appRoot,
    useVite: false,
  });

  return serverHandle.url;
}

app.whenReady().then(async () => {
  try {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['https://ais-dev-2stfzfltf33qw7myeiucht-1039508981893.asia-southeast1.run.app/*'] },
      (details, callback) => {
        if (details.url.includes('/api/spotify/callback')) {
          const urlObj = new URL(details.url);
          callback({ redirectURL: `http://localhost:3001/api/spotify/callback${urlObj.search}` });
        } else {
          callback({});
        }
      }
    );
    const url = await startDesktopServer();
    createWindow(url);
  } catch (error) {
    desktopLog('Startup failed', error);
    dialog.showErrorBox('Orion Smart Mirror 3 failed to start', error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (
      url.includes('homeassistant.local') ||
      url.includes('.local') ||
      url.includes('127.0.0.1') ||
      url.includes('localhost') ||
      /^https:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01]))/.test(url)
    ) {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle?.url) {
      createWindow(serverHandle.url);
    }
  });
});

app.on('window-all-closed', () => {
  if (serverHandle?.server) {
    serverHandle.server.close();
  }
  app.quit();
});

