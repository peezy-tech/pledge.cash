import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { UserNameEditor } from './profile/components/UserNameEditor'
import { AvatarViewer } from './profile/components/AvatarViewer'
import { AvatarSelector } from './profile/components/AvatarSelector'
import { AvatarUploader } from './profile/components/AvatarUploader'
import { PageLayout } from './PageLayout'
import { SectionContainer } from '../components/SectionContainer'

export function ProfilePage() {
  return (
    <PageLayout title="Profile">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-1">
          <AvatarViewer />
        </div>
        <div className="md:col-span-2">
          <UserNameEditor />
        </div>
      </div>
      
      <SectionContainer title="Avatar Options">
        <AvatarSelector />
      </SectionContainer>
      
      <SectionContainer title="Upload Custom Avatar">
        <AvatarUploader />
      </SectionContainer>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/profile',
    component: ProfilePage,
  }) 