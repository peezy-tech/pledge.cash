import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface AvatarUploaderProps {
  onAvatarUpload: (file: File) => void
}

export function AvatarUploader({ onAvatarUpload }: AvatarUploaderProps) {
  const [preview, setPreview] = useState<string | null>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
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
    accept: { 'model/gltf-binary': ['.glb'], 'model/vrm': ['.vrm'] },
    multiple: false,
  })

  return (
    <div className="mb-8">
      <h3 className="text-xl font-semibold mb-4">Upload Avatar</h3>
      <div
        {...getRootProps()}
        className={`p-8 border-2 border-dashed rounded hover:border-blue-500 cursor-pointer text-center 
          ${isDragActive ? 'border-blue-500 bg-gray-700' : 'border-gray-600 bg-gray-800'}`}
      >
        <input {...getInputProps()} />
        {preview ? (
          <p>New avatar selected. It will appear in the viewer.</p>
        ) : isDragActive ? (
          <p>Drop the avatar file here ...</p>
        ) : (
          <p>Drag 'n' drop a .vrm or .glb file here, or click to select file</p>
        )}
      </div>
    </div>
  )
} 