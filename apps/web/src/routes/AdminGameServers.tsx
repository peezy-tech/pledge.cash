import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/utils/api';

interface GameServer {
  id: string;
  containerId: string;
  port: number;
  url: string; // Add the full URL from the API
  status: "starting" | "running" | "stopping" | "stopped";
  createdAt: string; // Assuming date is stringified
  // Add other fields if the API returns more
}

// React Query keys for game servers list
const gameServersKeys = {
  all: ['gameServers'] as const,
  list: () => [...gameServersKeys.all, 'list'] as const,
};

// Custom hook to fetch all game servers
const useGameServersQuery = () => {
  return useQuery<GameServer[], Error>({
    queryKey: gameServersKeys.list(),
    queryFn: async () => {
      // Assuming the path for all game servers is api['game-servers'].get()
      const response = await api['game-servers'].get();

      if (response.error) {
        const errorValue = response.error.value as { error?: string; message?: string };
        throw new Error(errorValue?.error || errorValue?.message || `API Error ${response.error.status} fetching game servers list`);
      }

      if (response.data && (response.data as any).success && Array.isArray((response.data as any).data)) {
        return (response.data as any).data as GameServer[];
      }
      // Handle cases where response.data is not in the expected { success: true, data: [] } format
      // or success is false in the payload
      const detailMessage = (response.data as any)?.error || 'Invalid data structure received for game servers list.';
      throw new Error(detailMessage);
    },
    // Optional: staleTime, cacheTime, retry policies can be configured here
    staleTime: 1000 * 60 * 1, // 1 minute
  });
};

const AdminGameServers: React.FC = () => {
  const navigate = useNavigate();
  const { data: servers, isLoading: loading, error } = useGameServersQuery();

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
    return <div>Error fetching game servers: {error.message}</div>;
  }

  if (!servers || servers.length === 0) {
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