import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import TokenCreationPage from './components/token-creation-page'
import ChartsPage from './components/charts-page'
import { LoginForm } from './components/login-form'

function App() {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
      <div className="mt-4">
        <Link to="/token-admin" className="text-blue-500 hover:underline">
          Go to Token Admin
        </Link>
      </div>
    </div>
  )
}

export default App
