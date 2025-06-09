import React from 'react'

interface PageLayoutProps {
  title: string
  description?: string
  children: React.ReactNode
}

export function PageLayout({ title, description, children }: PageLayoutProps) {
  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-6 sm:px-8 py-8 max-w-6xl">
        <div className="flex justify-center mb-4">
          <h1 className="text-4xl font-bold text-white text-center  py-2 px-8 rounded-lg inline-block">
            {title}
          </h1>
        </div>
        {description && (
          <p className="text-gray-300 mb-10 text-center mx-auto max-w-2xl  p-3 rounded-lg">
            {description}
          </p>
        )}
        <div className=" p-6 rounded-xl">
          {children}
        </div>
      </div>
    </div>
  )
} 
