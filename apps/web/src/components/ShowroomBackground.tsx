import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { Suspense, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';

// Top level constants
const CAMERA_POSITION: [number, number, number] = [0, 2, 7]; // Raised y-value from 0 to 2
const CAMERA_FOV = 60;
const CAMERA_FAR = 1000;
const AUTO_ROTATE_SPEED = 0.3; // Slowed from 0.5 to 0.3

function ShowroomModel() {
  const gltf = useLoader(GLTFLoader, '/showroom.glb');
  const modelRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (modelRef.current) {
      // Subtle rotation animation
      modelRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.1) * 0.1;
    }
  });

  return (
    <primitive 
      ref={modelRef}
      object={gltf.scene} 
      scale={1.5} 
      position={[0, -1, 0]} 
    />
  );
}

export default function ShowroomBackground() {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: -1,
      overflow: 'hidden',
    }}>
      <Canvas 
        style={{ display: 'block' }}
        camera={{ 
          position: CAMERA_POSITION, 
          fov: CAMERA_FOV,
          far: CAMERA_FAR,
        }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 10, 5]} intensity={1.2} />
        <Suspense fallback={null}>
          <ShowroomModel />
          <Environment preset="city" />
          <OrbitControls 
            enableZoom={false} 
            enablePan={false}
            autoRotate
            autoRotateSpeed={AUTO_ROTATE_SPEED}
            maxPolarAngle={Math.PI / 2}
            minPolarAngle={Math.PI / 3}
          />
        </Suspense>
      </Canvas>
    </div>
  );
} 