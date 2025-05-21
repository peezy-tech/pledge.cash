import { useEffect, useRef } from 'react';
import * as THREE from 'three';
// import Stats from 'stats.js';

const SpaceBackground = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Performance stats setup
    // const stats = new Stats();
    // stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3: custom
    // stats.dom.style.position = 'absolute';
    // stats.dom.style.top = '0px';
    // stats.dom.style.left = '0px';
    // document.body.appendChild(stats.dom);
    
    // Scene setup
    const scene = new THREE.Scene();
    
    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 5;
    
    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ 
      alpha: true,
      antialias: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000005, 1); // Darker background
    containerRef.current.appendChild(renderer.domElement);
    
    // Create stars - reduced count
    const starCount = 5000;
    const starPositions = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starColors = new Float32Array(starCount * 3);
    const starSparkle = new Float32Array(starCount); // New array for sparkle flag
    
    // Create a star field with better depth distribution
    for (let i = 0; i < starCount * 3; i += 3) {
      // Create stars with better depth distribution
      const depth = Math.pow(Math.random(), 2); // Quadratic distribution for more distant stars
      
      // More stars in the distance, fewer in the foreground
      const distance = 50 + 200 * depth; // Stars go much further (up to 250 units away)
      const angle1 = Math.random() * Math.PI * 2;
      const angle2 = Math.random() * Math.PI * 2;
      
      starPositions[i] = Math.sin(angle1) * Math.cos(angle2) * distance;     // x
      starPositions[i + 1] = Math.sin(angle1) * Math.sin(angle2) * distance; // y
      starPositions[i + 2] = Math.cos(angle1) * distance - 100; // z - pushed back
      
      // Varied star sizes with smaller stars in the distance
      starSizes[i/3] = Math.random() * 0.5 + 0.2;
      
      // Make more stars twinkle (80% chance)
      const shouldTwinkle = Math.random() < 0.8;
      
      // Subtler star colors - mostly white/off-white with subtle variations
      const colorType = Math.random();
      
      if (colorType < 0.65) {
        // White stars with very slight variations
        const brightness = 0.85 + Math.random() * 0.15;
        starColors[i] = brightness; // R
        starColors[i + 1] = brightness; // G
        starColors[i + 2] = brightness; // B
        starSparkle[i/3] = shouldTwinkle ? 1.0 : 0.0; // Many white stars twinkle
      } else if (colorType < 0.75) {
        // Warm white (cream/ivory) - more noticeable
        const brightness = 0.85 + Math.random() * 0.15;
        starColors[i] = brightness; // R - full brightness
        starColors[i + 1] = brightness - 0.25; // G - more reduced
        starColors[i + 2] = brightness - 0.35; // B - significantly reduced
        starSparkle[i/3] = shouldTwinkle ? 0.5 : 0.0; // Some warm stars twinkle a bit
      } else if (colorType < 0.85) {
        // Cool white (bluish white) - more noticeable
        const brightness = 0.85 + Math.random() * 0.15;
        starColors[i] = brightness - 0.35; // R - significantly reduced
        starColors[i + 1] = brightness - 0.25; // G - more reduced
        starColors[i + 2] = brightness; // B - full brightness
        starSparkle[i/3] = shouldTwinkle ? 0.5 : 0.0; // Some cool stars twinkle a bit
      } else if (colorType < 0.92) {
        // Yellow tint - more noticeable
        const brightness = 0.85 + Math.random() * 0.15;
        starColors[i] = brightness; // R - full brightness
        starColors[i + 1] = brightness - 0.1; // G - slight reduction
        starColors[i + 2] = brightness - 0.4; // B - significantly reduced
        starSparkle[i/3] = 0.0; // No sparkle
      } else if (colorType < 0.98) {
        // Red tint - more noticeable
        const brightness = 0.85 + Math.random() * 0.15;
        starColors[i] = brightness; // R - full brightness
        starColors[i + 1] = brightness - 0.4; // G - significantly reduced
        starColors[i + 2] = brightness - 0.4; // B - significantly reduced
        starSparkle[i/3] = 0.0; // No sparkle
      } else {
        // Blue tint - more noticeable
        const brightness = 0.85 + Math.random() * 0.15;
        starColors[i] = brightness - 0.4; // R - significantly reduced
        starColors[i + 1] = brightness - 0.4; // G - significantly reduced
        starColors[i + 2] = brightness; // B - full brightness
        starSparkle[i/3] = 0.0; // No sparkle
      }
      
      // Make some stars larger to represent planets or distant suns
      if (Math.random() < 0.03) {
        starSizes[i/3] *= 2.5; // Occasional larger stars
      }
    }
    
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starGeometry.setAttribute('sparkle', new THREE.BufferAttribute(starSparkle, 1)); // Add sparkle attribute
    
    // Custom shader material with more natural star appearance
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        attribute float sparkle;
        uniform float time;
        varying float vSize;
        varying vec3 vColor;
        varying float vSparkle; // Pass sparkle to fragment shader
        
        void main() {
          vSize = size;
          vColor = color;
          vSparkle = sparkle;
          
          // Twinkling effect with minimal size variation
          float twinkle = 1.0;
          if (sparkle > 0.0) {
            // Calculate twinkling brightness variation
            float frequency = sparkle > 0.5 ? 1.0 : 0.5; // Full or partial frequency
            float flicker1 = sin(time * 0.5 + position.x * 0.1) * 0.7 * frequency;
            float flicker2 = sin(time * 0.7 + position.y * 0.2) * 0.6 * frequency;
            float flicker3 = sin(time * 0.9 + position.z * 0.3) * 0.5 * frequency;
            twinkle = 0.6 + flicker1 + flicker2 + flicker3;
            // Clamp to avoid negative values
            twinkle = max(0.2, twinkle);
          }
          
          // Adjust size based on z-position for depth effect
          float depth = clamp(1.0 - (-position.z / 300.0), 0.1, 1.0);
          
          // Apply minimal size variation - only 15% variation for twinkling effect
          float sizeVar = 1.0;
          if (sparkle > 0.0) {
            sizeVar = 0.925 + (twinkle - 0.6) * 0.15; // Reduce size variation to just ±7.5%
          }
          
          gl_PointSize = size * sizeVar * 11.25 * depth; // Reduced by 25% from 15.0
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vSize;
        varying float vSparkle; // Receive sparkle from vertex shader
        
        void main() {
          // Less perfect circular shape with some randomness
          float r = length(gl_PointCoord - vec2(0.5, 0.5)) * 2.0;
          
          // Add some imperfection to the edge
          float wobble = sin(gl_PointCoord.x * 12.0) * sin(gl_PointCoord.y * 9.0) * 0.05;
          r += wobble;
          
          if (r > 1.0) discard;
          
          // Softer falloff at the edges
          float alpha = 1.0 - smoothstep(0.6, 1.0, r);
          
          // Add a glow effect, but less intense to preserve colors
          float glow = smoothstep(0.8, 0.0, r);
          vec3 finalColor = vColor;
          
          // Reduced glow for twinkling stars to preserve colors
          if (vSparkle > 0.0) {
            finalColor = vColor * (1.0 + glow * 1.2); // Reduced from 2.0 to 1.2
          } else {
            finalColor = vColor * (1.0 + glow * 0.6); // Slightly increased from 0.4 to 0.6
          }
          
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    
    // Add a much larger nebula glow in the background
    const nebulaTexture = new THREE.TextureLoader().load(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mM08vSsBwAB/gG8PGm8BQAAAABJRU5ErkJggg=='
    );
    const nebulaGeometry = new THREE.PlaneGeometry(400, 400); // Doubled size
    const nebulaMaterial = new THREE.MeshBasicMaterial({
      map: nebulaTexture,
      transparent: true,
      opacity: 0.15, // Slightly increased opacity
      color: 0x1133cc, // Slightly more vibrant blue
      blending: THREE.AdditiveBlending,
    });
    
    const nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
    nebula.position.z = -20; // Pushed back further to encompass more of the scene
    scene.add(nebula);
    
    // Handle window resize
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);
    
    // Animation loop
    let time = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      
      // Begin measuring performance
      // stats.begin();
      
      // Update time for star twinkling - slower for more visible effect
      time += 0.01; // Increased time step for more noticeable twinkling
      starMaterial.uniforms.time.value = time;
      
      // Camera orbit instead of star rotation
      const radius = 10;
      const speed = 0.00005;
      camera.position.x = Math.sin(time * speed) * radius;
      camera.position.z = Math.cos(time * speed) * radius + 10; // Keep some distance
      camera.lookAt(scene.position); // Keep camera looking at center
      
      renderer.render(scene, camera);
      
      // End measuring performance
      // stats.end();
    };
    
    animate();
    
    // Cleanup on unmount
    return () => {
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      window.removeEventListener('resize', handleResize);
      
      // Remove stats from DOM
      // document.body.removeChild(stats.dom);
      
      // Dispose resources
      starGeometry.dispose();
      starMaterial.dispose();
      nebulaGeometry.dispose();
      nebulaMaterial.dispose();
      nebulaTexture.dispose();
      renderer.dispose();
    };
  }, []);
  
  return (
    <div 
      ref={containerRef} 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        overflow: 'hidden',
        pointerEvents: 'none', // Allow clicking through to content
      }}
    />
  );
};

export default SpaceBackground; 