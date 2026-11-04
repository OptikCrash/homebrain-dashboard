# Build stage: install exactly what package-lock.json pins and build the production bundle.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY angular.json tsconfig*.json ./
COPY src ./src
RUN npm run build -- --configuration production

# Serving stage: nginx only, no Node or Angular toolchain. Runs unprivileged.
FROM nginx:1.28-alpine
RUN rm -rf /docker-entrypoint.d /etc/nginx/conf.d /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /usr/local/bin/dashboard-web-start.sh
COPY wait-ready.sh /usr/local/bin/wait-ready.sh
# @angular/build:application writes browser files to dist/<project>/browser.
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["sh", "/usr/local/bin/dashboard-web-start.sh"]
