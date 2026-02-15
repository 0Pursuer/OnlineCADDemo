import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface CADViewerProps {
    geometryData?: any;
}

const CADViewer: React.FC<CADViewerProps> = ({ geometryData }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const meshRef = useRef<THREE.Mesh | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a1a);
        sceneRef.current = scene;

        // Initialize Camera
        const camera = new THREE.PerspectiveCamera(
            45,
            containerRef.current.clientWidth / containerRef.current.clientHeight,
            0.1,
            1000
        );
        camera.position.set(50, 50, 50);
        camera.lookAt(0, 0, 0);

        // Initialize Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Add Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(100, 100, 100);
        scene.add(dirLight);

        // Add Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // Add Grid
        const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
        scene.add(gridHelper);

        // Animation Loop
        const animate = () => {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        const handleResize = () => {
            if (!containerRef.current || !rendererRef.current) return;
            camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
            camera.updateProjectionMatrix();
            rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (containerRef.current && renderer.domElement) {
                containerRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
        };
    }, []);

    useEffect(() => {
        if (!sceneRef.current || !geometryData) return;

        // Clear previous mesh
        if (meshRef.current) {
            sceneRef.current.remove(meshRef.current);
            meshRef.current.geometry.dispose();
            (meshRef.current.material as THREE.Material).dispose();
        }

        // Create new geometry from mesh data
        if (geometryData.positions && geometryData.positions.length > 0) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometryData.positions, 3));

            if (geometryData.normals && geometryData.normals.length > 0) {
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geometryData.normals, 3));
            } else {
                geometry.computeVertexNormals();
            }

            const material = new THREE.MeshPhongMaterial({
                color: 0x4a90e2,
                specular: 0x111111,
                shininess: 30,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);
            sceneRef.current.add(mesh);
            meshRef.current = mesh;

            // Center camera on geometry
            geometry.computeBoundingSphere();
            if (geometry.boundingSphere) {
                // You could auto-zoom here if desired
            }
        }
    }, [geometryData]);

    return (
        <div ref={containerRef} className="w-full h-full min-h-[500px] border border-gray-700 rounded-lg overflow-hidden relative">
            <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 text-xs rounded pointer-events-none">
                Three.js Canvas
            </div>
        </div>
    );
};

export default CADViewer;
