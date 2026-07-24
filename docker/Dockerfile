FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM base AS runtime

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=4321

RUN groupadd --system --gid 10001 mirawind \
    && useradd --system --uid 10001 --gid mirawind --home-dir /nonexistent mirawind \
    && install -d -o mirawind -g mirawind -m 0700 /var/lib/mirawind

COPY --from=build --chown=root:root /app/dist ./dist
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --chown=root:root docker/healthcheck.mjs ./healthcheck.mjs

RUN chmod -R a-w /app

USER mirawind
EXPOSE 4321

CMD ["node", "dist/server/entry.mjs"]
