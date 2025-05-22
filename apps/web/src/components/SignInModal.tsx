import { useModal } from '../context/ModalContext';

export default function SignInModal() {
  const { isModalOpen, toggleModal } = useModal();

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-neutral-900 p-8 rounded-xl shadow-2xl text-white w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold">Sign In</h2>
          <button
            onClick={toggleModal}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <p className="text-neutral-400 mb-6 text-center">Choose your preferred sign-in method.</p>

        <button
          // onClick={handleSignInWithX} // We'll implement this later
          className="w-full flex items-center justify-center gap-3 px-4 py-3 font-semibold rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors mb-4 text-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-twitter"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>
          Sign in with X
        </button>
        {/* Add other OAuth buttons here if needed */}
      </div>
    </div>
  );
} 