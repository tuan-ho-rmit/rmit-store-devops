FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
ENV NODE_ENV=production
RUN npm ci

COPY . .
ENV PORT=3000
EXPOSE 3000

CMD ["npm","start"]
