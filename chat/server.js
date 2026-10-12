import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PORT = process.env.PORT || 3000;

const app = express();
const http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: MAX_FILE_BYTES + 1024 * 1024 });

app.use(express.static(new URL('./public', import.meta.url).pathname));

// Everything lives in memory. A room is deleted when its last member leaves.
const rooms = new Map(); // roomId -> { members: Map<socketId, name>, history: [] }

function roomOf(id) {
  if (!rooms.has(id)) rooms.set(id, { members: new Map(), history: [] });
  return rooms.get(id);
}

function memberList(room) {
  return [...room.members.values()];
}

io.on('connection', (socket) => {
  let roomId = null;

  socket.on('join', ({ room, name }) => {
    room = String(room || '').trim().slice(0, 40);
    name = String(name || '').trim().slice(0, 30);
    if (!room || !name) return;
    roomId = room;
    const r = roomOf(roomId);
    r.members.set(socket.id, name);
    socket.join(roomId);
    socket.emit('history', r.history);
    const notice = { type: 'system', text: `${name} joined`, time: Date.now() };
    r.history.push(notice);
    io.to(roomId).emit('message', notice);
    io.to(roomId).emit('members', memberList(r));
  });

  socket.on('text', (text) => {
    const r = rooms.get(roomId);
    if (!r || !r.members.has(socket.id)) return;
    text = String(text || '').slice(0, 5000);
    if (!text.trim()) return;
    const msg = { type: 'text', from: r.members.get(socket.id), text, time: Date.now() };
    r.history.push(msg);
    io.to(roomId).emit('message', msg);
  });

  socket.on('file', ({ name, mime, data }) => {
    const r = rooms.get(roomId);
    if (!r || !r.members.has(socket.id)) return;
    if (!data || data.byteLength > MAX_FILE_BYTES) {
      socket.emit('message', { type: 'system', text: 'File is too large (max 20 MB)', time: Date.now() });
      return;
    }
    const msg = {
      type: 'file',
      from: r.members.get(socket.id),
      name: String(name || 'file').slice(0, 200),
      mime: String(mime || 'application/octet-stream'),
      data,
      time: Date.now(),
    };
    r.history.push(msg);
    io.to(roomId).emit('message', msg);
  });

  socket.on('disconnect', () => {
    const r = rooms.get(roomId);
    if (!r) return;
    const name = r.members.get(socket.id);
    r.members.delete(socket.id);
    if (r.members.size === 0) {
      rooms.delete(roomId);
      return;
    }
    const notice = { type: 'system', text: `${name} left`, time: Date.now() };
    r.history.push(notice);
    io.to(roomId).emit('message', notice);
    io.to(roomId).emit('members', memberList(r));
  });
});

http.listen(PORT, () => console.log(`Chat running on http://localhost:${PORT}`));
