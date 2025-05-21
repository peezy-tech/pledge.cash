import { useState } from 'react'

// Mock avatar data
const mockAvatars = [
  { id: '1', name: 'Avatar 1', imageUrl: 'https://via.placeholder.com/100/4f46e5/ffffff?text=A1' },
  { id: '2', name: 'Avatar 2', imageUrl: 'https://via.placeholder.com/100/22c55e/ffffff?text=A2' },
  { id: '3', name: 'Avatar 3', imageUrl: 'https://via.placeholder.com/100/ef4444/ffffff?text=A3' },
  { id: '4', name: 'Avatar 4', imageUrl: 'https://via.placeholder.com/100/f59e0b/ffffff?text=A4' },
]

export function AvatarSelector() {
  const [selectedAvatar, setSelectedAvatar] = useState(mockAvatars[0])
  
  const containerStyle: React.CSSProperties = {
    padding: '20px',
    background: 'linear-gradient(to bottom right, #1f2937, #111827)',
    borderRadius: '12px',
    color: 'white',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)',
    width: '100%',
    marginBottom: '20px'
  }
  
  const avatarGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: '15px',
    marginTop: '15px'
  }
  
  const avatarItemStyle: React.CSSProperties = {
    cursor: 'pointer',
    borderRadius: '8px',
    overflow: 'hidden',
    transition: 'transform 0.2s',
    position: 'relative'
  }
  
  const buttonStyle: React.CSSProperties = {
    backgroundColor: '#4f46e5',
    color: 'white',
    padding: '8px 16px',
    borderRadius: '4px',
    border: 'none',
    marginTop: '15px',
    cursor: 'pointer',
    transition: 'background-color 0.3s'
  }
  
  const handleSelectAvatar = (avatar: typeof mockAvatars[0]) => {
    setSelectedAvatar(avatar)
  }
  
  const handleApplyAvatar = () => {
    console.log('Applied avatar:', selectedAvatar)
    // In a real app, here you would save the selected avatar to the user profile
  }
  
  return (
    <div style={containerStyle}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '16px' }}>Select Avatar</h2>
      
      <div style={avatarGridStyle}>
        {mockAvatars.map((avatar) => (
          <div 
            key={avatar.id}
            style={{
              ...avatarItemStyle,
              transform: selectedAvatar.id === avatar.id ? 'scale(1.05)' : 'scale(1)',
              boxShadow: selectedAvatar.id === avatar.id ? '0 0 0 3px #4f46e5' : 'none'
            }}
            onClick={() => handleSelectAvatar(avatar)}
          >
            <img 
              src={avatar.imageUrl} 
              alt={avatar.name} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ))}
      </div>
      
      <button onClick={handleApplyAvatar} style={buttonStyle}>
        Apply Selected Avatar
      </button>
    </div>
  )
} 