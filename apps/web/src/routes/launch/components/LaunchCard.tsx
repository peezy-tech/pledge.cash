import React from 'react'
import { LaunchForm } from './LaunchForm'

interface LaunchCardProps {
  onSubmit: (data: {
    name: string
    ticker: string
    description: string
    imageUrl: string
  }) => void
}

export function LaunchCard({ onSubmit }: LaunchCardProps) {
  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '600px',
    position: 'relative',
    perspective: '1000px'
  }

  const cardInnerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: '12px',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)'
  }

  const cardFaceStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: '12px',
    overflow: 'hidden',
    background: 'linear-gradient(to bottom right, #1f2937, #111827)',
    color: 'white',
    padding: '24px'
  }

  return (
    <div style={containerStyle}>
      <div style={cardInnerStyle}>
        <div style={cardFaceStyle}>
          <h2 className="text-xl font-bold mb-6 text-center">Launch Your World</h2>
          <LaunchForm onSubmit={onSubmit} />
        </div>
      </div>
    </div>
  )
} 