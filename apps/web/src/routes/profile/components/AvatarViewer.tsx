import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useAnimations } from '@react-three/drei'
import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useVRMloader } from '@/hooks/useVrmloader'
import { useClips } from '@/hooks/useClips'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface AvatarViewerProps {
  avatarUrl: string
}

interface ModelProps {
  url: string
  onHeadPositionKnown: (headPosition: THREE.Vector3) => void
}

function Model({ url, onHeadPositionKnown }: ModelProps) {
  const vrm = useVRMloader(url)
  const clips = useClips(vrm)
  const { mixer, actions } = useAnimations(clips, vrm.scene)

  useEffect(() => {
    if (actions.idle) {
      actions.idle.setEffectiveTimeScale(0.5)
      actions.idle.play()
    } else {
      console.error('No idle animation found')
    }
  }, [actions])

  useEffect(() => {
    // VRM is guaranteed to exist from the hook
    const humanoid = vrm.humanoid;
    if (!humanoid) {
      console.warn('VRM loaded, but humanoid data not available. Using default target.');
      onHeadPositionKnown(new THREE.Vector3(0, 1.0, 0));
      return;
    }
    
    const headBone = humanoid.getNormalizedBoneNode('head');
    if (headBone) {
      const headPosition = new THREE.Vector3();
      headBone.getWorldPosition(headPosition);
      onHeadPositionKnown(headPosition);
    } else {
      console.warn('Head bone not found in VRM. Falling back to hips or default.');
      const hipsBone = humanoid.getNormalizedBoneNode('hips');
      if (hipsBone) {
        const fallbackPosition = new THREE.Vector3();
        hipsBone.getWorldPosition(fallbackPosition);
        // Adjust Y if needed, hips are usually lower than desired target
        fallbackPosition.y += 0.8; // Example adjustment to approximate head height
        onHeadPositionKnown(fallbackPosition);
      } else {
        // Absolute fallback if no hips either
        onHeadPositionKnown(new THREE.Vector3(0, 1.0, 0)); // Default Y an assumption
      }
    }
  }, [vrm, onHeadPositionKnown])

  useFrame((_, delta) => {
    // VRM and mixer are guaranteed to exist
    vrm.update(delta)
    mixer.update(delta)
  })

  if (!vrm) {
    return null
  }

  return (
    <>
      <group position={[0, 0, 0]} rotation={[0, 0, 0]}>
        <primitive object={vrm.scene} />
      </group>
    </>
  )
}

export function AvatarViewer({ avatarUrl }: AvatarViewerProps) {
  const CAMERA_DISTANCE = 1.5; // Single value to control camera distance
  const VERTICAL_OFFSET = -0.2; // Constant to offset both look-at point and camera height
  const [orbitTarget, setOrbitTarget] = useState<THREE.Vector3>(() => new THREE.Vector3(0, 1.5, 0))
  const cameraRef = useRef<THREE.PerspectiveCamera>(null)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  const handleHeadPositionKnown = useCallback((newLookAtTarget: THREE.Vector3) => {
    // Apply vertical offset to the look-at target
    const adjustedTarget = newLookAtTarget.clone()
    adjustedTarget.y += VERTICAL_OFFSET
    setOrbitTarget(adjustedTarget)
  }, [setOrbitTarget, VERTICAL_OFFSET])

  // Effect to update camera whenever head position changes
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    
    // Position camera at proper height looking at the head
    // The orbitTarget already has the VERTICAL_OFFSET applied
    const newCameraPos = orbitTarget.clone().add(new THREE.Vector3(0, 0.05, CAMERA_DISTANCE));
    camera.position.copy(newCameraPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(orbitTarget);
    
    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(orbitTarget);
      controls.update();
    }
  }, [orbitTarget, CAMERA_DISTANCE])

  return (
    <div className="w-full h-[70vh] bg-gray-800 rounded">
      <Canvas
        camera={{ position: [0, 1.5, CAMERA_DISTANCE], fov: 50 }}
        onCreated={({ camera }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera
        }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[2.5, 8, 5]} intensity={1} />
        <Suspense fallback={null}>
          <Model
            key={avatarUrl}
            url={avatarUrl}
            onHeadPositionKnown={handleHeadPositionKnown}
          />
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          target={orbitTarget.toArray() as [number, number, number]} // Controlled target
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  )
} 