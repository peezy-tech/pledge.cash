import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { LaunchCard } from './launch/components/LaunchCard'
import { PageLayout } from './PageLayout'

export function LaunchPage() {
  const [launchStatus, setLaunchStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [launchData, setLaunchData] = useState<{
    name: string
    ticker: string
    description: string
    imageUrl: string
  } | null>(null)

  const handleLaunch = (data: {
    name: string
    ticker: string
    description: string
    imageUrl: string
  }) => {
    // In a real app, you would submit this data to your backend
    console.log('Launching world:', data)
    setLaunchData(data)
    setLaunchStatus('success')
    
    // Simulate API call
    // setTimeout(() => {
    //   setLaunchStatus('success')
    // }, 1500)
  }

  return (
    <PageLayout title="Launch">
      {launchStatus === 'success' && launchData ? (
        <div className="max-w-2xl mx-auto bg-gray-800 rounded-lg p-6 text-white">
          <h2 className="text-2xl font-bold mb-4 text-center text-green-500">Successfully Launched!</h2>
          <div className="flex flex-col md:flex-row gap-6">
            {launchData.imageUrl && (
              <div className="w-full md:w-1/3">
                <img 
                  src={launchData.imageUrl} 
                  alt={launchData.name} 
                  className="w-full h-auto rounded-lg object-cover"
                />
              </div>
            )}
            <div className="flex-1">
              <h3 className="text-xl font-bold">{launchData.name}</h3>
              <p className="text-sm font-mono bg-gray-700 inline-block px-2 py-1 rounded mt-1 mb-3">
                ${launchData.ticker}
              </p>
              <p className="text-gray-300">{launchData.description}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setLaunchStatus('idle')
              setLaunchData(null)
            }}
            className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            Launch Another World
          </button>
        </div>
      ) : (
        <div className="flex justify-center">
          <LaunchCard onSubmit={handleLaunch} />
        </div>
      )}
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/launch',
    component: LaunchPage,
  }) 