FROM node:18

# instala yt-dlp
RUN apt update && apt install -y yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]