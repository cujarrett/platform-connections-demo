# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# The Spa Crossplane composition mounts its own nginx config over
# /etc/nginx/conf.d/default.conf, so only the static files matter here.
FROM nginx:1.27-alpine
COPY --from=build /app/dist/spa/browser /usr/share/nginx/html
EXPOSE 80
