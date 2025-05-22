import { useState } from 'react'

interface ImageUploadProps {
  imageUrl: string
  setImageUrl: (url: string) => void
}

export function ImageUpload({ imageUrl, setImageUrl }: ImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length) {
      handleFile(e.target.files[0])
    }
  }

  const handleFile = (file: File) => {
    // In a real app, you would upload the file to a server
    // For demo purposes, we'll just create a local URL
    const reader = new FileReader()
    reader.onload = (e) => {
      if (e.target?.result) {
        setImageUrl(e.target.result as string)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="mt-2">
      <label className="block text-sm font-medium text-white mb-1">
        World Image
      </label>
      <div
        className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-lg ${
          isDragging ? 'border-white bg-opacity-20 backdrop-blur-sm' : 'border-gray-700 bg-opacity-50 backdrop-blur-sm'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="space-y-1 text-center">
          {imageUrl ? (
            <div className="relative w-full">
              <img
                src={imageUrl}
                alt="Preview"
                className="mx-auto h-40 w-auto object-contain rounded"
              />
              <button
                type="button"
                onClick={() => setImageUrl('')}
                className="absolute top-0 right-0 bg-opacity-70 backdrop-blur-sm text-white p-1 rounded-full"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="flex text-sm text-gray-400">
                <label
                  htmlFor="file-upload"
                  className="relative cursor-pointer bg-opacity-50 backdrop-blur-sm rounded-md font-medium text-white hover:text-gray-300 focus-within:outline-none"
                >
                  <span className="px-2">Upload a file</span>
                  <input
                    id="file-upload"
                    name="file-upload"
                    type="file"
                    className="sr-only"
                    accept="image/*"
                    onChange={handleFileInput}
                  />
                </label>
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-400">
                PNG, JPG, GIF up to 10MB
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
} 