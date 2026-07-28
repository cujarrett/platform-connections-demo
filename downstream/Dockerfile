FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o downstream .

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /app/downstream /downstream
EXPOSE 8080 9090
ENTRYPOINT ["/downstream"]
