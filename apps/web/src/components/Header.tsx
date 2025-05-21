import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="p-4 flex gap-4 bg-black/70 text-white justify-between items-center">
      <nav className="flex flex-row gap-2">
        <div className="px-3 py-2 font-semibold rounded-md hover:bg-white/10 transition-colors">
          <Link to="/">Home</Link>
        </div>

        <div className="px-3 py-2 font-semibold rounded-md hover:bg-white/10 transition-colors">
          <Link to="/launch">Launch</Link>
        </div>
        
        <div className="px-3 py-2 font-semibold rounded-md hover:bg-white/10 transition-colors">
          <Link to="/profile">Profile</Link>
        </div>
      </nav>
      {/* If you have other elements like a user profile button, they would go here */}
    </header>
  )
}
