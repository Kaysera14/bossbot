-- Distingue el cierre automático (grupo lleno) del cierre manual (botón 🔒),
-- para que al salir alguien el grupo se reabra solo si no lo cerrasteis vosotros.
ALTER TABLE groups ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
