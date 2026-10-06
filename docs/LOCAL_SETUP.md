# Setup local

## Requisitos

- Node.js compatible con Vite 7.
- Docker si se van a ejecutar Supabase local y pruebas RLS/E2E.
- Supabase CLI instalado por dependencia del proyecto.

## DEV persistente

```bash
npm ci
cp .env.example .env.local
npm run dev:infra:start
npm run dev:db:migrate
npm run dev:bootstrap
npm run dev
```

No ejecutes reset destructivo sobre DEV como verificacion rutinaria.

## TEST descartable

```bash
npm run test:infra:start
npm run test:infra:reset
npm run test:rls
npm run test:e2e
npm run test:infra:stop
```

TEST usa `.supabase-test` y puertos distintos a DEV.
