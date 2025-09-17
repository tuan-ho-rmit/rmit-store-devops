## Testing Strategy

### Server (Jest)
- Unit, integration, API tests under `server/__tests__`
- Run with `NODE_ENV=test`, import the Express app (no `.listen`) and use Supertest
- DB isolation with mongodb-memory-server or seeded test DB
- In CI: `npm test` with coverage; archive `server/coverage/**`

### Web UI (Playwright)
- Tests in `tests/e2e-playwright/tests`
- Config via `BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASS`, `READ_ONLY_GUARD`
- Run in CI post‑staging deploy using official Playwright image
- Videos and traces retained on failure

#### Example CI stage
```bash
docker run --rm \
  -e BASE_URL="http://$STAGING_HOST" \
  -e ADMIN_EMAIL="$P_ADMIN_EMAIL" -e ADMIN_PASS="$P_ADMIN_PASS" \
  -v $PWD/tests/e2e-playwright:/e2e -w /e2e \
  mcr.microsoft.com/playwright:v1.48.2-jammy bash -lc "npm install && npx playwright install --with-deps && npx playwright test"
```

### PR Flow (optional)
- Jenkins multibranch job to run Jest + Playwright smoke with `READ_ONLY_GUARD=1`, no deploy

### Test Data & Seeding
- Mongo seeding via Ansible seeds an admin user and catalog; `.seeded` flag set only after post‑verify counts > 0
- For Playwright smoke without DB mutations, set `READ_ONLY_GUARD=1` to stub POST/PUT/PATCH/DELETE


