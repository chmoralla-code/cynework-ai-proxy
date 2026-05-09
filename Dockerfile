FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm ci --only=production

# Bundle app source
COPY . .

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Start command
CMD [ "node", "src/server.js" ]
