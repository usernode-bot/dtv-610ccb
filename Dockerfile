# Stage 1: build. Compiles this app's Tailwind stylesheet and the TypeScript
# server (npm run build). Runs on every image build, so public/tailwind.css and
# dist/ always come from the source in THIS commit; neither is committed.
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json tailwind.config.js ./
COPY styles ./styles
COPY public ./public
COPY app ./app
COPY lib ./lib
COPY types ./types
COPY components ./components
COPY hooks ./hooks
RUN npm run build

# Stage 2: the app itself. Production dependencies, the static files, and the
# compiled output only.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=1000:1000 public ./public
COPY --chown=1000:1000 --from=build /build/dist ./dist
COPY --chown=1000:1000 --from=build /build/public/tailwind.css ./public/tailwind.css
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
# Kubernetes enforces runAsNonRoot without supplying a UID. Keep this numeric:
# unlike a symbolic USER, it lets the kubelet verify the image before startup.
USER 1000:1000
CMD ["node", "dist/app/server.js"]
