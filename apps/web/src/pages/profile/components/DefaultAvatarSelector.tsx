import React from 'react';

const BUCKET_URL = "https://pub-84b034e3e33c41f382e57fb1b9211ef7.r2.dev";

const defaultAvatars = [
  { name: "Cyber Spartain", url: `${BUCKET_URL}/CyberSpartain_v6_merged.vrm` },
  { name: "George Droyd", url: `${BUCKET_URL}/GeorgeDroyd_VRM.vrm` },
  { name: "Lain", url: `${BUCKET_URL}/LainPink.vrm` },
  { name: "Mog Tubby", url: `${BUCKET_URL}/MOG_Tubby.vrm` },
  { name: "Pepe", url: `${BUCKET_URL}/Pepe.vrm` },
  { name: "Retardio", url: `${BUCKET_URL}/Retardio_001.vrm` },
  { name: "Shaw AI", url: `${BUCKET_URL}/ShawAI.vrm` },
  { name: "Soyjak", url: `${BUCKET_URL}/Soyjak.vrm` },
  { name: "Yakub", url: `${BUCKET_URL}/Yakub.vrm` },
  { name: "Eliza", url: `${BUCKET_URL}/ai16zavatar2.vrm` },
  { name: "Bayc", url: `${BUCKET_URL}/bayc.vrm` },
  { name: "Bezos", url: `${BUCKET_URL}/bezos.vrm` },
  { name: "Buterin", url: `${BUCKET_URL}/buterin.vrm` },
  { name: "Goku", url: `${BUCKET_URL}/goku.vrm` },
  { name: "Jin", url: `${BUCKET_URL}/jin_ai16z_10.vrm` },
  { name: "Joe Coin", url: `${BUCKET_URL}/joe_coin.vrm` }
];

interface DefaultAvatarSelectorProps {
  onAvatarSelect: (avatarUrl: string) => void;
}

export const DefaultAvatarSelector: React.FC<DefaultAvatarSelectorProps> = ({ onAvatarSelect }) => {
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onAvatarSelect(event.target.value);
  };

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    perspective: '1000px'
  };

  const cardStyle: React.CSSProperties = {
    position: 'relative',
    transition: 'transform 0.6s',
    transformStyle: 'preserve-3d',
    borderRadius: '12px',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(4px)',
    color: 'white',
    padding: '1rem'
  };

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    outline: 'none'
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <select
          onChange={handleChange}
          style={selectStyle}
        >
          <option value="" disabled selected>Select an avatar</option>
          {defaultAvatars.map((avatar) => (
            <option key={avatar.url} value={avatar.url}>
              {avatar.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}; 