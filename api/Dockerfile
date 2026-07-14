FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o api .

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /app/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
