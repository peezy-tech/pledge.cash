import { useState } from 'react'

export function EditName() {
  const [name, setName] = useState('Anonymous')
  const [isEditing, setIsEditing] = useState(false)

  return (
    <div className="mb-8">
      {isEditing ? (
        <div className="flex items-center">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-gray-700 text-white p-2 rounded mr-2 flex-grow"
          />
          <button
            onClick={() => setIsEditing(false)}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="flex items-center">
          <h2 className="text-2xl font-bold mr-4">{name}</h2>
          <button
            onClick={() => setIsEditing(true)}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-1 px-3 rounded text-sm"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  )
} 