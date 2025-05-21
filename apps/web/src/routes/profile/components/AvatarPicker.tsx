export function AvatarPicker() {
  const avatars = [
    { id: 1, name: 'Avatar A', imageUrl: 'https://via.placeholder.com/150?text=Avatar+A' },
    { id: 2, name: 'Avatar B', imageUrl: 'https://via.placeholder.com/150?text=Avatar+B' },
    { id: 3, name: 'Avatar C', imageUrl: 'https://via.placeholder.com/150?text=Avatar+C' },
    { id: 4, name: 'Avatar D', imageUrl: 'https://via.placeholder.com/150?text=Avatar+D' },
  ]

  return (
    <div className="mb-8">
      <h3 className="text-xl font-semibold mb-4">Choose Your Avatar</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {avatars.map((avatar) => (
          <div key={avatar.id} className="bg-gray-700 p-2 rounded cursor-pointer hover:bg-gray-600">
            <img src={avatar.imageUrl} alt={avatar.name} className="w-full h-auto rounded mb-2" />
            <p className="text-center text-sm">{avatar.name}</p>
          </div>
        ))}
      </div>
    </div>
  )
} 