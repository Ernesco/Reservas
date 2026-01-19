// seguridad.js - Bloqueo inmediato
(function() {
    // Bloqueo de menú contextual (botón derecho)
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    }, false);

    // Bloqueo de combinaciones de teclas
    document.addEventListener('keydown', function(e) {
        // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, Ctrl+S
        if (
            e.key === "F12" || 
            (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) ||
            (e.ctrlKey && (e.key === "u" || e.key === "s"))
        ) {
            e.preventDefault();
        }
    }, false);
})();