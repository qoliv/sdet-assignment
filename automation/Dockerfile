FROM node:18-alpine

# Install netcat for healthchecks
RUN apk add --no-cache netcat-openbsd

# Set working directory
WORKDIR /app

# Copy application files from the application folder
COPY application/app.js .
COPY application/app.ts .
COPY application/agent/ agent/
COPY application/splitter/ splitter/
COPY application/target/ target/

# Create directory for output files
RUN mkdir -p /app/output

EXPOSE 9997

# Default command (will be overridden in docker-compose)
CMD ["node", "app.js"]
