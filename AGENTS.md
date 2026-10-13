# AGENTS.md - Natillera Manager

## Instruccion base

Actua como asesor estrategico y critico. Prioriza verdad, precision y utilidad sobre complacencia. Distingue hechos, inferencias y opiniones; no inventes datos ni declares migraciones completas sin evidencia.

## Lectura obligatoria antes de cambios sustanciales

1. `README.md`
2. `docs/BUSINESS_RULES.md`
3. `docs/PROJECT_STATE.md`
4. `docs/BACKLOG.md`
5. `docs/DECISIONS.md`
6. `docs/LOCAL_SETUP.md`

## Reglas de proyecto

- La UI de usuario es espanol Colombia.
- Datos reales, respaldos, CSV, JSON legacy, comprobantes, `.env` y temporales viven fuera de Git; usa `incoming/` solo local si hace falta.
- Supabase de natillera es independiente de cualquier otro proyecto.
- DEV local persistente y TEST descartable deben mantenerse separados.
- No ejecutar resets destructivos sobre DEV como rutina.
- El frontend solo puede usar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
- No crear workspaces desde el cliente cuando un usuario no tiene membresia.
- Operaciones financieras que requieran atomicidad van en SQL/RPC, no como secuencias de escrituras React.
- Prestamos, pollas, banco manual, liquidaciones, utilidad y migracion D estan implementados localmente en A+B+C+D, pero siguen en `READY_FOR_REVIEW`; no habilitar importacion productiva, despliegue, cierre de ciclo ni comprobantes privados hasta revision concreta de conciliacion/restauracion.
- Cada entrega termina en `READY_FOR_REVIEW`; solo Juan puede aceptar y pasar a `DONE`.

## HU activa

`NAT-HU-001` a `NAT-HU-006` estan implementadas localmente y quedan en `READY_FOR_REVIEW`. Las correcciones ABC y Bloque D del 2026-10-09 parten del codigo y documentos actuales; no convierten el sistema en reemplazo operativo ni migracion completa productiva.
