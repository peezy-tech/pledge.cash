import { Link } from '@tanstack/react-router'
import { useModal } from '../context/ModalContext';

export default function Header() {
  const { toggleModal } = useModal();

  return (
    <header className="p-2 flex gap-4 bg-black/30 backdrop-blur-sm text-white justify-between items-center">
      <nav className="flex flex-row gap-2">
        <Link 
          to="/" 
          className="px-3 py-2 font-semibold rounded-md hover:bg-white/20 transition-colors"
          activeProps={{ className: "px-3 py-2 font-semibold rounded-md bg-white/10 transition-colors" }}
          activeOptions={{ exact: true }}
        >
          Home
        </Link>

        <Link 
          to="/launch" 
          className="px-3 py-2 font-semibold rounded-md hover:bg-white/20 transition-colors"
          activeProps={{ className: "px-3 py-2 font-semibold rounded-md bg-white/10 transition-colors" }}
        >
          Launch
        </Link>
        
        <Link 
          to="/profile" 
          className="px-3 py-2 font-semibold rounded-md hover:bg-white/20 transition-colors"
          activeProps={{ className: "px-3 py-2 font-semibold rounded-md bg-white/10 transition-colors" }}
        >
          Profile
        </Link>
      </nav>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleModal}
          className="px-3 py-2 font-semibold rounded-md hover:bg-white/10 transition-colors"
        >
          Sign In
        </button>
      </div>
    </header>
  )
}
