# syntax=docker/dockerfile:1
# PlantMemory: one container serving the API and the built UI. No secrets inside:
# on Cloud Run it authenticates as its service account (Application Default Credentials).

# --- 1. Build the UI to static files ---
FROM node:24-slim AS web
WORKDIR /web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# Same-origin in production: the UI calls /api on the host that served it.
ENV NEXT_PUBLIC_API_BASE="" NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# --- 2. Python dependencies (uv stays in this stage) ---
FROM python:3.13-slim AS deps
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# --- 3. Runtime: read-only code owned by root, run as an unprivileged user ---
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" PORT=8080
WORKDIR /app
RUN useradd --system --uid 10001 --no-create-home plantmemory
COPY --from=deps /app/.venv/ .venv/
COPY app/ app/
COPY scripts/ scripts/
COPY data/seed/ data/seed/
COPY data/glossary/ data/glossary/
COPY data/samples/ data/samples/
COPY --from=web /web/out/ web/out/
USER plantmemory

# Cloud Run sets PORT (8080 by default).
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
