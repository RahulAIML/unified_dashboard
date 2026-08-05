# Production Release Checklist

This is the minimum release gate for the dashboard builder. Do not publish a
customer dashboard until every required item is complete.

## Deploy

- [ ] Set `AUTH_DATABASE_URL`, `JWT_SECRET`, `REFRESH_SECRET`, and a strong
  `SETUP_SECRET` in the dashboard environment.
- [ ] Run schema setup with `GET /api/auth/setup` and the `X-Setup-Secret`
  header before attempting the bootstrap request.
- [ ] Set `AI_SERVICE_URL` to the real AI service deployment. It must be
  reachable from the dashboard service and protected from direct public use.
- [ ] Deploy the dashboard and confirm `npm run build` succeeded in the host.
- [ ] Confirm migrations through `007_tenant_capability_flags.sql` have run,
  including `006_tenant_credentials.sql`.

## Bootstrap

- [ ] Register the intended platform owner at `/auth/register`.
- [ ] Promote that account once using `POST /api/auth/bootstrap-admin` with the
  `X-Setup-Secret` header. Do not put the secret in a URL.
- [ ] Log out and in again; confirm `/dashboard-builder` loads for that account.
- [ ] Confirm a normal user is redirected away from `/dashboard-builder` and
  receives `403` from `/api/ai/*`.
- [ ] Rotate or remove `SETUP_SECRET` after bootstrap.

## Live Builder Test

- [ ] Use a disposable tenant/domain, never an existing customer, for the first
  publish test.
- [ ] Generate a dashboard, review every preview metric against its upstream,
  and publish only after the validation result is successful.
- [ ] Verify the published dashboard at `/d/<slug>` and a user on the test
  domain receives only that tenant's data.
- [ ] Deactivate or delete the disposable tenant through the admin portal after
  recording the result.

## Operations

- [ ] Restrict the AI service to private networking or enforce a service token.
- [ ] Upgrade Next.js to a patched release and rerun `npm audit --omit=dev`.
- [ ] Configure backups, restore verification, centralized error reporting, and
  uptime alerts before customer launch.
