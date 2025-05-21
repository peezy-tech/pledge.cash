import { useState, useRef } from 'react'

export function AvatarUploader() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const containerStyle: React.CSSProperties = {
    padding: '20px',
    background: 'linear-gradient(to bottom right, #1f2937, #111827)',
    borderRadius: '12px',
    color: 'white',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)',
    width: '100%',
    marginBottom: '20px'
  }
  
  const dropzoneStyle: React.CSSProperties = {
    border: '2px dashed #4f46e5',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
    marginTop: '15px',
    cursor: 'pointer',
    transition: 'background-color 0.3s',
    backgroundColor: '#1f2937'
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
  
  const previewStyle: React.CSSProperties = {
    marginTop: '20px',
    textAlign: 'center'
  }
  
  const imagePreviewStyle: React.CSSProperties = {
    maxWidth: '200px',
    maxHeight: '200px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    margin: '0 auto 15px'
  }
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          setPreviewUrl(e.target.result as string)
        }
      }
      reader.readAsDataURL(file)
    }
  }
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          setPreviewUrl(e.target.result as string)
        }
      }
      reader.readAsDataURL(file)
    }
  }
  
  const handleClick = () => {
    fileInputRef.current?.click()
  }
  
  const handleUpload = () => {
    if (!previewUrl) return
    
    setIsUploading(true)
    
    // Simulate upload - in a real app this would be an API call
    setTimeout(() => {
      console.log('Avatar uploaded successfully')
      setIsUploading(false)
      // Here you'd typically save the URL returned from the server
    }, 1500)
  }
  
  return (
    <div style={containerStyle}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '16px' }}>Upload Avatar</h2>
      
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        onChange={handleFileChange}
      />
      
      <div 
        style={dropzoneStyle}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <p>Drag & drop an image here or click to select</p>
        <p style={{ fontSize: '0.8rem', marginTop: '8px', color: '#9ca3af' }}>
          Supported formats: JPG, PNG, GIF (max 5MB)
        </p>
      </div>
      
      {previewUrl && (
        <div style={previewStyle}>
          <img src={previewUrl} alt="Avatar preview" style={imagePreviewStyle} />
          <button 
            onClick={handleUpload} 
            style={buttonStyle}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload Avatar'}
          </button>
        </div>
      )}
    </div>
  )
} 