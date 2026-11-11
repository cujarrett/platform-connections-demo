FROM golang:1.27-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o downstream .

FROM ghcr.io/cujarrett/base-go:static-debian13@sha256:d1f5d2a974de81dffc620668df57baf021f1dab8d8b90968428dd00d20a3a090
COPY --from=builder /app/downstream /downstream
EXPOSE 8080 9090
ENTRYPOINT ["/downstream"]
