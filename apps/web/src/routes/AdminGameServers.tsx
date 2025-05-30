import React, { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

interface GameServer {
  id: string;
  containerId: string;
  port: number;
  url: string; // Add the full URL from the API
  status: "starting" | "running" | "stopping" | "stopped";
  createdAt: string; // Assuming date is stringified
  // Add other fields if the API returns more
}

interface ApiResponse {
  success: boolean;
  data?: GameServer[];
  error?: string;
}

const AdminGameServers: React.FC = () => {
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchGameServers = async () => {
      setLoading(true);
      setError(null);
      try {
        // Assuming API is on localhost:3000 and web app is proxied or has CORS configured
        // In a real setup, this URL should come from a config
        const response = await fetch('/api/game-servers'); 
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result: ApiResponse = await response.json();
        if (result.success && result.data) {
          setServers(result.data);
        } else {
          setError(result.error || 'Failed to fetch game servers');
        }
      } catch (e: any) {
        setError(e.message || 'An unexpected error occurred');
        console.error("Fetch error:", e);
      }
      setLoading(false);
    };

    fetchGameServers();
  }, []);

  const handleConnectClick = (server: GameServer) => {
    if (server.url) {
      navigate({ to: '/play-game', search: { url: server.url } });
    } else {
      console.error("Game server URL is missing for server:", server.id);
    }
  };

  if (loading) {
    return <div>Loading game servers...</div>;
  }

  if (error) {
    return <div>Error fetching game servers: {error}</div>;
  }

  if (servers.length === 0) {
    return <div>No game servers found.</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>Game Server Management</h1>
      {servers.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid black', padding: '8px' }}>ID</th>
              <th style={{ border: '1px solid black', padding: '8px' }}>Port</th>
              <th style={{ border: '1px solid black', padding: '8px' }}>Status</th>
              <th style={{ border: '1px solid black', padding: '8px' }}>Created At</th>
              <th style={{ border: '1px solid black', padding: '8px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => (
              <tr key={server.id}>
                <td style={{ border: '1px solid black', padding: '8px' }}>{server.id}</td>
                <td style={{ border: '1px solid black', padding: '8px' }}>{server.port}</td>
                <td style={{ border: '1px solid black', padding: '8px' }}>{server.status}</td>
                <td style={{ border: '1px solid black', padding: '8px' }}>{new Date(server.createdAt).toLocaleString()}</td>
                <td style={{ border: '1px solid black', padding: '8px' }}>
                  {server.status === 'running' && (
                    <button 
                      onClick={() => handleConnectClick(server)}
                      style={{ marginRight: '10px' }}
                    >
                      Connect
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default AdminGameServers; 