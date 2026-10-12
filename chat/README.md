# Noreatrix Chat

A simple temporary chat, styled like the Noreatrix website, for people you know: text messages and file sharing (up to 20 MB).

- Nothing is saved to disk. Messages and files live in server memory.
- When the last person leaves a room, the room and everything in it is deleted.
- Only people who have the room link can join, so share it only with your members.

## Run
```bash
cd chat
npm install
npm start          # open http://localhost:3000
```

Pick a name, keep or type a room code, press **Join**, then **Copy invite link** and send it to your friends.

## Put it online (free)
Deploy the `chat` folder to Render, Railway or Fly.io as a Node web service:
- Build command: `npm install`
- Start command: `npm start`
