import { useState } from 'react'

export function UserNameEditor() {
  const [username, setUsername] = useState('JohnDoe123')
  const [isEditing, setIsEditing] = useState(false)
  const [tempUsername, setTempUsername] = useState(username)

  const handleEditClick = () => {
    setIsEditing(true)
    setTempUsername(username)
  }

  const handleSaveClick = () => {
    setUsername(tempUsername)
    setIsEditing(false)
    // In a real app, here you would save the username to the backend
    console.log('Username saved:', tempUsername)
  }

  const handleCancelClick = () => {
    setIsEditing(false)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempUsername(e.target.value)
  }

  const containerStyle: React.CSSProperties = {
    padding: '20px',
    background: 'linear-gradient(to bottom right, #1f2937, #111827)',
    borderRadius: '12px',
    color: 'white',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)',
    width: '100%',
    marginBottom: '20px'
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '8px',
    fontSize: '0.875rem'
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#374151',
    borderRadius: '4px',
    color: 'white',
    border: 'none',
    marginBottom: '15px'
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

  const cancelButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#6b7280'
  }

  return (
    <div style={containerStyle}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '16px' }}>Username</h2>
      
      {isEditing ? (
        <>
          <label htmlFor="username" style={labelStyle}>
            Edit Username:
          </label>
          <input
            id="username"
            type="text"
            value={tempUsername}
            onChange={handleChange}
            style={inputStyle}
            autoFocus
          />
          <div>
            <button onClick={handleSaveClick} style={buttonStyle}>
              Save
            </button>
            <button onClick={handleCancelClick} style={cancelButtonStyle}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginBottom: '16px' }}>{username}</p>
          <button onClick={handleEditClick} style={buttonStyle}>
            Edit Username
          </button>
        </>
      )}
    </div>
  )
} 