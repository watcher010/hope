export const config = {
  wsUrl: import.meta.env.PROD 
    ? `wss://${window.location.host}/ws` 
    : `ws://localhost:${import.meta.env.VITE_WS_PORT || 8080}`,
  esp32Url: import.meta.env.VITE_ESP32_WS_URL || 'ws://localhost:81'
};