import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import { AlertTriangle, Power, Trash2, RefreshCw } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface Room {
  id: string;
  name: string;
  power: number;
  threshold: number;
  status: string;
  isCutoff: boolean;
  bypassDetected: boolean;
  measPin: number;
  cutoffPin: number;
}

function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [connected, setConnected] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({
    name: '',
    measPin: 0,
    cutoffPin: 0,
    threshold: 2500
  });

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080');

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'rooms') {
        setRooms(data.data);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  const handleAddRoom = () => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'add_room',
        room: {
          id: `room_${Date.now()}`,
          ...newRoom
        }
      }));
      setShowAddRoom(false);
      setNewRoom({
        name: '',
        measPin: 0,
        cutoffPin: 0,
        threshold: 2500
      });
    };
  };

  const handleDeleteRoom = (roomId: string) => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'delete_room',
        roomId
      }));
    };
  };

  const handleResetPower = (roomId: string) => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'reset_power',
        roomId
      }));
    };
  };

  const handleUpdateThreshold = (roomId: string, threshold: number) => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'update_threshold',
        roomId,
        threshold
      }));
    };
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Power Monitoring Dashboard</h1>
          <div className="mt-2 flex items-center">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'} mr-2`}></div>
            <span className="text-sm text-gray-600">
              {connected ? 'Connected to ESP32' : 'Disconnected from ESP32'}
            </span>
          </div>
        </header>

        <div className="mb-8">
          <button
            onClick={() => setShowAddRoom(!showAddRoom)}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            {showAddRoom ? 'Cancel' : 'Add New Room'}
          </button>

          {showAddRoom && (
            <div className="mt-4 bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">Add New Room</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <input
                  type="text"
                  placeholder="Room Name"
                  value={newRoom.name}
                  onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                  className="border p-2 rounded"
                />
                <input
                  type="number"
                  placeholder="Measure Pin"
                  value={newRoom.measPin}
                  onChange={(e) => setNewRoom({ ...newRoom, measPin: parseInt(e.target.value) })}
                  className="border p-2 rounded"
                />
                <input
                  type="number"
                  placeholder="Cutoff Pin"
                  value={newRoom.cutoffPin}
                  onChange={(e) => setNewRoom({ ...newRoom, cutoffPin: parseInt(e.target.value) })}
                  className="border p-2 rounded"
                />
                <input
                  type="number"
                  placeholder="Threshold (W)"
                  value={newRoom.threshold}
                  onChange={(e) => setNewRoom({ ...newRoom, threshold: parseInt(e.target.value) })}
                  className="border p-2 rounded"
                />
              </div>
              <button
                onClick={handleAddRoom}
                className="mt-4 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
              >
                Add Room
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="bg-white rounded-lg shadow-lg overflow-hidden"
            >
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold">{room.name}</h3>
                  <div className="flex items-center space-x-2">
                    {room.bypassDetected && (
                      <AlertTriangle className="text-yellow-500" />
                    )}
                    {room.isCutoff && (
                      <Power className="text-red-500" />
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-2xl font-bold">{room.power.toFixed(1)} W</p>
                  <p className={`text-sm ${
                    room.status === 'Normal' ? 'text-green-500' :
                    room.status === 'Cutoff Active' ? 'text-red-500' :
                    'text-yellow-500'
                  }`}>
                    {room.status}
                  </p>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700">
                    Power Threshold
                  </label>
                  <input
                    type="number"
                    value={room.threshold}
                    onChange={(e) => handleUpdateThreshold(room.id, parseInt(e.target.value))}
                    className="mt-1 block w-full border rounded-md shadow-sm p-2"
                  />
                </div>

                <Line
                  data={{
                    labels: Array(10).fill(''),
                    datasets: [
                      {
                        label: 'Power',
                        data: Array(10).fill(room.power),
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.1
                      },
                      {
                        label: 'Threshold',
                        data: Array(10).fill(room.threshold),
                        borderColor: 'rgb(255, 99, 132)',
                        borderDash: [5, 5]
                      }
                    ]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      y: {
                        beginAtZero: true
                      }
                    }
                  }}
                  className="h-48"
                />

                <div className="mt-4 flex justify-between">
                  <button
                    onClick={() => handleResetPower(room.id)}
                    className="flex items-center px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reset Power
                  </button>
                  <button
                    onClick={() => handleDeleteRoom(room.id)}
                    className="flex items-center px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Room
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;