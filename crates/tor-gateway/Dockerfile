FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

# The node:20-alpine image includes a 'node' user (UID 1000)
# Change ownership of app directory to node user
RUN chown -R node:node /app

# Switch to non-root user
USER node

EXPOSE 3080

CMD ["node", "dist/server.js"]
