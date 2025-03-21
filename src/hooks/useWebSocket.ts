import { useState, useEffect, useCallback } from 'react';
import { config } from '../config';

interface WebSocketHook {
  connected: boolean;
  sendMessage: (message: any) => void;
  lastMessage: any;
}

export function useWebSocket(): WebSocketHook {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);

  useEffect(() => {
    const socket = new WebSocket(config.wsUrl);

    socket.onopen = () => {
      setConnected(true);
      console.log('WebSocket connected');
    };

    socket.onclose = () => {
      setConnected(false);
      console.log('WebSocket disconnected');
      
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        console.log('Attempting to reconnect...');
        setWs(new WebSocket(config.wsUrl));
      }, 5000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }, [ws]);

  return { connected, sendMessage, lastMessage };
}