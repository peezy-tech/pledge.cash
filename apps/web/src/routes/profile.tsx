import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { PageLayout } from './PageLayout'
import { SectionContainer } from '../components/SectionContainer'
import { EditName } from './profile/components/EditName'
import { AvatarViewer } from './profile/components/AvatarViewer'
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
    <PageLayout title="Player">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2">
          <div className="mb-8">
            <AvatarViewer avatarUrl={avatarUrl} />
          </div>
        </div>

        <div className="md:col-span-1 space-y-8">
          <SectionContainer title="Name">
            <EditName />
          </SectionContainer>
          <SectionContainer title="Upload Avatar">
            <AvatarUploader onAvatarUpload={handleAvatarUpload} />
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