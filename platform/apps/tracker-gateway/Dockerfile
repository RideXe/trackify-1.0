FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
RUN npx esbuild apps/tracker-gateway/src/main.ts --bundle --platform=node --target=node24 --format=esm --outfile=dist/main.mjs

FROM node:24-alpine
RUN addgroup -S trackify && adduser -S -G trackify trackify
WORKDIR /app
COPY --from=build /app/dist/main.mjs ./main.mjs
USER trackify
EXPOSE 5023 5027
CMD ["node", "main.mjs"]
