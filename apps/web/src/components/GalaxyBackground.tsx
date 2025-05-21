import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

const createBlobTexture = () => {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Clear canvas
  ctx.clearRect(0, 0, size, size);

  // Draw multiple, slightly offset and varied circles to create a blob shape
  const numCircles = 3 + Math.floor(Math.random() * 3); // 3 to 5 circles
  const baseRadius = size / 4;

  for (let i = 0; i < numCircles; i++) {
    const offsetX = (Math.random() - 0.5) * baseRadius * 0.5; // Smaller offset
    const offsetY = (Math.random() - 0.5) * baseRadius * 0.5;
    const radius = baseRadius * (0.8 + Math.random() * 0.4); // Vary radius slightly
    const alpha = 0.3 + Math.random() * 0.3; // Vary alpha

    const gradient = ctx.createRadialGradient(
      size / 2 + offsetX,
      size / 2 + offsetY,
      0,
      size / 2 + offsetX,
      size / 2 + offsetY,
      radius
    );
    gradient.addColorStop(0, `rgba(255,255,255,${alpha * 0.7})`);
    gradient.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.3})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2 + offsetX, size / 2 + offsetY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
};

const GalaxyBackground: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000011); // Temporary dark blue background for testing
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true }); // alpha: true for transparent background

    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    camera.position.z = 10; // Adjusted camera position

    // Post-processing
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Create blob texture
    const blobTexture = createBlobTexture();

    // Stars
    const starGeometry = new THREE.BufferGeometry();
    const starColors = [];
    const offWhiteColors = [
      new THREE.Color(0xFFFFFF), // White
      new THREE.Color(0xADDFFF), // Light Blue (brighter)
      new THREE.Color(0xFFEAEA), // Misty Rose (brighter pale pinkish)
      new THREE.Color(0xE6FFFF), // Light Cyan (brighter)
      new THREE.Color(0xFFFDD0), // Lemon Chiffon (brighter pale yellow)
    ];
    const starMaterial = new THREE.PointsMaterial({
      size: 0.3,
      vertexColors: true,
      map: blobTexture,
      transparent: true,
      alphaTest: 0.1, // Adjust as needed, prevents fully transparent pixels from being rendered
    }); // Colored points (planets) - size increased
    const starVertices = [];
    for (let i = 0; i < 500; i++) { // 25% of 10000 particles
      const x = (Math.random() - 0.5) * 20; // Reduced spread
      const y = (Math.random() - 0.5) * 20; // Reduced spread
      const z = (Math.random() - 0.5) * 20; // Reduced spread
      starVertices.push(x, y, z);

      const color = offWhiteColors[Math.floor(Math.random() * offWhiteColors.length)];
      starColors.push(color.r, color.g, color.b);
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Planets
    const planetMaterial = new THREE.PointsMaterial({
      color: 0xf0f0f0,
      size: 0.05,
      transparent: true,
      opacity: 0.8,
      map: blobTexture,
      alphaTest: 0.1, // Adjust as needed
    }); // White points (stars) - size decreased
    const planetVertices = [];
     for (let i = 0; i < 7500; i++) { // 75% of 10000 particles
      const x = (Math.random() - 0.5) * 20; // Reduced spread
      const y = (Math.random() - 0.5) * 20; // Reduced spread
      const z = (Math.random() - 0.5) * 20; // Reduced spread
      planetVertices.push(x, y, z);
    }
    const planetGeometry = new THREE.BufferGeometry();
    planetGeometry.setAttribute('position', new THREE.Float32BufferAttribute(planetVertices, 3));
    const planets = new THREE.Points(planetGeometry, planetMaterial);
    scene.add(planets);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight); // Resize composer
    };

    window.addEventListener('resize', handleResize);

    const animate = () => {
      requestAnimationFrame(animate);
      stars.rotation.x += 0.0001;
      stars.rotation.y += 0.0001;
      planets.rotation.x += 0.00005;
      planets.rotation.y += 0.00005;
      composer.render();
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      planetGeometry.dispose();
      planetMaterial.dispose();
      if (blobTexture) {
        blobTexture.dispose();
      }
    };
  }, []);

  return <div ref={mountRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: -1 }} />;
};

export default GalaxyBackground; 