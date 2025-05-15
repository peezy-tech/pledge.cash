import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function useScreenSize() {
  const elemRef = useRef(null)
  const [width, setWidth] = useState(document.body.offsetWidth)
  const [height, setHeight] = useState(document.body.offsetHeight)
  useLayoutEffect(() => {
    const onResize = () => {
      setWidth(document.body.offsetWidth)
      setHeight(document.body.offsetHeight)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return [width, height]
}
