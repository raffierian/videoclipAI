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

// Auto-Updater Events
autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Tersedia',
    message: 'Versi baru telah diunduh. Aplikasi akan ditutup dan diperbarui.',
    buttons: ['Restart Sekarang', 'Nanti']
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

app.on('ready', () => {
  createWindow();
  // Check for updates
  autoUpdater.checkForUpdatesAndNotify();
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
