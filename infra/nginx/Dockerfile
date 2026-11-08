FROM node:24-alpine AS build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
ARG TELEGRAM_BOT_USERNAME
ENV VITE_TELEGRAM_BOT_USERNAME=$TELEGRAM_BOT_USERNAME
RUN npm run build
FROM nginx:stable-alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY infra/nginx/app.conf.template /etc/nginx/templates/default.conf.template
