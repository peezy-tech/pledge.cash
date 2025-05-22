import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { SectionContainer } from '../components/SectionContainer'
import { PageLayout } from './PageLayout'
import { EditName } from './profile/components/EditName'
import { AvatarViewer } from './profile/components/AvatarViewer'
import { AvatarUploader } from './profile/components/AvatarUploader'
import { DefaultAvatarSelector } from './profile/components/DefaultAvatarSelector'
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
          <SectionContainer title="Default Avatars">
            <DefaultAvatarSelector onAvatarSelect={handleDefaultAvatarSelect} />
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