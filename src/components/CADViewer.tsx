import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface CADViewerProps {
    geometry?: any;
    onEdgeClick?: (edgeId: number) => void;
    selectedEdgeIds?: number[];
}

const CADViewer: React.FC<CADViewerProps> = ({ geometry, onEdgeClick, selectedEdgeIds }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const meshRef = useRef<THREE.Mesh | null>(null);
    const edgesRef = useRef<THREE.LineSegments | null>(null); // Visual outlines
    const extraEdgesRef = useRef<THREE.LineSegments | null>(null);
    const edgeMeshRef = useRef<THREE.LineSegments | null>(null);
    const toolMeshRef = useRef<THREE.Mesh | null>(null);

    // Interaction Refs
    const raycasterRef = useRef(new THREE.Raycaster());
    const mouseRef = useRef(new THREE.Vector2(-1, -1));
    const materialShaderRef = useRef<any>(null);
    const activeMaterialShaderRef = useRef<any>(null);
    const edgeMaterialShaderRef = useRef<any>(null);
    const needsRaycastRef = useRef(false);

    // Refs for props to avoid stale closures in event listeners
    const onEdgeClickRef = useRef(onEdgeClick);
    const selectedEdgeIdsRef = useRef(selectedEdgeIds);

    useEffect(() => {
        onEdgeClickRef.current = onEdgeClick;
    }, [onEdgeClick]);

    useEffect(() => {
        selectedEdgeIdsRef.current = selectedEdgeIds;
        // Also update uniforms immediately if shader exists
        if (edgeMaterialShaderRef.current) {
            const arr = new Float32Array(20).fill(-1.0);
            (selectedEdgeIds || []).slice(0, 20).forEach((id, i) => arr[i] = id);
            edgeMaterialShaderRef.current.uniforms.uSelectedEdgeIds.value = arr;
        }
    }, [selectedEdgeIds]);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
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
        cameraRef.current = camera;

        // Initialize Renderer
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            logarithmicDepthBuffer: true
        });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
        sunLight.position.set(50, 100, 50);
        scene.add(sunLight);

        const pointLight1 = new THREE.PointLight(0x3b82f6, 0.5);
        pointLight1.position.set(-100, 50, 100);
        scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0xffffff, 0.5);
        pointLight2.position.set(-100, -50, -100);
        scene.add(pointLight2);

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // Grid
        const gridHelper = new THREE.GridHelper(100, 50, 0x333333, 0x222222);
        gridHelper.position.y = -0.02;
        scene.add(gridHelper);

        // Interaction Handler
        const onPointerMove = (event: PointerEvent) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            needsRaycastRef.current = true;
        };
        containerRef.current.addEventListener('pointermove', onPointerMove);

        const onClick = (event: MouseEvent) => {
            if (!cameraRef.current || !edgeMeshRef.current) return;

            // Prioritize edge picking
            raycasterRef.current.params.Line.threshold = 0.5;
            raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
            const edgeIntersects = raycasterRef.current.intersectObject(edgeMeshRef.current);

            if (edgeIntersects.length > 0) {
                const index = edgeIntersects[0].index;
                if (index !== undefined) {
                    const attr = edgeMeshRef.current.geometry.getAttribute('aEdgeId');
                    if (attr) {
                        const edgeId = attr.getX(index);
                        console.log(`CADViewer: Edge clicked: ${edgeId}`);
                        if (onEdgeClickRef.current) onEdgeClickRef.current(edgeId);
                        return;
                    }
                }
            }
        };
        containerRef.current.addEventListener('click', onClick);

        // Animation Loop
        const animate = () => {
            const req = requestAnimationFrame(animate);
            controls.update();

            // Raycasting logic
            if (needsRaycastRef.current && cameraRef.current) {
                raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

                // 1. Face Raycasting
                const rayTargets = [];
                if (meshRef.current) rayTargets.push(meshRef.current);
                if (toolMeshRef.current) rayTargets.push(toolMeshRef.current);

                if (rayTargets.length > 0) {
                    const intersects = raycasterRef.current.intersectObjects(rayTargets);
                    let hoveredFaceId = -1.0;
                    if (intersects.length > 0) {
                        const intersected = intersects[0];
                        const faceIndex = intersected.faceIndex;
                        const targetMesh = intersected.object as THREE.Mesh;
                        if (faceIndex !== undefined) {
                            const attribute = targetMesh.geometry.getAttribute('aFaceId');
                            if (attribute) hoveredFaceId = attribute.getX(faceIndex * 3);
                        }
                    }
                    if (materialShaderRef.current) {
                        materialShaderRef.current.uniforms.uHoverFaceId.value = hoveredFaceId;
                    }
                    if (activeMaterialShaderRef.current) {
                        activeMaterialShaderRef.current.uniforms.uHoverFaceId.value = hoveredFaceId;
                    }
                }

                // 2. Edge Raycasting
                if (edgeMeshRef.current) {
                    const edgeThreshold = 0.5;
                    raycasterRef.current.params.Line.threshold = edgeThreshold;
                    const edgeIntersects = raycasterRef.current.intersectObject(edgeMeshRef.current);
                    let hoveredEdgeId = -1.0;
                    if (edgeIntersects.length > 0) {
                        const index = edgeIntersects[0].index;
                        if (index !== undefined) {
                            const attr = edgeMeshRef.current.geometry.getAttribute('aEdgeId');
                            if (attr) hoveredEdgeId = attr.getX(index);
                        }
                    }
                    if (edgeMaterialShaderRef.current) {
                        edgeMaterialShaderRef.current.uniforms.uHoverEdgeId.value = hoveredEdgeId;
                    }
                }

                needsRaycastRef.current = false;
            }

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
            if (containerRef.current) {
                containerRef.current.removeEventListener('pointermove', onPointerMove);
                containerRef.current.removeEventListener('click', onClick);
            }
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
            materialShaderRef.current = null;
        }
        if (activeMaterialShaderRef.current) {
            activeMaterialShaderRef.current = null;
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
        if (edgeMeshRef.current) {
            sceneRef.current.remove(edgeMeshRef.current);
            edgeMeshRef.current.geometry.dispose();
            (edgeMeshRef.current.material as THREE.Material).dispose();
            edgeMeshRef.current = null;
            edgeMaterialShaderRef.current = null;
        }
        if (extraEdgesRef.current) {
            sceneRef.current.remove(extraEdgesRef.current);
            extraEdgesRef.current.geometry.dispose();
            (extraEdgesRef.current.material as THREE.Material).dispose();
            extraEdgesRef.current = null;
        }

        // 1. Render Main Geometry (Result)
        if (geometry.finalMesh && geometry.finalMesh.positions && geometry.finalMesh.positions.length > 0) {
            const threeGeo = new THREE.BufferGeometry();
            threeGeo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.finalMesh.positions, 3));

            // Set index buffer if available (shared vertices + triangle indices)
            if (geometry.finalMesh.indices && geometry.finalMesh.indices.length > 0) {
                threeGeo.setIndex(Array.from(geometry.finalMesh.indices));
            }

            if (geometry.finalMesh.normals && geometry.finalMesh.normals.length > 0) {
                threeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.finalMesh.normals, 3));
            } else {
                threeGeo.computeVertexNormals();
            }

            // Face Picking Attribute
            if (geometry.finalMesh.faceIds) {
                threeGeo.setAttribute('aFaceId', new THREE.Float32BufferAttribute(geometry.finalMesh.faceIds, 1));
            }

            const material = new THREE.MeshPhongMaterial({
                color: 0x3b82f6,
                specular: 0x444444,
                shininess: 80,
                side: THREE.DoubleSide,
                flatShading: false,
                transparent: !!geometry.activeMesh,
                opacity: geometry.activeMesh ? 0.3 : 1.0,
                depthWrite: !geometry.activeMesh,
                depthWrite: !geometry.activeMesh,
                polygonOffset: true,
                polygonOffsetFactor: 4.0, // Push background back significantly
                polygonOffsetUnits: 1.0
            });

            material.onBeforeCompile = (shader) => {
                shader.uniforms.uHoverFaceId = { value: -1.0 };
                shader.vertexShader = 'attribute float aFaceId;\nvarying float vFaceId;\n' + shader.vertexShader;
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\nvFaceId = aFaceId;'
                );
                shader.fragmentShader = 'uniform float uHoverFaceId;\nvarying float vFaceId;\n' + shader.fragmentShader;
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    '#include <dithering_fragment>\n' +
                    'if (uHoverFaceId >= 0.0 && abs(vFaceId - uHoverFaceId) < 0.1) {\n' +
                    '    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.8, 0.0), 0.5);\n' +
                    '}'
                );
                materialShaderRef.current = shader;
            };

            const mesh = new THREE.Mesh(threeGeo, material);
            sceneRef.current.add(mesh);
            meshRef.current = mesh;

            // Visual wireframe
            const edgesGeo = new THREE.EdgesGeometry(threeGeo, 24);
            const edgesMat = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: geometry.activeMesh ? 0.2 : 0.4,
                depthWrite: false
            });
            const edgesLines = new THREE.LineSegments(edgesGeo, edgesMat);
            edgesLines.scale.setScalar(1.001);
            sceneRef.current.add(edgesLines);
            edgesRef.current = edgesLines;

            // 1b. Render Pickable Edges
            if (geometry.finalMesh.edgePositions && geometry.finalMesh.edgePositions.length > 0) {
                const edgeGeo = new THREE.BufferGeometry();
                edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.finalMesh.edgePositions, 3));
                edgeGeo.setAttribute('aEdgeId', new THREE.Float32BufferAttribute(geometry.finalMesh.edgeIds, 1));

                const edgeMaterial = new THREE.LineBasicMaterial({
                    color: 0xcccccc,
                    transparent: true,
                    opacity: 0.8,
                    depthWrite: false,
                    linewidth: 1,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1
                });

                edgeMaterial.onBeforeCompile = (shader) => {
                    shader.uniforms.uHoverEdgeId = { value: -1.0 };
                    // Initialize with current selection
                    const selectionArr = new Float32Array(20).fill(-1.0);
                    (selectedEdgeIdsRef.current || []).slice(0, 20).forEach((id, i) => selectionArr[i] = id);
                    shader.uniforms.uSelectedEdgeIds = { value: selectionArr };

                    shader.vertexShader = 'attribute float aEdgeId;\nvarying float vEdgeId;\n' + shader.vertexShader;
                    shader.vertexShader = shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        '#include <begin_vertex>\nvEdgeId = aEdgeId;'
                    );

                    shader.fragmentShader = 'uniform float uHoverEdgeId;\nuniform float uSelectedEdgeIds[20];\nvarying float vEdgeId;\n' + shader.fragmentShader;
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <dithering_fragment>',
                        '#include <dithering_fragment>\n' +
                        'bool isSelected = false;\n' +
                        'for(int i=0; i<20; i++) {\n' +
                        '    if (abs(vEdgeId - uSelectedEdgeIds[i]) < 0.1) { isSelected = true; break; }\n' +
                        '}\n' +
                        'if (isSelected) {\n' +
                        '    gl_FragColor.rgb = vec3(1.0, 0.4, 0.0);\n' +
                        '} else if (uHoverEdgeId >= 0.0 && abs(vEdgeId - uHoverEdgeId) < 0.1) {\n' +
                        '    gl_FragColor.rgb = vec3(1.0, 0.9, 0.2);\n' +
                        '}'
                    );
                    edgeMaterialShaderRef.current = shader;
                };

                const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMaterial);
                edgeMesh.renderOrder = 3;
                sceneRef.current.add(edgeMesh);
                edgeMeshRef.current = edgeMesh;
            }
        }

        // 2. Render Active Mesh (Preview)
        if (geometry.activeMesh && geometry.activeMesh.positions && geometry.activeMesh.positions.length > 0) {
            const activeGeo = new THREE.BufferGeometry();
            activeGeo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.activeMesh.positions, 3));

            if (geometry.activeMesh.indices && geometry.activeMesh.indices.length > 0) {
                activeGeo.setIndex(Array.from(geometry.activeMesh.indices));
            }

            if (geometry.activeMesh.faceIds) {
                activeGeo.setAttribute('aFaceId', new THREE.Float32BufferAttribute(geometry.activeMesh.faceIds, 1));
            }

            if (geometry.activeMesh.normals && geometry.activeMesh.normals.length > 0) {
                activeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.activeMesh.normals, 3));
            } else {
                activeGeo.computeVertexNormals();
            }

            const activeMaterial = new THREE.MeshPhongMaterial({
                color: 0xff007f,
                side: THREE.FrontSide,
                transparent: true,
                opacity: 0.5,
                depthWrite: true,
                depthWrite: true,
                depthTest: true,
                polygonOffset: true,
                polygonOffsetFactor: 1.0, // Push active mesh back slightly less than background
                polygonOffsetUnits: 1.0
            });

            activeMaterial.onBeforeCompile = (shader) => {
                shader.uniforms.uHoverFaceId = { value: -1.0 };
                shader.vertexShader = 'attribute float aFaceId;\nvarying float vFaceId;\n' + shader.vertexShader;
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\nvFaceId = aFaceId;'
                );
                shader.fragmentShader = 'uniform float uHoverFaceId;\nvarying float vFaceId;\n' + shader.fragmentShader;
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    '#include <dithering_fragment>\n' +
                    'if (uHoverFaceId >= 0.0 && abs(vFaceId - uHoverFaceId) < 0.1) {\n' +
                    '    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.8, 0.0), 0.5);\n' +
                    '}'
                );
                activeMaterialShaderRef.current = shader;
            };

            const activeMesh = new THREE.Mesh(activeGeo, activeMaterial);
            activeMesh.scale.setScalar(1.0002);
            activeMesh.renderOrder = 5;
            sceneRef.current.add(activeMesh);
            toolMeshRef.current = activeMesh;

            // Add clean outlines for the active mesh
            const activeEdgesGeo = new THREE.EdgesGeometry(activeGeo, 24);
            const activeEdgesMat = new THREE.LineBasicMaterial({
                color: 0xff007f,
                transparent: true,
                opacity: 0.8,
                depthTest: true
            });
            const activeEdges = new THREE.LineSegments(activeEdgesGeo, activeEdgesMat);
            activeEdges.scale.setScalar(1.0005);
            activeEdges.renderOrder = 6;
            sceneRef.current.add(activeEdges);
            extraEdgesRef.current = activeEdges;
        }
    }, [geometry]);

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden">
        </div>
    );
};

export default CADViewer;
