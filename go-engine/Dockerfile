# Build stage
FROM golang:1.21-alpine AS builder

# Set up environment for CGO (required for sqlite3)
RUN apk add --no-cache gcc musl-dev

WORKDIR /app

# Check dependencies
COPY go.mod ./
# COPY go.sum ./ # Uncomment when go.sum is generated
RUN go mod tidy && go mod download

# Copy source code
COPY . .

# Build the engine
RUN CGO_ENABLED=1 GOOS=linux go build -a -o quant-engine main.go

# Final stage
FROM alpine:latest
RUN apk add --no-cache tzdata ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/quant-engine .

# Ensure data mapping directory exists
RUN mkdir -p /app/data

EXPOSE 8080

CMD ["./quant-engine"]
