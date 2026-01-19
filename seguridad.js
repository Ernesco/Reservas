// seguridad.js - Bloqueo universal de inspección
document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
}, false);

document.addEventListener('keydown', function(e) {
    // Bloquea F12
    if (e.key === "F12") {
        e.preventDefault();
    }
    // Bloquea Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
    if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C" || e.key === "i" || e.key === "j" || e.key === "c")) {
        e.preventDefault();
    }
    // Bloquea Ctrl+U (Ver código fuente)
    if (e.ctrlKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
    }
    // Bloquea Ctrl+S (Para que no guarden la página localmente)
    if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
    }
}, false);

console.log("Protección de interfaz activa.");