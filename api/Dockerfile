FROM node:22-alpine

# Prisma's query engine needs OpenSSL, which the alpine base image doesn't ship.
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

# Install exactly what package-lock.json pins. The schema has to be in place
# before `npm ci`: its postinstall runs `prisma generate`.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY wait-ready.sh ./wait-ready.sh

USER node
EXPOSE 8090
# Apply any pending migrations, then start the API.
CMD ["node", "src/start.js"]
