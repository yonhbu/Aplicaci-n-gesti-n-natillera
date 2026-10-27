# Trabajo local y auditoría segura

DEV persistente: API `http://127.0.0.1:44121`, PostgreSQL `44122`. No resetear DEV para verificar cambios. `npm run dev` inicia el servidor seguro sin abrir dotenv.

TEST descartable: API `http://127.0.0.1:55421`, PostgreSQL `55422`, correo OTP local `55424`, frontend `5198`. Docker y dependencias Node deben estar disponibles.

CI y regresión general: `npm run test:e2e:guards`, `npm run test:infra:start`, `npm run test:infra:reset`, `npm run test:rls`, `npm run test:e2e`. El runner prepara sus fixtures antes de descubrir los tests y repite la preparación entre escritorio y móvil; no requiere DEV. Vite usa modo `test` con `envDir: false` y credenciales públicas TEST en memoria. Infraestructura y E2E ya no generan ni leen dotenv; `npm run test:env:write` conserva la escritura explícita para herramientas locales antiguas. [Detalle y evidencias de CI](qa/CI-DATABASE.md).

Auditoría sin leer archivos de entorno privados:

```powershell
node scripts/test-supabase.mjs start
node scripts/test-supabase.mjs reset
node scripts/run-sql-tests-local.mjs
node node_modules/vitest/vitest.mjs run --config vitest.audit.config.ts --maxWorkers=2
node node_modules/typescript/bin/tsc -b
node scripts/build-audit.mjs
node scripts/check-secrets.mjs
node node_modules/@playwright/test/cli.js test --config playwright.functional-audit.config.ts
node node_modules/@playwright/test/cli.js test --config playwright.audit-extended.config.ts
node node_modules/@playwright/test/cli.js test --config playwright.audit-all.config.ts
node scripts/check-audit-artifacts.mjs
```

`npm run qa:functional:all` es el atajo de la corrida completa de navegador. `qa:functional:e2e` ejecuta solamente los escenarios nuevos autocontenidos; las cuatro comprobaciones de integración por fuente no se contabilizan como recorridos financieros de UI.

El reset anterior es únicamente de `.supabase-test`: reconstruye todas las migraciones y elimina fixtures TEST previos. Es el mecanismo de limpieza reproducible. Los E2E crean un workspace e identidad sintéticos nuevos por ejecución, con nombres únicos y estado inicial conocido. No reutilizan el workspace operativo.

El preflight valida API exacta y binding del contenedor TEST; el navegador verifica el endpoint efectivo de Supabase, bloquea service workers y rechaza destinos de red ajenos a la lista permitida. Las credenciales se obtienen en memoria del CLI y nunca se incluyen en fixtures ni reportes.

Metadatos de fixture, evidencia financiera, capturas y resultados: `incoming/functional-audit/`, ignorado por Git. Conservar solo evidencia sintética. No versionar sesiones, tokens, dotenv ni trazas sin sanear.

`node scripts/prove-p011-baseline.mjs` reproduce el defecto contra el componente exacto de la revisión inicial `f5f6671`, sin sobrescribir el código corregido. Su fallo esperado queda documentado como evidencia de reproducción; no es un fallo de la entrega corregida.

La compilación de auditoría inyecta exclusivamente URL/clave pública de TEST en memoria y produce `dist/` local. Esa compilación de verificación no debe publicarse: un despliegue posterior requiere la configuración pública del destino aprobado.
