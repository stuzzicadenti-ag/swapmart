FROM node:22-alpine
RUN apk add --no-cache vips-dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY src/ src/
ENV NODE_ENV=production PORT=4003
EXPOSE 4003
CMD ["node", "src/server.js"]
