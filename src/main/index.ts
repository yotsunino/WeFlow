import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

/**
 * Main entry point for the WeFlow Electron application.
 * Handles window creation, lifecycle events, and IPC communication.
 */

let mainWindow: BrowserWindow | null = null;

/**
 * Creates the main application window with appropriate settings
 * for development and production environments.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show window once ready to avoid visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in the default browser instead of Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the renderer — dev server in development, built files in production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Application lifecycle: ready
 * Sets up the app ID, window optimizations, and creates the main window.
 */
app.whenReady().then(() => {
  // Set the app user model ID for Windows taskbar grouping
  electronApp.setAppUserModelId('com.weflow.app');

  // Watch for shortcut keys in development (e.g., F12 for DevTools)
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  // On macOS, re-create the window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * Application lifecycle: all windows closed
 * Quit the app on all platforms except macOS.
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * IPC handler: get-app-version
 * Returns the current application version from package.json.
 */
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

/**
 * IPC handler: open-external-url
 * Safely opens a URL in the system's default browser.
 */
ipcMain.handle('open-external-url', async (_event, url: string) => {
  const allowedProtocols = ['https:', 'http:'];
  try {
    const parsed = new URL(url);
    if (allowedProtocols.includes(parsed.protocol)) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'Disallowed protocol' };
  } catch {
    return { success: false, error: 'Invalid URL' };
  }
});
