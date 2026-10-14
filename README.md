# Drivebox

Drivebox is a self-hosted MERN file storage application. It provides a React interface for organizing files in nested folders, sharing content with other users, managing file versions, and restoring deleted items.

MongoDB stores metadata and session records. File contents are stored as opaque blobs on disk outside the web root.

## Features

- Account registration and sign-in with secure, HTTP-only session cookies
- Nested folders, file uploads and downloads, search, and paginated listings
- Viewer/editor sharing with inherited folder permissions
- Rename, move, version history, version restoration, trash, and item restoration
- Per-user storage quotas and optimistic concurrency checks
- OpenAPI specification and local Docker or Windows startup options

## Project structure

```text
client/       React application
server/       Express API, MongoDB models, and file storage
scripts/      Setup, development, desktop, and demo utilities
tests/        Unit and integration tests
docs/         API, architecture, verification, and demo documentation
```

## Contents

- [Windows quick start](#simplest-windows-setup-no-docker)
- [Docker setup](#start-with-docker)
- [Local development](#run-locally)
- [Configuration](#configuration)
- [Roles and behavior](#roles-and-behavior)
- [API](#api-and-examples)
- [Tests and demonstration](#tests-and-demonstration)
- [Architecture and scope](#architecture-and-scope)

## Simplest Windows setup: no Docker

Install [Node.js LTS](https://nodejs.org/en/download), extract this project, and double-click **Start-Drivebox.cmd**. On its first run, the launcher installs packages and downloads a real local MongoDB server. It opens the app at **http://localhost:4000** and keeps your data in `.local-data` across restarts. Keep the terminal window open; press Ctrl+C to stop.

No manual MongoDB installation or `.env` editing is needed for this mode. It uses a dedicated local database and leaves any existing `.env` unchanged. Read [START-HERE-WINDOWS.md](START-HERE-WINDOWS.md) for complete instructions, data locations, and troubleshooting. This is a browser-based local application; it is not a packaged Windows executable.

## Start with Docker

Requirements: Node.js 22.12 or newer to generate configuration, and Docker Engine/Desktop with the Compose v2 plugin. Commands below run from this directory.

```bash
npm run setup
docker compose up --build -d
docker compose logs -f app
```

Open **http://localhost:4000** and create an account. API health is at http://localhost:4000/api/health. The machine running Docker needs internet access to download container images and npm dependencies on the first build.

The setup script generates a random session secret in `.env`. MongoDB runs as a single-node replica set so metadata transactions work. Compose waits for its primary election before starting the app. The database is available only within the Compose network; the web port binds to your machine's loopback address.

```bash
docker compose down        # stop; keep database and uploaded files
docker compose up -d       # start again
```

Do not run `docker compose down --volumes` unless you intend to delete all application data. Database and file volumes must be backed up together.

To use a different local port, set both `APP_PORT=4001` and `PUBLIC_ORIGIN=http://localhost:4001` in `.env` before starting Compose. For a public deployment, put the app behind an HTTPS reverse proxy, set `PUBLIC_ORIGIN` to the exact browser origin, and adapt the web port binding for that proxy. The Compose MongoDB configuration is intended for local use; a hosted environment needs authentication, private networking, backups, and a resilient replica set.

## Run locally

Requirements: Node.js 22.12+, npm, and MongoDB 7+ configured as a replica set. An ordinary standalone MongoDB instance cannot execute this application's transactions.

```bash
npm run setup
npm install
npm run dev
```

Open **http://localhost:5173**. Vite forwards `/api` requests to Express on port 4000. The server reads the root `.env`; it never sends the database URI or session secret to the client.

The root workspace lockfile and client lockfile are included. Run `npm ci` from the root to install the exact locked workspace dependencies. See the [verification notes](docs/VERIFICATION.md) for actual build and test results and the checks still needed for Docker and browser-based demonstration.

For a local MongoDB installation, run these in separate terminals. Create `./mongo-data` first. Keep MongoDB listening only on loopback for this setup.

```bash
mongod --dbpath ./mongo-data --replSet rs0 --bind_ip 127.0.0.1
```

```bash
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh --eval 'db.hello().isWritablePrimary'
```

Wait for the second command to print `true`, then start the app. `rs.initiate()` is needed only for a new data directory. Alternatively, use a MongoDB Atlas replica set and put its connection string in `.env`.

To serve the built React app from Express locally:

```bash
npm run build
```

Set `NODE_ENV=production` and `CLIENT_ORIGIN=http://localhost:4000` in `.env`, then run `npm start`. For development, restore `NODE_ENV=development` and `CLIENT_ORIGIN=http://localhost:5173`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Production serves the built React app. |
| `PORT` | `4000` | Express port. |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Exact allowed browser origin, without a trailing slash. HTTPS enables the Secure cookie flag. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/drivebox?replicaSet=rs0` | A replica set connection string. |
| `SESSION_SECRET` | Generated by setup | At least 32 characters; keep private. Changing it invalidates existing sessions. |
| `SESSION_DAYS` | `7` | Session duration in days. |
| `STORAGE_DIR` | `./storage` | Opaque blob directory, resolved relative to the server process's working directory. Workspace starts resolve this under `server/`; Docker uses `/data/uploads`. |
| `DEFAULT_QUOTA_BYTES` | `104857600` | Quota assigned when a new account is registered: 100 MiB. |
| `MAX_UPLOAD_BYTES` | `26214400` | Maximum bytes per file upload: 25 MiB. |
| `PUBLIC_ORIGIN` | `http://localhost:4000` | Compose-only setting mapped to the server's `CLIENT_ORIGIN`. |
| `APP_PORT` | `4000` | Compose-only host web port. |
| `TEST_MONGODB_URI` | unset | Optional existing replica set used by integration tests. Tests create and clean their own uniquely named database. |

Changing `DEFAULT_QUOTA_BYTES` affects newly registered accounts. Existing users retain the quota stored in their user record. Trash and retained versions continue using storage; restoring a version reuses its existing blob and does not charge that blob twice. An editor upload counts against the tree owner's quota.

## Roles and behavior

| Operation | Owner | Editor | Viewer |
| --- | :---: | :---: | :---: |
| List, read, download, inspect version history | Yes | Yes | Yes |
| Rename, upload a new version, restore an earlier version | Yes | Yes | No |
| Create files or folders inside an accessible folder | Yes | Yes | No |
| Move items, send to trash, restore from trash | Yes | No | No |
| View, change, or revoke direct shares | Yes | No | No |

Folder sharing applies recursively. The strongest direct or inherited grant wins. Sharing a child does not reveal its unshared ancestors. Revoking one direct share does not remove a separate grant inherited from an ancestor. Trashing a folder hides its subtree from shared users, including directly shared descendants; restoring it restores the existing ownership and grants. Names are unique among active siblings, case-insensitively. Conflicts during restore are reported rather than silently overwriting data.

Search matches a filename within the current folder. Root **Shared with me** lists directly shared entries; opening a shared folder lists permitted children. Listing and version history use page-based pagination with a maximum page size of 100. Moves across owners and moves that create cycles are rejected.

## API and examples

The full OpenAPI 3.0 specification is [docs/openapi.json](docs/openapi.json), also served at **GET `/api/openapi.json`**. Import the JSON into Swagger Editor or another OpenAPI client. Routes below are relative to `/api`.

| Area | Routes |
| --- | --- |
| Accounts | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Browsing | `GET /items`, `GET /items/:id` |
| Folders | `POST /folders` |
| Files | `POST /files`, `GET /files/:id/download` |
| Management | `PATCH /items/:id`, `DELETE /items/:id`, `POST /items/:id/restore` |
| Versions | `GET /files/:id/versions`, `POST /files/:id/versions`, `POST /files/:id/versions/:versionId/restore` |
| Sharing | `GET /items/:id/shares`, `PUT /items/:id/shares`, `DELETE /items/:id/shares/:userId` |

These Bash examples target Docker. Use `Origin: http://localhost:5173` when running Vite locally. The server checks Origin on unsafe browser requests; curl examples include it explicitly. The example passwords below are demonstration values only.

```bash
curl -i -c owner.cookies -H 'Origin: http://localhost:4000' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@example.test","password":"DemoPassword-2026!"}' \
  http://localhost:4000/api/auth/register

curl -b owner.cookies -H 'Origin: http://localhost:4000' \
  -H 'Content-Type: application/json' -d '{"name":"Project"}' \
  http://localhost:4000/api/folders

# Replace FOLDER_ID and FILE_ID with IDs from the JSON responses.
curl -b owner.cookies -H 'Origin: http://localhost:4000' \
  -F 'file=@./README.md' -F 'parentId=FOLDER_ID' \
  http://localhost:4000/api/files

curl -b owner.cookies \
  'http://localhost:4000/api/items?parentId=FOLDER_ID&page=1&limit=20&q=readme'

curl -b owner.cookies -H 'Origin: http://localhost:4000' \
  -X PATCH -H 'Content-Type: application/json' \
  -d '{"name":"Project-notes.md","revision":1}' \
  http://localhost:4000/api/items/FILE_ID

curl -b owner.cookies -H 'Origin: http://localhost:4000' \
  -F 'file=@./README.md' -F 'revision=2' \
  http://localhost:4000/api/files/FILE_ID/versions

curl -b owner.cookies http://localhost:4000/api/files/FILE_ID/versions
curl -b owner.cookies -o downloaded.md \
  http://localhost:4000/api/files/FILE_ID/download
```

Register a second account with `ben@example.test` in a different browser profile, or with a separate cookie jar, before sharing:

```bash
curl -b owner.cookies -H 'Origin: http://localhost:4000' \
  -X PUT -H 'Content-Type: application/json' \
  -d '{"email":"ben@example.test","role":"viewer"}' \
  http://localhost:4000/api/items/FOLDER_ID/shares

curl -b owner.cookies -H 'Origin: http://localhost:4000' \
  -X DELETE http://localhost:4000/api/items/FILE_ID

curl -b owner.cookies 'http://localhost:4000/api/items?view=trash'

curl -b owner.cookies -H 'Origin: http://localhost:4000' \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  http://localhost:4000/api/items/FILE_ID/restore
```

Mutations that accept `revision` return `409 REVISION_CONFLICT` if the supplied revision is stale. To move an item to root, send `{"parentId":null,"revision":CURRENT_REVISION}` to `PATCH /items/:id`. Restoring a previous version creates a new version entry; use the current revision of the file.

All API errors use `{"error":{"code":"...","message":"..."}}`. Typical statuses: `400` invalid input, `401` no valid session, `403` insufficient permission on a visible item, `404` inaccessible/missing item, `409` conflict, `413` upload size limit, `503` unavailable stored bytes, and `507` quota exceeded. Inaccessible IDs return 404 to avoid revealing whether private items exist. Downloads return attachment bytes only after authorization, including when a historical `versionId` is requested. Owners may read retained trash; shared users cannot.

## Tests and demonstration

```bash
npm run test:unit
npm test
npm run build
```

Unit tests use the Node test runner. Integration tests start a temporary MongoDB replica set with `mongodb-memory-server` by default; its first run downloads a MongoDB binary and requires internet access. Set `TEST_MONGODB_URI` to a reachable test replica set to avoid that download. Tests cover permissions, traversal and invalid operations, nested sharing, immutable versions, trash/restore, quota boundaries, and relevant failure paths. Read the tests and the verification report for the exact executed coverage.

For a browser recording, start the application and follow [docs/DEMO.md](docs/DEMO.md). The included browser script can produce a local demonstration after Playwright's Chromium is installed. A generated video is not claimed until that script has actually run successfully.

## Architecture and scope

See [docs/architecture.md](docs/architecture.md) for models, indexes, authorization, transaction boundaries, quota accounting, and disk failure handling.

Included stretch behavior: filename search and optimistic revision checks. Not implemented: public share links, expiring links/download limits, resumable uploads, content-hash deduplication, previews, malware scanning, audit-event persistence, production monitoring, and load testing. Permanent purge is intentionally absent: trash and old versions retain bytes and quota. Local disk storage targets one application instance; use shared object storage and appropriate coordination before scaling horizontally.
