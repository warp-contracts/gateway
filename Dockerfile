FROM node:18

RUN mkdir /app
WORKDIR /app

# Installing required npm packages
COPY package.json package.json
COPY yarn.lock yarn.lock
RUN yarn && yarn global add pm2

# Copying all files
COPY . .

# Building app
RUN yarn build

EXPOSE 5666

# Running the gateway
CMD [ "pm2-runtime", "start", "dist/gateway/init.js", "--name", "gateway", "-i", "max", "--", "--noSync" ]
