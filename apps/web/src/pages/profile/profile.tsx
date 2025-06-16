import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import { EditName } from './components/EditName'
import { AvatarViewer } from './components/AvatarViewer'
import { AvatarUploader } from './components/AvatarUploader'
import { DefaultAvatarSelector } from './components/DefaultAvatarSelector'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import type { RootRoute } from '@tanstack/react-router'

export function ProfilePage() {
  const [avatarUrl, setAvatarUrl] = useState('/avatar.vrm')

  const handleAvatarUpload = (file: File) => {
    const newUrl = URL.createObjectURL(file)
    setAvatarUrl(newUrl)
    // In a real app, you would upload the file to a server here
    // and update the avatarUrl with the server's response.
  }

  const handleDefaultAvatarSelect = (url: string) => {
    setAvatarUrl(url)
  }

  return (
    <ProtectedRoute 
      fallback={
        <PageLayout title="Profile - Access Restricted">
          <div className="text-center py-12">
            <h2 className="text-2xl font-bold text-white mb-4">Profile Access Restricted</h2>
            <p className="text-gray-300 mb-6">
              You need to connect your wallet and login to access your profile.
            </p>
            <p className="text-sm text-gray-400">
              Click the "Connect Wallet" button in the header to get started.
            </p>
          </div>
        </PageLayout>
      }
    >
      <PageLayout title="Player">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <div className="mb-8">
              <AvatarViewer avatarUrl={avatarUrl} />
            </div>
          </div>

          <div className="md:col-span-1 space-y-8">
            
              <EditName />
            
            
              <AvatarUploader onAvatarUpload={handleAvatarUpload} />
              <DefaultAvatarSelector onAvatarSelect={handleDefaultAvatarSelect} />
            
          </div>
        </div>
      </PageLayout>
    </ProtectedRoute>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/profile',
    component: ProfilePage,
  }) 