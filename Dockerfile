FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Run migrations then start the server.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
