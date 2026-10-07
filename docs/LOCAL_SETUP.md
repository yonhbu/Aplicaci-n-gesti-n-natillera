# Setup local

## Requisitos

- Node.js compatible con Vite 7.
- Docker si se van a ejecutar Supabase local y pruebas RLS/E2E.
- Supabase CLI instalado por dependencia del proyecto.

Diagnostico sin secretos:

```bash
npm run dev:doctor
```

## DEV persistente

```bash
npm ci
npm run dev:infra:start
npm run dev:env:write
npm run dev:db:migrate
npm run dev:bootstrap
npm run dev:demo
npm run dev
```

No ejecutes reset destructivo sobre DEV como verificacion rutinaria.

`dev:env:write` lee `supabase status -o env` y crea `.env.local` solo si no existe. No imprime llaves. Debe reportar API local `http://127.0.0.1:44121`.

`dev:demo` crea de forma idempotente un socio ficticio `Socio prueba` en DEV local. Se niega a operar si `SUPABASE_URL` no es `http://127.0.0.1:44121`, si `SUPABASE_ENV=test` o si el ciclo esta cerrado.

URLs DEV:

| Servicio | URL |
| --- | --- |
| App Vite | http://127.0.0.1:5176 |
| Supabase Studio | http://127.0.0.1:44123 |
| Bandeja local OTP | http://127.0.0.1:44124 |
| API Supabase | http://127.0.0.1:44121 |

Para abrir la app desde terminal:

```bash
npm run dev:open
```

## TEST descartable

```bash
npm run test:infra:start
npm run test:infra:reset
npm run test:rls
npm run test:e2e
npm run test:infra:stop
```

TEST usa `.supabase-test`, `SUPABASE_ENV=test`, `.env.test.local` y puertos distintos a DEV. Los comandos de prueba deben negarse a usar puertos DEV.

Puertos TEST:

| Servicio | URL |
| --- | --- |
| API Supabase | http://127.0.0.1:55421 |
| Base de datos | 127.0.0.1:55422 |
| Supabase Studio | http://127.0.0.1:55423 |
| Bandeja local OTP | http://127.0.0.1:55424 |

## Prueba manual RPC idempotente

Usar solo en DEV local con datos ficticios. En Studio local, obtener `user_id` y `cycle_member_id`:

```sql
select wu.user_id
from public.workspace_users wu
join public.workspaces w on w.id = wu.workspace_id
join auth.users u on u.id = wu.user_id
where w.name = 'Natillera local' and u.email = 'admin@example.test';

select cm.id as cycle_member_id
from public.cycle_members cm
join public.members m on m.id = cm.member_id
join public.cycles c on c.id = cm.cycle_id
join public.workspaces w on w.id = cm.workspace_id
where w.name = 'Natillera local'
  and c.year = 2026 and m.display_name = 'Socio prueba';
```

Luego ejecutar dos veces la misma llamada con la misma clave y contenido:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'UUID_USUARIO_ADMIN_LOCAL', true);

select id from public.register_savings_contribution(
  'UUID_CYCLE_MEMBER', 'manual-idem-20261006-001', 100000,
  '2026-09-23', 2026, 10, 'bank_transfer', 'manual'
);
select id from public.register_savings_contribution(
  'UUID_CYCLE_MEMBER', 'manual-idem-20261006-001', 100000,
  '2026-09-23', 2026, 10, 'bank_transfer', 'manual'
);
select count(*) as filas_de_esta_operacion
from public.savings_contributions
where cycle_member_id = 'UUID_CYCLE_MEMBER'
  and idempotency_key = 'manual-idem-20261006-001';
commit;
```

Esperado: ambas llamadas devuelven el mismo `id` y el conteo es `1`.

## Movil e iPhone

Para escritorio local usa `npm run dev -- --host 127.0.0.1`. Para emular movil, usa Playwright o devtools responsive.

Para iPhone fisico no basta cambiar a `--host 0.0.0.0`: la URL de Supabase tambien debe ser accesible desde el telefono y `crypto.randomUUID()` exige contexto seguro. Si se configura prueba fisica, debe hacerse con perfil LAN/HTTPS separado y datos ficticios, sin exponer Studio ni llaves administrativas.

## Respaldos legacy

Los respaldos se conservan fuera de Git. En esta maquina hay un manifiesto local ignorado por Git en `incoming/manifests/legacy-sources-2026-10-06.sha256.json`.

Comprobantes originales: no hay carpeta/archivo de imagenes confirmada en las rutas entregadas. Las referencias del JSON no equivalen a los bytes de imagen.
