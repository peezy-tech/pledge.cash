import React from 'react';

const BUCKET_URL = "https://pub-84b034e3e33c41f382e57fb1b9211ef7.r2.dev";

const defaultAvatars = [
  { name: "8ball Facial", url: `${BUCKET_URL}/8ball-facial.vrm` },
  { name: "Adworld Workbro", url: `${BUCKET_URL}/Adworld_Workbro.vrm` },
  { name: "Bitcoin Guy", url: `${BUCKET_URL}/BitcoinGuy.vrm` },
  { name: "Chadworldfix", url: `${BUCKET_URL}/Chadworldfix.vrm` },
  { name: "Cyber Spartain", url: `${BUCKET_URL}/CyberSpartain_v6_merged.vrm` },
  { name: "Doge Coin", url: `${BUCKET_URL}/DogeCoin.vrm` },
  { name: "George Droyd", url: `${BUCKET_URL}/GeorgeDroyd_VRM.vrm` },
  { name: "Lain", url: `${BUCKET_URL}/LainPink.vrm` },
  { name: "Mog Tubby", url: `${BUCKET_URL}/MOG_Tubby.vrm` },
  { name: "Patchwork Naval", url: `${BUCKET_URL}/PatchworkNaval01.vrm` },
  { name: "Pepe", url: `${BUCKET_URL}/Pepe.vrm` },
  { name: "Retardio", url: `${BUCKET_URL}/Retardio_001.vrm` },
  { name: "Shaw", url: `${BUCKET_URL}/Shaw.vrm` },
  { name: "Shaw AI", url: `${BUCKET_URL}/ShawAI.vrm` },
  { name: "Soyjak", url: `${BUCKET_URL}/Soyjak.vrm` },
  { name: "Yakub", url: `${BUCKET_URL}/Yakub.vrm` },
  { name: "Eliza", url: `${BUCKET_URL}/ai16zavatar2.vrm` },
  { name: "Background Avatar", url: `${BUCKET_URL}/background_avatar.vrm` },
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

  return (
    <div className="w-full">
      <select
        onChange={handleChange}
        className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="" disabled selected>Select an avatar</option>
        {defaultAvatars.map((avatar) => (
          <option key={avatar.url} value={avatar.url}>
            {avatar.name}
          </option>
        ))}
      </select>
    </div>
  );
}; 