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

USER node
EXPOSE 3000
# Apply any pending migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node src/server.js"]
