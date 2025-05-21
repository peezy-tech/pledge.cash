import { useState } from 'react'

interface WorldCardProps {
  id: string
  title: string
  imageUrl: string
  price: number
}

export function WorldCard({ id, title, imageUrl, price }: WorldCardProps) {
  const [isFlipped, setIsFlipped] = useState(false)
  const [amount, setAmount] = useState(1)

  const handleFlip = () => {
    setIsFlipped(!isFlipped)
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(parseInt(e.target.value) || 1)
  }

  const handleBuy = () => {
    console.log(`Buying ${amount} of ${title} at ${price} each`)
    // Implementation for buying would go here
  }

  const handleSell = () => {
    console.log(`Selling ${amount} of ${title} at ${price} each`)
    // Implementation for selling would go here
  }

  const containerStyle: React.CSSProperties = {
    width: '256px',
    height: '320px',
    position: 'relative',
    cursor: 'pointer',
    perspective: '1000px'
  }

  const cardInnerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    transition: 'transform 0.6s',
    transformStyle: 'preserve-3d',
    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
    borderRadius: '12px',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)'
  }

  const cardFaceStyle: React.CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backfaceVisibility: 'hidden',
    borderRadius: '12px',
    overflow: 'hidden',
    background: 'linear-gradient(to bottom right, #1f2937, #111827)',
    color: 'white'
  }

  const cardFrontStyle: React.CSSProperties = {
    ...cardFaceStyle,
    zIndex: 2
  }

  const cardBackStyle: React.CSSProperties = {
    ...cardFaceStyle,
    transform: 'rotateY(180deg)'
  }

  return (
    <div style={containerStyle} onClick={handleFlip}>
      <div style={cardInnerStyle}>
        {/* Front side */}
        <div style={cardFrontStyle}>
          <div style={{ position: 'relative' }}>
            <img 
              src={imageUrl} 
              alt={title} 
              style={{ 
                width: '100%', 
                height: '192px', 
                objectFit: 'cover',
                transition: 'transform 0.3s',
              }}
            />
            <div style={{ 
              position: 'absolute', 
              inset: 0, 
              background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)', 
              opacity: 0.5 
            }}></div>
          </div>
          <div style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{title}</h3>
            <div style={{ 
              marginTop: '8px', 
              fontSize: '0.75rem', 
              color: '#c4b5fd',
            }}>Click to flip</div>
          </div>
        </div>

        {/* Back side */}
        <div style={cardBackStyle}>
          <div style={{ 
            padding: '16px', 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%', 
            justifyContent: 'space-between' 
          }}>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '8px' }}>{title}</h3>
              <p style={{ color: '#4ade80', fontSize: '1.25rem', marginBottom: '16px' }}>${price.toFixed(2)}</p>
            </div>

            <div>
              <div style={{ marginBottom: '16px' }}>
                <label htmlFor={`amount-${id}`} style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem' }}>
                  Amount:
                </label>
                <input
                  id={`amount-${id}`}
                  type="number"
                  min="1"
                  value={amount}
                  onChange={handleAmountChange}
                  style={{ 
                    width: '100%', 
                    padding: '8px 12px', 
                    backgroundColor: '#374151', 
                    borderRadius: '4px', 
                    color: 'white' 
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button 
                  style={{ 
                    backgroundColor: '#22c55e', 
                    color: 'white', 
                    padding: '8px 0', 
                    borderRadius: '4px',
                    transition: 'background-color 0.3s'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleBuy()
                  }}
                >
                  Buy
                </button>
                <button 
                  style={{ 
                    backgroundColor: '#ef4444', 
                    color: 'white', 
                    padding: '8px 0', 
                    borderRadius: '4px',
                    transition: 'background-color 0.3s'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSell()
                  }}
                >
                  Sell
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 