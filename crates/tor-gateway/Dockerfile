FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

EXPOSE 3080

CMD ["node", "dist/server.js"]
