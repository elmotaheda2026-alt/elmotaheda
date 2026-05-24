# Al Muttahida Backend

Production-oriented backend foundation for installment operations.

## Includes
- JWT authentication
- Role-based permissions (RBAC)
- SQL Server database with startup schema init
- Audit log for financial operations
- Sales lock rules after payments
- Payment reverse flow (no hard delete)
- Core reports: Aging, Collection Rate, Daily Cash

## Quick Start
1. Copy `.env.example` to `.env`
2. Install dependencies: `pnpm install` (or `npm install`)
3. Seed admin user: `POST /auth/seed-admin`
4. Run: `pnpm dev`

Isolation guarantee:
- Runs on separate port (`PORT`, default `4000`)
- Uses separate database name (`DB_NAME`, recommended `AlMuttahida_New`)
- Does not modify any old company server/database unless you intentionally point `.env` to it

Default seeded admin:
- Email: `admin@almuttahida.com`
- Password: `admin123`

## Main Endpoints
- `POST /auth/login`
- `GET/POST /sales`
- `PUT /sales/:id`
- `GET/POST /payments`
- `POST /payments/:id/reverse`
- `GET /reports/aging`
- `GET /reports/collection-rate`
- `GET /reports/daily-cash?date=YYYY-MM-DD`
- `POST /closing/close`
