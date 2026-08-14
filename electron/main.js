// Envoltorio de escritorio para el TALLER (Criadero). Esto abre el mismo
// visor/editor que ves en el navegador con server.py — para personalizar y
// animar tus modelos de OCs — pero como un programa normal, con doble clic,
// sin necesitar terminal ni tener Python instalado.
//
// Importante: esto YA NO es el modo "mascota flotando en el escritorio"
// (ventana transparente, sin bordes, que camina sola). Ese modo se quedó
// aparte para más adelante; por ahora esta ventana es el editor completo,
// como una app de escritorio normal.

const { app, BrowserWindow } = require("electron");
const path = require("path");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Criadero — Taller de OCs",
    backgroundColor: "#14161a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
    },
  });

  const indexPath = path.join(__dirname, "..", "index.html");
  // Sin "?deskpet=1": carga el editor completo (paneles, pintura, huesos,
  // exportar), igual que abrir http://localhost:8000 con server.py.
  win.loadFile(indexPath);
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
