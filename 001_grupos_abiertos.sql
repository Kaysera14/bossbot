-- Los grupos ahora nacen abiertos y se cierran al llegar al tamaño máximo
-- o cuando alguien pulsa "Cerrar grupo".
ALTER TABLE groups ADD COLUMN closed INTEGER NOT NULL DEFAULT 0;
