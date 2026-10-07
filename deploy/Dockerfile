FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js privacy.html ./
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.js"]
