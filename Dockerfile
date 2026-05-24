# ==============================================================================
# Production Dockerfile for Absensi-Module (ZieeBot)
# Built on official Microsoft Playwright base image with Node.js 20 pre-installed
# ==============================================================================

FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Create and define application workdir
WORKDIR /usr/src/app

# Copy package configurations
COPY package*.json ./

# Install production npm packages only
# Note: npm ci is faster and timing-safe in CI/CD environments
RUN npm ci --only=production

# Copy application source files (excluding patterns in .dockerignore)
COPY . .

# Expose proxy server port
EXPOSE 3001

# Run application using NodeJS runtime
CMD ["node", "index.js"]
