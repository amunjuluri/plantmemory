.PHONY: install run dev test lint fmt check seed eval web web-check api-types

PORT ?= 8473
WEB_PORT ?= 3473

install:  ## Install Python and UI dependencies
	uv sync
	cd web && pnpm install --frozen-lockfile

run: web/out/index.html  ## Run the API + built UI on :8473 (builds the UI first if needed)
	uv run uvicorn app.main:app --reload --port $(PORT)

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
