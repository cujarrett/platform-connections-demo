# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# The Spa Crossplane composition mounts its own nginx config over
# /etc/nginx/conf.d/default.conf, so only the static files matter here.
FROM nginx:1.31-alpine@sha256:a3554c0d0b48177b1413c26e01f695334428020d9df01243fbae3e11cfd17417
# The base still ships brotli-libs 1.2.0, open to CVE-2026-111497.
# Drop this line once nginx:1.31-alpine carries 1.2.1.
RUN apk add --no-cache 'brotli-libs>=1.2.1-r0'
COPY --from=build /app/dist/spa/browser /usr/share/nginx/html
EXPOSE 80
