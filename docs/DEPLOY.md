# Deploying to Google Cloud

PlantMemory runs as one Cloud Run service (API + UI) backed by Firestore vector search
and Gemini on Vertex AI. One command sets it up and can be re-run safely:

```bash
make deploy PROJECT_ID=your-project-id SEED=1   # SEED=1 loads the seed repair records
```

It prints the account, project and everything it will create, then asks before doing
anything. Default region: `asia-south1` (Mumbai). Override with `REGION=...`.

## What it creates

| Resource | Purpose |
|---|---|
| Firestore database `(default)`, Native mode, Standard edition | Incident records and their 768-dimension embeddings |
| 3 Firestore indexes on `incidents` | Vector search; vector search filtered by industry; listing by date within an industry |
| Service account `plantmemory-run` | What the Cloud Run service runs as. Roles: `datastore.user`, `aiplatform.user`. Nothing else |
| Service account `plantmemory-build` | What Cloud Build runs as. Role: `run.builder` |
| Artifact Registry repo `cloud-run-source-deploy` | Holds the built image |
| Cloud Run service `plantmemory` | Public URL, scales to zero, at most 3 instances |

No keys or secrets exist anywhere. The service authenticates as its service account,
and the image contains no credentials (see `.dockerignore`).

## Deploying from GitHub

After the first deploy, merges to `main` deploy themselves: `.github/workflows/ci.yml`
runs lint and tests on every pull request, and on `main` it then runs
`scripts/deploy.sh --deploy-only`. Each deploy shows under **Deployments** on GitHub
(environment `production`) with the service URL. Seeding stays a manual step, because it
replaces the data in Firestore.

Set it up once:

```bash
scripts/setup_github_deploy.sh --project your-project-id
```

No keys are created. GitHub signs in through Workload Identity Federation, and only
workflows on this repo's `main` branch can use the `plantmemory-deploy` service account.
That account can deploy new revisions but can't change IAM or who may call the service.

## Vector index setup (done by the script)

Firestore needs a vector index before `find_nearest` works. The script runs the
equivalent of:

```bash
gcloud firestore indexes composite create --collection-group=incidents \
  --query-scope=COLLECTION \
  --field-config='vector-config={"dimension":"768","flat":"{}"},field-path=embedding'

# Same, with industry first, for searches limited to one industry
gcloud firestore indexes composite create --collection-group=incidents \
  --query-scope=COLLECTION \
  --field-config=order=ASCENDING,field-path=industry \
  --field-config='vector-config={"dimension":"768","flat":"{}"},field-path=embedding'
```

Indexes take a few minutes to build. Check with
`gcloud firestore indexes composite list`. Until they are `READY`, searches fail.

The dimension must match `EMBEDDING_DIM`. Firestore allows up to 2048. If you change the
embedding model or dimension, create new indexes and re-seed.

## Expected cost

For a demo this sits within Google Cloud's free tiers, apart from Gemini calls:

- **Cloud Run** scales to zero, so it costs nothing when idle.
- **Firestore** uses the free daily quota on the `(default)` database.
- **Cloud Build** is a few build-minutes per deploy.
- **Artifact Registry** costs cents per month for stored images.
- **Gemini** is paid per call: a repair guide with its translation is about $0.008
  (gemini-3.1-flash-lite), and a spoken report about $0.01 (gemini-3.8-live).

Each visitor (IP address) gets at most 300 AI actions per hour (`AI_REQUESTS_PER_HOUR`):
a draft, a voice conversation, an approval and so on each count once. That is room for
a team sharing one office network, and at about a cent an action it caps the cost at
about $3 an hour per address. At most 3 instances run at once.

## Run the production image locally

```bash
make docker-run    # http://localhost:8474, uses your local credentials, read-only
```
