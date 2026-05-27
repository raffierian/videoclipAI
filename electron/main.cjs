const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const { autoUpdater } = require('electron-updater')

let mainWindow
let serverProcess

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  const serverPath = path.join(__dirname, '..', 'dist-server', 'server.js')
  const { utilityProcess } = require('electron')
  serverProcess = utilityProcess.fork(serverPath, [], {
    cwd: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: app.isPackaged ? 'production' : 'development'
    },
    stdio: 'pipe'
  })

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server] ${data}`)
    if (data.toString().includes('Server running on port 3000') || data.toString().includes('localhost:3000')) {
      mainWindow.loadURL('http://localhost:3000')
    }
  })

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error] ${data}`)
  })

  serverProcess.on('exit', (code, signal) => {
    if (app.isPackaged && code !== 0) {
      dialog.showErrorBox('Backend Crash', `Server exited with code ${code} and signal ${signal}`)
    }
  })

  setTimeout(() => {
    if (mainWindow && mainWindow.webContents.getURL() === '') {
      mainWindow.loadURL('http://localhost:3000')
    }
  }, 5000)

  mainWindow.on('closed', function () {
    mainWindow = null
  })
}

// Logger Helper for Auto-Updater
const fs = require('fs');
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFilePath = path.join(logDir, 'updater.log');

function logUpdater(message) {
  const time = new Date().toISOString();
  const entry = `[${time}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, entry);
  } catch (e) {
    console.error('Failed to write to updater log file:', e);
  }
  console.log(`[Updater] ${message}`);
}

// Auto-Updater Events
autoUpdater.on('checking-for-update', () => {
  logUpdater('Mengecek pembaruan...');
});

autoUpdater.on('update-available', (info) => {
  logUpdater(`Pembaruan tersedia: Versi ${info.version}`);
  dialog.showMessageBox({
    type: 'info',
    title: 'Pembaruan Tersedia',
    message: `Versi baru (${info.version}) telah tersedia. Sedang mengunduh pembaruan di latar belakang...`,
    buttons: ['OK']
  });
});

autoUpdater.on('update-not-available', (info) => {
  logUpdater('Aplikasi sudah menggunakan versi terbaru.');
});

autoUpdater.on('error', (err) => {
  logUpdater(`Error saat mengecek pembaruan: ${err.stack || err.message}`);
});

autoUpdater.on('download-progress', (progressObj) => {
  const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2); // MB/s
  const percent = progressObj.percent.toFixed(2);
  logUpdater(`Progress unduhan: ${percent}% (${speed} MB/s)`);
});

autoUpdater.on('update-downloaded', (info) => {
  logUpdater('Pembaruan selesai diunduh.');
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Siap Dipasang',
    message: 'Versi baru telah diunduh. Aplikasi akan ditutup dan diperbarui.',
    buttons: ['Restart Sekarang', 'Nanti']
  }).then((result) => {
    if (result.response === 0) {
      logUpdater('Memulai proses instalasi pembaruan...');
      autoUpdater.quitAndInstall();
    }
  });
});


app.on('ready', () => {
  createWindow();

  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  // Attach logger so electron-updater writes to our log file
  autoUpdater.logger = {
    info: (msg) => logUpdater(`[INFO] ${msg}`),
    warn: (msg) => logUpdater(`[WARN] ${msg}`),
    error: (msg) => logUpdater(`[ERROR] ${msg}`),
    debug: (msg) => logUpdater(`[DEBUG] ${msg}`),
  };

  // Check for updates after a small delay to let the window load first
  setTimeout(() => {
    logUpdater(`Memulai pengecekan pembaruan... (versi saat ini: ${app.getVersion()})`);
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      logUpdater(`checkForUpdatesAndNotify error: ${err.message || err}`);
    });
  }, 3000);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    if (serverProcess) {
      serverProcess.kill()
    }
    app.quit()
  }
})

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow()
  }
})
