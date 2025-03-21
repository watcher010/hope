export const config = {
  wsUrl: import.meta.env.PROD 
    ? import.meta.env.VITE_WS_URL
    : `ws://localhost:${import.meta.env.VITE_WS_PORT || 8080}`,
  apiUrl: import.meta.env.PROD
    ? import.meta.env.VITE_API_URL
    : `http://localhost:${import.meta.env.VITE_PORT || 3000}`
};
