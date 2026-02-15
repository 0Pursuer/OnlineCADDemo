import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface CADViewerProps {
    geometry?: any;
}

const CADViewer: React.FC<CADViewerProps> = ({ geometry }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const meshRef = useRef<THREE.Mesh | null>(null);
    const edgesRef = useRef<THREE.LineSegments | null>(null);
    const toolMeshRef = useRef<THREE.Mesh | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a); // Slightly darker
        sceneRef.current = scene;

        // Initialize Camera
        const camera = new THREE.PerspectiveCamera(
            45,
            containerRef.current.clientWidth / containerRef.current.clientHeight,
            0.1,
            1000
        );
        camera.position.set(60, 60, 60);
        camera.lookAt(0, 0, 0);

        // Initialize Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Add Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);

        // Main Directional Light (Sun-like)
        const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
        sunLight.position.set(50, 100, 50);
        scene.add(sunLight);

        const pointLight1 = new THREE.PointLight(0x3b82f6, 0.5); // Subtle blue fill
        pointLight1.position.set(-100, 50, 100);
        scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0xffffff, 0.5);
        pointLight2.position.set(-100, -50, -100);
        scene.add(pointLight2);

        // Add Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // Add Grid
        const gridHelper = new THREE.GridHelper(100, 50, 0x333333, 0x222222);
        scene.add(gridHelper);

        // Animation Loop
        const animate = () => {
            const req = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        const animId = requestAnimationFrame(animate);

        const handleResize = () => {
            if (!containerRef.current || !rendererRef.current) return;
            camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
            camera.updateProjectionMatrix();
            rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animId);
            if (containerRef.current && renderer.domElement) {
                containerRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
        };
    }, []);

    useEffect(() => {
        if (!sceneRef.current || !geometry) return;

        // Clear previous meshes
        if (meshRef.current) {
            sceneRef.current.remove(meshRef.current);
            meshRef.current.geometry.dispose();
            (meshRef.current.material as THREE.Material).dispose();
            meshRef.current = null;
        }
        if (edgesRef.current) {
            sceneRef.current.remove(edgesRef.current);
            edgesRef.current.geometry.dispose();
            (edgesRef.current.material as THREE.Material).dispose();
            edgesRef.current = null;
        }
        if (toolMeshRef.current) {
            sceneRef.current.remove(toolMeshRef.current);
            toolMeshRef.current.geometry.dispose();
            (toolMeshRef.current.material as THREE.Material).dispose();
            toolMeshRef.current = null;
        }

        // 1. Render Main Geometry
        if (geometry.positions && geometry.positions.length > 0) {
            const threeGeo = new THREE.BufferGeometry();
            threeGeo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.positions, 3));

            if (geometry.normals && geometry.normals.length > 0) {
                threeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.normals, 3));
            } else {
                threeGeo.computeVertexNormals();
            }

            const material = new THREE.MeshPhongMaterial({
                color: 0x3b82f6,
                specular: 0x444444,
                shininess: 80,
                side: THREE.DoubleSide,
                flatShading: false
            });

            const mesh = new THREE.Mesh(threeGeo, material);
            sceneRef.current.add(mesh);
            meshRef.current = mesh;

            // Add Edges/Wireframe highlight
            const edgesGeo = new THREE.EdgesGeometry(threeGeo, 20); // 20 deg threshold
            const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.6 });
            const edges = new THREE.LineSegments(edgesGeo, edgesMat);
            sceneRef.current.add(edges);
            edgesRef.current = edges;

            threeGeo.computeBoundingSphere();
        }

        // 2. Render Tool Mesh (Ghost Preview - Fainter now)
        if (geometry.toolMesh && geometry.toolMesh.positions && geometry.toolMesh.positions.length > 0) {
            const toolGeo = new THREE.BufferGeometry();
            toolGeo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.toolMesh.positions, 3));

            if (geometry.toolMesh.normals && geometry.toolMesh.normals.length > 0) {
                toolGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.toolMesh.normals, 3));
            } else {
                toolGeo.computeVertexNormals();
            }

            const toolMaterial = new THREE.MeshPhongMaterial({
                color: 0xa855f7,
                transparent: true,
                opacity: 0.15,    // Much fainter as requested
                side: THREE.DoubleSide,
                depthWrite: false
            });

            const toolMesh = new THREE.Mesh(toolGeo, toolMaterial);
            sceneRef.current.add(toolMesh);
            toolMeshRef.current = toolMesh;
        }
    }, [geometry]);

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden">
            {/* Overlay indicators could go here */}
        </div>
    );
};

export default CADViewer;
