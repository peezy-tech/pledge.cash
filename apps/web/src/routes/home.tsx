import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'

export function HomePage() {
  return (
    <div className="container p-4">
      <h1 className="text-2xl mb-4">Home Page</h1>
      <p>This is the home page where users can discover content.</p>
    </div>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomePage,
  }) 