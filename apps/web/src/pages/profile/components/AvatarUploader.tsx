import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface AvatarUploaderProps {
  onAvatarUpload: (file: File) => void
}

export function AvatarUploader({ onAvatarUpload }: AvatarUploaderProps) {
  const [preview, setPreview] = useState<string | null>(null)

  const onDrop = useCallback((acceptedFiles: Array<File>) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0]
      onAvatarUpload(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }, [onAvatarUpload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'model/vrm': ['.vrm'] },
    multiple: false,
  })

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    cursor: 'pointer',
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
    padding: '2rem',
  }

  return (
    <div style={containerStyle}>
      <div
        {...getRootProps()}
        style={{
          ...cardStyle,
          borderWidth: '2px',
          borderStyle: 'dashed',
          borderColor: isDragActive ? '#3b82f6' : '#4b5563',
          textAlign: 'center',
        }}
      >
        <input {...getInputProps()} />
        {preview ? (
          <p>New avatar selected. It will appear in the viewer.</p>
        ) : isDragActive ? (
          <p>Drop the avatar file here ...</p>
        ) : (
          <p>Drag 'n' drop a .vrm file here, or click to select file</p>
        )}
      </div>
    </div>
  )
} 