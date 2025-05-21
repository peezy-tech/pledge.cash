import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'

export function ProfilePage() {
  return (
    <div className="container p-4">
      <h1 className="text-2xl mb-4">Profile Page</h1>
      <p>This is the profile page where users can view their profile information.</p>
    </div>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/profile',
    component: ProfilePage,
  }) 