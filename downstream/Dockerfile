FROM golang:1.27-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o downstream .

FROM ghcr.io/cujarrett/base-go:static-debian13@sha256:805eafa57ee884e338dfa8cfa7c7457df4ffe0b7a391e3a8f878bfb3db74d171
COPY --from=builder /app/downstream /downstream
EXPOSE 8080 9090
ENTRYPOINT ["/downstream"]
