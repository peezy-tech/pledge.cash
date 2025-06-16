import { useState } from 'react'
import { ImageUpload } from './ImageUpload'

interface LaunchFormProps {
  onSubmit: (data: {
    name: string
    ticker: string
    description: string
    imageUrl: string
  }) => void
}

export function LaunchForm({ onSubmit }: LaunchFormProps) {
  const [name, setName] = useState('')
  const [ticker, setTicker] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({ name, ticker, description, imageUrl })
  }

  const inputStyle = "w-full rounded-lg bg-opacity-50 backdrop-blur-sm border border-gray-700 text-white px-4 py-2 focus:ring-white focus:border-white"

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-white mb-1">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputStyle}
            required
          />
        </div>

        <div>
          <label htmlFor="ticker" className="block text-sm font-medium text-white mb-1">
            Ticker
          </label>
          <input
            id="ticker"
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className={inputStyle}
            required
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-white mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={inputStyle}
            required
          />
        </div>

        <ImageUpload imageUrl={imageUrl} setImageUrl={setImageUrl} />
      </div>

      <button
        type="submit"
        className="w-full py-3 px-4 bg-opacity-50 backdrop-blur-sm border border-gray-700 text-white font-semibold rounded-lg shadow transition duration-200 hover:bg-white hover:bg-opacity-10"
      >
        Launch World
      </button>
    </form>
  )
} 