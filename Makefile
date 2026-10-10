.PHONY: install run test lint fmt check seed eval

PORT ?= 8080

install:  ## Install Python deps (incl. dev tools) into .venv
	uv sync

run:  ## Run the API + UI locally with reload
	uv run uvicorn app.main:app --reload --port $(PORT)

test:  ## Run tests
	uv run pytest

lint:  ## Lint and check formatting
	uv run ruff check .
	uv run ruff format --check .

fmt:  ## Auto-fix lint and format
	uv run ruff check --fix .
	uv run ruff format .

check: lint test  ## Everything CI would run

seed:  ## Embed and load the synthetic seed data (resets the store)
	uv run python -m scripts.seed --reset

eval:  ## Retrieval hit rates: semantic vs keyword baseline
	uv run python -m scripts.eval_retrieval
