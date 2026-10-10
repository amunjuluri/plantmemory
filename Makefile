.PHONY: install run test lint fmt check

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
