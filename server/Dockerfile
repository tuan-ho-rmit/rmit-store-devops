FROM node:18-alpine
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy rest of the source
COPY . .

# Runtime configuration comes from the environment
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Run as non-root user provided by the base image
USER node

# Start the HTTP server directly (no dev dependency on cross-env)
CMD ["node","index.js"]
