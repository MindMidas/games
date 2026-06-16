FROM node:22-bookworm-slim AS frontend

WORKDIR /app/src/platform/frontend
COPY src/platform/frontend/package.json src/platform/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/platform/frontend/ ./
RUN npm run build

FROM python:3.13-slim-bookworm AS engines

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential clang make swig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src/pool/engine/ src/pool/engine/
COPY src/chezz/engine/ src/chezz/engine/
RUN make -C src/pool/engine clean all \
    && make -C src/chezz/engine clean all

FROM python:3.13-slim-bookworm AS runtime

ENV LD_LIBRARY_PATH=/app/src/pool/engine \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN addgroup --system appuser && adduser --system --ingroup appuser appuser
COPY --chown=appuser:appuser src/ src/
COPY --from=frontend --chown=appuser:appuser /app/src/platform/frontend/static/ src/platform/frontend/static/
COPY --from=engines --chown=appuser:appuser /app/src/pool/engine/libphylib.so /app/src/pool/engine/_phylib.so /app/src/pool/engine/phylib.py src/pool/engine/
COPY --from=engines --chown=appuser:appuser /app/src/chezz/engine/libuser_actions.so src/chezz/engine/

USER appuser
EXPOSE 8080

CMD ["python3", "src/platform/serve.py", "--host", "0.0.0.0", "--port", "8080"]
