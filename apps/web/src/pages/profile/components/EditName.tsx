import { useState } from 'react'

export function EditName() {
  const [name, setName] = useState('Anonymous')
  const [isEditing, setIsEditing] = useState(false)

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    perspective: '1000px',
    marginBottom: '2rem'
  }

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
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: 'white',
    padding: '0.5rem',
    borderRadius: '0.25rem',
    marginRight: '0.5rem',
    flexGrow: 1,
    border: 'none'
  }

  const saveButtonStyle: React.CSSProperties = {
    backgroundColor: '#4B5563',
    color: 'white',
    fontWeight: 'bold',
    padding: '0.5rem 1rem',
    borderRadius: '0.25rem',
    border: 'none',
    cursor: 'pointer'
  }

  const editButtonStyle: React.CSSProperties = {
    backgroundColor: '#4B5563',
    color: 'white',
    fontWeight: 'bold',
    padding: '0.5rem 1rem',
    borderRadius: '0.25rem',
    marginLeft: '1rem',
    border: 'none',
    cursor: 'pointer'
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {isEditing ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
            <button
              onClick={() => setIsEditing(false)}
              style={saveButtonStyle}
            >
              Save
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{name}</h2>
            <button
              onClick={() => setIsEditing(true)}
              style={editButtonStyle}
            >
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  )
} 