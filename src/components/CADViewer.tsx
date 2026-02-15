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
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            logarithmicDepthBuffer: true // Better depth precision for close surfaces
        });
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
        gridHelper.position.y = -0.02; // Small offset to prevent Z-fighting with Z=0 faces
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

        // 1. Render Main Geometry (Result)
        if (geometry.finalMesh && geometry.finalMesh.positions && geometry.finalMesh.positions.length > 0) {
            const threeGeo = new THREE.BufferGeometry();
            threeGeo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.finalMesh.positions, 3));

            if (geometry.finalMesh.normals && geometry.finalMesh.normals.length > 0) {
                threeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.finalMesh.normals, 3));
            } else {
                threeGeo.computeVertexNormals();
            }

            const material = new THREE.MeshPhongMaterial({
                color: 0x3b82f6,
                specular: 0x444444,
                shininess: 80,
                side: THREE.DoubleSide, // Reverted to DoubleSide for robust CAD rendering
                flatShading: false,
                transparent: !!geometry.activeMesh,
                opacity: geometry.activeMesh ? 0.3 : 1.0,
                depthWrite: !geometry.activeMesh,
                polygonOffset: true,
                polygonOffsetFactor: 1, // Lowered offset
                polygonOffsetUnits: 1
            });

            const mesh = new THREE.Mesh(threeGeo, material);
            sceneRef.current.add(mesh);
            meshRef.current = mesh;

            // Add Edges/Wireframe highlight
            const edgesGeo = new THREE.EdgesGeometry(threeGeo, 20);
            const edgesMat = new THREE.LineBasicMaterial({
                color: 0xffffff,
                linewidth: 2,
                transparent: true,
                opacity: geometry.activeMesh ? 0.1 : 0.6,
                depthWrite: false
            });
            const edges = new THREE.LineSegments(edgesGeo, edgesMat);
            // Push edges slightly out to prevent face occlusion
            edges.scale.setScalar(1.001);
            sceneRef.current.add(edges);
            edgesRef.current = edges;

            threeGeo.computeBoundingSphere();
        }

        // 2. Render Active Mesh (Pink Highlight Preview)
        if (geometry.activeMesh && geometry.activeMesh.positions && geometry.activeMesh.positions.length > 0) {
            const activeGeo = new THREE.BufferGeometry();
            activeGeo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.activeMesh.positions, 3));

            if (geometry.activeMesh.normals && geometry.activeMesh.normals.length > 0) {
                activeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.activeMesh.normals, 3));
            } else {
                activeGeo.computeVertexNormals();
            }

            const activeMaterial = new THREE.MeshPhongMaterial({
                color: 0xff007f, // Bright Pink
                specular: 0xffffff,
                shininess: 100,
                side: THREE.DoubleSide, // Must be DoubleSide
                transparent: true,
                opacity: 0.7,
                polygonOffset: true,
                polygonOffsetFactor: -1, // Balanced offset
                polygonOffsetUnits: -1,
                depthWrite: true,
                depthTest: true
            });

            const activeMesh = new THREE.Mesh(activeGeo, activeMaterial);
            // Slightly scale active mesh if it is a perfect overlap
            activeMesh.scale.setScalar(1.0002); // Lower scaling
            sceneRef.current.add(activeMesh);
            toolMeshRef.current = activeMesh;
        }
    }, [geometry]);

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden">
            {/* Overlay indicators could go here */}
        </div>
    );
};

export default CADViewer;
