FROM node:20-alpine
WORKDIR /app

# Install all deps (including dev) for build
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Remove dev deps after build
RUN npm prune --production

EXPOSE 3001
CMD ["node", "dist/index.js"]
