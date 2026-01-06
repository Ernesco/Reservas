const { app, BrowserWindow } = require('electron');

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true
    }
  });

  // IMPORTANTE: Aquí usamos el puerto 3000
  // Si usas Tailscale, cambiarías localhost por tu IP
  win.loadURL('http://100.121.174.32:3000/login.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function mostrarError(mensaje) {
    const modal = document.getElementById('modalError');
    const texto = document.getElementById('mensajeErrorTexto');
    const btnCerrar = document.getElementById('btnCerrarError');

    texto.textContent = mensaje;
    modal.style.display = 'flex';

    btnCerrar.onclick = () => {
        modal.style.display = 'none';
    };
}