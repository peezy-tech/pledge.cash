import { useState } from 'react'

interface AvatarViewerProps {
  imageUrl?: string
}

export function AvatarViewer({ imageUrl = 'https://via.placeholder.com/200/4f46e5/ffffff?text=Avatar' }: AvatarViewerProps) {
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  
  const containerStyle: React.CSSProperties = {
    padding: '20px',
    background: 'linear-gradient(to bottom right, #1f2937, #111827)',
    borderRadius: '12px',
    color: 'white',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)',
    width: '100%',
    marginBottom: '20px'
  }
  
  const viewerStyle: React.CSSProperties = {
    width: '200px',
    height: '200px',
    margin: '0 auto 20px',
    borderRadius: '50%',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: '0 0 20px rgba(79, 70, 229, 0.3)',
    border: '4px solid #4f46e5'
  }
  
  const imageStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: `rotate(${rotation}deg) scale(${zoom})`,
    transition: 'transform 0.3s ease-out'
  }
  
  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    marginBottom: '15px'
  }
  
  const sliderContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '120px'
  }
  
  const sliderLabelStyle: React.CSSProperties = {
    fontSize: '0.8rem',
    marginBottom: '5px',
    color: '#9ca3af'
  }
  
  const sliderStyle: React.CSSProperties = {
    width: '100%',
    accentColor: '#4f46e5'
  }
  
  const handleRotateLeft = () => {
    setRotation(prev => prev - 90)
  }
  
  const handleRotateRight = () => {
    setRotation(prev => prev + 90)
  }
  
  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setZoom(parseFloat(e.target.value))
  }
  
  const buttonStyle: React.CSSProperties = {
    backgroundColor: '#4f46e5',
    color: 'white',
    padding: '8px 16px',
    borderRadius: '4px',
    border: 'none',
    marginRight: '10px',
    cursor: 'pointer',
    transition: 'background-color 0.3s'
  }
  
  return (
    <div style={containerStyle}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '16px', textAlign: 'center' }}>Your Avatar</h2>
      
      <div style={viewerStyle}>
        <img 
          src={imageUrl} 
          alt="User avatar" 
          style={imageStyle} 
        />
      </div>
      
      <div style={controlsStyle}>
        <div style={sliderContainerStyle}>
          <div style={sliderLabelStyle}>Zoom: {zoom.toFixed(1)}x</div>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={zoom}
            onChange={handleZoomChange}
            style={sliderStyle}
          />
        </div>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={handleRotateLeft} style={buttonStyle}>
          Rotate Left
        </button>
        <button onClick={handleRotateRight} style={buttonStyle}>
          Rotate Right
        </button>
      </div>
    </div>
  )
} 