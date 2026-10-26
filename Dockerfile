# For any host that runs containers. No build step: the app uses only Node.js itself.
FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3860 DATA_DIR=/data FORCE_HTTPS=1 TRUST_PROXY=1
WORKDIR /app
COPY server.js package.json ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3860
VOLUME ["/data"]
# SETUP_KEY must be supplied by the host (16+ random characters).
CMD ["node", "server.js"]
