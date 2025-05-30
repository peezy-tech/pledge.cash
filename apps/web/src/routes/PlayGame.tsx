import React from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

interface PlayGameSearch {
  url?: string;
}

const PlayGame: React.FC = () => {
  const navigate = useNavigate();
  const { url } = useSearch({ from: '/play-game' }) as PlayGameSearch;

  if (!url) {
    return (
      <div style={{ padding: '20px' }}>
        <h2>Error: No game URL provided.</h2>
        <button onClick={() => navigate({ to: '/admin/game-servers' })}>
          Back to Server List
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'black', zIndex: 9999 }}>
      <iframe
        src={url}
        title="Game Viewer"
        style={{ width: '100%', height: '100%', border: 'none' }}
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock"
        allow="xr-spatial-tracking"
      />
      <button 
        onClick={() => navigate({ to: '/' })}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          padding: '10px 15px',
          backgroundColor: 'rgba(0,0,0,0.7)',
          color: 'white',
          border: '1px solid white',
          borderRadius: '5px',
          cursor: 'pointer',
          zIndex: 10000, // Ensure button is above iframe
        }}
      >
        Exit Game
      </button>
    </div>
  );
};

export default PlayGame; 