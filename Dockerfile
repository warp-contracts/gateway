FROM node:18

RUN mkdir /app
WORKDIR /app

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
CMD [ "node", "dist/gateway/init.js", "--noSync" ]
