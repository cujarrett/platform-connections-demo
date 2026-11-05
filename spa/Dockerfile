# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# The Spa Crossplane composition mounts its own nginx config over
# /etc/nginx/conf.d/default.conf, so only the static files matter here.
FROM nginx:1.31-alpine@sha256:785835ea65db4bba6f021acc0f3be91b0fef76a53fe41f8588c6698d2aed0606
# The base still ships brotli-libs 1.2.0, open to CVE-2026-111497.
# Drop this line once nginx:1.31-alpine carries 1.2.1.
RUN apk add --no-cache 'brotli-libs>=1.2.1-r0'
COPY --from=build /app/dist/spa/browser /usr/share/nginx/html
EXPOSE 80
