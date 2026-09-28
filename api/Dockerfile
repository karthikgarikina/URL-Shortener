FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=5s --start-period=5s --retries=10 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
