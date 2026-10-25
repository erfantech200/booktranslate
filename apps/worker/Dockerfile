# Bookbridge worker. Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t bookbridge-worker .
# Base image tag MUST match the `playwright` version in packages/core/package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# poppler-utils: pdfinfo/pdftotext/pdftoppm. libheif-examples: heif-convert (HEIC fallback;
# the code also has a pure-JS decoder). Noto fonts: system fallback for any glyph the vendored
# fonts lack (the renderers embed the vendored fonts from packages/core/assets/fonts).
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils libheif-examples libheif1 fonts-noto-core fonts-noto-ui-core ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @bookbridge/worker... --prod=false

COPY packages/core packages/core
COPY apps/worker apps/worker

RUN useradd --create-home --uid 10001 worker && chown -R worker /app
USER worker
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@bookbridge/worker", "start"]
