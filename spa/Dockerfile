# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# The Spa Crossplane composition mounts its own nginx config over
# /etc/nginx/conf.d/default.conf, so only the static files matter here.
# The platform base image already carries Alpine's security fixes.
FROM ghcr.io/cujarrett/base-spa:nginx1.31-alpine@sha256:a5e096d54c04b6543c25e45b26334e3a2f8533b571bf50e0dd02b66fb7c4e84a
COPY --from=build /app/dist/spa/browser /usr/share/nginx/html
EXPOSE 80
