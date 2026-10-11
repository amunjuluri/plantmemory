.PHONY: install run dev test lint fmt check seed seed-kb figures sample-manual eval web web-check api-types deploy docker-run

PORT ?= 8473
# HOST=0.0.0.0 to open it from a phone on the same Wi-Fi.
HOST ?= 127.0.0.1
WEB_PORT ?= 3473

install:  ## Install Python and UI dependencies
	uv sync
	cd web && pnpm install --frozen-lockfile

run: web/out/index.html  ## Run the API + built UI on :8473 (builds the UI first if needed)
	uv run uvicorn app.main:app --reload --host $(HOST) --port $(PORT)

test:  ## Run tests
	uv run pytest

lint:  ## Lint and check formatting
	uv run ruff check .
	uv run ruff format --check .

fmt:  ## Auto-fix lint and format
	uv run ruff check --fix .
	uv run ruff format .

check: lint test web-check  ## Everything CI would run

seed:  ## Embed and load the synthetic seed data (resets the store)
	uv run python -m scripts.seed --reset

seed-kb:  ## Load the synthetic manuals, alarm codes, parts and figures (resets them, keeps guides)
	uv run python -m scripts.seed_kb --reset

figures:  ## Draw any missing manual figures and part photos with Gemini
	uv run python -m scripts.make_figures

sample-manual:  ## Rewrite data/samples/manual_fbd120.pdf (the upload demo)
	uv run python -m scripts.make_sample_manual

eval:  ## Retrieval hit rates: semantic vs keyword baseline
	uv run python -m scripts.eval_retrieval

web/out/index.html:
	cd web && pnpm build

web:  ## Build the UI to web/out (served by FastAPI)
	cd web && pnpm build

dev:  ## UI with hot reload on :3473 + API on :8473 (needs CORS_ORIGINS in .env)
	trap 'kill 0' INT TERM EXIT; uv run uvicorn app.main:app --reload --port $(PORT) & (cd web && pnpm dev --port $(WEB_PORT))

web-check:  ## Typecheck and lint the UI
	cd web && pnpm typecheck && pnpm lint

api-types:  ## Regenerate the UI's TypeScript types from the API schema
	cd web && pnpm gen:api

# gcloud configuration and project used for deploys (override on the command line).
GCLOUD_CONFIG ?= plantmemory
PROJECT_ID ?=

deploy:  ## Deploy to Cloud Run (asks before creating anything). Add SEED=1 to load seed data
	CLOUDSDK_ACTIVE_CONFIG_NAME=$(GCLOUD_CONFIG) scripts/deploy.sh $(if $(PROJECT_ID),--project $(PROJECT_ID)) $(if $(SEED),--seed)

docker-run:  ## Build and run the production image locally on :8474 (uses your ADC)
	docker build -t plantmemory:local .
	docker run --rm -p 127.0.0.1:8474:8080 \
	  -v "$$HOME/.config/gcloud/application_default_credentials.json:/secrets/adc.json:ro" \
	  -v "$$PWD/data/store:/app/data/store:ro" \
	  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/adc.json --env-file .env plantmemory:local
