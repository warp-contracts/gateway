FROM node:16.17.0-alpine3.16

RUN mkdir /app
WORKDIR /app
RUN apk add git

# Installing required npm packages
COPY package.json package.json
COPY yarn.lock yarn.lock
RUN yarn

# Copying all files
COPY . .

# Building app
RUN yarn build

EXPOSE 5666

# Running the gateway
CMD yarn start:prod --env_path .secrets/.env
