# Cleared

Cleared is a brand governance and pre-publication review platform. It helps teams check draft content against approved sources, brand language, policies, and factual references before anything is published.

The current codebase is an MVP-style implementation that includes:
- a React frontend for workspace operations
- an Express API with role-based access control
- SQLite-backed persistence for workspaces, users, invitations, reviews, and approved sources
- an optional AI verification step using the Gemini API

## Product overview

Cleared is designed for a workflow like this:

1. A brand manager or workspace owner adds approved sources.
2. A creator submits a draft or document for review.
3. The system checks the draft against approved sources.
4. Claims are classified as Supported, Contradicted, or Not enough evidence.
5. Reviewers decide whether to approve, reject, or request changes.
6. The workspace keeps the decision trail scoped to that organization.

This is especially useful for marketing, internal communications, compliance, product messaging, and release content where factual and brand accuracy matter.

## Current project status

This repository is a working MVP, not a fully production-hardened platform. The implementation already includes:
- workspace creation and invitation flow
- role-based workspace permissions
- approved source management
- review submission and status updates
- verification checks against trusted source text
- SQLite database persistence with workspace scoping

The project also contains a Supabase migration scaffold for a future managed-auth and multi-tenant architecture, but the live runtime in this repo still uses the local Express + SQLite implementation.

## Core features

### Workspace and access control
- Create a company workspace and become the owner
- Create user accounts and invite employees by email
- Support roles such as owner, administrator, brand_manager, reviewer, and creator
- Enforce workspace-scoped access to reviews and source records
- Prevent users from seeing or editing data outside their workspace

### Approved sources
- Upload approved source documents as TXT, MD, or CSV
- Save source metadata such as name, category, type, and timestamp
- Store text content for Gemini fact-checking
- Keep sources organized by collection/category

### Review workflow
- Submit a review title plus draft text or file upload
- Track review status: In review, Needs changes, Approved, Rejected
- Restrict approvals and changes to the right roles
- Keep review records tied to the creator and workspace

### AI verification
- Send draft content and approved sources to Gemini
- Force the model to return JSON-formatted claim checks
- Use approved source text as the evidence base
- Require a human review decision even when AI finds issues

## Architecture

The application is intentionally split into a frontend app and a backend API so the workspace, source data, and verification logic remain separate from the UI.

### High-level component map

| Component | Responsibility | Notes |
| --- | --- | --- |
| Frontend app | User experience and workspace UI | React + Webpack single-page app |
| API server | Request handling and auth middleware | Express app mounted at `/api` |
| Auth service | Session creation and validation | Uses signed cookies and workspace membership checks |
| Store layer | SQLite persistence | Manages current tenant data and membership rules |
| Review service | Draft submission and review lifecycle | Stores review records and maintains status |
| Source service | Approved source uploads | Reads content for later verification |
| Verification service | AI claim checking | Calls Gemini with approved texts |
| Supabase scaffold | Future database/Auth migration | Not the active runtime implementation |

## Repository structure

```text
cleared/
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── server.js
│   │   │   └── services/
│   │   │       ├── auth.js
│   │   │       ├── reviews.js
│   │   │       ├── sources.js
│   │   │       ├── store.js
│   │   │       ├── verification.js
│   │   │       └── workspace.js
│   │   └── test/
│   │       └── workspace-access.test.js
│   └── web/
│       ├── package.json
│       ├── index.html
│       └── src/
│           ├── main.jsx
│           ├── ReviewDesk.jsx
│           ├── WorkspaceSettings.jsx
│           ├── styles.css
│           └── review-desk.css
├── supabase/
│   ├── README.md
│   ├── migrations/
│   └── tests/
└── .env
```

## Tech stack

### Frontend
- React 18
- Webpack 5
- CSS modules / custom styling
- Lucide icons
- GSAP for motion effects

### Backend
- Node.js 24+
- Express 4
- `node:sqlite` for SQLite persistence
- `multer` for file uploads
- CORS support for local API access

### Verification and security
- Gemini API for factual claim evaluation
- HMAC-signed session cookies using `SESSION_SECRET` or `JWT_SECRET`
- Role/gate checks before write operations
- Workspace-level isolation for reviews, members, and sources

## Runtime behavior

The current runtime is intentionally lightweight and suitable for local development.

### Local development URLs
- Web app: `http://localhost:5173`
- API: `http://localhost:4000`

### Database and storage
The API stores data in SQLite under:
- `apps/api/data/cleared.sqlite`

Uploaded files are stored under:
- `apps/api/uploads/`
- `apps/api/uploads/reviews/`

This is adequate for a local MVP, but it should be backed by persistent storage in deployment and should not be treated as a production-scale multi-instance database solution.

## Environment variables

Copy `.env.example` to `.env` and customize it for your environment.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | Secret used to sign API sessions |
| `JWT_SECRET` | Optional fallback | Alternative session secret |
| `PORT` | No | API port; defaults to `4000` |
| `APP_BASE_URL` | Optional | Used for invitation and redirect links |
| `GEMINI_API_KEY` | Optional | Enables AI verification |
| `GEMINI_MODEL` | Optional | Overrides the default Gemini model |
| `CLEARED_DB_PATH` | Optional | Custom SQLite file path |
| `SUPABASE_URL` | Optional | Future managed architecture config |
| `SUPABASE_PUBLISHABLE_KEY` | Optional | Future managed auth config |
| `SUPABASE_SECRET_KEY` | Optional | Server-only key for future privileged operations |

