import { WorldCard } from './WorldCard'

// Sample data for virtual worlds
const mockWorlds = [
  {
    id: '1',
    title: 'Neon Metropolis',
    imageUrl: 'https://images.unsplash.com/photo-1604871000636-074fa5117945?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=687&q=80',
    price: 0.05
  },
  {
    id: '2',
    title: 'Cosmic Odyssey',
    imageUrl: 'https://images.unsplash.com/photo-1614732414444-096e5f1122d5?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1074&q=80',
    price: 0.08
  },
  {
    id: '3',
    title: 'Enchanted Realms',
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=684&q=80',
    price: 0.12
  },
  {
    id: '4',
    title: 'Digital Frontier',
    imageUrl: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=735&q=80',
    price: 0.09
  },
  {
    id: '5',
    title: 'Astral Planes',
    imageUrl: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1074&q=80',
    price: 0.15
  },
  {
    id: '6',
    title: 'Quantum Arena',
    imageUrl: 'https://images.unsplash.com/photo-1563207153-f403bf289096?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1171&q=80',
    price: 0.07
  }
]

export function WorldGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
      {mockWorlds.map(world => (
        <WorldCard
          key={world.id}
          id={world.id}
          title={world.title}
          imageUrl={world.imageUrl}
          price={world.price}
        />
      ))}
    </div>
  )
} 