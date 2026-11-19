FROM golang:1.27-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o api .

FROM ghcr.io/cujarrett/base-distroless:static-debian13@sha256:a359c6ce58f19d70594119fa4d2233f0d27d93bce787328a4936fd1f995cc779
COPY --from=builder /app/api /api
EXPOSE 8080 9090
ENTRYPOINT ["/api"]
