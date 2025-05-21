import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'

export function LaunchPage() {
  return (
    <div className="container p-4">
      <h1 className="text-2xl mb-4">Launch Page</h1>
      <p>This is the launch page where users can launch their project.</p>
    </div>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/launch',
    component: LaunchPage,
  }) 