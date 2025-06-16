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
    transition: 'transform 0.6s',
    transformStyle: 'preserve-3d',
    borderRadius: '12px',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)'
  }

  const cardFaceStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    backfaceVisibility: 'hidden',
    borderRadius: '12px',
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(4px)',
    color: 'white',
    padding: '24px'
  }

  return (
    <div style={containerStyle}>
      <div style={cardInnerStyle}>
        <div style={cardFaceStyle}>
          <LaunchForm onSubmit={onSubmit} />
        </div>
      </div>
    </div>
  )
} 