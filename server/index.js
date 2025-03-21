import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'power.db'));

// Initialize database with better error handling
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      threshold REAL DEFAULT 2500.0,
      meas_pin INTEGER NOT NULL,
      cutoff_pin INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS power_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT,
      timestamp INTEGER NOT NULL,
      power REAL NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_power_readings_room_id ON power_readings(room_id);
    CREATE INDEX IF NOT EXISTS idx_power_readings_timestamp ON power_readings(timestamp);
  `);
} catch (error) {
  console.error('Database initialization failed:', error);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, '../dist')));
}

const wss = new WebSocketServer({ 
  port: process.env.WS_PORT || 8080,
  clientTracking: true
});

// Store connected clients with ping/pong
const clients = new Map();

// Simulated room data with persistence
const rooms = new Map();

// Load existing rooms from database
try {
  const existingRooms = db.prepare('SELECT * FROM rooms').all();
  existingRooms.forEach(room => {
    rooms.set(room.id, {
      ...room,
      power: 0,
      status: 'Normal',
      isCutoff: false,
      bypassDetected: false
    });
  });
} catch (error) {
  console.error('Failed to load existing rooms:', error);
}

// WebSocket connection handling with heartbeat
wss.on('connection', (ws) => {
  const clientId = Date.now();
  clients.set(clientId, {
    ws,
    isAlive: true,
    lastPing: Date.now()
  });

  console.log(`Client ${clientId} connected`);

  // Send initial room data
  ws.send(JSON.stringify({
    type: 'rooms',
    data: Array.from(rooms.values())
  }));

  ws.on('pong', () => {
    const client = clients.get(clientId);
    if (client) {
      client.isAlive = true;
      client.lastPing = Date.now();
    }
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(data, ws);
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client ${clientId} disconnected`);
  });
});

// Heartbeat interval
setInterval(() => {
  const now = Date.now();
  clients.forEach((client, id) => {
    if (now - client.lastPing > 30000) {
      client.ws.terminate();
      clients.delete(id);
      console.log(`Client ${id} terminated due to inactivity`);
      return;
    }
    if (!client.isAlive) {
      client.ws.terminate();
      clients.delete(id);
      return;
    }
    client.isAlive = false;
    client.ws.ping();
  });
}, 10000);

// Enhanced message handling with database persistence
function handleWebSocketMessage(data, ws) {
  try {
    switch (data.type) {
      case 'add_room':
        addRoom(data.room);
        break;
      case 'delete_room':
        deleteRoom(data.roomId);
        break;
      case 'update_threshold':
        updateThreshold(data.roomId, data.threshold);
        break;
      case 'reset_power':
        resetPower(data.roomId);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  } catch (error) {
    console.error('Error in message handler:', error);
    ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
  }
}

function addRoom(room) {
  try {
    const stmt = db.prepare('INSERT INTO rooms (id, name, threshold, meas_pin, cutoff_pin) VALUES (?, ?, ?, ?, ?)');
    stmt.run(room.id, room.name, room.threshold, room.measPin, room.cutoffPin);

    rooms.set(room.id, {
      ...room,
      power: 0,
      status: 'Normal',
      isCutoff: false,
      bypassDetected: false
    });
    
    broadcastRooms();
  } catch (error) {
    console.error('Failed to add room:', error);
  }
}

function deleteRoom(roomId) {
  try {
    const stmt = db.prepare('DELETE FROM rooms WHERE id = ?');
    stmt.run(roomId);
    
    rooms.delete(roomId);
    broadcastRooms();
  } catch (error) {
    console.error('Failed to delete room:', error);
  }
}

function updateThreshold(roomId, threshold) {
  try {
    const stmt = db.prepare('UPDATE rooms SET threshold = ? WHERE id = ?');
    stmt.run(threshold, roomId);

    const room = rooms.get(roomId);
    if (room) {
      room.threshold = threshold;
      broadcastRooms();
    }
  } catch (error) {
    console.error('Failed to update threshold:', error);
  }
}

function resetPower(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.isCutoff = false;
    room.bypassDetected = false;
    room.status = 'Normal';
    broadcastRooms();
  }
}

function broadcastRooms() {
  const message = JSON.stringify({
    type: 'rooms',
    data: Array.from(rooms.values())
  });
  
  clients.forEach(client => {
    if (client.ws.readyState === 1) {
      client.ws.send(message);
    }
  });
}

// Enhanced ESP32 simulation with realistic data patterns
function simulateESP32Data() {
  rooms.forEach((room, roomId) => {
    // Generate more realistic power values with some variation
    const baseLoad = 50 + Math.random() * 100;
    const spikeProbability = 0.1;
    const power = spikeProbability > Math.random() 
      ? baseLoad + Math.random() * 400  // Occasional power spike
      : baseLoad + Math.sin(Date.now() / 10000) * 20;  // Normal variation
    
    room.power = power;
    
    // Update status based on power consumption
    if (power > room.threshold) {
      room.isCutoff = true;
      room.status = 'Cutoff Active';
    }
    
    // Simulate bypass detection with persistence
    if (room.isCutoff && Math.random() < 0.1) {
      room.bypassDetected = true;
      room.status = 'Bypass Detected';
    }

    // Store power reading in database
    try {
      const stmt = db.prepare('INSERT INTO power_readings (room_id, timestamp, power, status) VALUES (?, ?, ?, ?)');
      stmt.run(roomId, Date.now(), power, room.status);
    } catch (error) {
      console.error('Failed to store power reading:', error);
    }
  });
  
  broadcastRooms();
}

// Start simulation with error handling
try {
  setInterval(simulateESP32Data, 1000);
} catch (error) {
  console.error('Simulation failed to start:', error);
}

// Error handling for unexpected shutdowns
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  wss.close(() => {
    db.close();
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  wss.close(() => {
    db.close();
    process.exit(1);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on port ${process.env.WS_PORT || 8080}`);
});