import React from 'react'

interface PageLayoutProps {
  title: string
  description?: string
  children: React.ReactNode
}

export function PageLayout({ title, description, children }: PageLayoutProps) {
  return (
    <div className="min-h-screen text-white">
      <div className="container mx-auto px-6 sm:px-8 py-8 max-w-6xl">
        <h1 className="text-4xl font-bold text-white text-center mb-4">
          {title}
        </h1>
        {description && (
          <p className="text-gray-300 mb-10 text-center mx-auto max-w-2xl">
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  )
} 
