import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { PageLayout } from './PageLayout'
import { SectionContainer } from '../components/SectionContainer'
import { EditName } from './profile/components/EditName'
import { AvatarViewer } from './profile/components/AvatarViewer'
import { AvatarPicker } from './profile/components/AvatarPicker'
import { AvatarUploader } from './profile/components/AvatarUploader'

export function ProfilePage() {
  const [avatarUrl, setAvatarUrl] = useState('/avatar.vrm')

  const handleAvatarUpload = (file: File) => {
    const newUrl = URL.createObjectURL(file)
    setAvatarUrl(newUrl)
    // In a real app, you would upload the file to a server here
    // and update the avatarUrl with the server's response.
  }

  return (
    <PageLayout title="Character">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2">
          <div className="mb-8">
            <AvatarViewer avatarUrl={avatarUrl} />
          </div>
        </div>

        <div className="md:col-span-1 space-y-8">
          <SectionContainer title="Outfit - Your Style">
            <EditName />
            <div>
              <p className="text-sm text-gray-400 mb-2">This item is usable in:</p>
              <div className="flex space-x-2">
                <span className="bg-gray-700 px-2 py-1 text-xs rounded">Battle Royale</span>
                <span className="bg-gray-700 px-2 py-1 text-xs rounded">Fortnite Festival</span>
                <span className="bg-gray-700 px-2 py-1 text-xs rounded">Rocket Racing</span>
              </div>
            </div>
          </SectionContainer>
          <SectionContainer title="Avatar Customization">
            <AvatarUploader onAvatarUpload={handleAvatarUpload} />
          </SectionContainer>
          <SectionContainer title="Select Avatar (Placeholder)">
            <AvatarPicker />
          </SectionContainer>
        </div>
      </div>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/profile',
    component: ProfilePage,
  }) 