FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json

RUN npm ci

COPY apps/api ./apps/api

RUN npm run build --workspace @openrd/api

WORKDIR /app/apps/api
ENV NODE_ENV=production

EXPOSE 4000

CMD ["node", "--enable-source-maps", "dist/index.js"]