Notes:
- `SESSION_SECRET` must be at least 32 characters long.
- The app will refuse to use auth routes until a valid secret is present.
- AI verification is disabled unless `GEMINI_API_KEY` is configured.

## Installation and local startup

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

```bash
copy .env.example .env
```

Then edit `.env` and set at minimum:

```env
SESSION_SECRET=your_super_long_random_key_here
```

Optional verification settings:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### 3) Start the app

```bash
npm run dev
```

This boots both the API and the web app together.

## API overview

The API is mounted under `/api` and authenticates requests before most workspace actions.

### Authentication routes

- `GET /api/health` — service health check
- `GET /api/auth/session` — returns the current authenticated user, if any
- `POST /api/auth/workspaces` — create a workspace and owner account
- `POST /api/auth/login` — sign in to a workspace
- `POST /api/auth/invitations/accept` — accept an invite and join a workspace
- `POST /api/auth/logout` — clear the signed session cookie

### Workspace routes

- `GET /api/workspace` — current workspace metadata
- `GET /api/workspace/members` — list workspace members
- `POST /api/workspace/invitations` — create an invite for a user
- `PATCH /api/workspace/members/:userId` — change a member role
- `DELETE /api/workspace/members/:userId` — remove a member

### Review routes

- `GET /api/reviews` — list reviews in the current workspace
- `POST /api/reviews` — create a review from text or uploaded file
- `PATCH /api/reviews/:id` — update status (In review, Needs changes, Approved, Rejected)

### Source routes

- `GET /api/sources` — list approved sources
- `POST /api/sources` — add a TXT, MD, or CSV approved source

### Verification route

- `POST /api/verification/check/:reviewId` — run a Gemini-based claim check for a review

## Data model

The core schema is stored in SQLite and is intentionally simple for the MVP.

### Workspaces
- `id` — workspace UUID
- `name` — workspace name
- `created_at` — creation timestamp

### Users
- `id` — user UUID
- `email` — email address, unique at the app level
- `password_hash` — derived password hash
- `password_salt` — password salt
- `created_at` — creation timestamp

### Memberships
- `workspace_id` — workspace reference
- `user_id` — user reference
- `role` — one of the workspace roles

### Invitations
- `id` — invitation UUID
- `workspace_id` — target workspace
- `email` — invited email address
- `role` — role assigned on acceptance
- `token_hash` — hashed invite token
- `created_by` — inviter user id
- `expires_at` — expiry timestamp
- `accepted_at` — acceptance timestamp

### Reviews
- `id` — review UUID
- `workspace_id` — owning workspace
- `data` — full review JSON blob

### Sources
- `id` — source UUID
- `workspace_id` — owning workspace
- `data` — full source JSON blob

## Verification flow

The Gemini flow is designed as a human-in-the-loop review assistant.

1. A creator submits a review draft.
2. Approved sources are loaded from the workspace.
3. The API sends the draft plus relevant source text to Gemini.
4. Gemini must return structured JSON with claim-level results.
5. The server evaluates the result, stores findings on the review, and updates status if needed.
6. The review remains subject to a human approval or rejection decision.

This means AI can suggest findings, but it never acts as the final publishing authority.

## Testing

The project includes a focused workspace-access test suite.

```bash
npm test --workspace @cleared/api
```

The test file verifies:
- workspace creation
- invitation acceptance
- member-role scope isolation
- access restrictions between workspaces
- rejected re-use of already-used invitations

## Current limitations and known gaps

This MVP is intentionally compact, but several things are still not implemented or are only partially implemented:

- PDF/DOCX extraction is not implemented
- source uploads are limited to TXT, MD, and CSV
- invitation emails are not actually sent
- sessions live in API memory and are reset on restart
- no strong audit-event timeline yet
- no production deployment configuration for scaling
- no malware scanning integration yet
- no production-ready SSO, MFA, or SOC controls yet
- no migration from SQLite to a managed PostgreSQL architecture is active in this runtime

## Future roadmap

The near-term roadmap is:

1. Formalize the domain model and API contracts
2. Move identity and tenant access to Supabase/Auth managed services
3. Add full document extraction for PDF and DOCX
4. Expand audit trail and governance reporting
5. Add richer review corrections, comments, and revision history
6. Move from SQLite to persistent managed database storage for production
7. Add scanning, export, and compliance controls

## Security considerations

A few important guardrails are already in place:
- sessions are signed with HMAC and a secret value
- workspace membership is enforced before most protected routes
- owners cannot be removed from a workspace by a lower-role user
- role restrictions prevent creators from approving reviews they do not own
- AI results are treated as advisory only and do not bypass human approval

Nevertheless, the current app should still be considered a development MVP. Production rollout should include stronger deployment controls, persistent storage, secret management, and more formal security review.

## License

This repository does not currently declare a project license in the root files. If you plan to distribute or commercialize the application, add an explicit license file such as MIT or Apache-2.0 before release.

## Summary

Cleared is a practical MVP for AI-assisted brand and factual governance. It already demonstrates:
- workspace-based tenant isolation
- trusted-source management
- draft review flows
- AI-powered claim checking
- human approval gating

It is a strong foundation for a more formal enterprise governance platform, but the project still needs additional polish and production hardening before it should be treated as a fully production-ready SaaS product.
