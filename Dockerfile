FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false sh -c 'if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci --no-audit --no-fund'
COPY . .
RUN npm run build && mkdir -p /data && chown -R node:node /app /data
USER node
ENV PORT=4174 DATA_DIR=/data
EXPOSE 4174
CMD ["node", "server/index.mjs"]
