import React from 'react'

interface SectionContainerProps {
  title: string
  children: React.ReactNode
}

export function SectionContainer({ title, children }: SectionContainerProps) {
  return (
    <div className="section-style">
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      {children}
    </div>
  )
} 